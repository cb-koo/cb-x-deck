// 클라이언트 현황 — DB 읽기·판정 기록(스펙 2026-10-09-client-status-design.md §4·6). 계산은 clientStatus.ts(순수).
import type postgres from 'postgres';
import { addDays, mdLabel, suggestDecision, weeklyX, sum4, isDecision, type Decision, type Suggestion,
  valueAtHorizon, ACCRUAL_DEFAULT, H_BOOKMARKS, H_VIEWS, MIN_MEASURE_H, type Accrual, type Check, type StatusCounts, countTotal, type ReviewSnapshot } from './clientStatus.ts';
import { groupPosts, type PostGroup } from '../components/charts/postGroups.ts';
import { campaignWeeksBack, prevCampaignWeek, type CampaignWeek } from './campaignWeek.ts';
import { defaultPeriod, periodParam, periodLabel, isInProgress, stepPeriod, canStepNext, switchKind, type Period } from './reportPeriod.ts';
import { typical } from '../components/charts/normal.ts';

const WEEKS = 12;
const DAYS = 56;
const GROWTH_DAYS = 14;
const MIN_BOOKMARKS = 50;
const JPY_TO_KRW = 10;

/** 작업 비용(원) — 엔은 ×10 */
export const krw = (cost: { amount?: number; currency?: string } | null) => (cost?.amount ? Number(cost.amount) * (cost.currency === 'JPY' ? JPY_TO_KRW : 1) : 0);
const isoDate = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

export interface ReviewRow { verdict: Decision; suggested: Decision; memo: string; decidedByName: string; decidedAt: string; snapshot: ReviewSnapshot | null }
// 게시물 한 건 — 리포트의 글 상세 패널(스펙 2026-10-09 §10)이 추가 조회 없이 바로 그릴 수 있게 작업·캠페인·지표를 같이 싣는다.
// 측정 이력·글 본문(이미지)만 패널을 열 때 따로 부른다.
export interface StatusPost {
  id: string; tweetId: string; handle: string; date: string; postedAt: string;
  views: number; bookmarks: number; likes: number; retweets: number; replies: number; quotes: number;
  taskId: string; taskType: string; campaignId: string; campaignName: string; costKrw: number;
  capturedAt: string | null; unavailable: boolean;
}
export interface GrowthCurve { id: string; label: string; date: string; bookmarks: number; points: Array<[number, number]> }
// 비교용 게시물(글 상세 패널의 '다른 글과 비교'·'팔로워 대비 확산'·'같은 원글') — LINE 연동 클라이언트 전체, 같은 8주.
// 값은 기준 시점 값(북마크 3일·조회 7일). est = 아직 그 시점 전이라 누적 비율로 나눈 예상값. measuring = 마지막 측정이 게시 24시간 전.
export interface Horizon { value: number; est: boolean }
export interface PoolPost {
  id: string; clientId: string; clientName: string; type: string; handle: string; targetKey: string | null;
  followers: number | null; costKrw: number; views7: Horizon | null; bm3: Horizon | null; measuring: boolean;
}

export type { StatusCounts } from './clientStatus.ts';
export interface ResultSummary {
  revenue4: number; revenuePrev4: number;        // 접수일 기준 예약 매출
  visitRevenue4: number; visitRevenuePrev4: number;
  cost4: number; costPrev4: number;              // 우리 작업 비용(게시일 기준, 엔 ×10)
  roas4: number | null; roasPrev4: number | null; // 매출 ÷ 작업 비용 — 비용 0이면 null
  status4: StatusCounts;                         // 최근 4주 예약 상태 합
  settled: { status: StatusCounts; lostRate: number | null; from: string; to: string };   // 불발이 정리된 4주(2주 이상 지난 주)
  upcomingConfirmed: number | null;              // 방문 예정 확정 예약(최신 주 값)
}

// 화면이 기간 선택기를 그리는 데 필요한 것 — 계산은 서버(reportPeriod.ts)가 하고 화면은 그대로 쓴다
export interface PeriodInfo { kind: 'week' | 'month'; param: string; label: string; start: string; end: string; days: number; inProgress: boolean; prevParam: string; nextParam: string | null; altParam: string; latestParam: string }
export function periodInfo(p: Period, today: string): PeriodInfo {
  return { kind: p.kind, param: periodParam(p), label: periodLabel(p), start: p.start, end: p.end, days: p.days, inProgress: isInProgress(p, today),
    prevParam: periodParam(stepPeriod(p, -1)), nextParam: canStepNext(p, today) ? periodParam(stepPeriod(p, 1)) : null,
    altParam: periodParam(switchKind(p, p.kind === 'week' ? 'month' : 'week', today)),   // 주간 ↔ 월간 전환 때 같은 시점
    latestParam: periodParam(defaultPeriod(p.kind, today)) };                           // 끝난 가장 최근 기간
}
// 주차 하나의 리포트 값을 어디서 가져왔나 — cweek(캠페인 주차 그대로) > week(월~일이 꽉 찬 주) > days(일별 합산: 사람 수는 근사)
export type WeekSource = 'cweek' | 'week' | 'days' | null;

export interface ClientStatus {
  client: { id: string; name: string };
  baseWeek: { start: string; end: string };
  period: PeriodInfo;
  weekDays: number[]; weekSource: WeekSource[];
  weeks: string[]; weekLabels: string[];
  newInflow: Array<number | null>; inflow: Array<number | null>; consulted: Array<number | null>; reservers: Array<number | null>;
  days: string[]; dailyNew: Array<number | null>;
  x: { views: number[]; bookmarks: number[]; postCount: number[]; cost: number[]; costPerBookmark: Array<number | null> };
  posts: StatusPost[]; groups: PostGroup[]; smallPostCount: number; typicalDay: number;
  growth: GrowthCurve[];
  budget: { label: string; total: number; spent: number; planned: number; pace: number } | null;
  suggestion: Suggestion; reservers4: number; reserversPrev4: number; posts2w: number;
  pool: PoolPost[]; accrual: Accrual;
  funnel4: { newInflow: [number, number]; consulted: [number, number]; reservers: [number, number] };
  // 결과 구간 — 예약 매출 두 기준(접수일 = 예약을 받은 주, 예정 포함·바뀔 수 있음 / 방문일 = 실제 방문한 주, 최근 주는 진행 중)
  revenueCreated: Array<number | null>; revenueVisit: Array<number | null>;
  statusWeeks: Array<StatusCounts | null>;   // 접수일 기준 예약 상태(주별)
  result: ResultSummary;
  review: ReviewRow | null; lastReview: ReviewRow | null;
}

export async function listStatusClients(sql: postgres.Sql): Promise<{ linked: Array<{ id: string; name: string; clinicCode: string }>; unlinked: string[] }> {
  const rows = await sql<Array<{ id: string; name: string; clinic_code: string | null }>>`select id, name, clinic_code from client order by name`;
  return {
    linked: rows.filter((r) => r.clinic_code).map((r) => ({ id: r.id, name: r.name, clinicCode: r.clinic_code as string })),
    unlinked: rows.filter((r) => !r.clinic_code).map((r) => r.name),
  };
}

type ReviewDb = { week_start: Date; verdict: string; suggested: string; memo: string; decided_by_name: string; decided_at: Date; snapshot: ReviewSnapshot | null };
const toReview = (r: ReviewDb | undefined): ReviewRow | null => (r && isDecision(r.verdict) && isDecision(r.suggested)
  ? { verdict: r.verdict, suggested: r.suggested, memo: r.memo, decidedByName: r.decided_by_name, decidedAt: new Date(r.decided_at).toISOString(), snapshot: r.snapshot ?? null } : null);

export async function loadClientStatus(sql: postgres.Sql, clientId: string, today: string, period?: Period): Promise<ClientStatus | null> {
  const c = (await sql<Array<{ id: string; name: string; clinic_code: string | null }>>`select id, name, clinic_code from client where id = ${clientId}`)[0];
  if (!c || !c.clinic_code) return null;
  const per = period && period.kind === 'week' ? period : defaultPeriod('week', today);
  if (per.kind !== 'week') return null;
  const wks = campaignWeeksBack(per.week, WEEKS);
  const weeks = wks.map((w) => w.start), weekDays = wks.map((w) => w.days);
  const base = per.start, baseEnd = per.end;
  const dayFrom = addDays(baseEnd, -(DAYS - 1));
  const days = Array.from({ length: DAYS }, (_, i) => addDays(dayFrom, i));
  const firstDay = weeks[0] < dayFrom ? weeks[0] : dayFrom;

  const [cweekRows, weekRows, dayRows] = await Promise.all([
    sql<Array<{ period_start: Date; payload: Record<string, unknown> }>>`
      select period_start, payload from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'cweek' and period_start in ${sql(weeks)}`,
    sql<Array<{ period_start: Date; payload: Record<string, unknown> }>>`
      select period_start, payload from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'week' and period_start in ${sql(weeks)}`,
    sql<Array<{ period_start: Date; nc: string | null; act: string | null; con: string | null; rsv: string | null; rc: string | null; rv: string | null; st: Record<string, number> | null }>>`
      select period_start, payload->'funnel'->>'new_customers' as nc, payload->'funnel'->>'active_customers' as act,
        payload->'funnel'->>'consulted_customers' as con, payload->'funnel'->'reservers'->>'by_line_id' as rsv,
        payload->'reservations'->'created_at'->'revenue'->>'total' as rc, payload->'reservations'->'reservation_date'->'revenue'->>'total' as rv,
        payload->'reservations'->'created_at'->'status_counts' as st
      from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'day' and period_start between ${firstDay} and ${baseEnd}`,
  ]);
  const cweekMap = new Map(cweekRows.map((r) => [isoDate(r.period_start), r.payload]));
  const weekMap = new Map(weekRows.map((r) => [isoDate(r.period_start), r.payload]));
  const dayMap = new Map(dayRows.map((r) => [isoDate(r.period_start), r]));
  const recs = wks.map((w) => weekRecord(w, cweekMap.get(w.start) ?? (w.days === 7 ? weekMap.get(w.start) : undefined), cweekMap.has(w.start) ? 'cweek' : 'week', dayMap));
  const weekSource = recs.map((r) => r.source);
  const newInflow = recs.map((r) => r.newInflow), inflow = recs.map((r) => r.inflow), consulted = recs.map((r) => r.consulted), reservers = recs.map((r) => r.reservers);
  const revenueCreated = recs.map((r) => r.revCreated), revenueVisit = recs.map((r) => r.revVisit), statusWeeks = recs.map((r) => r.status);
  const upcomingConfirmed = recs[recs.length - 1].upcoming;
  const dailyNew = days.map((d) => num(dayMap.get(d)?.nc));

  const { posts, costs } = await loadClientPosts(sql, c.id, weeks[0]);
  const x = weeklyX(wks, posts, costs);

  const recentPosts = posts.filter((p) => p.date >= dayFrom && p.date <= baseEnd);   // 기간 뒤에 올린 글은 빼고
  const accrual = await loadAccrual(sql);
  const pool = await loadPostPool(sql, dayFrom, baseEnd, accrual);
  const typicalDay = typical(dailyNew);
  const groups = groupPosts(recentPosts, new Map(days.map((d, i) => [d, dailyNew[i] ?? 0])), typicalDay, MIN_BOOKMARKS);
  const smallPostCount = recentPosts.filter((p) => p.bookmarks < MIN_BOOKMARKS).length;

  // 성장 곡선 — 기간 끝까지 14일 동안 게시된 글의 측정 기록 전체
  const gRows = await sql<Array<{ tp_id: string; h: string | null; tw: Date; captured_at: Date; views: number }>>`
    with p as (
      select tp.id as tp_id, t.influencer_handle as h,
        to_timestamp((((substring(t.post_url from 'status/(\\d+)'))::numeric / 4194304)::bigint + 1288834974657) / 1000.0) as tw
      from campaign_task t join campaign cp on cp.id = t.campaign_id
      join tracked_post tp on tp.task_id = t.id and t.post_url ~ ('/status/' || tp.tweet_id || '([/?#]|$)')
      where cp.client_id = ${c.id} and t.removed_at is null and t.cancelled_at is null)
    select p.tp_id, p.h, p.tw, s.captured_at, s.views from p join post_metric_snapshot s on s.tracked_post_id = p.tp_id
    where p.tw >= ${addDays(baseEnd, -(GROWTH_DAYS - 1))}::date and p.tw < ${addDays(baseEnd, 1)}::date order by p.tp_id, s.captured_at`;
  const gMap = new Map<string, GrowthCurve>();
  for (const r of gRows) {
    const g = gMap.get(r.tp_id) ?? { id: r.tp_id, label: r.h ?? '', date: isoDate(r.tw), bookmarks: 0, points: [] };
    g.points.push([Math.round(((new Date(r.captured_at).getTime() - new Date(r.tw).getTime()) / 3600e3) * 10) / 10, Number(r.views)]);
    gMap.set(r.tp_id, g);
  }
  const growth = [...gMap.values()].filter((g) => g.points.filter(([h]) => h >= 1).length >= 2)
    .map((g) => ({ ...g, bookmarks: posts.find((p) => p.id === g.id)?.bookmarks ?? 0 }));

  // 예산 — 오늘을 포함하는 기간, 그 기간에 시작한 캠페인들의 집행·예정
  const bp = (await sql<Array<{ starts_on: Date; ends_on: Date; amount_krw: string }>>`
    select starts_on, ends_on, amount_krw from client_budget_period where client_id = ${c.id} and starts_on <= ${today} and ends_on >= ${today} limit 1`)[0];
  let budget: ClientStatus['budget'] = null;
  if (bp) {
    const s = isoDate(bp.starts_on), e = isoDate(bp.ends_on);
    const spendRows = await sql<Array<{ cost: { amount?: number; currency?: string } | null; done: boolean }>>`
      select t.cost, (t.post_url is not null or t.posted_at is not null) as done from campaign_task t join campaign cp on cp.id = t.campaign_id
      where cp.client_id = ${c.id} and cp.starts_on between ${s} and ${e} and t.removed_at is null and t.cancelled_at is null`;
    const planned = spendRows.reduce((a, r) => a + krw(r.cost), 0), spent = spendRows.filter((r) => r.done).reduce((a, r) => a + krw(r.cost), 0);
    const total = (Date.parse(e) - Date.parse(s)) / 864e5 + 1, gone = (Date.parse(today) - Date.parse(s)) / 864e5;
    budget = { label: `${mdLabel(s)}~${mdLabel(e)}`, total: Number(bp.amount_krw), spent, planned, pace: Math.max(0, Math.min(1, gone / total)) };
  }

  const r4 = sum4(reservers);
  const posts2w = x.postCount.slice(-2).reduce((a, b) => a + b, 0);
  const result = summarizeResult(wks, revenueCreated, revenueVisit, x.cost, statusWeeks, upcomingConfirmed);
  const days4 = weekDays.slice(-4).reduce((a, b) => a + b, 0), daysPrev4 = weekDays.slice(-8, -4).reduce((a, b) => a + b, 0);
  const inProgress = isInProgress(per, today);
  const judged = suggestDecision({ newInflow: newInflow.slice(-8), weekDays: weekDays.slice(-8), days4, daysPrev4, reservers4: r4.recent, reserversPrev4: r4.prev, posts2w,
    revenue4: result.revenue4, revenuePrev4: result.revenuePrev4, roas4: result.roas4, lostRate: result.settled.lostRate });
  // 진행 중인 주차는 덜 찬 숫자라 판정하지 않는다(점검 칩도 보이지 않게)
  const suggestion: Suggestion = inProgress ? { ...judged, decision: 'hold', reason: '진행 중인 주차라 판정하지 않아요', checks: [] } : judged;
  const s4 = (a: Array<number | null>): [number, number] => { const v = sum4(a); return [v.recent, v.prev]; };

  const reviews = await sql<ReviewDb[]>`select week_start, verdict, suggested, memo, decided_by_name, decided_at, snapshot from client_weekly_review
    where client_id = ${c.id} and week_start in (${base}, ${prevCampaignWeek(per.week).start})`;
  const rv = (w: string) => toReview(reviews.find((r) => isoDate(r.week_start) === w));

  return {
    client: { id: c.id, name: c.name }, baseWeek: { start: base, end: baseEnd }, period: periodInfo(per, today), weekDays, weekSource,
    weeks, weekLabels: weeks.map(mdLabel), newInflow, inflow, consulted, reservers, days, dailyNew,
    x, posts: recentPosts, groups, smallPostCount, typicalDay, growth, budget, pool, accrual,
    suggestion, reservers4: r4.recent, reserversPrev4: r4.prev, posts2w,
    funnel4: { newInflow: s4(newInflow), consulted: s4(consulted), reservers: s4(reservers) },
    revenueCreated, revenueVisit, statusWeeks, result,
    review: rv(base), lastReview: rv(prevCampaignWeek(per.week).start),
  };
}

/** 확정 순간의 핵심 숫자 — 화면이 본 것과 같은 계산 결과에서 뽑는다 */
export function reviewSnapshot(s: ClientStatus): ReviewSnapshot {
  const n = s.newInflow.length;
  return {
    newInflow: s.newInflow[n - 1], days: s.weekDays[n - 1], reservers4: s.reservers4, revenue4: s.result.revenue4,
    roas4: s.result.roas4, lostRate: s.result.settled.lostRate, checks: s.suggestion.checks, reason: s.suggestion.reason,
  };
}

export async function saveReview(sql: postgres.Sql, input: {
  clientId: string; weekStart: string; weekEnd?: string; verdict: Decision; suggested: Decision; memo: string;
  by: { id: string; name: string } | null; snapshot?: ReviewSnapshot | null;
}): Promise<ReviewRow> {
  const snap = input.snapshot ? sql.json(input.snapshot as never) : null;
  const r = (await sql<ReviewDb[]>`
    insert into client_weekly_review (client_id, week_start, period_end, verdict, suggested, memo, decided_by, decided_by_name, snapshot)
    values (${input.clientId}, ${input.weekStart}, ${input.weekEnd ?? null}, ${input.verdict}, ${input.suggested}, ${input.memo}, ${input.by?.id ?? null}, ${input.by?.name ?? ''}, ${snap})
    on conflict (client_id, week_start) do update set verdict = excluded.verdict, suggested = excluded.suggested, memo = excluded.memo,
      decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name, decided_at = now(), period_end = excluded.period_end, snapshot = excluded.snapshot
    returning week_start, verdict, suggested, memo, decided_by_name, decided_at, snapshot`)[0];
  return toReview(r) as ReviewRow;
}

// ── 전체 보기(스펙 §3 첫 화면) — 클라이언트마다 상세와 같은 계산을 돌려 한 줄로 줄인다(3곳뿐이라 그대로 반복) ──
export interface StatusRow {
  id: string; name: string;
  decision: Decision; confirmed: boolean; reason: string; memo: string;
  newInflow8: number[]; band: [number, number] | null; newInflowLast: number | null;
  bookmarksLast: number; bookmarksPrev: number; postsLast: number;
  reservers4: number; reserversPrev4: number;
  checks: Check[]; revenue4: number; revenuePrev4: number; roas4: number | null;
}
export async function listStatusRows(sql: postgres.Sql, today: string, period?: Period): Promise<{ baseWeek: { start: string; end: string }; period: PeriodInfo; rows: StatusRow[]; unlinked: string[] }> {
  const { linked, unlinked } = await listStatusClients(sql);
  const per = period && period.kind === 'week' ? period : defaultPeriod('week', today);
  const all = (await Promise.all(linked.map((c) => loadClientStatus(sql, c.id, today, per)))).filter((s): s is ClientStatus => s !== null);
  const rows = all.map((s): StatusRow => ({
    id: s.client.id, name: s.client.name,
    decision: s.review?.verdict ?? s.suggestion.decision, confirmed: !!s.review,
    reason: s.suggestion.reason, memo: s.review?.memo ?? '',
    newInflow8: s.newInflow.slice(-8).map((v) => v ?? 0), band: s.suggestion.band, newInflowLast: s.newInflow[s.newInflow.length - 1],
    bookmarksLast: s.x.bookmarks[s.x.bookmarks.length - 1], bookmarksPrev: s.x.bookmarks[s.x.bookmarks.length - 2], postsLast: s.x.postCount[s.x.postCount.length - 1],
    reservers4: s.reservers4, reserversPrev4: s.reserversPrev4,
    checks: s.suggestion.checks, revenue4: s.result.revenue4, revenuePrev4: s.result.revenuePrev4, roas4: s.result.roas4,
  }));
  return { baseWeek: { start: per.start, end: per.end }, period: periodInfo(per, today), rows, unlinked };
}

const COST_JPY = 10;
const tweetMs = (id: string) => Number((BigInt(id) >> BigInt(22)) + BigInt(1288834974657));

/** 누적 비율 표 — 운영 측정 기록에서 다시 계산한다(게시 6일 넘어 잰 값을 최종으로 보고, 구간별 중앙값).
 *  구간에 글이 5개 미만이면 기본값(ACCRUAL_DEFAULT)을 쓴다. 자동 측정이 쌓일수록 정확해진다. */
export async function loadAccrual(sql: postgres.Sql): Promise<Accrual> {
  const rows = await sql<Array<{ h: number; n: number; views: string | null; bookmarks: string | null }>>`
    with tp as (select id, to_timestamp(((tweet_id::numeric / 4194304)::bigint + 1288834974657) / 1000.0) tw from tracked_post where tweet_id ~ '^\\d{15,}$'),
    s as (select s.tracked_post_id id, extract(epoch from s.captured_at - tp.tw) / 3600 h, s.views, s.bookmarks from post_metric_snapshot s join tp on tp.id = s.tracked_post_id),
    fin as (select distinct on (id) id, views fv, bookmarks fb from s where h >= 144 order by id, h desc),
    b as (select case when h < 18 then 12 when h < 36 then 24 when h < 60 then 48 when h < 96 then 72 else 120 end hb, s.views::numeric / nullif(fv, 0) vs, s.bookmarks::numeric / nullif(fb, 0) bs, s.id
          from s join fin using (id) where s.h >= 6 and s.h < 144 and fv > 0 and fb > 0)
    select hb as h, count(distinct id)::int as n, percentile_cont(0.5) within group (order by vs) as views, percentile_cont(0.5) within group (order by bs) as bookmarks
    from b group by hb order by hb`;
  const table = ACCRUAL_DEFAULT.map((d) => {
    const r = rows.find((x) => Number(x.h) === d.h);
    return r && r.n >= 5 && r.views !== null && r.bookmarks !== null ? { h: d.h, views: Math.min(1, Number(r.views)), bookmarks: Math.min(1, Number(r.bookmarks)) } : d;
  });
  // 누적은 줄지 않는다 — 구간마다 글 묶음이 달라 중앙값이 뒤집히면 앞 구간 값으로 올린다
  for (let i = 1; i < table.length; i++) table[i] = { h: table[i].h, views: Math.max(table[i].views, table[i - 1].views), bookmarks: Math.max(table[i].bookmarks, table[i - 1].bookmarks) };
  return table;
}

/** 비교용 게시물 — LINE 연동 클라이언트 전체에서 [from, to]에 게시된 우리 작업 글(취소·삭제 제외) */
export async function loadPostPool(sql: postgres.Sql, from: string, to: string, acc: Accrual): Promise<PoolPost[]> {
  const rows = await sql<Array<{ tp_id: string; tweet_id: string; client_id: string; client_name: string; type: string; h: string | null; target: string | null; followers: number | null; cost: { amount?: number; currency?: string } | null }>>`
    select tp.id as tp_id, tp.tweet_id, c.id as client_id, c.name as client_name, t.type, t.influencer_handle as h,
      coalesce(substring(t.target_tweet_url from 'status/(\\d+)'), t.target_task_id::text) as target, i.followers_count as followers, t.cost
    from campaign_task t join campaign cp on cp.id = t.campaign_id join client c on c.id = cp.client_id
    join tracked_post tp on tp.task_id = t.id and t.post_url ~ ('/status/' || tp.tweet_id || '([/?#]|$)')
    left join influencer i on lower(i.handle) = lower(t.influencer_handle)
    where c.clinic_code is not null and t.removed_at is null and t.cancelled_at is null and tp.tweet_id ~ '^\\d{15,}$'
      and (to_timestamp(((tp.tweet_id::numeric / 4194304)::bigint + 1288834974657) / 1000.0) at time zone 'Asia/Seoul')::date between ${from} and ${to}`;
  if (!rows.length) return [];
  const snaps = await sql<Array<{ id: string; at: Date; views: string | null; bookmarks: number | null }>>`
    select tracked_post_id as id, captured_at as at, views, bookmarks from post_metric_snapshot where tracked_post_id in ${sql(rows.map((r) => r.tp_id))}`;
  type SnapRow = { id: string; at: Date; views: string | null; bookmarks: number | null };
  const by = new Map<string, SnapRow[]>();
  for (const x of snaps) by.set(x.id, [...(by.get(x.id) ?? []), x]);
  return rows.map((r) => {
    const t0 = tweetMs(r.tweet_id);
    const ss = (by.get(r.tp_id) ?? []).map((x) => ({ h: (new Date(x.at).getTime() - t0) / 3600e3, views: x.views === null ? null : Number(x.views), bm: x.bookmarks }));
    const vPts = ss.filter((x) => x.views !== null).map((x): [number, number] => [x.h, x.views as number]);
    const bPts = ss.filter((x) => x.bm !== null).map((x): [number, number] => [x.h, x.bm as number]);
    const lastH = Math.max(-1, ...ss.map((x) => x.h));
    return {
      id: r.tp_id, clientId: r.client_id, clientName: r.client_name, type: r.type, handle: r.h ?? '', targetKey: r.target,
      followers: r.followers, costKrw: r.cost?.amount ? Number(r.cost.amount) * (r.cost.currency === 'JPY' ? COST_JPY : 1) : 0,
      views7: valueAtHorizon(vPts, H_VIEWS, 'views', acc), bm3: valueAtHorizon(bPts, H_BOOKMARKS, 'bookmarks', acc),
      measuring: lastH < MIN_MEASURE_H,
    };
  });
}

const ZERO: StatusCounts = { visited: 0, confirmed: 0, reviewing: 0, lost: 0, cancelled: 0, noshow: 0 };
const addCounts = (a: StatusCounts, b: StatusCounts | null): StatusCounts => (b ? {
  visited: a.visited + b.visited, confirmed: a.confirmed + b.confirmed, reviewing: a.reviewing + b.reviewing,
  lost: a.lost + b.lost, cancelled: a.cancelled + b.cancelled, noshow: a.noshow + b.noshow } : a);
const SETTLE_WEEKS = 2;   // 불발은 CS가 후속 연락 뒤에 표시해 늦게 정리된다 — 최근 2주는 불발률에서 뺀다

/** 결과 구간 4주 요약 — 매출은 접수일 기준이 대표, 비용은 우리 작업 비용(게시일 기준). 비용 0인 기간의 비율은 null(—). */
export function summarizeResult(weeks: Array<{ start: string; end: string }>, revCreated: Array<number | null>, revVisit: Array<number | null>, cost: number[],
  statusWeeks: Array<StatusCounts | null>, upcomingConfirmed: number | null): ResultSummary {
  const n = weeks.length;
  const sum = (a: Array<number | null>, from: number, to: number) => a.slice(Math.max(0, from), Math.max(0, to)).reduce<number>((t, v) => t + (v ?? 0), 0);
  const revenue4 = sum(revCreated, n - 4, n), revenuePrev4 = sum(revCreated, n - 8, n - 4);
  const cost4 = sum(cost, n - 4, n), costPrev4 = sum(cost, n - 8, n - 4);
  const sFrom = n - 4 - SETTLE_WEEKS, sTo = n - SETTLE_WEEKS;
  const settledStatus = statusWeeks.slice(Math.max(0, sFrom), sTo).reduce(addCounts, ZERO);
  const settledTotal = countTotal(settledStatus);
  return {
    revenue4, revenuePrev4, visitRevenue4: sum(revVisit, n - 4, n), visitRevenuePrev4: sum(revVisit, n - 8, n - 4),
    cost4, costPrev4,
    roas4: cost4 > 0 ? revenue4 / cost4 : null, roasPrev4: costPrev4 > 0 ? revenuePrev4 / costPrev4 : null,
    status4: statusWeeks.slice(n - 4).reduce(addCounts, ZERO),
    settled: { status: settledStatus, lostRate: settledTotal >= 5 ? settledStatus.lost / settledTotal : null, from: weeks[Math.max(0, sFrom)].start, to: weeks[sTo - 1].end },
    upcomingConfirmed,
  };
}

export type DayRow = { nc: string | null; act: string | null; con: string | null; rsv: string | null; rc: string | null; rv: string | null; st: Record<string, number> | null };
export interface WeekRecord {
  source: WeekSource; newInflow: number | null; inflow: number | null; consulted: number | null; reservers: number | null;
  revCreated: number | null; revVisit: number | null; status: StatusCounts | null; upcoming: number | null;
}
const at = (o: unknown, path: string[]) => { let v: unknown = o; for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined; return num(v); };
/** 주차 하나의 값 — 스냅샷이 있으면 그대로, 없으면 일별을 더한다(신규 인입·매출·예약 상태는 정확, 인입·상담·예약자 같은 사람 수는 같은 사람이 겹쳐 근사). */
export function weekRecord(w: { start: string; end: string }, payload: Record<string, unknown> | undefined, kind: 'cweek' | 'week', dayMap: Map<string, DayRow>): WeekRecord {
  if (payload) {
    const st = (k: keyof StatusCounts) => at(payload, ['reservations', 'created_at', 'status_counts', k]) ?? 0;
    return {
      source: kind, newInflow: at(payload, ['funnel', 'new_customers']), inflow: at(payload, ['funnel', 'active_customers']),
      consulted: at(payload, ['funnel', 'consulted_customers']), reservers: at(payload, ['funnel', 'reservers', 'by_line_id']),
      revCreated: at(payload, ['reservations', 'created_at', 'revenue', 'total']), revVisit: at(payload, ['reservations', 'reservation_date', 'revenue', 'total']),
      status: { visited: st('visited'), confirmed: st('confirmed'), reviewing: st('reviewing'), lost: st('lost'), cancelled: st('cancelled'), noshow: st('noshow') },
      upcoming: at(payload, ['reservations', 'upcoming_confirmed']),
    };
  }
  const rows: DayRow[] = [];
  for (let d = w.start; d <= w.end; d = addDays(d, 1)) { const r = dayMap.get(d); if (r) rows.push(r); }
  if (!rows.length) return { source: null, newInflow: null, inflow: null, consulted: null, reservers: null, revCreated: null, revVisit: null, status: null, upcoming: null };
  const sum = (k: keyof Omit<DayRow, 'st'>) => rows.reduce((a, r) => a + (num(r[k]) ?? 0), 0);
  const st = (k: keyof StatusCounts) => rows.reduce((a, r) => a + Number(r.st?.[k] ?? 0), 0);
  return {
    source: 'days', newInflow: sum('nc'), inflow: sum('act'), consulted: sum('con'), reservers: sum('rsv'), revCreated: sum('rc'), revVisit: sum('rv'),
    status: { visited: st('visited'), confirmed: st('confirmed'), reviewing: st('reviewing'), lost: st('lost'), cancelled: st('cancelled'), noshow: st('noshow') },
    upcoming: null,
  };
}

/** 우리 게시물·비용 — 이 클라이언트의 캠페인 작업(취소·삭제 제외, from 이후 게시). 게시 시각은 게시물 번호에서(KST 날짜).
 *  주간·월간 보기가 같이 쓴다. 비용은 게시일 기준(엔 ×10). */
export async function loadClientPosts(sql: postgres.Sql, clientId: string, from: string): Promise<{ posts: StatusPost[]; costs: Array<{ date: string; krw: number }> }> {
  const taskRows = await sql<Array<{
    task_id: string; type: string; campaign_id: string; campaign_name: string; tp_id: string | null; tweet_id: string | null; unavailable_at: Date | null;
    h: string | null; cost: { amount?: number; currency?: string } | null; posted_on: Date | null; tw_day: Date | null; tw: Date | null;
    views: string | null; bookmarks: number | null; likes: number | null; retweets: number | null; replies: number | null; quotes: number | null; captured_at: Date | null;
  }>>`
    select t.id as task_id, t.type, cp.id as campaign_id, cp.name as campaign_name, tp.id as tp_id, tp.tweet_id, tp.unavailable_at,
      t.influencer_handle as h, t.cost, (t.posted_at at time zone 'Asia/Seoul')::date as posted_on,
      (to_timestamp((((substring(t.post_url from 'status/(\\d+)'))::numeric / 4194304)::bigint + 1288834974657) / 1000.0) at time zone 'Asia/Seoul')::date as tw_day,
      to_timestamp((((substring(t.post_url from 'status/(\\d+)'))::numeric / 4194304)::bigint + 1288834974657) / 1000.0) as tw,
      s.views, s.bookmarks, s.likes, s.retweets, s.replies, s.quotes, s.captured_at
    from campaign_task t join campaign cp on cp.id = t.campaign_id
    left join tracked_post tp on tp.task_id = t.id and t.post_url ~ ('/status/' || tp.tweet_id || '([/?#]|$)')
    left join lateral (select views, bookmarks, likes, retweets, replies, quotes, captured_at from post_metric_snapshot s where s.tracked_post_id = tp.id order by captured_at desc limit 1) s on true
    where cp.client_id = ${clientId} and t.removed_at is null and t.cancelled_at is null and t.posted_at is not null
      and (t.posted_at at time zone 'Asia/Seoul')::date >= ${from}`;
  const posts: StatusPost[] = taskRows.filter((r) => r.tw_day && r.tp_id && r.views !== null).map((r) => ({
    id: r.tp_id as string, tweetId: r.tweet_id as string, handle: r.h ?? '', date: isoDate(r.tw_day as Date), postedAt: new Date(r.tw as Date).toISOString(),
    views: Number(r.views), bookmarks: Number(r.bookmarks ?? 0), likes: r.likes ?? 0, retweets: r.retweets ?? 0, replies: r.replies ?? 0, quotes: r.quotes ?? 0,
    taskId: r.task_id, taskType: r.type, campaignId: r.campaign_id, campaignName: r.campaign_name, costKrw: krw(r.cost),
    capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : null, unavailable: !!r.unavailable_at,
  }));
  const costs = taskRows.filter((r) => r.posted_on).map((r) => ({ date: isoDate(r.posted_on as Date), krw: krw(r.cost) }));
  return { posts, costs };
}
