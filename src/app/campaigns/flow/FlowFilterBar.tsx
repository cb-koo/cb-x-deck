'use client';
import type { FlowFilter, ExtraFilter } from '@/lib/campaignFlowView';
import type { FlowStage, TaskType } from '@/lib/campaignJudgment';

// TODO(Task 6): 구현 — 필터 드롭다운(단계·유형·추가 조건) + 검색 + 요약/정렬 문구 + 정산 대기 바로가기(b-task-6-brief.md §1)
export function FlowFilterBar(_props: {
  filter: FlowFilter;
  onChange: (f: FlowFilter) => void;
  counts: { stage: Record<FlowStage, number>; type: Record<TaskType, number>; extra: Record<ExtraFilter, number> };
  summary: string;
  sortNote: string;
  settleWait: number;
  campaignId: string;
}) {
  void _props;   // 타입만 받는 껍데기 — Task 6이 채운다
  return null;
}
