'use client';
import { Badge } from '@/components/ds/badge';
import {
  WORKFLOW_STAGE_LABEL, WORKFLOW_STAGE_OWNER, isPostOverdue, nextActionText, workflowStage,
  type WorkflowInput, type WorkflowStage,
} from '@/lib/campaignWorkflow';

// 「진행」 한 칸 — 지금 어디에 있고 다음에 무엇을 하면 되는지를 함께 보여준다(스펙 §6-2).
// 지금 일곱 열에서 원고·대상·증빙·정산 배지가 하던 일을 이 칸이 맡는다.

// Badge의 variant는 여섯 개뿐이라 단계 일곱 개를 다 담지 못한다 —
// '누구 차례'로 접어서 고른다. 색이 곧 "내가 손댈 것인가"를 말하게 된다.
const STAGE_VARIANT: Record<WorkflowStage, 'default' | 'secondary' | 'outline' | 'destructive' | 'ghost'> = {
  preparing: 'secondary',
  deliverPending: 'default',
  postPending: 'outline',
  settlePending: 'default',
  payPending: 'outline',
  done: 'ghost',
  cancelled: 'ghost',
};

export function StageCell({ task, today, showStage }: { task: WorkflowInput; today: string; showStage: boolean }) {
  const stage = workflowStage(task, today);
  const action = nextActionText(task, today);
  const late = stage === 'postPending' && isPostOverdue(task, today);
  const owner = WORKFLOW_STAGE_OWNER[stage];
  return (
    <div className="flex flex-col items-start gap-1">
      {/* 묶기가 '진행'이면 묶음 제목이 이미 단계를 말한다 — 같은 말을 두 번 하지 않는다(§6-1) */}
      {showStage && (
        <Badge variant={late ? 'destructive' : STAGE_VARIANT[stage]}>
          {WORKFLOW_STAGE_LABEL[stage]}
        </Badge>
      )}
      {action && (
        <span className={`text-sm ${late ? 'text-destructive' : owner === 'us' ? 'text-foreground' : 'text-muted-foreground'}`}>
          {action}
        </span>
      )}
    </div>
  );
}
