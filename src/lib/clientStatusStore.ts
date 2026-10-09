// 클라이언트 현황 — DB 읽기·판정 기록(스펙 2026-10-09-client-status-design.md §4·6). 계산은 clientStatus.ts(순수).
import type postgres from 'postgres';
import { addDays, baseWeekStart, weekStarts, mdLabel, suggestDecision, weeklyX, sum4, isDecision, type Decision, type Suggestion,
  valueAtHorizon, ACCRUAL_DEFAULT, H_BOOKMARKS, H_VIEWS, MIN_MEASURE_H, type Accrual } from './clientStatus.ts';
import { groupPosts, type PostGroup } from '../components/charts/postGroups.ts';
import { typical } from '../components/charts/normal.ts';

const WEEKS = 12;
const DAYS = 56;
const GROWTH_DAYS = 14;
const MIN_BOOKMARKS = 50;
const JPY_TO_KRW = 10;

const isoDate = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

export interface ReviewRow { verdict: Decision; suggested: Decision; memo: string; decidedByName: string; decidedAt: string }
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

export interface ClientStatus {
  client: { id: string; name: string };
  baseWeek: { start: string; end: string };
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
  review: ReviewRow | null; lastReview: ReviewRow | null;
}

export async function listStatusClients(sql: postgres.Sql): Promise<{ linked: Array<{ id: string; name: string; clinicCode: string }>; unlinked: string[] }> {
  const rows = await sql<Array<{ id: string; name: string; clinic_code: string | null }>>`select id, name, clinic_code from client order by name`;
  return {
    linked: rows.filter((r) => r.clinic_code).map((r) => ({ id: r.id, name: r.name, clinicCode: r.clinic_code as string })),
    unlinked: rows.filter((r) => !r.clinic_code).map((r) => r.name),
  };
}

type ReviewDb = { week_start: Date; verdict: string; suggested: string; memo: string; decided_by_name: string; decided_at: Date };
const toReview = (r: ReviewDb | undefined): ReviewRow | null => (r && isDecision(r.verdict) && isDecision(r.suggested)
  ? { verdict: r.verdict, suggested: r.suggested, memo: r.memo, decidedByName: r.decided_by_name, decidedAt: new Date(r.decided_at).toISOString() } : null);

export async function loadClientStatus(sql: postgres.Sql, clientId: string, today: string): Promise<ClientStatus | null> {
  const c = (await sql<Array<{ id: string; name: string; clinic_code: string | null }>>`select id, name, clinic_code from client where id = ${clientId}`)[0];
  if (!c || !c.clinic_code) return null;
  const base = baseWeekStart(today);
  const baseEnd = addDays(base, 6);
  const weeks = weekStarts(base, WEEKS);
  const dayFrom = addDays(baseEnd, -(DAYS - 1));
  const days = Array.from({ length: DAYS }, (_, i) => addDays(dayFrom, i));

  const [weekRows, dayRows] = await Promise.all([
    sql<Array<{ period_start: Date; payload: Record<string, unknown> }>>`
      select period_start, payload from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'week'
        and period_start between ${weeks[0]} and ${base}`,
    sql<Array<{ period_start: Date; nc: string | null }>>`
      select period_start, payload->'funnel'->>'new_customers' as nc from report_snapshot where clinic_code = ${c.clinic_code} and granularity = 'day'
        and period_start between ${dayFrom} and ${baseEnd}`,
  ]);
  const wk = new Map(weekRows.map((r) => [isoDate(r.period_start), r.payload]));
  const f = (w: string, path: string[]) => { let v: unknown = wk.get(w); for (const k of path) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined; return num(v); };
  const newInflow = weeks.map((w) => f(w, ['funnel', 'new_customers']));
  const inflow = weeks.map((w) => f(w, ['funnel', 'active_customers']));
  const consulted = weeks.map((w) => f(w, ['funnel', 'consulted_customers']));
  const reservers = weeks.map((w) => f(w, ['funnel', 'reservers', 'by_line_id']));
  const dm = new Map(dayRows.map((r) => [isoDate(r.period_start), num(r.nc)]));
  const dailyNew = days.map((d) => dm.get(d) ?? null);

  // 우리 게시물·비용 — 이 클라이언트의 캠페인 작업(취소·삭제 제외). 게시 시각은 게시물 번호에서(KST 날짜).
  const from = weeks[0];
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
    where cp.client_id = ${c.id} and t.removed_at is null and t.cancelled_at is null and t.posted_at is not null
      and (t.posted_at at time zone 'Asia/Seoul')::date >= ${from}`;
  const krw = (cost: { amount?: number; currency?: string } | null) => (cost?.amount ? Number(cost.amount) * (cost.currency === 'JPY' ? JPY_TO_KRW : 1) : 0);
  const posts: StatusPost[] = taskRows.filter((r) => r.tw_day && r.tp_id && r.views !== null).map((r) => ({
    id: r.tp_id as string, tweetId: r.tweet_id as string, handle: r.h ?? '', date: isoDate(r.tw_day as Date), postedAt: new Date(r.tw as Date).toISOString(),
    views: Number(r.views), bookmarks: Number(r.bookmarks ?? 0), likes: r.likes ?? 0, retweets: r.retweets ?? 0, replies: r.replies ?? 0, quotes: r.quotes ?? 0,
    taskId: r.task_id, taskType: r.type, campaignId: r.campaign_id, campaignName: r.campaign_name, costKrw: krw(r.cost),
    capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : null, unavailable: !!r.unavailable_at,
  }));
  const costs = taskRows.filter((r) => r.posted_on).map((r) => ({ date: isoDate(r.posted_on as Date), krw: krw(r.cost) }));
  const x = weeklyX(weeks, posts, costs);

  const recentPosts = posts.filter((p) => p.date >= dayFrom);
  const accrual = await loadAccrual(sql);
  const pool = await loadPostPool(sql, dayFrom, baseEnd, accrual);
  const typicalDay = typical(dailyNew);
  const groups = groupPosts(recentPosts, new Map(days.map((d, i) => [d, dailyNew[i] ?? 0])), typicalDay, MIN_BOOKMARKS);
  const smallPostCount = recentPosts.filter((p) => p.bookmarks < MIN_BOOKMARKS).length;

  // 성장 곡선 — 최근 14일 게시물의 측정 기록 전체
  const gRows = await sql<Array<{ tp_id: string; h: string | null; tw: Date; captured_at: Date; views: number }>>`
    with p as (
      select tp.id as tp_id, t.influencer_handle as h,
        to_timestamp((((substring(t.post_url from 'status/(\\d+)'))::numeric / 4194304)::bigint + 1288834974657) / 1000.0) as tw
      from campaign_task t join campaign cp on cp.id = t.campaign_id
      join tracked_post tp on tp.task_id = t.id and t.post_url ~ ('/status/' || tp.tweet_id || '([/?#]|$)')
      where cp.client_id = ${c.id} and t.removed_at is null and t.cancelled_at is null)
    select p.tp_id, p.h, p.tw, s.captured_at, s.views from p join post_metric_snapshot s on s.tracked_post_id = p.tp_id
    where p.tw >= ${addDays(today, -GROWTH_DAYS)}::date order by p.tp_id, s.captured_at`;
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
  const suggestion = suggestDecision({ newInflow: newInflow.slice(-8), reservers4: r4.recent, reserversPrev4: r4.prev, posts2w });
  const s4 = (a: Array<number | null>): [number, number] => { const v = sum4(a); return [v.recent, v.prev]; };

  const reviews = await sql<ReviewDb[]>`select week_start, verdict, suggested, memo, decided_by_name, decided_at from client_weekly_review
    where client_id = ${c.id} and week_start in (${base}, ${addDays(base, -7)})`;
  const rv = (w: string) => toReview(reviews.find((r) => isoDate(r.week_start) === w));

  return {
    client: { id: c.id, name: c.name }, baseWeek: { start: base, end: baseEnd },
    weeks, weekLabels: weeks.map(mdLabel), newInflow, inflow, consulted, reservers, days, dailyNew,
    x, posts: recentPosts, groups, smallPostCount, typicalDay, growth, budget, pool, accrual,
    suggestion, reservers4: r4.recent, reserversPrev4: r4.prev, posts2w,
    funnel4: { newInflow: s4(newInflow), consulted: s4(consulted), reservers: s4(reservers) },
    review: rv(base), lastReview: rv(addDays(base, -7)),
  };
}

export async function saveReview(sql: postgres.Sql, input: { clientId: string; weekStart: string; verdict: Decision; suggested: Decision; memo: string; by: { id: string; name: string } | null }): Promise<ReviewRow> {
  const r = (await sql<ReviewDb[]>`
    insert into client_weekly_review (client_id, week_start, verdict, suggested, memo, decided_by, decided_by_name)
    values (${input.clientId}, ${input.weekStart}, ${input.verdict}, ${input.suggested}, ${input.memo}, ${input.by?.id ?? null}, ${input.by?.name ?? ''})
    on conflict (client_id, week_start) do update set verdict = excluded.verdict, suggested = excluded.suggested, memo = excluded.memo,
      decided_by = excluded.decided_by, decided_by_name = excluded.decided_by_name, decided_at = now()
    returning week_start, verdict, suggested, memo, decided_by_name, decided_at`)[0];
  return toReview(r) as ReviewRow;
}

// ── 전체 보기(스펙 §3 첫 화면) — 클라이언트마다 상세와 같은 계산을 돌려 한 줄로 줄인다(3곳뿐이라 그대로 반복) ──
export interface StatusRow {
  id: string; name: string;
  decision: Decision; confirmed: boolean; reason: string; memo: string;
  newInflow8: number[]; band: [number, number] | null; newInflowLast: number | null;
  bookmarksLast: number; bookmarksPrev: number; postsLast: number;
  reservers4: number; reserversPrev4: number;
}
export async function listStatusRows(sql: postgres.Sql, today: string): Promise<{ baseWeek: { start: string; end: string }; rows: StatusRow[]; unlinked: string[] }> {
  const { linked, unlinked } = await listStatusClients(sql);
  const all = (await Promise.all(linked.map((c) => loadClientStatus(sql, c.id, today)))).filter((s): s is ClientStatus => s !== null);
  const rows = all.map((s): StatusRow => ({
    id: s.client.id, name: s.client.name,
    decision: s.review?.verdict ?? s.suggestion.decision, confirmed: !!s.review,
    reason: s.suggestion.reason, memo: s.review?.memo ?? '',
    newInflow8: s.newInflow.slice(-8).map((v) => v ?? 0), band: s.suggestion.band, newInflowLast: s.newInflow[s.newInflow.length - 1],
    bookmarksLast: s.x.bookmarks[s.x.bookmarks.length - 1], bookmarksPrev: s.x.bookmarks[s.x.bookmarks.length - 2], postsLast: s.x.postCount[s.x.postCount.length - 1],
    reservers4: s.reservers4, reserversPrev4: s.reserversPrev4,
  }));
  const base = baseWeekStart(today);
  return { baseWeek: { start: base, end: addDays(base, 6) }, rows, unlinked };
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
