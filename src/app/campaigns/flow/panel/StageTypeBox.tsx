import { flowStage, FLOW_STAGE_LABEL, TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { STAGE_CHIP, TYPE_CHIP, FLOW_STEPS } from '@/lib/flowChips';
import type { FlowRow } from '@/lib/campaignFlowView';
import { PanelSection } from './PanelSection';

// 본문 첫 상자(설계 §5) — 단계는 흐름 줄(지금 단계만 검은 칩), 유형은 칩. 둘 다 읽기 전용이라 입력칸처럼 보이는 테두리·호버를 주지 않는다.
export function StageTypeBox({ task }: { task: FlowRow }) {
  const stage = flowStage(task, task.settlement);
  return (
    <PanelSection>
      <dl className="grid grid-cols-[76px_1fr] items-center gap-3">
        <dt className="text-[14px] font-semibold text-x-secondary">단계</dt>
        <dd>
          {stage === 'canc'
            ? <span className={`rounded-full px-2.5 py-1 text-[14px] ${STAGE_CHIP.canc}`}>{FLOW_STAGE_LABEL.canc}</span>
            : (
              <ol className="flex flex-wrap items-center gap-1 text-[14px]" aria-label="진행 단계">
                {FLOW_STEPS.map((s, i) => (
                  <li key={s} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden className="text-[12px] text-x-border-strong">›</span>}
                    <span aria-current={s === stage ? 'step' : undefined}
                          className={`rounded-full border px-2.5 py-1 ${s === stage ? 'border-x-text bg-x-text font-semibold text-white' : 'border-x-border bg-x-surface text-x-muted'}`}>
                      {FLOW_STAGE_LABEL[s]}
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
