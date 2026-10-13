// 정산 화면 전용 fetch 래퍼 — campaignApi와 같은 모양(ApiResult).
import { apiFetch } from './apiFetch.ts';
import { toApiResult, type ApiResult } from './campaignApi.ts';
import type { SettlementSettings, AutoSendSwitch } from './settlementSettings.ts';
import type { PaymentRequestRow, RequestFilter, SettlementVersionRow, RevisionEdits, RevisionTarget, RevisionHistoryRow } from './settlementStore.ts';
import type { ReadinessIssue } from './settlementCalc.ts';
import type { ExternalLogRow } from './externalLogCopy.ts';
import type { TaskCost } from './campaignCost.ts';
import type { KeepReason } from './settlementDisplay.ts';
import type { PendingRow, PendingSummary } from './settlementAutoStore.ts';


const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function call<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try { return await toApiResult<T>(await apiFetch(input, init)); }
  catch (e) {
    if (e instanceof Error && e.message === 'unauthorized') throw e;
    return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요', status: 0 };
  }
}

export const fetchRequests = (f: RequestFilter) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  const qs = p.toString();
  return call<PaymentRequestRow[]>(`/api/settlement/requests${qs ? `?${qs}` : ''}`);
};
export const cancelRequestApi = (id: string, reason: string) => call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'cancel', reason }));
// 정산팀 지급 금액 ≠ 작업 금액 처리(스펙 2026-10-07 §5) — 창을 연 때의 작업 금액·지급 금액을 함께 보낸다(서버가 경합을 409로)
const expectOf = (r: PaymentRequestRow) => ({ expectedTaskCost: r.taskCost, expectedPaidKrw: r.paidAmountKrw, expectedPaidJpy: r.paidAmountJpy });
export const matchTaskCostApi = (r: PaymentRequestRow, newCost: TaskCost, reason: string) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${r.id}`, json('PATCH', { action: 'match-task-cost', ...expectOf(r), newCost, reason }));
export const keepTaskCostApi = (r: PaymentRequestRow, reasonKind: KeepReason, memo: string) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${r.id}`, json('PATCH', { action: 'keep-task-cost', ...expectOf(r), reasonKind, memo }));
export const undoKeepTaskCostApi = (id: string) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'undo-keep-task-cost' }));
export const fetchSettlementSettings = () => call<{ settings: SettlementSettings; versions: SettlementVersionRow[] }>('/api/settlement/settings');
export const saveSettlementSettingsApi = (settings: SettlementSettings) => call<{ settings: SettlementSettings }>('/api/settlement/settings', json('PUT', { settings }));
export const fetchExternalLog = (f: { method?: 'GET' | 'POST'; rejectedOnly?: boolean; correctionsOnly?: boolean; request?: string } = {}) => {
  const p = new URLSearchParams();
  if (f.method) p.set('method', f.method);
  if (f.rejectedOnly) p.set('rejectedOnly', '1');
  if (f.correctionsOnly) p.set('correctionsOnly', '1');
  if (f.request) p.set('request', f.request);
  const qs = p.toString();
  return call<{ rows: ExternalLogRow[] }>(`/api/settlement/external-log${qs ? `?${qs}` : ''}`);
};

// ── 제자리 수정(스펙 2026-09-07 §6) ──
export const fetchSettlementConfig = () => call<{ revisionV2: boolean }>('/api/settlement/config');
export type RevisionPreviewResult = { ok: true; before: PaymentRequestRow; after: RevisionTarget } | { ok: false; error: string; issues?: ReadinessIssue[]; before: PaymentRequestRow | null };
export const fetchRevisionPreview = (id: string, edits: RevisionEdits | null) => {
  const p = new URLSearchParams();
  if (edits) { p.set('category', edits.category); p.set('deadlineOn', edits.deadlineOn); p.set('referenceUrl', edits.referenceUrl ?? ''); }
  const qs = p.toString();
  return call<RevisionPreviewResult>(`/api/settlement/requests/${id}/revision-preview${qs ? `?${qs}` : ''}`);
};
export const reviseRequestApi = (id: string, input: { expectedRevision: number; reason: string; edits: RevisionEdits; partnerConfirmed: boolean }) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'revise', ...input }));
export const fetchRevisions = (id: string) => call<{ revisions: RevisionHistoryRow[] }>(`/api/settlement/requests/${id}/revisions`);
// 정산 요청 자동 전송(스펙 2026-10-12) — 정산 요청 대기 목록·행 버튼·보낸 뒤 내려감 [그대로 두기]
export const fetchPending = (campaignId?: string) =>
  call<{ rows: PendingRow[]; summary: PendingSummary }>(`/api/settlement/pending${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ''}`);
export const sendPendingApi = (taskId: string) => call<{ ok: true; request: PaymentRequestRow }>(`/api/settlement/pending/${taskId}`, json('POST', { action: 'send' }));
export const holdPendingApi = (taskId: string, reason: string) => call<{ ok: true }>(`/api/settlement/pending/${taskId}`, json('POST', { action: 'hold', reason }));
export const ackRemovalApi = (requestId: string) => call<{ ok: true }>(`/api/settlement/requests/${requestId}/removal-ack`, json('POST', {}));
export const setAutoSendApi = (enabled: boolean) => call<{ autoSend: AutoSendSwitch }>('/api/settlement/auto-send-switch', json('PUT', { enabled }));
