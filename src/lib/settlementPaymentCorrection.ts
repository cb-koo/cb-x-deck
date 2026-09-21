// 그쪽(정산 프로덕트)이 보내는 수취 정보(결제 수단) 정정 회신 — `POST …/requests/{id}/payment-info`의 순수 부분. DB 없음.
// 설계: docs/superpowers/specs/2026-09-21-settlement-payment-info-correction-design.md §3·§4. 그쪽 전달 문서: docs/api/settlement-external-api.md §6-1.
//
// 두 단계로 나눈다 — ① 본문 모양 검사(parsePaymentInfoCorrection: 요청을 찾기 전에 끝난다, 상태 POST와 같은 관례)
// ② 현재 스냅샷과 합쳐 수단 종류에 맞는지 검사(mergePaymentMethodCorrection: 행을 읽어야 하므로 스토어가 트랜잭션 안에서 부른다).
import type { PaymentMethodSnapshot } from './settlementCalc.ts';
import { PAYMENT_TYPE_LABEL, parsePaymentMethodInput, type PaymentMethodType } from './influencerPayment.ts';
import { isUuidLike } from './uuid.ts';
import { parseOperatorField, parseIsoField, type StatusOperator } from './settlementExternal.ts';

// 그쪽이 보내는 7키(snake_case). type·currency는 없다 — 수단 종류·통화를 바꾸는 것은 다른 의무라 on_hold + note로 알려 달라고 했다.
export const CORRECTION_KEYS = ['holder', 'paypal_id', 'email', 'identifier', 'bank', 'branch', 'account'] as const;
export type CorrectionKey = (typeof CORRECTION_KEYS)[number];
const TO_CAMEL: Record<CorrectionKey, Exclude<keyof PaymentMethodSnapshot, 'type' | 'currency'>> = {
  holder: 'holder', paypal_id: 'paypalId', email: 'email', identifier: 'identifier', bank: 'bank', branch: 'branch', account: 'account',
};
// 수단 종류별로 고칠 수 있는 키. 다른 종류의 키(예: PayPal 수단에 bank)는 조용히 버리지 않고 400 — "정정했다고 믿은 값이 반영되지 않음"이 가장 나쁜 실패다.
const ALLOWED_BY_TYPE: Record<PaymentMethodType, readonly CorrectionKey[]> = {
  paypal: ['holder', 'email', 'paypal_id'],
  paypay: ['holder', 'identifier'],
  bank: ['holder', 'bank', 'branch', 'account'],
};
// 비워서(null·"") 지울 수 있는 키 — 선택 항목만. paypal의 email·paypal_id는 둘 중 하나만 남으면 된다(influencerPayment 규칙이 다시 검사한다).
const REMOVABLE: ReadonlySet<CorrectionKey> = new Set(['branch', 'email', 'paypal_id']);
const VALUE_MAX = 200;
const REASON_MAX = 500;
const IDEM_MAX = 200;

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
    if (t.length > VALUE_MAX) return bad(`payment_method.${k}`, `${VALUE_MAX}자를 넘어요`);
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
  for (const k of ['email', 'paypalId', 'identifier', 'bank', 'branch', 'account'] as const) if (before[k]) merged[k] = before[k];
  for (const [k, v] of Object.entries(patch) as Array<[CorrectionKey, string | null | undefined]>) {
    if (v === undefined) continue;
    if (!allowed.includes(k)) return { ok: false, field: `payment_method.${k}`, error: `${PAYMENT_TYPE_LABEL[before.type]} 수단에는 없는 항목이에요 — ${allowed.join('·')}만 고칠 수 있어요` };
    const camel = TO_CAMEL[k];
    if (v === null) delete merged[camel]; else merged[camel] = v;
  }
  const parsed = parsePaymentMethodInput(merged);
  if (typeof parsed === 'string') return { ok: false, field: 'payment_method', error: parsed };
  const after: PaymentMethodSnapshot = { type: parsed.type, holder: parsed.holder, currency: parsed.currency };
  for (const k of ['email', 'paypalId', 'identifier', 'bank', 'branch', 'account'] as const) if (parsed[k]) after[k] = parsed[k];
  const fields: CorrectionFieldDiff[] = [];
  for (const k of ['holder', 'email', 'paypalId', 'identifier', 'bank', 'branch', 'account'] as const) {
    const a = before[k] ?? null, b = after[k] ?? null;
    if (a !== b) fields.push({ field: k, from: a, to: b });
  }
  return { ok: true, after, fields };
}
