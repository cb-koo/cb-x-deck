// 인용·RT 대상 미리보기의 상태(설계 §7-1) — 판정은 campaignJudgment.targetStatus/targetUrlOf와 같은 규칙:
// 대상 작업은 postUrl이 있어야 보인다(게시 확인만 되고 링크가 없으면 아직 '게시 전'과 같다, campaignTaskStore:36).
// 새 작업 폼(로컬 TargetValue)도 같은 두 함수로 판정한다 — 화면에서 따로 규칙을 다시 적지 않는다.
import { targetStatus, targetUrlOf, type TargetInput } from './campaignJudgment.ts';
import type { TaskRow } from './campaignTaskStore.ts';

export type TargetPreviewState = { kind: 'none' } | { kind: 'pending' } | { kind: 'cancelled' } | { kind: 'link'; url: string };

function fromInput(input: TargetInput, cancelledAt: string | null): TargetPreviewState {
  const s = targetStatus({ ...input, targetCancelledAt: cancelledAt });
  if (s === 'none') return { kind: 'none' };
  if (s === 'cancelled') return { kind: 'cancelled' };
  if (s === 'pending') return { kind: 'pending' };
  const url = targetUrlOf(input);
  return url ? { kind: 'link', url } : { kind: 'none' };
}

export function targetPreviewState(t: Pick<TaskRow, 'targetTaskId' | 'targetTweetUrl' | 'target'>): TargetPreviewState {
  return fromInput(
    { targetTaskId: t.targetTaskId, targetTweetUrl: t.targetTweetUrl, targetPostUrl: t.target?.postUrl ?? null },
    t.target?.cancelledAt ?? null,
  );
}

// 새 작업 폼의 대상(TargetPicker의 TargetValue와 같은 모양) — 고른 작업의 postUrl은 후보 조회가 끝나야 채워진다
// (그 전엔 undefined → 게시 전과 같게 본다). 폼의 후보 목록엔 취소 여부가 없어 cancelled는 나오지 않는다.
export function targetPreviewStateOfValue(v: { taskId: string; postUrl?: string | null } | { url: string } | null): TargetPreviewState {
  if (v === null) return { kind: 'none' };
  if ('url' in v) return fromInput({ targetTaskId: null, targetTweetUrl: v.url, targetPostUrl: null }, null);
  return fromInput({ targetTaskId: v.taskId, targetTweetUrl: null, targetPostUrl: v.postUrl ?? null }, null);
}
