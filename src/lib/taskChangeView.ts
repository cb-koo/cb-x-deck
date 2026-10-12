// 작업 금액 변경 이력 표시(스펙 2026-10-07 §9 '이력 행'·'이력 출처 문장') — 작업 패널과 정산 화면이 같은 문장을 쓴다. 순수 모듈.
import { formatMoney } from './influencerPricing.ts';
import type { TaskCost } from './campaignCost.ts';
import type { TaskChangeSource } from './campaignTaskStore.ts';

export const TASK_CHANGE_SOURCE_TEXT: Record<TaskChangeSource, string> = {
  settlement: '정산 화면에서 정산팀 지급 금액에 맞췄어요',
  campaign: '캠페인 화면에서 고쳤어요',
  replace: '인플루언서를 바꾸면서 고쳤어요',
};
export const costText = (c: TaskCost | null): string => (c ? formatMoney(c.amount, c.currency) : '—');
