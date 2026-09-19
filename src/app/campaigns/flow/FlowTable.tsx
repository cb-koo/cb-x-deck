'use client';
import type { ReactNode } from 'react';
import type { FlowRow, FlowSort } from '@/lib/campaignFlowView';
import type { InfluencerOption } from '@/lib/draftTypes';

// TODO(Task 6): 구현 — 표 6열(단계·유형·인플·원고·게시 예정일·비용) + 헤더 정렬 + 빈 상태 + 하단 요약(b-task-6-brief.md §2)
export function FlowTable(_props: {
  rows: FlowRow[];
  total: number;
  today: string;
  influencerOptions: InfluencerOption[];
  sort: FlowSort;
  onSortChange: (s: FlowSort) => void;
  footer: string;
  selectedId: string | null;
  onRowClick: (t: FlowRow) => void;
  renderMenu: (t: FlowRow) => ReactNode;
}) {
  void _props;   // 타입만 받는 껍데기 — Task 6이 채운다
  return null;
}
