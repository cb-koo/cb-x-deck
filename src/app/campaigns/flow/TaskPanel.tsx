'use client';
import type { FlowRow } from '@/lib/campaignFlowView';

// TODO(Task 7): 구현 — 실제 prop 모양은 b-task-7-brief.md가 정한다(mode: {kind:'edit'|'new'} · campaign · today ·
// influencerOptions · actions(useCampaignTaskActions) · onCreate · menu · onOpenDraft/onAttachDraft/onDetachDraft ·
// onGenerateHref · slots:{cost,target}). 지금은 FlowDetail이 열림/닫힘만 조건부로 그릴 수 있는 최소 골격이다.
export function TaskPanel(_props: {
  task: FlowRow | null;
  isNew: boolean;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  void _props;   // 타입만 받는 껍데기 — Task 7이 채운다
  return null;
}
