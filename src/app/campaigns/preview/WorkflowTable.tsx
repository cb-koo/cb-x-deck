'use client';
import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ds/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ds/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ds/table';
import { formatMoney } from '@/lib/influencerPricing';
import { formatDateKo, TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import {
  GROUP_BYS, GROUP_BY_LABEL, blockedCount, groupTasks, hidesColumn, isGroupBy, isBlocked,
  type GroupBy, type WorkflowInput,
} from '@/lib/campaignWorkflow';
import { StageCell } from './StageCell';

// 업무 흐름대로 본 작업 표(스펙 §6-2). 1단계는 읽기 전용 — 다음 행동은 문구로만 둔다.
// 열 다섯: 유형 · 인플루언서 · 진행 · 예정일 · 비용. 묶은 기준은 열에서 빠진다(§6-1).

export interface WorkflowTask extends WorkflowInput {
  id: string;
  draftLabel: string | null;
}

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">묶기</span>
          {/* ToggleGroup은 값을 배열로 다룬다(다중 선택 프리미티브) — 하나만 쓰되 빈 선택은 무시한다 */}
          <ToggleGroup variant="outline" size="sm" spacing={0} value={[groupBy]}
                       onValueChange={(v) => { const next = v.at(-1); if (isGroupBy(next)) onGroupBy(next); }}>
            {GROUP_BYS.map((g) => (
              <ToggleGroupItem key={g} value={g}>{GROUP_BY_LABEL[g]}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <span className="text-sm text-muted-foreground">
          작업 {tasks.length}건
          {blocked > 0 && <> · <span className="font-medium text-destructive">막힌 것 {blocked}건</span></>}
        </span>
      </div>

      {groups.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">작업이 없어요</p>}

      {groups.map((g) => {
        const open = g.key in opened ? opened[g.key] : !g.collapsedByDefault;
        const groupBlocked = blockedCount(g.items, today);
        return (
          <section key={g.key} className="overflow-hidden rounded-xl border">
            {g.label && (
              <h3>
                <button type="button" onClick={() => toggle(g.key)} aria-expanded={open}
                        className="flex min-h-11 w-full items-center gap-2 bg-muted/60 px-3.5 py-2 text-left transition-colors hover:bg-muted">
                  {open ? <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                        : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
                  <span className="font-semibold">{g.label}</span>
                  <span className="text-sm text-muted-foreground">{g.items.length}건</span>
                  {groupBlocked > 0 && groupBy !== 'stage' && (
                    <Badge variant="destructive" className="ml-1">막힌 것 {groupBlocked}</Badge>
                  )}
                </button>
              </h3>
            )}
            {open && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {showType && <TableHead className="w-[92px] px-3.5">유형</TableHead>}
                    {showInfluencer && <TableHead className="w-[168px] px-3.5">인플루언서</TableHead>}
                    <TableHead className="min-w-[280px] px-3.5">진행</TableHead>
                    <TableHead className="w-[112px] px-3.5">예정일</TableHead>
                    <TableHead className="w-[124px] px-3.5">비용</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.items.map((t) => (
                    <TableRow key={t.id} data-blocked={isBlocked(t, today) || undefined}>
                      {showType && <TableCell className="px-3.5 py-3 align-top">{TASK_TYPE_LABEL[t.type]}</TableCell>}
                      {showInfluencer && (
                        <TableCell className="px-3.5 py-3 align-top">
                          {t.influencerHandle ?? <span className="text-muted-foreground">미배정</span>}
                        </TableCell>
                      )}
                      <TableCell className="px-3.5 py-3 align-top whitespace-normal">
                        <StageCell task={t} today={today} showStage={showStage} />
                        {t.draftLabel && <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">원고: {t.draftLabel}</p>}
                      </TableCell>
                      <TableCell className="px-3.5 py-3 align-top">
                        {t.scheduledOn ? formatDateKo(t.scheduledOn) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="px-3.5 py-3 align-top">
                        {t.cost ? formatMoney(t.cost.amount, t.cost.currency) : <span className="text-destructive">없음</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        );
      })}
    </div>
  );
}
