// 클라이언트 현황 월간 보기(스펙 §3-3, koo 10-10) — 큰 방향(확대·유지·축소·전환)을 정하는 화면.
// 월 = 달력 월 = 그 달 캠페인 주차들의 합. 비교는 전월·최근 6개월. 주간 보기(clientStatusStore)와 계산 부품을 같이 쓴다.
import type postgres from 'postgres';
import { isDecision, isDirection, mdLabel, type Decision, type Direction, type MonthSnapshot } from './clientStatus.ts';
import { campaignWeeksInMonth, campaignWeekLabel } from './campaignWeek.ts';
import { stepPeriod, periodParam, type Period } from './reportPeriod.ts';
import { weekRecord, loadClientPosts, krw, periodInfo, listStatusClients, type DayRow, type WeekRecord, type PeriodInfo } from './clientStatusStore.ts';

const MONTHS = 6;
const isoDate = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 10);
type MonthPeriod = Extract<Period, { kind: 'month' }>;

export interface MonthRow {
  start: string; end: string; label: string; inProgress: boolean;
  rec: WeekRecord; views: number; bookmarks: number; postCount: number; cost: number; roas: number | null;
}
export interface MonthWeekRow {
  param: string; label: string; start: string; end: string; days: number; inProgress: boolean;
  newInflow: number | null; bookmarks: number; postCount: number; revCreated: number | null; cost: number; verdict: Decision | null; source: WeekRecord['source'];
}
export interface MonthReview { direction: Direction; memo: string; decidedByName: string; decidedAt: string; snapshot: MonthSnapshot | null }
export interface ClientMonth {
  kind: 'month'; client: { id: string; name: string }; period: PeriodInfo;
  months: MonthRow[];        // 오래된 순, 마지막 = 고른 달
  weeks: MonthWeekRow[];     // 고른 달의 캠페인 주차
  budget: { label: string; total: number; spent: number; planned: number; pace: number } | null;
  review: MonthReview | null; lastReview: MonthReview | null;
}

type ReviewDb = { month_start: Date; direction: string; memo: string; decided_by_name: string; decided_at: Date; snapshot: MonthSnapshot | null };
const toReview = (r: ReviewDb | undefined): MonthReview | null => (r && isDirection(r.direction)
  ? { direction: r.direction, memo: r.memo, decidedByName: r.decided_by_name, decidedAt: new Date(r.decided_at).toISOString(), snapshot: r.snapshot ?? null } : null);

export async function loadClientMonth(sql: postgres.Sql, clientId: string, today: string, per: MonthPeriod): Promise<ClientMonth | null> {
  const c = (await sql<Array<{ id: string; name: string; clinic_code: string | null }>>`select id, name, clinic_code from client where id = ${clientId}`)[0];
  if (!c || !c.clinic_code) return null;
  const periods: MonthPeriod[] = [per];
  while (periods.length < MONTHS) periods.unshift(stepPeriod(periods[0], -1) as MonthPeriod);
  const from = periods[0].start, to = per.end;
  const wks = campaignWeeksInMonth(per.year, per.month);

  const [monthRows, cweekRows, weekRows, dayRows, { posts, costs }, reviews, weekReviews] = await Promise.all([
    sql<Array<{ period_start: Date; payload: Record<string, unknown> }>>`
      select period_start, payload from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'month' and period_start between ${from} and ${per.start}`,
    sql<Array<{ period_start: Date; payload: Record<string, unknown> }>>`
      select period_start, payload from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'cweek' and period_start in ${sql(wks.map((w) => w.start))}`,
    sql<Array<{ period_start: Date; payload: Record<string, unknown> }>>`
      select period_start, payload from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'week' and period_start in ${sql(wks.map((w) => w.start))}`,
    sql<Array<DayRow & { period_start: Date }>>`
      select period_start, payload->'funnel'->>'new_customers' as nc, payload->'funnel'->>'active_customers' as act,
        payload->'funnel'->>'consulted_customers' as con, payload->'funnel'->'reservers'->>'by_line_id' as rsv,
        payload->'reservations'->'created_at'->'revenue'->>'total' as rc, payload->'reservations'->'reservation_date'->'revenue'->>'total' as rv,
        payload->'reservations'->'created_at'->'status_counts' as st
      from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'day' and period_start between ${from} and ${to}`,
    loadClientPosts(sql, c.id, from),
    sql<ReviewDb[]>`select month_start, direction, memo, decided_by_name, decided_at, snapshot from client_monthly_review
      where client_id = ${c.id} and month_start in (${per.start}, ${periods[periods.length - 2].start})`,
    sql<Array<{ week_start: Date; verdict: string }>>`select week_start, verdict from client_weekly_review where client_id = ${c.id} and week_start in ${sql(wks.map((w) => w.start))}`,
  ]);
  const monthMap = new Map(monthRows.map((r) => [isoDate(r.period_start), r.payload]));
  const dayMap = new Map(dayRows.map((r) => [isoDate(r.period_start), r]));
  const cweekMap = new Map(cweekRows.map((r) => [isoDate(r.period_start), r.payload]));
  const weekMap = new Map(weekRows.map((r) => [isoDate(r.period_start), r.payload]));
  const inRange = (d: string, s: string, e: string) => d >= s && d <= e;
  const xOf = (s: string, e: string) => {
    const ps = posts.filter((p) => inRange(p.date, s, e));
    return { views: ps.reduce((a, p) => a + p.views, 0), bookmarks: ps.reduce((a, p) => a + p.bookmarks, 0), postCount: ps.length,
      cost: costs.filter((x) => inRange(x.date, s, e)).reduce((a, x) => a + x.krw, 0) };
  };

  // 끝난 달은 월 스냅샷(사람 수 정확), 진행 중이거나 없으면 일별 합산(사람 수 근사)
  const months: MonthRow[] = periods.map((p) => {
    const rec = weekRecord(p, monthMap.get(p.start), 'week', dayMap);
    const x = xOf(p.start, p.end);
    return { start: p.start, end: p.end, label: `${p.month}월`, inProgress: p.end >= today, rec, ...x,
      roas: x.cost > 0 && rec.revCreated !== null ? rec.revCreated / x.cost : null };
  });
  const verdictBy = new Map(weekReviews.map((r) => [isoDate(r.week_start), r.verdict]));
  const weeks: MonthWeekRow[] = wks.map((w) => {
    const rec = weekRecord(w, cweekMap.get(w.start) ?? (w.days === 7 ? weekMap.get(w.start) : undefined), cweekMap.has(w.start) ? 'cweek' : 'week', dayMap);
    const x = xOf(w.start, w.end);
    const v = verdictBy.get(w.start);
    return { param: `w-${w.start}`, label: campaignWeekLabel(w), start: w.start, end: w.end, days: w.days, inProgress: w.end >= today,
      newInflow: rec.newInflow, bookmarks: x.bookmarks, postCount: x.postCount, revCreated: rec.revCreated, cost: x.cost,
      verdict: isDecision(v) ? v : null, source: rec.source };
  });

  // 예산 — 이 달과 겹치는 예산 기간(1일이 든 기간 우선). 집행 = 그 기간에 시작한 캠페인의 게시된 작업 비용(주간 예산 카드와 같은 셈)
  const bp = (await sql<Array<{ starts_on: Date; ends_on: Date; amount_krw: string }>>`
    select starts_on, ends_on, amount_krw from client_budget_period where client_id = ${c.id} and starts_on <= ${per.end} and ends_on >= ${per.start}
    order by (starts_on <= ${per.start}) desc, starts_on limit 1`)[0];
  let budget: ClientMonth['budget'] = null;
  if (bp) {
    const s = isoDate(bp.starts_on), e = isoDate(bp.ends_on);
    const rows = await sql<Array<{ cost: { amount?: number; currency?: string } | null; done: boolean }>>`
      select t.cost, (t.post_url is not null or t.posted_at is not null) as done from campaign_task t join campaign cp on cp.id = t.campaign_id
      where cp.client_id = ${c.id} and cp.starts_on between ${s} and ${e} and t.removed_at is null and t.cancelled_at is null`;
    const total = (Date.parse(e) - Date.parse(s)) / 864e5 + 1;
    const gone = Math.min(total, Math.max(0, (Date.parse(today < e ? today : e) - Date.parse(s)) / 864e5 + (today > e ? 1 : 0)));
    budget = { label: `${mdLabel(s)}~${mdLabel(e)}`, total: Number(bp.amount_krw), planned: rows.reduce((a, r) => a + krw(r.cost), 0),
      spent: rows.filter((r) => r.done).reduce((a, r) => a + krw(r.cost), 0), pace: Math.max(0, Math.min(1, gone / total)) };
  }

  const rv = (start: string) => toReview(reviews.find((r) => isoDate(r.month_start) === start));
  return { kind: 'month', client: { id: c.id, name: c.name }, period: periodInfo(per, today), months, weeks, budget,
    review: rv(per.start), lastReview: rv(periods[periods.length - 2].start) };
}

export function monthSnapshot(m: ClientMonth): MonthSnapshot {
  const cur = m.months[m.months.length - 1];
  const weekVerdicts: MonthSnapshot['weekVerdicts'] = {};
  for (const w of m.weeks) if (w.verdict) weekVerdicts[w.verdict] = (weekVerdicts[w.verdict] ?? 0) + 1;
  return { newInflow: cur.rec.newInflow, revenue: cur.rec.revCreated, roas: cur.roas, budgetUsed: m.budget && m.budget.total ? m.budget.spent / m.budget.total : null, weekVerdicts };
}

export async function saveMonthReview(sql: postgres.Sql, input: { clientId: string; monthStart: string; direction: Direction; memo: string; by: { id: string; name: string } | null; snapshot: MonthSnapshot }): Promise<MonthReview> {
  const r = (await sql<ReviewDb[]>`
    insert into client_monthly_review (client_id, month_start, direction, memo, decided_by, decided_by_name, snapshot)
    values (${input.clientId}, ${input.monthStart}, ${input.direction}, ${input.memo}, ${input.by?.id ?? null}, ${input.by?.name ?? ''}, ${sql.json(input.snapshot as never)})
    on conflict (client_id, month_start) do update set direction = excluded.direction, memo = excluded.memo, decided_by = excluded.decided_by,
      decided_by_name = excluded.decided_by_name, decided_at = now(), snapshot = excluded.snapshot
    returning month_start, direction, memo, decided_by_name, decided_at, snapshot`)[0];
  return toReview(r) as MonthReview;
}

// ── 월간 전체 보기 — 클라이언트마다 한 줄 ──
export interface MonthStatusRow {
  id: string; name: string; direction: Direction | null; memo: string;
  weekVerdicts: Partial<Record<Decision, number>>; weeksTotal: number;
  newInflow: number | null; newInflowPrev: number | null; bookmarks: number; postCount: number;
  revenue: number | null; revenuePrev: number | null; roas: number | null; approx: boolean;
}
export async function listStatusMonthRows(sql: postgres.Sql, today: string, per: MonthPeriod): Promise<{ kind: 'month'; period: PeriodInfo; rows: MonthStatusRow[]; unlinked: string[] }> {
  const { linked, unlinked } = await listStatusClients(sql);
  const all = (await Promise.all(linked.map((c) => loadClientMonth(sql, c.id, today, per)))).filter((m): m is ClientMonth => m !== null);
  const rows = all.map((m): MonthStatusRow => {
    const cur = m.months[m.months.length - 1], prev = m.months[m.months.length - 2];
    return {
      id: m.client.id, name: m.client.name, direction: m.review?.direction ?? null, memo: m.review?.memo ?? '',
      weekVerdicts: monthSnapshot(m).weekVerdicts, weeksTotal: m.weeks.length,
      newInflow: cur.rec.newInflow, newInflowPrev: prev?.rec.newInflow ?? null, bookmarks: cur.bookmarks, postCount: cur.postCount,
      revenue: cur.rec.revCreated, revenuePrev: prev?.rec.revCreated ?? null, roas: cur.roas, approx: cur.rec.source === 'days',
    };
  });
  return { kind: 'month', period: periodInfo(per, today), rows, unlinked };
}
export { periodParam };
