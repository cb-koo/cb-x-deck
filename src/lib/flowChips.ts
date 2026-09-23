// 단계·유형 칩 색 — 표(FlowTable·TaskTable)·주간 달력·대상 고르기·작업 패널이 같은 표를 쓴다.
// 예전에는 파일마다 복사해 들고 있었다(4벌). 한 곳만 고치면 전 화면이 같이 바뀌게 여기 하나로 둔다.
import type { FlowStage, TaskType } from './campaignJudgment.ts';

export const STAGE_CHIP: Record<FlowStage, string> = {
  prep: 'bg-x-surface text-x-secondary', handed: 'bg-[#e8f0fe] text-[#1d4ed8]', posted: 'bg-[#e6f6ee] text-[#15803d]',
  settle: 'bg-[#f3e8ff] text-[#7e22ce]', done: 'bg-x-text text-white', canc: 'bg-slate-50 text-slate-400 line-through',
};
export const TYPE_CHIP: Record<TaskType, string> = {
  post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', rt: 'bg-[#e6f6ee] text-[#15803d]', visit: 'bg-[#fff4e5] text-[#b45309]',
};
// 패널의 단계 흐름 줄 — 취소는 흐름 밖 상태라 줄에 넣지 않는다(취소면 칩 하나만, §5).
export const FLOW_STEPS: readonly FlowStage[] = ['prep', 'handed', 'posted', 'settle', 'done'];
