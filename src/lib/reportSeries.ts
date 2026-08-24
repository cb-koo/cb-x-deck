import type { ReportBundles, ReportUnit } from './reportApi.ts';

// 날짜는 전부 KST date-only 문자열. Date는 UTC 자정으로만 다뤄 시간대 오염을 차단한다.
const d2u = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const u2d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;

export interface BucketRange { start: string; end: string }

export function addDays(date: string, n: number): string { return u2d(d2u(date) + n * DAY); }
export function inclusiveDays(start: string, end: string): number { return Math.round((d2u(end) - d2u(start)) / DAY) + 1; }
export function isCalendarMonth(start: string, end: string): boolean {
  return start.slice(8) === '01' && start.slice(0, 7) === end.slice(0, 7) && addDays(end, 1).slice(8) === '01';
}
export function recommendUnit(start: string, end: string): ReportUnit {
  const n = inclusiveDays(start, end);
  return n <= 31 ? 'day' : n <= 120 ? 'week' : 'month';
}

function weekStart(date: string): string { // 월요일 시작
  const wd = new Date(d2u(date)).getUTCDay(); // 0=일
  return addDays(date, -((wd + 6) % 7));
}
function monthStart(date: string): string { return date.slice(0, 8) + '01'; }
function monthEnd(date: string): string {
  return addDays(monthStart(addDays(monthStart(date), 45)), -1);
}

export function bucketRanges(start: string, end: string, unit: ReportUnit): BucketRange[] {
  const out: BucketRange[] = [];
  if (unit === 'day') {
    for (let t = d2u(start); t <= d2u(end); t += DAY) out.push({ start: u2d(t), end: u2d(t) });
    return out;
  }
  let s = unit === 'week' ? weekStart(start) : monthStart(start);
  while (d2u(s) <= d2u(end)) {
    const e = unit === 'week' ? addDays(s, 6) : monthEnd(s);
    out.push({ start: s, end: e });
    s = addDays(e, 1);
  }
  return out;
}

export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined || den === null || den === undefined || den === 0) return null;
  return num / den;
}

export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

export interface SeriesPoint {
  start: string; end: string; inProgress: boolean; missing: boolean; fetchedAt: string | null;
  inflow: number | null; newCustomers: number | null; consulted: number | null; reserversByLineId: number | null;
  convInflowToConsult: number | null; convConsultToReserve: number | null;
  reservationCount: number | null; revenueTotal: number | null; revenueFirst: number | null; revenueRepeat: number | null;
  cancelNoshowRate: number | null; cancelNoshowCount: number | null; statusTotal: number | null;
  followersTotal: number | null; followersChange: number | null;
  marketingCost: number | null; costByMedia: Array<{ media: string; amount: number }> | null;
  roas: number | null; xViewsChange: number | null;
}

// 버킷 하나를 차트 점 하나로. null 전파가 본체다 — "모름"을 절대 0으로 만들지 않는다.
export function toSeriesPoint(
  bucket: BucketRange,
  stored: { payload: ReportBundles; fetchedAt: string | null } | null,
  todayKst: string,
): SeriesPoint {
  const b = stored?.payload ?? null;
  const fu = b?.funnel ?? null;
  const cr = b?.reservations?.created_at ?? null;
  const co = b?.costs ?? null;
  const fo = b?.followers ?? null;
  const statusTotal = cr ? Object.values(cr.status_counts).reduce((a, x) => a + x, 0) : null;
  return {
    start: bucket.start, end: bucket.end,
    inProgress: bucket.end >= todayKst, missing: stored === null, fetchedAt: stored?.fetchedAt ?? null,
    inflow: fu?.active_customers ?? null, newCustomers: fu?.new_customers ?? null,
    consulted: fu?.consulted_customers ?? null, reserversByLineId: fu?.reservers.by_line_id ?? null,
    convInflowToConsult: ratio(fu?.consulted_customers, fu?.active_customers),
    convConsultToReserve: ratio(fu?.reservers.by_line_id, fu?.consulted_customers),
    reservationCount: cr?.reservation_count ?? null,
    revenueTotal: cr?.revenue.total ?? null, revenueFirst: cr?.revenue.first_visit ?? null,
    revenueRepeat: cr?.revenue.repeat_visit ?? null,
    cancelNoshowRate: cr ? ratio(cr.status_counts.cancelled + cr.status_counts.noshow, statusTotal) : null,
    cancelNoshowCount: cr ? cr.status_counts.cancelled + cr.status_counts.noshow : null,
    statusTotal,
    followersTotal: fo?.total_at_end ?? null, followersChange: fo?.change ?? null,
    marketingCost: co?.marketing_cost.total ?? null,
    costByMedia: co?.marketing_cost.by_media ?? null,
    roas: co?.roas ?? null,
    xViewsChange: co?.x_views?.change ?? null,
  };
}
