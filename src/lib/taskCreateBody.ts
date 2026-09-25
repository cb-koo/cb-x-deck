// 새 작업 만들기 폼의 본문 조립 — TaskPanel.tsx의 [만들기] 처리에 인라인으로 있던 것을 그대로 옮긴다(Task 5가 배선한다).
// draftId 한 줄만 더한다: 고른 원고를 작업 생성과 같은 트랜잭션에서 붙인다(campaignTaskStore.ts:163 attachDraft).
// 서버 제약(campaignTaskStore.ts:144): draftId는 influencers가 1개 이하일 때만 오고, count와 함께 오지 않는다 —
// 이 폼은 count를 아예 안 쓰므로 그 규칙은 자동으로 지켜진다.
import type { TaskCreateRequest } from './campaignApi.ts';
import type { TaskCost } from './campaignCost.ts';
import type { TaskType } from './campaignJudgment.ts';

export type TaskCreateFormState = {
  type: TaskType;
  handle: string | null;
  cost: TaskCost | null;
  scheduledOn: string | null;
  visitOn: string | null;
  note: string;
  target: { taskId: string } | { url: string } | null;
  draftId: string | null;
  paymentMethodId?: string | null;   // 새 작업 폼에서 고른 결제 수단(§8-2) — 사람 줄에 싣는다. 기본 수단이면 null(안 보냄)
};

export function buildTaskCreateBody(input: TaskCreateFormState): TaskCreateRequest {
  return {
    type: input.type,
    influencers: input.handle ? [{ handle: input.handle, cost: input.cost, ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}) }] : [],
    ...(input.handle ? {} : { cost: input.cost ?? undefined }),
    scheduledOn: input.scheduledOn, visitOn: input.type === 'visit' ? input.visitOn : null,
    note: input.note,
    ...(input.target && 'taskId' in input.target ? { targetTaskId: input.target.taskId } : {}),
    ...(input.target && 'url' in input.target ? { targetTweetUrl: input.target.url } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
  };
}
