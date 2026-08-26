// 달력 격자의 순수 계산(스펙 §3-2 주간 달력) — 주 행 스택·날짜별 카드 배분·날짜 앵커 표기. DOM 없음, 컴포넌트는 결과를 그릴 뿐이다.
// 날짜는 전부 'YYYY-MM-DD'(date-only) — 산술은 campaignJudgment의 헬퍼를 그대로 쓴다.
// 주 페이징(◀ ▶)은 없앴다(리서치 §3-1): 달력 도구는 주를 넘기지 않고 아래로 쌓아 기간 전체를 한 화면에 보여준다.
import { weekStartOf, weekDays, addDays, sortContent, type SortInput } from './campaignJudgment.ts';
import { dateOnlyMonthDay, asDateOnly, type DateOnly } from './datetime.ts';

export interface DayCell<T> { date: DateOnly; items: T[] }
export interface CalendarGrid<T> { weeks: DayCell<T>[][]; unscheduled: T[] }
export interface WeekBounds { first: string; last: string }   // 그려야 할 첫·마지막 주(월요일)

// 그릴 범위 = 캠페인 기간의 주들 ∪ 예정일이 찍힌 주들. 기간 밖 예정일도 어느 주엔가 보여야 그 카드에 손이 닿는다.
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

/** 격자의 주 행들 — 각 행은 월~일 7일. 캠페인이 걸치는 주 전부(+ 기간 밖 예정일이 있는 주)를 위에서 아래로 쌓는다. */
export function weekRows(startsOn: string, endsOn: string, scheduled: Array<string | null>): DateOnly[][] {
  const { first, last } = weekBounds(startsOn, endsOn, scheduled);
  const rows: DateOnly[][] = [];
  // addDays(±7)만 쓰므로 달·해 경계에서도 어긋나지 않는다. 상한(200주)은 망가진 기간 값이 무한 루프가 되는 것만 막는다.
  for (let w = asDateOnly(first); w <= last && rows.length < 200; w = addDays(w, 7)) rows.push(weekDays(w));
  return rows;
}

/** 주 행 × 요일 칸에 카드를 담고, 예정일 없는 카드는 따로 모은다.
 *  칸 안 순서는 sortContent('scheduled') — 같은 날이라 생성순이 되고 미사용은 맨 아래(표와 같은 규칙, 흐린 카드가 중간에 끼지 않게). */
export function calendarGrid<T extends SortInput>(items: T[], weeks: DateOnly[][], today: string): CalendarGrid<T> {
  const sorted = sortContent(items, 'scheduled', today);
  return {
    weeks: weeks.map((days) => days.map((date) => ({ date, items: sorted.filter((d) => d.scheduledOn === date) }))),
    unscheduled: sorted.filter((d) => d.scheduledOn === null),
  };
}

/** 칸 좌상단 날짜 앵커 — 보통 일 숫자만('3'), 격자 첫 칸과 달이 바뀌는 칸만 '9/1'로 달을 알려준다.
 *  달력은 요일 헤더가 위에 한 번 있고 칸 안 날짜는 작은 앵커라는 해부학(리서치 §3-2)을 따르되,
 *  여러 주가 쌓이면 "이게 몇 월이지?"가 생기므로 달이 바뀌는 지점에서만 달을 붙인다. */
export function dateAnchorLabel(date: string, prevDate: string | null): string {
  const day = Number(date.slice(8, 10));
  if (Number.isNaN(day)) return '';
  const sameMonth = prevDate !== null && prevDate.slice(0, 7) === date.slice(0, 7);
  return sameMonth ? String(day) : dateOnlyMonthDay(asDateOnly(date));
}
