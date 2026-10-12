import { flowStage, FLOW_STAGE_LABEL, TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { STAGE_CHIP, TYPE_CHIP, FLOW_STEPS } from '@/lib/flowChips';
import { flowStageLabel, visitStep, VISIT_STEPS, VISIT_STEP_LABEL, type FlowRow } from '@/lib/campaignFlowView';
import { VISIT_PHASE_LABEL, type VisitPhase } from '@/lib/reservationPolicy';
import { PanelSection } from './PanelSection';

// 본문 첫 상자(설계 §5) — 단계는 흐름 줄(지금 단계만 검은 칩), 유형은 칩. 둘 다 읽기 전용이라 입력칸처럼 보이는 테두리·호버를 주지 않는다.
// 방문협찬은 예약 단계를 넣은 7단계 줄(대기 → 확정 → 방문 → 전달 → 게시 → 정산 → 완료, campaignFlowView.visitStep) — 패널이 단계(phase)를
// 넘겨주고 예약 상태를 아는 DB(reservation 칸)일 때만. 그 밖(다른 유형·예약 구조 없는 DB)은 공통 5단계 줄에 준비 칩 글자만 바꾼다.
export function StageTypeBox({ task, phase = null }: { task: FlowRow; phase?: VisitPhase | null }) {
  const stage = flowStage(task, task.settlement);
  const visit = task.type === 'visit' && phase !== null && task.reservation !== undefined;
  const step = visit ? visitStep(task, phase) : undefined;   // undefined = 공통 줄, null = 흐름 밖(취소·노쇼)
  const outOfFlow = stage === 'canc' || step === null;
  // 노쇼로 끝난 예약은 작업도 취소 처리되지만(cancelledAt) 칩에는 끝난 이유를 그대로 쓴다 — '취소'라고만 하면 왜 끝났는지 안 보인다
  const endLabel = visit && (phase === 'visit_no_show' || phase === 'upload_no_show') ? VISIT_PHASE_LABEL[phase] : FLOW_STAGE_LABEL.canc;
  const steps: readonly { key: string; label: string; current: boolean }[] = step
    ? VISIT_STEPS.map((s) => ({ key: s, label: VISIT_STEP_LABEL[s], current: s === step }))
    : FLOW_STEPS.map((s) => ({ key: s, label: s === 'prep' ? flowStageLabel(task, 'prep') : FLOW_STAGE_LABEL[s], current: s === stage }));
  return (
    <PanelSection>
      <dl className="grid grid-cols-[76px_1fr] items-center gap-3">
        <dt className="text-[14px] font-semibold text-x-secondary">단계</dt>
        <dd>
          {outOfFlow
            ? <span className={`rounded-full px-2.5 py-1 text-[14px] ${STAGE_CHIP.canc}`}>{endLabel}</span>
            : (
              <ol className="flex flex-wrap items-center gap-1 text-[14px]" aria-label="진행 단계">
                {steps.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden className="text-[12px] text-x-border-strong">›</span>}
                    <span aria-current={s.current ? 'step' : undefined}
                          className={`rounded-full border px-2.5 py-1 ${s.current ? 'border-x-text bg-x-text font-semibold text-white' : 'border-x-border bg-x-surface text-x-muted'}`}>
                      {s.label}
                    </span>
                  </li>
                ))}
              </ol>
            )}
        </dd>
        <dt className="text-[14px] font-semibold text-x-secondary">유형</dt>
        <dd><span className={`rounded-full px-2.5 py-1 text-[14px] font-medium ${TYPE_CHIP[task.type]}`}>{TASK_TYPE_LABEL[task.type]}</span></dd>
      </dl>
    </PanelSection>
  );
}
