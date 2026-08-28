// 그쪽(정산 프로덕트) API 계약의 순수 부분 — 커서·상태 파서·직렬화. DB 없음.
// 설계: docs/superpowers/specs/2026-08-28-payment-api-design.md §5·§6. 그쪽 전달 문서: docs/api/settlement-external-api.md
import type { PaymentRequestRow } from './settlementStore.ts';            // 타입만 — 값 import면 settlementStore↔settlementExternal 순환
import { EXTERNAL_STATUSES, type ExternalStatus } from './campaignTaskStore.ts';
import { isUuidLike } from './uuid.ts';
import type { PaymentFee } from './influencerPayment.ts';

export const EXTERNAL_API_VERSION = 1;
export const LIST_LIMIT_DEFAULT = 100;
export const LIST_LIMIT_MAX = 500;
const NOTE_MAX = 500;
const EXTERNAL_ID_MAX = 100;

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
export interface ExportRow { row: PaymentRequestRow; updatedAtUs: string; requester: { email: string | null; slackId: string | null } }
export interface ExternalItem {
  request_id: string; revision: 0 | 1; status: 'requested' | 'cancelled'; created_at: string; updated_at: string;
  cancelled: { at: string | null; by_name: string | null; reason: string | null } | null;
  task_id: string | null;
  campaign: { id: string | null; name: string }; clinic: { id: string | null; name: string };
  influencer: { id: string | null; handle: string };
  task_type: PaymentRequestRow['taskType'];
  category: { code: string | null; label: string };
  item: string; purpose: string;
  amount_krw: number; cost_currency: PaymentRequestRow['costCurrency'];
  payout: { currency: PaymentRequestRow['payoutCurrency']; net: number; fee: PaymentFee | null; fee_amount: number; gross: number; rate_krw_per_jpy: number };
  deadline: string; reference_url: string | null;
  payment_method: Record<string, string>;
  requester: { name: string; email: string | null; slack_id: string | null };
  note: string;
  settlement: { status: ExternalStatus | null; paid_amount_krw: number | null; paid_at: string | null; note: string | null; updated_at: string | null; external_id: string | null };
}
const SNAKE_PM: Record<string, string> = { type: 'type', holder: 'holder', currency: 'currency', email: 'email', paypalId: 'paypal_id', identifier: 'identifier', bank: 'bank', branch: 'branch', account: 'account' };
export function toExternalItem(e: ExportRow): ExternalItem {
  const r = e.row;
  const pm: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.paymentMethod)) if (typeof v === 'string' && SNAKE_PM[k]) pm[SNAKE_PM[k]] = v;
  return {
    request_id: r.id, revision: r.status === 'cancelled' ? 1 : 0, status: r.status, created_at: r.createdAt, updated_at: r.updatedAt,
    cancelled: r.status === 'cancelled' ? { at: r.cancelledAt, by_name: r.cancelledByName, reason: r.cancelReason } : null,
    task_id: r.taskId,
    campaign: { id: r.campaignId, name: r.campaignName }, clinic: { id: r.clientId, name: r.clientName },
    influencer: { id: r.influencerId, handle: r.influencerHandle },
    task_type: r.taskType,
    category: { code: r.categoryOptionId, label: r.category },
    item: r.itemText, purpose: r.purposeText,
    amount_krw: r.amountKrw, cost_currency: r.costCurrency,
    payout: { currency: r.payoutCurrency, net: r.amountNet, fee: r.fee, fee_amount: r.feeAmount, gross: r.amountGross, rate_krw_per_jpy: r.rateKrwPerJpy },
    deadline: r.deadlineOn, reference_url: r.referenceUrl,
    payment_method: pm,
    requester: { name: r.requesterName, email: e.requester.email, slack_id: e.requester.slackId },
    note: r.note,
    settlement: { status: r.externalStatus, paid_amount_krw: r.paidAmountKrw, paid_at: r.paidAt, note: r.externalNote, updated_at: r.externalUpdatedAt, external_id: r.externalId },
  };
}

// ── 상태 수신 본문(§6-1) — 첫 오류에서 멈추고 어느 필드인지 알려준다(landingEvent 파서 관례) ──
export interface StatusUpdate { status: ExternalStatus; updatedAt: string; note: string | null; paidAmountKrw: number | null; paidAt: string | null; externalId: string | null }
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
  return { ok: true, update: { status: status as ExternalStatus, updatedAt, note, paidAmountKrw, paidAt, externalId } };
}
