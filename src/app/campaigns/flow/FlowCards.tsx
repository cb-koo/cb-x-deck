'use client';
import type { FlowStats } from '@/lib/campaignFlowView';
import type { CampaignMonthBudget } from '@/lib/clientBudget';

// TODO(Task 11): 구현 — 요약 카드 3장(작업·성과·비용/예산 막대) + 성과 [업데이트] 버튼(b-task-11-brief.md §1)
export function FlowCards(_props: {
  stats: FlowStats;
  budget: CampaignMonthBudget | null;
  clientId: string | null;
  cancelledCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  void _props;   // 타입만 받는 껍데기 — Task 11이 채운다
  return null;
}
