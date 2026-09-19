'use client';
import { useMemo } from 'react';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import type { TaskCost } from '@/lib/campaignCost';
import type { CancelReason } from '@/lib/campaignTaskInput';
import { cancelTaskApi, restoreTaskApi, replaceInfluencerApi } from '@/lib/campaignApi';
import { restoreMessage } from '@/lib/campaignFlowView';

// 취소·되돌리기·교체(ADR 0002·0005)는 PATCH가 아니라 액션 라우트 — 원고 상태·증빙·로그·정산 배지까지 서버가 한 트랜잭션으로
// 바꾸므로 낙관적 갱신 대신 성공 뒤 상세를 다시 읽는다(useCampaignTaskActions의 patch 롤백 규칙을 여기 얹지 않는다).
// 호출부(취소·되돌리기·교체 다이얼로그)는 Task 10 — 여기는 훅만 준비해 둔다(b-task-7-brief.md §1).
export function useFlowTaskActions({ campaignId, show, reload, onChanged }: {
  campaignId: string; show: (m: string) => void; reload: () => Promise<void>; onChanged: () => void;
}) {
  return useMemo(() => ({
    cancel: async (t: CampaignTaskItem, body: { reason: CancelReason | null; note: string }) => {
      const r = await cancelTaskApi(campaignId, t.id, body);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show(t.draftId ? '작업을 취소했어요 — 붙어 있던 원고는 떼어져 다른 작업에 쓸 수 있어요' : '작업을 취소했어요');
      return true;
    },
    restore: async (t: CampaignTaskItem) => {
      const r = await restoreTaskApi(campaignId, t.id);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show(restoreMessage(r.data.draft));
      return true;
    },
    replace: async (t: CampaignTaskItem, body: { handle: string; cost?: TaskCost | null; reason?: CancelReason | null; note?: string }) => {
      const r = await replaceInfluencerApi(campaignId, t.id, body);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show(`@${body.handle}로 바꿨어요 — 작업·대상·예정일은 그대로예요`);
      return true;
    },
  }), [campaignId, show, reload, onChanged]);
}
