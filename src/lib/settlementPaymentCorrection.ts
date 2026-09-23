// 그쪽(정산 프로덕트)이 보내는 수취 정보(결제 수단) 정정 회신 — `POST …/requests/{id}/payment-info`의 순수 부분. DB 없음.
// 설계: docs/superpowers/specs/2026-09-21-settlement-payment-info-correction-design.md §3·§4. 그쪽 전달 문서: docs/api/settlement-external-api.md §6-1.
//
// 두 단계로 나눈다 — ① 본문 모양 검사(parsePaymentInfoCorrection: 요청을 찾기 전에 끝난다, 상태 POST와 같은 관례)
// ② 현재 스냅샷과 합쳐 수단 종류에 맞는지 검사(mergePaymentMethodCorrection: 행을 읽어야 하므로 스토어가 트랜잭션 안에서 부른다).
import { toMethodSnapshot, type PaymentMethodSnapshot } from './settlementCalc.ts';
import { PAYMENT_TYPE_LABEL, parsePaymentMethodInput, getDefaultPaymentMethod, type PaymentMethodType, type PaymentMethod, type PaymentMethodInput, type PaymentOp } from './influencerPayment.ts';
import { isUuidLike } from './uuid.ts';
import { parseOperatorField, parseIsoField, type StatusOperator } from './settlementExternal.ts';
import { MAX_PAYMENT_QR_BYTES } from './paymentQrInput.ts';

// 그쪽이 보내는 8키(snake_case). type·currency는 없다 — 수단 종류·통화를 바꾸는 것은 다른 의무라 on_hold + note로 알려 달라고 했다.
export const CORRECTION_KEYS = ['holder', 'paypal_id', 'email', 'identifier', 'qr', 'bank', 'branch', 'account'] as const;
export type CorrectionKey = (typeof CORRECTION_KEYS)[number];
const TO_CAMEL: Record<CorrectionKey, Exclude<keyof PaymentMethodSnapshot, 'type' | 'currency'>> = {
  holder: 'holder', paypal_id: 'paypalId', email: 'email', identifier: 'identifier', qr: 'qr', bank: 'bank', branch: 'branch', account: 'account',
};
// 수단 종류별로 고칠 수 있는 키. 다른 종류의 키(예: PayPal 수단에 bank)는 조용히 버리지 않고 400 — "정정했다고 믿은 값이 반영되지 않음"이 가장 나쁜 실패다.
const ALLOWED_BY_TYPE: Record<PaymentMethodType, readonly CorrectionKey[]> = {
  paypal: ['holder', 'email', 'paypal_id'],
  paypay: ['holder', 'identifier', 'qr'],
  bank: ['holder', 'bank', 'branch', 'account'],
};
// 비워서(null·"") 지울 수 있는 키 — 선택 항목만. paypal의 email·paypal_id는 둘 중 하나만 남으면 된다(influencerPayment 규칙이 다시 검사한다).
// qr을 넣는 이유: 잘못 올린 QR을 되돌릴 길이 필요하다.
const REMOVABLE: ReadonlySet<CorrectionKey> = new Set(['branch', 'email', 'paypal_id', 'qr']);
const VALUE_MAX = 200;
const REASON_MAX = 500;
const IDEM_MAX = 200;
// qr은 다른 키(홀더명·계좌번호 등)와 자릿수가 다른 값이다 — 200자 제한을 그대로 적용하면 실제 QR(수 KB~수십 KB)이
// 전부 400으로 막힌다(리뷰 2026-09-23 Critical 1). 상한은 paymentQrInput.ts의 MAX_PAYMENT_QR_BYTES(바이트 상한, 저장소에
// 넣기 직전 다시 검사)에서 파생시킨다 — 숫자를 두 곳에 따로 적지 않는다. base64는 3바이트→4글자(올림), 여기에
// "data:image/webp;base64," 같은 data URI 접두어 + 개행 등 여유를 크게 잡아 더한다.
const QR_VALUE_MAX = Math.ceil(MAX_PAYMENT_QR_BYTES / 3) * 4 + 256;

export interface PaymentInfoCorrection {
  correctionId: string;                                   // 그쪽 발급 uuid — 회신 상관관계·멱등 키
  baseRevision: number;                                   // 정정이 기준한 우리 revision(불일치 → 409 revision-mismatch)
  baseUpdatedAt: string;                                  // 기준 updated_at(정보용 — 판정에는 쓰지 않는다, 스펙 §4)
  patch: Partial<Record<CorrectionKey, string | null>>;   // 바뀐 키만. null = 그 키를 지운다(REMOVABLE만)
  operator: StatusOperator;                               // 정정을 실행한 그쪽 담당자(필수)
  reason: string;
  idempotencyKey: string | null;
}
export type CorrectionParse = { ok: true; correction: PaymentInfoCorrection } | { ok: false; field: string; error: string };
const bad = (field: string, error: string): CorrectionParse => ({ ok: false, field, error });

// 호출 기록(external_api_log.body)에 base64가 새지 않게 payment_method.qr 값을 지운다(리뷰 2026-09-23 Critical 2).
// route.ts가 recordExternalCallSafe에 원본 요청 본문(raw)을 넘기기 직전에 항상 이 함수를 거친다.
// 순수 함수 — DB·저장소 없이 테스트할 수 있다.
function qrPlaceholder(qr: string): string {
  return `<qr 이미지 ${qr.length}자>`;
}
export function maskQrInRawBody(raw: string): string {
  if (!raw) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const pm = (parsed as Record<string, unknown>).payment_method;
      if (pm !== null && typeof pm === 'object' && !Array.isArray(pm) && typeof (pm as Record<string, unknown>).qr === 'string') {
        (pm as Record<string, unknown>).qr = qrPlaceholder((pm as Record<string, unknown>).qr as string);
        return JSON.stringify(parsed);
      }
    }
    return raw;   // JSON은 맞지만 payment_method.qr이 문자열이 아니다 — 지울 게 없다
  } catch {
    // 깨진 JSON(그쪽이 잘못 보낸 본문) — 그래도 raw를 그대로 흘려보내면 이 함수를 만든 이유가 없다.
    // "qr":"<값>" 모양만 정규식으로 찾아 값만 치환한다(base64 data URI에는 따옴표가 안 나온다).
    return raw.replace(/("qr"\s*:\s*")([^"]*)(")/, (_m, pre: string, val: string, post: string) => `${pre}${qrPlaceholder(val)}${post}`);
  }
}

export function parsePaymentInfoCorrection(body: unknown): CorrectionParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('body', 'JSON 객체여야 해요');
  const o = body as Record<string, unknown>;
  if (typeof o.correction_id !== 'string' || !isUuidLike(o.correction_id)) return bad('correction_id', '정정 식별자(uuid)가 필요해요');
  const rev = o.base_source_revision;
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) return bad('base_source_revision', '0 이상의 정수여야 해요 — 정정이 기준한 아이템의 revision 값');
  const baseUpdatedAt = parseIsoField(o.base_source_updated_at);
  if (!baseUpdatedAt) return bad('base_source_updated_at', 'ISO 8601 시각이어야 해요');

  const pm = o.payment_method;
  if (typeof pm !== 'object' || pm === null || Array.isArray(pm)) return bad('payment_method', '바뀐 항목을 담은 객체여야 해요');
  const patch: PaymentInfoCorrection['patch'] = {};
  for (const [k, v] of Object.entries(pm as Record<string, unknown>)) {
    if (k === 'type' || k === 'currency') return bad(`payment_method.${k}`, '수단 종류·통화는 이 API로 바꿀 수 없어요 — on_hold + note로 알려 주세요');
    if (!(CORRECTION_KEYS as readonly string[]).includes(k)) return bad(`payment_method.${k}`, `고칠 수 없는 항목이에요 — ${CORRECTION_KEYS.join('·')}만 보낼 수 있어요`);
    const key = k as CorrectionKey;
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') return bad(`payment_method.${k}`, '문자열이어야 해요');
    const t = v === null ? '' : v.trim();
    const max = key === 'qr' ? QR_VALUE_MAX : VALUE_MAX;
    // qr만 공백을 턴 뒤 길이로 상한을 잰다(리뷰 2026-09-23 Minor 2). 일부 인코더는 base64를 76자마다 개행하는
    // 관행이 있어(RFC 2045) 5MB 이미지면 개행만 약 9만 자가 붙는데, QR_VALUE_MAX의 여유(256자)로는 그걸
    // 못 견딘다 — parseQrDataUri는 어차피 이 개행을 지우고 바이트를 재므로(§ 위 DATA_URI_RE), 여기서도 개행을
    // 뺀 길이로 재야 "실제로는 5MB 이하인데 개행 때문에 여기서 먼저 400"이 나지 않는다. qr이 아닌 항목(홀더명 등)은
    // 원문 그대로 200자를 지킨다 — 그런 값에서 공백은 사용자가 실제로 입력한 문자일 수 있어 무시하면 안 된다.
    const len = key === 'qr' ? t.replace(/\s+/g, '').length : t.length;
    if (len > max) return bad(`payment_method.${k}`, `${max}자를 넘어요`);
    if (!t.length) {
      if (!REMOVABLE.has(key)) return bad(`payment_method.${k}`, '비워 둘 수 없는 항목이에요');
      patch[key] = null;
    } else {
      patch[key] = t;
    }
  }
  if (!Object.keys(patch).length) return bad('payment_method', '바뀐 항목이 하나도 없어요');

  // operator: 상태 POST에서는 선택이지만 정정은 사람이 실행한 것만 오므로 필수(그쪽 09-21 요청 §3-6).
  const operator = parseOperatorField(o.operator);
  if (operator === null) return bad('operator', '정정을 실행한 담당자 { id, name }가 필요해요');
  if ('ok' in operator) return operator.ok ? bad('operator', '{ id, name } 객체여야 해요') : bad(operator.field, operator.error);

  if (typeof o.reason !== 'string' || !o.reason.trim()) return bad('reason', '정정 사유가 필요해요');
  const reason = o.reason.trim();
  if (reason.length > REASON_MAX) return bad('reason', `${REASON_MAX}자를 넘어요`);

  let idempotencyKey: string | null = null;
  if (o.idempotency_key !== undefined && o.idempotency_key !== null) {
    if (typeof o.idempotency_key !== 'string') return bad('idempotency_key', '문자열 또는 null이어야 해요');
    const t = o.idempotency_key.trim();
    if (t.length > IDEM_MAX) return bad('idempotency_key', `${IDEM_MAX}자를 넘어요`);
    idempotencyKey = t.length ? t : null;
  }
  return { ok: true, correction: { correctionId: o.correction_id, baseRevision: rev, baseUpdatedAt, patch, operator, reason, idempotencyKey } };
}

// ── ② 현재 스냅샷에 정정을 얹는다 ──
// 결과의 after는 새 요청을 만들 때와 같은 검사(influencerPayment.parsePaymentMethodInput)를 통과한 값만이다 — 정정으로 "요청 생성이 막혔을 값"이 들어오지 않게.
export interface CorrectionFieldDiff { field: string; from: string | null; to: string | null }   // field는 camelCase(PAYMENT_FIELD_LABEL 키)
export type CorrectionMerge =
  | { ok: true; after: PaymentMethodSnapshot; fields: CorrectionFieldDiff[] }
  | { ok: false; field: string; error: string };
export function mergePaymentMethodCorrection(before: PaymentMethodSnapshot, patch: PaymentInfoCorrection['patch']): CorrectionMerge {
  const allowed = ALLOWED_BY_TYPE[before.type];
  const merged: Record<string, unknown> = { type: before.type, holder: before.holder, currency: before.currency };
  for (const k of ['email', 'paypalId', 'identifier', 'bank', 'branch', 'account', 'qr'] as const) if (before[k]) merged[k] = before[k];
  for (const [k, v] of Object.entries(patch) as Array<[CorrectionKey, string | null | undefined]>) {
    if (v === undefined) continue;
    if (!allowed.includes(k)) return { ok: false, field: `payment_method.${k}`, error: `${PAYMENT_TYPE_LABEL[before.type]} 수단에는 없는 항목이에요 — ${allowed.join('·')}만 고칠 수 있어요` };
    const camel = TO_CAMEL[k];
    if (v === null) delete merged[camel]; else merged[camel] = v;
  }
  const parsed = parsePaymentMethodInput(merged);
  if (typeof parsed === 'string') return { ok: false, field: 'payment_method', error: parsed };
  const after: PaymentMethodSnapshot = { type: parsed.type, holder: parsed.holder, currency: parsed.currency };
  for (const k of ['email', 'paypalId', 'identifier', 'bank', 'branch', 'account', 'qr'] as const) if (parsed[k]) after[k] = parsed[k];
  const fields: CorrectionFieldDiff[] = [];
  for (const k of ['holder', 'email', 'paypalId', 'identifier', 'bank', 'branch', 'account', 'qr'] as const) {
    const a = before[k] ?? null, b = after[k] ?? null;
    if (a !== b) fields.push({ field: k, from: a, to: b });
  }
  return { ok: true, after, fields };
}

// ── 명부(원본) 반영 계획(057) — 정정이 "고친 항목만" 인플루언서 명부 수단에 병합한다. ──
// 사용자 결정(2026-09-22): patch가 가리킨 키만 명부 수단에 반영하고, 수수료(fee)·메모(memo)·기본 여부(isDefault)·id·정정과 무관한 항목은 그대로 둔다.
//   (요청 스냅샷 전체로 덮으면 명부에서만 바뀐 값이나 통화까지 되돌아가므로, after가 아니라 patch를 명부 현재 값에 얹는다.)
// 대상 고르기: 같은 종류 수단이 하나면 그것 / 여럿이면 요청 스냅샷(before)의 식별값과 일치하는 하나(유일할 때만) / 같은 종류가 없으면 명부 기본 수단.
// 건너뜀 사유: no_method(명부에 수단 없음) · ambiguous(같은 종류 여럿인데 일치가 유일하지 않음 — 엉뚱한 수단을 고치지 않게) · invalid(patch 병합 결과가 검사 실패, 예: 종류 불일치).
export type RosterSkipReason = 'no_method' | 'ambiguous' | 'invalid';
export type RosterOverwritePlan =
  | { op: Extract<PaymentOp, { kind: 'update' }>; targetId: string }
  | { skip: RosterSkipReason };

// 같은 종류가 여럿일 때 어느 수단을 정정했는지 가릴 식별값 — 요청 스냅샷(before)과 명부 수단을 같은 규칙으로 뽑아 맞춘다.
function methodIdentity(m: Pick<PaymentMethodSnapshot, 'type' | 'holder' | 'email' | 'paypalId' | 'identifier' | 'account'>): string | null {
  if (m.type === 'paypal') return m.email ?? m.paypalId ?? null;
  if (m.type === 'bank') return m.account ?? null;
  return m.identifier ?? m.holder ?? null;   // paypay
}

export function planRosterOverwrite(
  list: PaymentMethod[], before: PaymentMethodSnapshot, patch: PaymentInfoCorrection['patch'],
): RosterOverwritePlan {
  if (list.length === 0) return { skip: 'no_method' };
  const sameType = list.filter((m) => m.type === before.type);
  let target: PaymentMethod;
  if (sameType.length === 0) {
    target = getDefaultPaymentMethod(list) ?? list[0];   // 같은 종류가 없어도 반영 시도 — 기본 수단에(병합이 안 맞으면 아래에서 invalid)
  } else if (sameType.length === 1) {
    target = sameType[0];
  } else {
    const wanted = methodIdentity(before);
    const matches = sameType.filter((m) => methodIdentity(m) === wanted);
    if (matches.length !== 1) return { skip: 'ambiguous' };   // 유일하게 못 가리면 건너뛴다(엉뚱한 수단 오손 방지)
    target = matches[0];
  }
  // 정정이 고친 항목만 병합 — 명부 수단의 "현재 값"에 patch를 얹는다(안 고친 항목·fee·memo·기본 여부는 그대로).
  const merged = mergePaymentMethodCorrection(toMethodSnapshot(target), patch);
  if (!merged.ok) return { skip: 'invalid' };
  const input: PaymentMethodInput = { ...merged.after };
  if (target.fee) input.fee = target.fee;
  if (target.memo) input.memo = target.memo;
  return { op: { kind: 'update', id: target.id, input }, targetId: target.id };
}
