// 클라이언트 현황 — DB 읽기·판정 기록(스펙 2026-10-09-client-status-design.md §4·6). 계산은 clientStatus.ts(순수).
import type postgres from 'postgres';
import { addDays, baseWeekStart, weekStarts, mdLabel, suggestDecision, weeklyX, sum4, isDecision, type Decision, type Suggestion } from './clientStatus.ts';
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
    x, posts: recentPosts, groups, smallPostCount, typicalDay, growth, budget,
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
