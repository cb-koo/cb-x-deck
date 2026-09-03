'use client';
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '@/lib/influencerPricing';
import { formatDateKo, TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import {
  GROUP_BYS, GROUP_BY_LABEL, blockedCount, groupTasks, hidesColumn, isBlocked,
  type GroupBy, type WorkflowInput,
} from '@/lib/campaignWorkflow';
import { StageCell } from './StageCell';

// 업무 흐름대로 본 작업 표(스펙 §6-2). 1단계는 읽기 전용 — 다음 행동은 문구로만 둔다.
// 열 다섯: 유형 · 인플루언서 · 진행 · 예정일 · 비용. 묶은 기준은 열에서 빠진다(§6-1).

export interface WorkflowTask extends WorkflowInput {
  id: string;
  draftLabel: string | null;
}

const TH = 'px-3.5 py-2.5 text-left text-ui font-medium text-x-secondary';
const TD = 'px-3.5 py-3 align-top';

export function WorkflowTable({
  tasks, today, groupBy, onGroupBy,
}: {
  tasks: WorkflowTask[];
  today: string;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
}) {
  const groups = useMemo(() => groupTasks(tasks, groupBy, today), [tasks, groupBy, today]);
  // 접힘은 묶음 키로 기억한다 — 기본으로 접히는 묶음(완료·취소)은 groupTasks가 알려준다(§6-2).
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const toggle = useCallback((key: string) => setOpened((o) => ({ ...o, [key]: !(key in o ? o[key] : false) })), []);
  const showType = !hidesColumn(groupBy, 'type');
  const showInfluencer = !hidesColumn(groupBy, 'influencer');
  const showStage = !hidesColumn(groupBy, 'stage');
  const blocked = blockedCount(tasks, today);

  return (
    <div className="ds flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-ui text-x-secondary">묶기</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-x-border">
            {GROUP_BYS.map((g) => (
              <button key={g} type="button" onClick={() => onGroupBy(g)}
                      aria-pressed={groupBy === g}
                      className={`min-h-9 px-3 text-ui ${groupBy === g ? 'bg-x-blue text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                {GROUP_BY_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
        <span className="text-ui text-x-secondary">
          작업 {tasks.length}건 · <strong className={blocked ? 'text-x-pink' : 'text-x-secondary'}>막힌 것 {blocked}건</strong>
        </span>
      </div>

      {groups.length === 0 && <p className="py-10 text-center text-content text-x-muted">작업이 없어요</p>}

      {groups.map((g) => {
        const open = g.key in opened ? opened[g.key] : !g.collapsedByDefault;
        const groupBlocked = blockedCount(g.items, today);
        return (
          <section key={g.key} className="overflow-hidden rounded-xl border border-x-border">
            {g.label && (
              <h3>
                <button type="button" onClick={() => toggle(g.key)} aria-expanded={open}
                        className="flex min-h-11 w-full items-center gap-2 bg-x-surface px-3.5 py-2 text-left hover:bg-x-hover">
                  <span aria-hidden className="text-x-muted">{open ? '⌄' : '›'}</span>
                  <span className="text-content font-semibold">{g.label}</span>
                  <span className="text-ui text-x-secondary">{g.items.length}건</span>
                  {groupBlocked > 0 && groupBy !== 'stage' && (
                    <span className="text-ui text-x-pink">막힌 것 {groupBlocked}</span>
                  )}
                </button>
              </h3>
            )}
            {open && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-x-border">
                      {showType && <th scope="col" className={`${TH} w-[92px]`}>유형</th>}
                      {showInfluencer && <th scope="col" className={`${TH} w-[160px]`}>인플루언서</th>}
                      <th scope="col" className={`${TH} min-w-[280px]`}>진행</th>
                      <th scope="col" className={`${TH} w-[110px]`}>예정일</th>
                      <th scope="col" className={`${TH} w-[120px]`}>비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((t) => (
                      <tr key={t.id} className={`border-b border-x-border last:border-0 ${isBlocked(t, today) ? '' : 'bg-white'}`}>
                        {showType && <td className={`${TD} text-content`}>{TASK_TYPE_LABEL[t.type]}</td>}
                        {showInfluencer && (
                          <td className={`${TD} text-content`}>
                            {t.influencerHandle ?? <span className="text-x-muted">미배정</span>}
                          </td>
                        )}
                        <td className={TD}>
                          <StageCell task={t} today={today} showStage={showStage} />
                          {t.draftLabel && <p className="mt-1 truncate text-caption text-x-muted">원고: {t.draftLabel}</p>}
                        </td>
                        <td className={`${TD} text-content`}>
                          {t.scheduledOn ? formatDateKo(t.scheduledOn) : <span className="text-x-muted">—</span>}
                        </td>
                        <td className={`${TD} text-content`}>
                          {t.cost ? formatMoney(t.cost.amount, t.cost.currency) : <span className="text-x-pink">없음</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
