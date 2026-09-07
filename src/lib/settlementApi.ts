// 정산 화면 전용 fetch 래퍼 — campaignApi와 같은 모양(ApiResult). 409의 failures만 추가로 실어 준다.
import { apiFetch } from './apiFetch.ts';
import { toApiResult, type ApiResult } from './campaignApi.ts';
import type { SettlementCandidate } from './settlementCalc.ts';
import type { SettlementSettings } from './settlementSettings.ts';
import type { PaymentRequestRow, CreateItemInput, RequestFilter, SettlementVersionRow, RevisionEdits, RevisionTarget, RevisionHistoryRow } from './settlementStore.ts';
import type { ReadinessIssue } from './settlementCalc.ts';
import type { ExternalLogRow } from './externalLogCopy.ts';

export type CreateFailure = { taskId: string; reason: string };
export type CreateResult = ApiResult<{ created: PaymentRequestRow[] }> & { failures?: CreateFailure[] };

const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function call<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try { return await toApiResult<T>(await apiFetch(input, init)); }
  catch (e) {
    if (e instanceof Error && e.message === 'unauthorized') throw e;
    return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요', status: 0 };
  }
}

export const fetchCandidates = () => call<{ candidates: SettlementCandidate[]; settings: SettlementSettings; today: string }>('/api/settlement/candidates');
export const fetchRequests = (f: RequestFilter) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  const qs = p.toString();
  return call<PaymentRequestRow[]>(`/api/settlement/requests${qs ? `?${qs}` : ''}`);
};
export async function createRequestsApi(items: CreateItemInput[]): Promise<CreateResult> {
  try {
    const r = await apiFetch('/api/settlement/requests', json('POST', { items }));
    const body: unknown = await r.json().catch(() => null);
    if (r.ok) return { ok: true, data: body as { created: PaymentRequestRow[] } };
    const b = (body ?? {}) as { error?: string; failures?: CreateFailure[] };
    return { ok: false, error: b.error ?? `오류 ${r.status}`, status: r.status, failures: b.failures };
  } catch (e) {
    if (e instanceof Error && e.message === 'unauthorized') throw e;
    return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요', status: 0 };
  }
}
export const cancelRequestApi = (id: string, reason: string) => call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'cancel', reason }));
export const ackDiffApi = (id: string) => call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'ack-diff' }));
export const unackDiffApi = (id: string) => call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'unack-diff' }));
export const fetchSettlementSettings = () => call<{ settings: SettlementSettings; versions: SettlementVersionRow[] }>('/api/settlement/settings');
export const saveSettlementSettingsApi = (settings: SettlementSettings) => call<{ settings: SettlementSettings }>('/api/settlement/settings', json('PUT', { settings }));
export const fetchExternalLog = (f: { method?: 'GET' | 'POST'; rejectedOnly?: boolean; request?: string } = {}) => {
  const p = new URLSearchParams();
  if (f.method) p.set('method', f.method);
  if (f.rejectedOnly) p.set('rejectedOnly', '1');
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
export const reviseRequestApi = (id: string, input: { expectedRevision: number; reason: string; edits: RevisionEdits }) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'revise', ...input }));
export const fetchRevisions = (id: string) => call<{ revisions: RevisionHistoryRow[] }>(`/api/settlement/requests/${id}/revisions`);
