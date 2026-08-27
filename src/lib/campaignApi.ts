// 브라우저 전용 fetch 헬퍼 — /campaigns·DraftCard·/generate가 같은 요청 함수를 쓴다(오류 문구 추출을 한 곳에).
// 성공/실패를 한 모양(ApiResult)으로 돌려 호출부가 try/catch 없이 ok만 본다 — 낙관적 갱신·롤백 코드가 짧아진다.
import { apiFetch } from './apiFetch.ts';
import type { DraftRow } from './draftStore.ts';
import type { DraftStatus } from './draftStatus.ts';
import type { DraftContent } from './draftTypes.ts';
import type { CampaignRow, CampaignDetail, InfluencerCostRow } from './campaignStore.ts';
import type { CampaignCreateInput, CampaignPatchInput } from './campaignInput.ts';
import type { ExtraCost } from './campaignCost.ts';
import type { TrackedPostRow } from './trackingStore.ts';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

// 서버가 준 오류 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(profileShared.errOf 관례). 본문이 깨져도 상태코드는 남긴다.
export async function toApiResult<T>(r: Response): Promise<ApiResult<T>> {
  const body: unknown = await r.json().catch(() => null);
  if (r.ok) return { ok: true, data: body as T };
  const error = (body as { error?: string } | null)?.error ?? `오류 ${r.status}`;
  return { ok: false, error, status: r.status };
}

const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// 네트워크 예외도 같은 모양으로 — status 0. 401은 apiFetch가 /login으로 리다이렉트하며 Error('unauthorized')를 던진다 —
// 그걸 여기서 네트워크 오류로 뭉개면 리다이렉트는 이미 걸렸는데 화면엔 "연결을 확인하세요"가 뜨는 모순이 생긴다.
// 그래서 그 경우만 다시 던져 호출부(또는 전역 경계)가 리다이렉트 진행 중임을 알 수 있게 한다.
async function call<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    return await toApiResult<T>(await apiFetch(input, init));
  } catch (e) {
    if (e instanceof Error && e.message === 'unauthorized') throw e;
    return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요', status: 0 };
  }
}

// ── 캠페인 ──
export const fetchCampaigns = () => call<CampaignRow[]>('/api/campaigns');
export const fetchCampaignDetail = (id: string) => call<CampaignDetail>(`/api/campaigns/${id}`);
export const createCampaignApi = (input: CampaignCreateInput) => call<CampaignRow>('/api/campaigns', json('POST', input));
export const patchCampaignApi = (id: string, patch: CampaignPatchInput) => call<CampaignRow>(`/api/campaigns/${id}`, json('PATCH', patch));
export const deleteCampaignApi = (id: string) =>
  call<{ ok: true; deleted: boolean; taskCount: number; detachedTargets: number }>(`/api/campaigns/${id}`, { method: 'DELETE' });
export const putInfluencerCostApi = (campaignId: string, handle: string, patch: { extraCosts?: ExtraCost[]; note?: string }) =>
  call<InfluencerCostRow>(`/api/campaigns/${campaignId}/influencers/${encodeURIComponent(handle)}`, json('PUT', patch));
// Task 17에서 AddDraftsModal과 함께 제거 — 이 라우트는 이미 지웠다(대체: GET /api/drafts?unattached=1). 지금 부르면 404.
export const fetchCandidateDrafts = (campaignId: string) => call<DraftRow[]>(`/api/campaigns/${campaignId}/drafts`);

// ── 원고(기존 라우트 — 값은 하나, 캠페인 전용 경로 없음 §2-5) ──
export interface DraftPatchBody {
  status?: DraftStatus; influencerHandle?: string | null; title?: string; edited?: DraftContent; dismissedFlags?: string[];
  taskId?: string | null;   // null = 작업에서 떼기 · uuid = 그 작업에 붙이기(스펙 2026-08-28 §5)
}
export const patchDraftApi = (id: string, body: DraftPatchBody) => call<DraftRow>(`/api/drafts/${id}`, json('PATCH', body));
// 일괄 소속·해제 — 50건도 커넥션 1개(updateDraftsBulk). '기존 원고 고르기'와 DraftCard 캠페인 칸의 이동이 쓴다.
export const bulkCampaignApi = (ids: string[], campaignId: string | null) =>
  call<{ ok: true; updated: number }>('/api/drafts', json('PATCH', { ids, campaignId }));
export const deleteDraftApi = (id: string) => call<{ ok: true }>(`/api/drafts/${id}`, { method: 'DELETE' });
export const rewriteDraftApi = (id: string, baseIndex: number, feedback: string) =>
  call<DraftRow>(`/api/drafts/${id}/rewrite`, json('POST', { baseIndex, ...(feedback ? { feedback } : {}) }));
export const regenPostApi = (id: string, index: number) => call<DraftRow>(`/api/drafts/${id}/regen-post`, json('POST', { index }));

// ── 게시물 연결(스펙 §3-2 단계 셀 옆) — 등록 POST(url만 받는다) 뒤 PATCH로 draft_id를 붙인다. 두 라우트 다 기존.
export const registerTrackedPostApi = (url: string) => call<{ created: boolean; row: TrackedPostRow }>('/api/tracking', json('POST', { url }));
// 라우트가 재조회 결과를 { row }로 감싸 돌려준다 — 무검사 캐스팅이라 타입이 어긋나면 tsc가 못 잡는다.
// row는 findTrackedPostById 재조회이므로 대상이 그 사이 지워졌으면 null일 수 있다(호출부가 null도 다뤄야 한다).
export const linkTrackedPostDraftApi = (trackedPostId: string, draftId: string | null) =>
  call<{ row: TrackedPostRow | null }>(`/api/tracking/${trackedPostId}`, json('PATCH', { draftId }));
