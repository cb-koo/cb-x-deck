// 그쪽(정산 프로덕트) API 계약의 순수 부분 — 커서·상태 파서·직렬화. DB 없음.
// 설계: docs/superpowers/specs/2026-08-28-payment-api-design.md §5·§6, 2026-09-01-proof-to-partner-design.md §3·§5. 그쪽 전달 문서: docs/api/settlement-external-api.md
import type { PaymentRequestRow } from './settlementStore.ts';            // 타입만 — 값 import면 settlementStore↔settlementExternal 순환
import { EXTERNAL_STATUSES, type ExternalStatus } from './campaignTaskStore.ts';
import { isUuidLike } from './uuid.ts';
import type { PaymentFee } from './influencerPayment.ts';
import type { TaskProof } from './taskProofGuard.ts';

import { isRevisionV2 } from './settlementRevisionFlag.ts';
export const EXTERNAL_API_VERSION = 1;
export const LIST_LIMIT_DEFAULT = 100;
export const LIST_LIMIT_MAX = 500;
const NOTE_MAX = 500;
const EXTERNAL_ID_MAX = 100;
const OPERATOR_MAX = 100;

// ── 커서: (updated_at 마이크로초 정수, id) — ISO(ms)로 만들면 같은 ms의 다음 행이 다시 나와 무한 반복될 수 있다 ──
export interface Cursor { updatedAtUs: string; id: string }
export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.updatedAtUs}:${c.id}`).toString('base64url');
}
export function decodeCursor(s: string): Cursor | null {
  let raw: string;
  try { raw = Buffer.from(s, 'base64url').toString('utf8'); } catch { return null; }
  const i = raw.indexOf(':');
  if (i < 0) return null;
  const us = raw.slice(0, i), id = raw.slice(i + 1);
  if (!/^\d{1,16}$/.test(us) || !isUuidLike(id)) return null;
  return { updatedAtUs: us, id };
}
export function clampLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < 1) return LIST_LIMIT_DEFAULT;
  return Math.min(n, LIST_LIMIT_MAX);
}

// ── 직렬화(§5-3) — GET 목록·GET 단건·POST 응답이 전부 이 함수 하나를 쓴다 ──
// proof는 이미 해석된 "실을 값"이다(settlementStore.exportRows가 결정) — task_id가 있으면 campaign_task.proof(현재값),
// 없으면 row.proof(payment_request 스냅샷)로 이미 폴백된 상태로 들어온다(스펙 §5, koo 결정 B). 여기서는 DB를 만지지 않으므로
// "라이브냐 스냅샷이냐"를 다시 판단하지 않고, 주어진 값을 그쪽 계약 모양(snake_case)으로만 바꾼다.
export interface ExportRow { row: PaymentRequestRow; updatedAtUs: string; requester: { email: string | null; slackId: string | null }; proof: TaskProof | null }
export interface ExternalItem {
  request_id: string; revision: number; revised_at: string | null; status: 'requested' | 'cancelled'; created_at: string; updated_at: string;
  cancelled: { at: string | null; by_name: string | null; reason: string | null } | null;
  task_id: string | null;
  campaign: { id: string | null; name: string }; clinic: { id: string; name: string };
  influencer: { id: string; handle: string };
  task_type: PaymentRequestRow['taskType'];
  category: { code: string; label: string };
  item: string; purpose: string;
  amount_krw: number; cost_currency: PaymentRequestRow['costCurrency'];
  payout: { currency: PaymentRequestRow['payoutCurrency']; net: number; fee: PaymentFee | null; fee_amount: number; gross: number; rate_krw_per_jpy: number; gross_krw: number };
  deadline: string; reference_url: string | null;
  payment_method: Record<string, string>;
  requester: { name: string; email: string | null; slack_id: string | null };
  note: string;
  settlement: { status: ExternalStatus | null; paid_amount_krw: number | null; paid_at: string | null; note: string | null; updated_at: string | null; external_id: string | null };
  // RT 지급 전 확인 자료(스펙 §3). null인 경우 둘: ①RT가 아닌 유형(reference_url로 확인) ②RT인데 아직 증빙이 없음.
  // url은 고정 엔드포인트(서명 URL이 아니다 — 서명 URL은 만료돼 캐시된 목록의 링크가 죽는다, 스펙 §4).
  proof: { url: string; uploaded_at: string; uploaded_by: string } | null;
}
const SNAKE_PM: Record<string, string> = { type: 'type', holder: 'holder', currency: 'currency', email: 'email', paypalId: 'paypal_id', identifier: 'identifier', bank: 'bank', branch: 'branch', account: 'account' };

// origin은 호출한 라우트의 new URL(req.url).origin — 하드코딩하면 스테이징·운영이 갈린다(part B가 만들 /proof 경로).
export function toExternalItem(e: ExportRow, origin: string): ExternalItem {
  const r = e.row;
  const pm: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.paymentMethod)) if (typeof v === 'string' && SNAKE_PM[k]) pm[SNAKE_PM[k]] = v;
  return {
    // revision(스펙 2026-09-07 §2): 스위치 꺼짐 = 옛 의미(0 요청/1 취소, 그쪽 옛 파서가 0|1만 받는다) / 켜짐 = 수정 횟수(취소 여부는 status로만)
    request_id: r.id, revision: isRevisionV2() ? r.revision : (r.status === 'cancelled' ? 1 : 0), revised_at: isRevisionV2() ? r.revisedAt : null,
    status: r.status, created_at: r.createdAt, updated_at: r.updatedAt,
    cancelled: r.status === 'cancelled' ? { at: r.cancelledAt, by_name: r.cancelledByName, reason: r.cancelReason } : null,
    task_id: r.taskId,
    campaign: { id: r.campaignId, name: r.campaignName }, clinic: { id: r.clientId, name: r.clientName },
    influencer: { id: r.influencerId, handle: r.influencerHandle },
    task_type: r.taskType,
    category: { code: r.categoryOptionId, label: r.category },
    item: r.itemText, purpose: r.purposeText,
    amount_krw: r.amountKrw, cost_currency: r.costCurrency,
    // gross_krw(실제 송금액의 원화 환산)는 045 생성 컬럼(payment_request.gross_krw)에서 그대로 옮겨 싣는다 — 여기서 계산하지 않는다.
    // amount_krw(수수료 제외 단가)와는 다른 값이니 "실제 나간 돈" 집계는 이 값을 쓰라고 그쪽 문서(§5-3)에 적어 두었다.
    payout: {
      currency: r.payoutCurrency, net: r.amountNet, fee: r.fee, fee_amount: r.feeAmount, gross: r.amountGross,
      rate_krw_per_jpy: r.rateKrwPerJpy, gross_krw: r.grossKrw,
    },
    deadline: r.deadlineOn, reference_url: r.referenceUrl,
    payment_method: pm,
    requester: { name: r.requesterName, email: e.requester.email, slack_id: e.requester.slackId },
    note: r.note,
    settlement: { status: r.externalStatus, paid_amount_krw: r.paidAmountKrw, paid_at: r.paidAt, note: r.externalNote, updated_at: r.externalUpdatedAt, external_id: r.externalId },
    proof: e.proof ? { url: `${origin}/api/external/settlement/requests/${r.id}/proof`, uploaded_at: e.proof.at, uploaded_by: e.proof.byName } : null,
  };
}

// ── 상태 수신 본문(§6-1) — 첫 오류에서 멈추고 어느 필드인지 알려준다(landingEvent 파서 관례) ──
export interface StatusOperator { id: string; name: string }   // 그 상태 전이를 실행한 그쪽 결제 담당자(09-04 그쪽 요청). 자동 전이엔 없다.
export interface StatusUpdate { status: ExternalStatus; updatedAt: string; note: string | null; paidAmountKrw: number | null; paidAt: string | null; externalId: string | null; operator: StatusOperator | null; revision: number | null }   // revision: 그쪽이 마지막으로 받은 판(§6). null = 안 보냄(전환 전 허용)
export type StatusParse = { ok: true; update: StatusUpdate } | { ok: false; field: string; error: string };
const bad = (field: string, error: string): StatusParse => ({ ok: false, field, error });
function isoOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
function optStr(o: Record<string, unknown>, k: string, max: number): string | null | StatusParse {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return bad(k, '문자열이어야 해요');
  const t = v.trim();
  if (t.length > max) return bad(k, `${max}자를 넘어요`);
  return t.length ? t : null;
}
const isParse = (v: unknown): v is StatusParse => typeof v === 'object' && v !== null && 'ok' in (v as object);
export function parseStatusUpdate(body: unknown): StatusParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('body', 'JSON 객체여야 해요');
  const o = body as Record<string, unknown>;
  const status = o.status;
  if (typeof status !== 'string' || !EXTERNAL_STATUSES.includes(status as ExternalStatus)) return bad('status', `${EXTERNAL_STATUSES.join('·')} 중 하나여야 해요`);
  const updatedAt = isoOf(o.updated_at);
  if (!updatedAt) return bad('updated_at', 'ISO 8601 시각이어야 해요');
  const note = optStr(o, 'note', NOTE_MAX); if (isParse(note)) return note;
  const externalId = optStr(o, 'external_id', EXTERNAL_ID_MAX); if (isParse(externalId)) return externalId;
  let paidAmountKrw: number | null = null, paidAt: string | null = null;
  if (status === 'paid') {
    const a = o.paid_amount_krw;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 0) return bad('paid_amount_krw', '지급 완료에는 0 이상의 정수 원화 금액이 필요해요');
    paidAmountKrw = a;
    paidAt = isoOf(o.paid_at);
    if (!paidAt) return bad('paid_at', '지급 완료에는 ISO 8601 지급 시각이 필요해요');
  }
  // operator(선택): 있으면 { id, name } 모양만 받는다 — 그쪽 목 서버 규칙과 같다. null은 "없음". 본문의 그 외 모르는 키는 전부 무시한다.
  let operator: StatusOperator | null = null;
  if (o.operator !== undefined && o.operator !== null) {
    const op = o.operator;
    if (typeof op !== 'object' || Array.isArray(op)) return bad('operator', '{ id, name } 객체여야 해요');
    const { id, name } = op as Record<string, unknown>;
    const idOk = typeof id === 'string' && id.trim() !== '' && id.length <= OPERATOR_MAX;
    const nameOk = typeof name === 'string' && name.trim() !== '' && name.length <= OPERATOR_MAX;
    if (!idOk || !nameOk) return bad('operator', `id·name은 비어 있지 않은 ${OPERATOR_MAX}자 이하 문자열이어야 해요`);
    operator = { id: (id as string).trim(), name: (name as string).trim() };
  }
  // revision(§6, 전환 후 필수): 정수(≥0)만. 없거나 null이면 null — 필수 여부는 라우트가 스위치를 보고 판단한다(파서는 스위치를 모른다).
  let revision: number | null = null;
  if (o.revision !== undefined && o.revision !== null) {
    if (typeof o.revision !== 'number' || !Number.isInteger(o.revision) || o.revision < 0) return bad('revision', '0 이상의 정수여야 해요 — 마지막으로 받은 아이템의 revision 값');
    revision = o.revision;
  }
  return { ok: true, update: { status: status as ExternalStatus, updatedAt, note, paidAmountKrw, paidAt, externalId, operator, revision } };
}
