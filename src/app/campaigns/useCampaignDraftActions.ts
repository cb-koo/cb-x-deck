'use client';
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { CampaignDraftItem, CampaignRow } from '@/lib/campaignStore';
import type { DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption, DraftContent } from '@/lib/draftTypes';
import { suggestDraftCost, type DraftCost } from '@/lib/campaignCost';
import { defaultCostType } from '@/lib/campaignJudgment';
import { patchDraftApi, type DraftPatchBody } from '@/lib/campaignApi';

// 캠페인 화면의 원고 편집은 전부 PATCH /api/drafts/[id] 하나를 탄다(스펙 §2-5 값은 하나) — 배정 자동 로그(influencerSync)도 그대로 돈다.
// 낙관적 갱신 + "이 요청이 세팅한 값이 아직 표시 중일 때만" 롤백(generate/page.tsx changeStatus·assignInfluencer 계열) —
// 응답을 기다리는 사이 사용자가 같은 행을 또 바꿨다면 뒤 갱신을 덮지 않는다.
type Item = CampaignDraftItem;
type Optimistic = Partial<Pick<Item, 'status' | 'influencerHandle' | 'scheduledOn' | 'cost' | 'title' | 'edited' | 'dismissedFlags'>>;

export function useCampaignDraftActions({ campaign, setDrafts, influencerOptions, show, onChanged }: {
  campaign: CampaignRow | null;                 // 로드 전엔 null — 비용 제안 유형(defaultCostType)에만 쓴다
  setDrafts: Dispatch<SetStateAction<Item[]>>;
  influencerOptions: InfluencerOption[];        // pricing 포함 — 배정 시 비용 제안 소스
  show: (message: string) => void;
  onChanged: () => void;                        // 목록(왼쪽)의 콘텐츠 수·합계가 바뀔 변경 뒤에 부른다
}) {
  const apply = useCallback(async (d: Item, optimistic: Optimistic, body: DraftPatchBody): Promise<boolean> => {
    const keys = Object.keys(optimistic) as Array<keyof Optimistic>;
    // 이 요청이 쓴 칸이 아직 내가 세팅한 값 그대로인가 — 성공·실패가 같은 기준을 쓴다
    const stillMine = (x: Item) => keys.every((k) => JSON.stringify(x[k]) === JSON.stringify(optimistic[k]));
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...optimistic } : x)));
    const r = await patchDraftApi(d.id, body);
    if (r.ok) {
      // 응답은 DraftRow — 게시됨·성과(published·perf·linkClicks)는 이 PATCH로 바뀌지 않으니 기존 값을 유지한 채 덮는다.
      // 성공에도 롤백과 같은 가드가 필요하다 — 응답은 보낸 순서대로 오지 않는다(먼저 보낸 PATCH가 늦게 도착할 수 있다).
      // 가드가 없으면 늦게 온 옛 응답이 그 사이 사용자가 바꾼 값을 서버의 옛 값으로 되돌려버린다.
      setDrafts((cur) => cur.map((x) => (x.id === d.id && stillMine(x) ? { ...x, ...r.data } : x)));
      return true;
    }
    setDrafts((cur) => cur.map((x) => {
      if (x.id !== d.id) return x;
      // 내가 세팅한 값이 아직 그대로일 때만 되돌린다 — 그 사이 사용자가 또 바꿨으면 뒤 갱신이 이긴다
      if (!stillMine(x)) return x;
      const back: Item = { ...x };
      for (const k of keys) Object.assign(back, { [k]: d[k] });   // 요청 전 값(d)으로 되돌린다 — 건드린 칸만
      return back;
    }));
    show(r.error);
    return false;
  }, [setDrafts, show]);

  return useMemo(() => ({
    changeStatus: async (d: Item, status: DraftStatus) => {
      const ok = await apply(d, { status }, { status });
      // 미사용 ↔ 그 외는 요약 N·인플 콘텐츠 수·합계의 모집단이 바뀐다(§2-4) — 목록 보조줄도 따라가야 한다
      if (ok && (status === 'unused' || d.status === 'unused')) onChanged();
      return ok;
    },
    // 배정·변경 시 비용 제안 — 비어 있을 때만 자동 채움(사람이 적은 값은 덮지 않는다). 금액 = pricing[유형], 통화 = pricing 레벨 하나.
    // 제안이 있으면 같은 PATCH에 cost를 함께 실어 요청 1번으로 끝낸다.
    assignInfluencer: async (d: Item, handle: string | null) => {
      const opt = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
      const suggested = !d.cost && opt ? suggestDraftCost(opt.pricing, defaultCostType(campaign?.kind ?? null)) : null;
      const patch = { influencerHandle: handle, ...(suggested ? { cost: suggested } : {}) };
      const ok = await apply(d, patch, patch);
      if (ok) onChanged();   // 인플 목록·(제안이 들어갔으면) 합계가 바뀐다
      return ok;
    },
    changeScheduledOn: (d: Item, next: string | null) => apply(d, { scheduledOn: next }, { scheduledOn: next }),
    changeCost: async (d: Item, next: DraftCost | null) => {
      const ok = await apply(d, { cost: next }, { cost: next });
      if (ok) onChanged();   // 합계가 목록 보조줄에도 실린다
      return ok;
    },
    // 제목 지우기는 라우트에서 ''(빈 문자열) — 낙관적 표시는 null(제목 없음)이라 두 값을 따로 준다
    changeTitle: (d: Item, next: string | null) => apply(d, { title: next }, { title: next ?? '' }),
    saveMedia: (d: Item, next: DraftContent) => apply(d, { edited: next }, { edited: next }),
    setDismissed: (d: Item, next: string[]) => apply(d, { dismissedFlags: next }, { dismissedFlags: next }),
    // 캠페인에서 빼기 — 행이 사라지는 변경이라 apply의 필드 롤백 대신 목록 복원으로 되돌린다(순서는 표 정렬이 다시 잡는다)
    removeFromCampaign: async (d: Item) => {
      setDrafts((cur) => cur.filter((x) => x.id !== d.id));
      const r = await patchDraftApi(d.id, { campaignId: null });
      if (r.ok) { show('캠페인에서 뺐어요 — 원고는 콘텐츠 생성 목록에 그대로 있어요'); onChanged(); return true; }
      setDrafts((cur) => (cur.some((x) => x.id === d.id) ? cur : [...cur, d]));
      show(r.error);
      return false;
    },
    // DraftCard 캠페인 칸에서 다른 캠페인으로 옮김(Task 15 배선) — 값은 하나라 이 화면에서는 사라진다. 경고 없음(§7).
    moveToCampaign: async (d: Item, campaignId: string | null) => {
      if (campaignId === (campaign?.id ?? null)) return true;
      setDrafts((cur) => cur.filter((x) => x.id !== d.id));
      const r = await patchDraftApi(d.id, { campaignId });
      if (r.ok) { show(campaignId ? '다른 캠페인으로 옮겼어요' : '캠페인에서 뺐어요'); onChanged(); return true; }
      setDrafts((cur) => (cur.some((x) => x.id === d.id) ? cur : [...cur, d]));
      show(r.error);
      return false;
    },
  }), [apply, campaign, influencerOptions, onChanged, setDrafts, show]);
}
