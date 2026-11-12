// 캠페인 현황(전체 캠페인 모니터링) 화면의 순수 계산 — DB·화면 없이 테스트한다.
import { weekStartOf, addDays, isDateOnlyString, isTaskExcluded, isTaskOverdue } from './campaignJudgment.ts';
import type { CampaignTaskItem } from './campaignStore.ts';
import { flowStats } from './campaignFlowView.ts';
import { toKrw } from './clientBudget.ts';

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

// 나중에 판정을 얹을 자리(스펙 §6) — 지금은 항상 null
export interface Metric { value: number | null; judgment: null }
export type CpvView = { kind: 'value'; krw: number } | { kind: 'free' } | { kind: 'none' };
export interface Perf { views: Metric; bookmarks: Metric; cpv: CpvView; spentKrw: number }

const isLivePosted = (t: CampaignTaskItem) => !isTaskExcluded(t) && t.postedAt !== null;

// 숫자는 flowStats 그대로 — 캠페인 상세와 같은 숫자가 나와야 한다
export function perfOf(tasks: CampaignTaskItem[]): Perf {
  const s = flowStats(tasks);
  const spentKrw = toKrw(s.spent).krw;
  const views = s.perf.views;
  let cpv: CpvView = { kind: 'none' };
  if (spentKrw > 0) {
    // CPV 공식은 flowStats 하나만 — 조회가 있을 때만 값이 있다
    if (views && s.cpvKrw !== null) cpv = { kind: 'value', krw: s.cpvKrw };
  } else {
    // flowStats는 비용 0원에도 cpvKrw 0을 준다 — 비용 미입력과 무상을 가르려면 작업을 직접 본다
    const posted = tasks.filter(isLivePosted);
    if (posted.length > 0 && posted.every((t) => t.noCost || t.cost?.amount === 0)) cpv = { kind: 'free' };
  }
  return { views: { value: views, judgment: null }, bookmarks: { value: s.perf.bookmarks, judgment: null }, cpv, spentKrw };
}

// 소수 한 자리는 캠페인 상세(FlowCards·FlowTable)의 CPV 표기와 맞춘다
export function formatCpv(c: CpvView): string {
  if (c.kind === 'value') return `${c.krw.toFixed(1)}원`;
  return c.kind === 'free' ? '무상' : '-';
}

// 스토어가 주는 재료: 본 게시물의 한국 날짜별 마지막 실측값
export interface DayPoint { taskId: string; day: string; views: number | null; bookmarks: number | null }
export interface FlowChart {
  days: string[];              // 'YYYY-MM-DD' 가로 칸 전부
  todayIndex: number;          // 선이 끝나는 칸(이번 주 = 오늘, 지난 주 = 마지막 칸)
  views: Array<number | null>; // todayIndex 뒤는 null
  bookmarks: Array<number | null>;
  postedPerDay: number[];      // 그날 게시된 작업 수(postedAt 기준)
}

// 이번 주는 7칸을 다 그리고 오늘에서 선을 멈춘다. 지난 주는 게시 뒤 2주까지 조회가 붙으니 일요일+14일(또는 오늘)까지.
export function chartDays(weekStart: string, today: string): { days: string[]; todayIndex: number } {
  const weekEnd = addDays(weekStart, 6);
  if (weekStart <= today && today <= weekEnd) {
    const days: string[] = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return { days, todayIndex: days.indexOf(today) };
  }
  const last = addDays(weekEnd, 14) < today ? addDays(weekEnd, 14) : today;
  const days: string[] = [];
  for (let d = weekStart; d <= last; d = addDays(d, 1)) days.push(d);
  return { days, todayIndex: days.length - 1 };
}

type Key = 'views' | 'bookmarks';

// 날짜별 누적 = 게시물마다 그날까지의 마지막 실측값(null은 건너뜀, 측정 전은 0)의 합.
// 오늘 칸은 카드와 같은 규칙(flowStats — 최신값이 null인 게시물은 뺀다)으로 덮어 카드 숫자와 선 끝이 같게 한다.
export function flowChart(tasks: CampaignTaskItem[], points: DayPoint[], weekStart: string, today: string): FlowChart | null {
  const posted = tasks.filter(isLivePosted);
  const ids = new Set(posted.map((t) => t.id));
  const pts = points.filter((p) => ids.has(p.taskId)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  // 카드에 숫자가 하나도 없으면(조회·저장 모두 '-') 차트도 그리지 않는다 — 선만 있고 끝이 0으로 꺾이는 모순을 막는다
  const hasLatest = posted.some((t) => t.perf?.views != null || t.perf?.bookmarks != null);
  if (!hasLatest) return null;

  const { days, todayIndex } = chartDays(weekStart, today);
  // 게시물별로 그날까지 이어온 값
  const carry = (key: Key, day: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const p of pts) {
      if (p.day > day) break;
      const v = p[key];
      if (v !== null) m.set(p.taskId, v);
    }
    return m;
  };
  const series = (key: Key): Array<number | null> => days.map((day, i) => {
    if (i > todayIndex) return null;
    if (i === todayIndex) return posted.reduce((sum, t) => sum + (t.perf?.[key] ?? 0), 0);
    const m = carry(key, day);
    let sum = 0;
    for (const v of m.values()) sum += v;
    return sum;
  });

  // postedAt이 시각까지 오더라도 날짜 부분만 비교한다
  const postedPerDay = days.map((day) => posted.filter((t) => t.postedAt!.slice(0, 10) === day).length);
  return { days, todayIndex, views: series('views'), bookmarks: series('bookmarks'), postedPerDay };
}
