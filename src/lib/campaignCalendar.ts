// 주간 달력의 순수 계산(스펙 §3-2 주간 달력) — 열 배분·넘김 범위·주 라벨. DOM 없음, 컴포넌트는 결과를 그릴 뿐이다.
// 날짜는 전부 'YYYY-MM-DD'(date-only) — 산술은 campaignJudgment의 헬퍼, 라벨은 datetime.weekRangeLabel(스펙 §8 "주 범위 계산 연계").
import { weekStartOf, weekDays, addDays, sortContent, type SortInput } from './campaignJudgment.ts';
import { weekRangeLabel, asDateOnly } from './datetime.ts';

export interface DayColumn<T> { date: string; items: T[] }
export interface WeekColumns<T> { days: DayColumn<T>[]; unscheduled: T[] }
export interface WeekBounds { first: string; last: string }   // 넘길 수 있는 첫·마지막 주(월요일)

// 월~일 7열 + 예정일 없음. 다른 주의 카드는 이 주에 없다(넘김으로 간다). 열 안 순서는 sortContent('scheduled') —
// 같은 날이라 생성순이 되고 미사용은 맨 아래(표와 같은 규칙, 흐린 카드가 중간에 끼지 않게).
export function weekColumns<T extends SortInput>(items: T[], weekStart: string, today: string): WeekColumns<T> {
  const sorted = sortContent(items, 'scheduled', today);
  return {
    days: weekDays(weekStart).map((date) => ({ date, items: sorted.filter((d) => d.scheduledOn === date) })),
    unscheduled: sorted.filter((d) => d.scheduledOn === null),
  };
}

// 넘김 범위 = 캠페인 기간의 주들 ∪ 예정일이 찍힌 주들. 기간 밖 예정일도 어느 주엔가 보여야 '기간 밖' 배지가 뜬다.
export function weekBounds(startsOn: string, endsOn: string, scheduled: Array<string | null>): WeekBounds {
  let first: string = weekStartOf(startsOn);
  let last: string = weekStartOf(endsOn);
  for (const s of scheduled) {
    if (s === null) continue;
    const w: string = weekStartOf(s);
    // 'YYYY-MM-DD'는 사전순 = 시간순이라 문자열 비교로 충분하다(Date 객체를 만들지 않는다)
    if (w < first) first = w;
    if (w > last) last = w;
  }
  return { first, last };
}
// 한 주에 다 들어가면 ◀ ▶를 그리지 않는다(스펙 §3-2 "7일 이하면 한 주" — 열이 월~일 고정이라 주 단위로 판정한다)
export function isSingleWeek(b: WeekBounds): boolean {
  return b.first === b.last;
}
export function prevWeek(weekStart: string, b: WeekBounds): string | null {
  const p: string = addDays(weekStart, -7);
  return p < b.first ? null : p;
}
export function nextWeek(weekStart: string, b: WeekBounds): string | null {
  const n: string = addDays(weekStart, 7);
  return n > b.last ? null : n;
}
// 보고 있던 주가 범위 밖으로 나가면(예정일 지움·기간 축소) 가장 가까운 경계 주로 — 빈 달력에 갇히지 않게
export function clampWeek(weekStart: string, b: WeekBounds): string {
  if (weekStart < b.first) return b.first;
  if (weekStart > b.last) return b.last;
  return weekStart;
}
/** '8/24~30 주' · 월이 바뀌면 '8/31~9/6 주' — 넘김 헤더 */
export function weekLabel(weekStart: string): string {
  return `${weekRangeLabel(asDateOnly(weekStart))} 주`;
}
