// 클리닉(본점) 운영시간 판정 — 순수 함수. 웹 운영시간 화면·월 캘린더 API·예약 시각 안내가 같이 쓴다.
// 판정 순서(구현 계획 §클리닉 설정): 날짜 예외 → 공휴일 → 요일. 결과는 운영/휴무/확인 필요 셋.
// 운영 여부 안내일 뿐 잔여 예약 수량을 뜻하지 않는다.
//
// 목업(src/app/mockup/x-extension/policy.ts·hours.ts)의 규칙을 옮기되, 목업에 박혀 있던 2026년 10월 샘플 공휴일은
// 가져오지 않는다. 공휴일은 holiday_calendar에서 읽은 값과 '그 연도 자료를 확보했는지'를 함께 받는다 —
// 자료가 없거나 갱신에 실패한 연도는 평일로 단정하지 않고 확인 필요로 둔다.

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// intervals = 'HH:mm-HH:mm' 또는 점심으로 나뉜 'HH:mm-HH:mm, HH:mm-HH:mm'. 빈 문자열 = 미설정.
export interface DayHours { closed: boolean; intervals: string }
export type HolidayPolicy = 'closed' | 'special' | 'unknown';
export interface ClinicHoursSettings {
  week: DayHours[];          // 길이 7, 0 = 일요일(getUTCDay와 같은 번호)
  holidayPolicy: HolidayPolicy;
  holidayIntervals: string;  // holidayPolicy === 'special'일 때의 공휴일 운영시간
}
export interface ClinicDateException { date: string; closed: boolean; intervals: string; note: string }
// 공휴일 자료. coveredYears에 없는 연도는 '모름'이다(빈 공휴일 목록과 다르다).
export interface HolidayCalendar { names: Record<string, string>; coveredYears: readonly number[] }

export type OperatingState = 'operating' | 'closed' | 'unknown';
export const OPERATING_STATE_LABEL: Record<OperatingState, string> = { operating: '운영', closed: '휴무', unknown: '확인 필요' };
export type OperatingSource = 'exception' | 'holiday' | 'weekday' | 'holiday_data_missing';
export interface OperatingDay {
  state: OperatingState;
  intervals: string;
  source: OperatingSource;
  reason: string;            // 사용자 문장 — 왜 이 판정인지
  holidayName: string | null;
}

export function validIntervals(raw: string): boolean {
  const ranges = raw.split(',').map((s) => s.trim());
  let end = '';
  return (
    !!raw &&
    ranges.every((s) => {
      const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(s);
      if (!match) return false;
      const [, a, b] = match;
      const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
      if (!valid(a) || !valid(b) || a >= b || a < end) return false;
      end = b;
      return true;
    })
  );
}

const fromIntervals = (closed: boolean, intervals: string): OperatingState =>
  closed ? 'closed' : validIntervals(intervals) ? 'operating' : 'unknown';

export function operatingOn(
  settings: ClinicHoursSettings,
  exceptions: readonly ClinicDateException[],
  holidays: HolidayCalendar,
  day: string,
): OperatingDay {
  const ex = exceptions.find((e) => e.date === day);
  const holidayName = holidays.names[day] ?? null;
  if (ex) {
    const state = fromIntervals(ex.closed, ex.intervals);
    return { state, intervals: ex.closed ? '' : ex.intervals, source: 'exception', reason: ex.note || '특정일 설정', holidayName };
  }
  if (!holidays.coveredYears.includes(Number(day.slice(0, 4)))) {
    return {
      state: 'unknown',
      intervals: '',
      source: 'holiday_data_missing',
      reason: '이 연도 공휴일 정보가 아직 없어요. 공휴일인지 확인해 주세요.',
      holidayName: null,
    };
  }
  if (holidayName) {
    if (settings.holidayPolicy === 'closed') return { state: 'closed', intervals: '', source: 'holiday', reason: holidayName, holidayName };
    if (settings.holidayPolicy === 'unknown') {
      return { state: 'unknown', intervals: '', source: 'holiday', reason: `${holidayName} · 공휴일 운영 방침이 정해지지 않았어요`, holidayName };
    }
    return {
      state: fromIntervals(false, settings.holidayIntervals),
      intervals: settings.holidayIntervals,
      source: 'holiday',
      reason: `${holidayName} · 공휴일 별도 운영`,
      holidayName,
    };
  }
  const w = settings.week[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const state = w ? fromIntervals(w.closed, w.intervals) : 'unknown';
  return {
    state,
    intervals: w && !w.closed ? w.intervals : '',
    source: 'weekday',
    reason: state === 'closed' ? '정기 휴무' : state === 'unknown' ? '요일 운영시간이 설정되지 않았어요' : '요일별 운영시간',
    holidayName: null,
  };
}

// 예약 희망 시각에 대한 안내 — 숫자만 던지지 않고 판단과 다음 행동까지 말한다(UX 원칙 3).
// visitAt = 'YYYY-MM-DDTHH:mm'(서울). 해석할 수 없으면 빈 문자열.
export type TimeGuidance = { tone: 'ok' | 'warn'; text: string } | null;
export function timeGuidance(day: OperatingDay, visitAt: string): TimeGuidance {
  const time = visitAt.slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  if (day.state === 'closed') return { tone: 'warn', text: `휴무일이에요(${day.reason}). 다른 날짜를 제안하거나 클리닉에 확인해 주세요.` };
  if (day.state === 'unknown') return { tone: 'warn', text: `운영 여부를 알 수 없어요 — ${day.reason}` };
  const ranges = day.intervals.split(',').map((s) => s.trim().split('-'));
  if (ranges.some(([from, to]) => from <= time && time < to)) {
    return { tone: 'ok', text: `운영시간 안이에요(${day.intervals}). 예약 가능 여부는 클리닉 확정으로 결정돼요.` };
  }
  const first = ranges[0][0];
  const last = ranges[ranges.length - 1][1];
  return first <= time && time < last
    ? { tone: 'warn', text: `점심시간이라 운영 여부를 확인해 주세요(${day.intervals}).` }
    : { tone: 'warn', text: `운영시간 밖이에요(${day.intervals}). 시간을 다시 확인해 주세요.` };
}

// ─────────────────────────── 운영시간 입력(시작·종료·점심) ───────────────────────────
export interface HoursSelection { opens: string; closes: string; lunch: boolean; lunchStarts: string; lunchEnds: string }
export const DEFAULT_HOURS: HoursSelection = { opens: '10:00', closes: '19:00', lunch: true, lunchStarts: '13:00', lunchEnds: '14:00' };

export function readHours(intervals: string): HoursSelection | null {
  if (!validIntervals(intervals)) return null;
  const ranges = intervals.split(',').map((r) => r.trim().split('-'));
  if (ranges.length > 2) return null;
  return {
    opens: ranges[0][0],
    closes: ranges[ranges.length - 1][1],
    lunch: ranges.length === 2 && ranges[0][1] !== ranges[1][0],
    lunchStarts: ranges.length === 2 ? ranges[0][1] : DEFAULT_HOURS.lunchStarts,
    lunchEnds: ranges.length === 2 ? ranges[1][0] : DEFAULT_HOURS.lunchEnds,
  };
}

// 종료 ≤ 시작, 운영 범위 밖 점심은 저장하지 않는다.
export function hoursError(hours: HoursSelection): string {
  if (!validIntervals(`${hours.opens}-${hours.closes}`)) {
    return '운영 시작과 종료 시간을 확인해 주세요. 종료 시간은 시작 시간보다 늦어야 해요.';
  }
  if (
    hours.lunch &&
    (!validIntervals(`${hours.lunchStarts}-${hours.lunchEnds}`) || hours.lunchStarts <= hours.opens || hours.lunchEnds >= hours.closes)
  ) {
    return '점심시간은 운영시간 안에 있어야 하며, 끝나는 시간이 시작보다 늦어야 해요.';
  }
  return '';
}

export function writeHours(hours: HoursSelection): string {
  const error = hoursError(hours);
  if (error) throw new Error(error);
  return hours.lunch ? `${hours.opens}-${hours.lunchStarts}, ${hours.lunchEnds}-${hours.closes}` : `${hours.opens}-${hours.closes}`;
}

export function describeHours(intervals: string): { range: string; break: string } {
  const h = readHours(intervals);
  return h
    ? { range: `${h.opens}–${h.closes}`, break: h.lunch ? `점심 ${h.lunchStarts}–${h.lunchEnds}` : '점심시간 없음' }
    : { range: intervals ? intervals.replaceAll('-', '–').replaceAll(',', ' ·') : '시간 미설정', break: '' };
}

export function weekdayLabel(days: number[]): string {
  if (days.length === 7) return '매일';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return '월–금';
  return WEEK_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAYS[d]).join('·');
}

export function groupWeek(week: readonly DayHours[]): { days: number[]; schedule: DayHours }[] {
  const groups: { days: number[]; schedule: DayHours }[] = [];
  for (const day of WEEK_ORDER) {
    const schedule = week[day];
    const found = groups.find(
      (g) => g.schedule.closed === schedule.closed && (schedule.closed || g.schedule.intervals === schedule.intervals),
    );
    if (found) found.days.push(day);
    else groups.push({ days: [day], schedule });
  }
  return groups;
}

// 선택한 요일만 바꾼다. 휴무로 바꿔도 기존 시간은 보존해 다시 운영으로 돌릴 때 쓴다.
export function applyWeekHours(week: readonly DayHours[], days: number[], closed: boolean, hours: HoursSelection): DayHours[] {
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('적용할 요일을 하나 이상 선택해 주세요.');
  }
  const intervals = closed ? '' : writeHours(hours);
  return week.map((day, index) => (days.includes(index) ? { closed, intervals: closed ? day.intervals : intervals } : day));
}
