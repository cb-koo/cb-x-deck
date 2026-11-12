// 캠페인 현황(전체 캠페인 모니터링) 화면의 순수 계산 — DB·화면 없이 테스트한다.
import { weekStartOf, addDays, isDateOnlyString, isTaskExcluded, isTaskOverdue } from './campaignJudgment.ts';
import type { CampaignTaskItem } from './campaignStore.ts';

export interface OverviewWeek { weekStart: string; weekEnd: string; isCurrent: boolean }

// 주소의 주 값을 월~일 주로 바꾼다. 틀린 값·미래 주는 이번 주로 — 아직 오지 않은 주는 볼 게 없다.
// isDateOnlyString이 형식과 실제 달력 날짜(02-30 등)를 함께 거른다.
export function resolveWeek(param: string | null, today: string): OverviewWeek {
  const current = weekStartOf(today);
  let weekStart: string = current;
  if (param !== null && isDateOnlyString(param)) {
    const ws = weekStartOf(param);
    if (ws <= current) weekStart = ws;
  }
  return { weekStart, weekEnd: addDays(weekStart, 6), isCurrent: weekStart === current };
}

// 계획 수량 — 나중에 최소 작업량이 생기면 여기만 바꾼다(스펙 §6)
export function plannedCount(tasks: CampaignTaskItem[]): number {
  return tasks.filter((t) => !isTaskExcluded(t)).length;
}

export interface Quantity { planned: number; posted: number; overdue: number; open: number; undated: number; cancelled: number }

// open = planned − posted(게시 전 전부, overdue 포함). undated = 게시 전이고 예정일 없음.
export function quantityOf(tasks: CampaignTaskItem[], today: string): Quantity {
  const live = tasks.filter((t) => !isTaskExcluded(t));
  const planned = plannedCount(tasks);
  const posted = live.filter((t) => t.postedAt !== null).length;
  // 밀림 판정은 기존 규칙 하나만 쓴다 — 다른 화면과 숫자가 어긋나지 않게
  const overdue = live.filter((t) => isTaskOverdue(t, today)).length;
  const undated = live.filter((t) => t.postedAt === null && t.scheduledOn === null).length;
  return { planned, posted, overdue, open: planned - posted, undated, cancelled: tasks.length - live.length };
}

export type CardStatus = 'unset' | 'done' | 'late' | 'onTrack';

// 판정 순서: 계획 없음 → 다 게시 → 밀림 있음 → 예정대로
export function cardStatus(q: Quantity): CardStatus {
  if (q.planned === 0) return 'unset';
  if (q.open === 0) return 'done';
  if (q.overdue > 0) return 'late';
  return 'onTrack';
}

export const CARD_STATUS_LABEL = (s: CardStatus, overdue: number): string => {
  switch (s) {
    case 'unset': return '세팅 전';
    case 'done': return '✓ 계획 완료';
    case 'late': return `예정일 지난 ${overdue}건`;
    case 'onTrack': return '예정대로';
  }
};
