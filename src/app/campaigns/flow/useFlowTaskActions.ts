'use client';
import { useMemo } from 'react';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import type { TaskCost } from '@/lib/campaignCost';
import type { CancelReason } from '@/lib/campaignTaskInput';
import { cancelTaskApi, restoreTaskApi, replaceInfluencerApi, settleElsewhereApi, unsettleElsewhereApi } from '@/lib/campaignApi';
import { restoreMessage } from '@/lib/campaignFlowView';
import { restoreLinkedNote } from '@/lib/sameVisit';

// 취소·되돌리기·교체(ADR 0002·0005)는 PATCH가 아니라 액션 라우트 — 원고 상태·증빙·로그·정산 배지까지 서버가 한 트랜잭션으로
// 바꾸므로 낙관적 갱신 대신 성공 뒤 상세를 다시 읽는다(useCampaignTaskActions의 patch 롤백 규칙을 여기 얹지 않는다).
// 호출부(취소·되돌리기·교체 다이얼로그)는 Task 10 — 여기는 훅만 준비해 둔다(b-task-7-brief.md §1).
export function useFlowTaskActions({ campaignId, show, reload, onChanged, openTask }: {
  campaignId: string; show: (m: string, opts?: { actionLabel?: string; onAction?: () => void }) => void; reload: () => Promise<void>; onChanged: () => void;
  openTask?: (taskId: string) => void;   // 원래 작업이 취소된 연결 작업을 되돌리려 할 때 알림의 [원래 작업 열기]
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
      if (!r.ok) {
        const code = (r.body as { code?: string } | undefined)?.code;
        const original = t.sameVisitOf;
        if (code === 'SAME_VISIT_ORIGINAL_CANCELLED' && original && openTask) show(r.error, { actionLabel: '원래 작업 열기', onAction: () => openTask(original) });
        else show(r.error);
        return false;
      }
      await reload(); onChanged();
      // 같은 방문(090) — 원래 작업과 함께 취소됐던 게시물 작업도 함께 돌아왔으면 그 수를 덧붙인다
      show(restoreMessage(r.data.draft) + (r.data.linked ? restoreLinkedNote(r.data.linked) : ''));
      return true;
    },
    // 다른 곳에서 정산함(061) — 단계·정산 대기 수·정산 배지가 함께 바뀌므로 상세를 다시 읽는다
    settleElsewhere: async (t: CampaignTaskItem, note: string) => {
      const r = await settleElsewhereApi(campaignId, t.id, { note });
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show('다른 곳에서 정산함으로 표시했어요 — 정산 대기에서 빠지고, 비용은 집행액에 그대로 잡혀요');
      return true;
    },
    unsettleElsewhere: async (t: CampaignTaskItem) => {
      const r = await unsettleElsewhereApi(campaignId, t.id);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show('표시를 되돌렸어요 — 다시 정산 대기에 올라와요');
      return true;
    },
    replace: async (t: CampaignTaskItem, body: { handle: string; cost?: TaskCost | null; reason?: CancelReason | null; note?: string }) => {
      const r = await replaceInfluencerApi(campaignId, t.id, body);
      if (!r.ok) { show(r.error); return false; }
      await reload(); onChanged();
      show(`@${body.handle}로 바꿨어요 — 작업·대상·예정일은 그대로예요`);
      return true;
    },
  }), [campaignId, show, reload, onChanged, openTask]);
}
