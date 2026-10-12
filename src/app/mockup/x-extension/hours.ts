import type { DaySchedule } from './model';
import { validIntervals } from './policy';

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export type HoursSelection = {
  opens: string;
  closes: string;
  lunch: boolean;
  lunchStarts: string;
  lunchEnds: string;
};
export const DEFAULT_HOURS: HoursSelection = {
  opens: '10:00',
  closes: '19:00',
  lunch: true,
  lunchStarts: '13:00',
  lunchEnds: '14:00',
};
export function readHours(intervals: string): HoursSelection | null {
  if (!validIntervals(intervals)) return null;
  const ranges = intervals.split(',').map((r) => r.trim().split('-'));
  if (ranges.length > 2) return null;
  return {
    opens: ranges[0][0],
    closes: ranges[ranges.length - 1][1],
    lunch: ranges.length === 2 && ranges[0][1] !== ranges[1][0],
    lunchStarts: ranges.length === 2 ? ranges[0][1] : '13:00',
    lunchEnds: ranges.length === 2 ? ranges[1][0] : '14:00',
  };
}
export function hoursError(hours: HoursSelection) {
  if (!validIntervals(`${hours.opens}-${hours.closes}`))
    return '운영 시작과 종료 시간을 확인해 주세요. 종료 시간은 시작 시간보다 늦어야 해요.';
  if (
    hours.lunch &&
    (!validIntervals(`${hours.lunchStarts}-${hours.lunchEnds}`) ||
      hours.lunchStarts <= hours.opens ||
      hours.lunchEnds >= hours.closes)
  )
    return '점심시간은 운영시간 안에 있어야 하며, 끝나는 시간이 시작보다 늦어야 해요.';
  return '';
}
export function writeHours(hours: HoursSelection) {
  const error = hoursError(hours);
  if (error) throw new Error(error);
  return hours.lunch
    ? `${hours.opens}-${hours.lunchStarts}, ${hours.lunchEnds}-${hours.closes}`
    : `${hours.opens}-${hours.closes}`;
}
export function describeHours(intervals: string) {
  const h = readHours(intervals);
  return h
    ? {
        range: `${h.opens}–${h.closes}`,
        break: h.lunch ? `점심 ${h.lunchStarts}–${h.lunchEnds}` : '점심시간 없음',
      }
    : { range: intervals ? intervals.replaceAll('-', '–').replaceAll(',', ' ·') : '시간 미설정', break: '' };
}
export function weekdayLabel(days: number[]) {
  if (days.length === 7) return '매일';
  if ([1, 2, 3, 4, 5].every((d) => days.includes(d)) && days.length === 5) return '월–금';
  return WEEK_ORDER.filter((d) => days.includes(d))
    .map((d) => WEEKDAYS[d])
    .join('·');
}
export function groupWeek(week: DaySchedule[]) {
  const groups: { days: number[]; schedule: DaySchedule }[] = [];
  for (const day of WEEK_ORDER) {
    const schedule = week[day];
    const found = groups.find(
      (g) =>
        g.schedule.closed === schedule.closed &&
        (schedule.closed || g.schedule.intervals === schedule.intervals),
    );
    if (found) found.days.push(day);
    else groups.push({ days: [day], schedule });
  }
  return groups;
}
export function applyWeekHours(week: DaySchedule[], days: number[], closed: boolean, hours: HoursSelection) {
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    throw new Error('적용할 요일을 하나 이상 선택해 주세요.');
  const intervals = closed ? '' : writeHours(hours);
  return week.map((day, index) =>
    days.includes(index) ? { closed, intervals: closed ? day.intervals : intervals } : day,
  );
}
