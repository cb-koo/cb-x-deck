'use client';
import {
  WORKFLOW_STAGE_LABEL, WORKFLOW_STAGE_OWNER, isPostOverdue, nextActionText, workflowStage,
  type WorkflowInput, type WorkflowStage,
} from '@/lib/campaignWorkflow';

// 「진행」 한 칸 — 지금 어디에 있고 다음에 무엇을 하면 되는지를 함께 보여준다(스펙 §6-2).
// 지금 일곱 열에서 원고·대상·증빙·정산 배지가 하던 일을 이 칸이 맡는다.

const STAGE_CHIP: Record<WorkflowStage, string> = {
  preparing: 'bg-x-surface text-x-secondary',
  deliverPending: 'bg-x-blue/10 text-x-blue-text',
  postPending: 'bg-amber-50 text-amber-700',
  settlePending: 'bg-x-blue/10 text-x-blue-text',
  payPending: 'bg-x-surface text-x-secondary',
  done: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-x-surface text-x-muted line-through',
};

export function StageCell({ task, today, showStage }: { task: WorkflowInput; today: string; showStage: boolean }) {
  const stage = workflowStage(task, today);
  const action = nextActionText(task, today);
  const late = stage === 'postPending' && isPostOverdue(task, today);
  return (
    <div className="flex flex-col gap-1">
      {/* 묶기가 '진행'이면 묶음 제목이 이미 단계를 말한다 — 같은 말을 두 번 하지 않는다(§6-1) */}
      {showStage && (
        <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-ui font-medium ${STAGE_CHIP[stage]}`}>
          {WORKFLOW_STAGE_LABEL[stage]}
        </span>
      )}
      {action && (
        <span className={`text-ui ${late ? 'text-x-pink' : WORKFLOW_STAGE_OWNER[stage] === 'us' ? 'text-x-text' : 'text-x-muted'}`}>
          {action}
        </span>
      )}
    </div>
  );
}
