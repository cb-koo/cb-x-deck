import type postgres from 'postgres';
import { getCampaignDetail, listCampaigns, type CampaignRow } from './campaignStore.ts';
import { buildOverview, pickLong, pickWeekly, resolveWeek, type DayPoint, type Overview, type OverviewInput } from './campaignOverview.ts';
import { pickTaskMainPost } from './selfReplies.ts';
import { loadTaskFacts } from './extensionReadStore.ts';
import { classifyTask } from './extensionTasks.ts';
import type { VisitPhase } from './reservationPolicy.ts';
import { kstToday } from './datetime.ts';

// 캠페인 현황(읽기 전용). 숫자는 캠페인 상세와 같은 함수(getCampaignDetail)로 읽어 두 화면이 어긋나지 않게 한다.
export async function getCampaignOverview(sql: postgres.Sql, weekParam: string | null, today: string = kstToday()): Promise<Overview> {
  const week = resolveWeek(weekParam, today);
  const all = await listCampaigns(sql);
  const weeklyRows = pickWeekly(all, week.weekStart);
  // 장기 줄 순서 고정(R6) — 클라이언트 이름 → 시작일 → id
  const longRows = pickLong(all, today).sort((a, b) =>
    (a.clientName ?? a.name).localeCompare(b.clientName ?? b.name, 'ko')
    || a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id));

  const details = await detailsOf(sql, [...weeklyRows, ...longRows], today);
  const weeklyDetails = details.slice(0, weeklyRows.length);
  const longDetails = details.slice(weeklyRows.length);

  const points = await dayPoints(sql, weeklyDetails.flatMap((d) => d.tasks));
  const phases = await visitPhases(sql, longDetails.flatMap((d) => d.tasks), today);

  const weekly: OverviewInput[] = weeklyDetails.map((d) => {
    const ids = new Set(d.tasks.map((t) => t.id));
    return { ...d, points: points.filter((p) => ids.has(p.taskId)), visitPhases: {} };
  });
  const long: OverviewInput[] = longDetails.map((d) => ({ ...d, points: [], visitPhases: phases }));
  return buildOverview(weekly, long, week, today);
}

type Detail = Pick<OverviewInput, 'campaign' | 'tasks' | 'perfUpdatedAt'>;

// 동시에 3개까지만 — DB 연결 풀이 5개라(2026-08 연결 고갈 사고) 한꺼번에 돌리면 다른 요청이 막힌다
async function detailsOf(sql: postgres.Sql, rows: CampaignRow[], today: string): Promise<Detail[]> {
  const out: Detail[] = new Array(rows.length);
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const i = next++;
      const d = await getCampaignDetail(sql, rows[i].id, today);
      // 목록과 상세 사이에 지워졌으면 빈 작업으로 — 화면 전체를 실패시키지 않는다
      out[i] = d ? { campaign: d.campaign, tasks: d.tasks, perfUpdatedAt: d.perfUpdatedAt } : { campaign: rows[i], tasks: [], perfUpdatedAt: null };
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, rows.length) }, worker));
  return out;
}

type PointRow = { task_id: string; tweet_id: string; posted_at: Date | null; day: string; views: string | number | null; bookmarks: number | null; is_reply: boolean | null };

// 날짜별 누적 — (게시물, 한국 날짜)마다 마지막 실측값. 본 게시물 고르기는 상세와 같은 pickTaskMainPost(댓글은 더하지 않는다).
// 추정값(post_metric_estimate)은 읽지 않는다 — 차트는 실측만.
async function dayPoints(sql: postgres.Sql, tasks: Detail['tasks']): Promise<DayPoint[]> {
  if (!tasks.length) return [];
  const rows = await sql<PointRow[]>`
    select distinct on (tp.id, d.day) tp.task_id, tp.tweet_id, tp.posted_at,
           d.day, s.views, s.bookmarks, (s.raw->>'isReply')::boolean as is_reply
      from tracked_post tp
      join post_metric_snapshot s on s.tracked_post_id = tp.id
      cross join lateral (select to_char(s.captured_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day) d
     where tp.task_id in ${sql(tasks.map((t) => t.id))}
     order by tp.id, d.day, s.captured_at desc`;
  const byTask = new Map<string, PointRow[]>();
  for (const r of rows) { const l = byTask.get(r.task_id); if (l) l.push(r); else byTask.set(r.task_id, [r]); }

  const out: DayPoint[] = [];
  for (const t of tasks) {
    const list = byTask.get(t.id);
    if (!list) continue;
    // 게시물마다 한 후보 — isReply는 그 게시물의 가장 최근 측정값을 쓴다(상세가 최신 스냅샷으로 판정하는 것과 같게)
    const posts = new Map<string, { tweetId: string; postedAt: string | null; isReply: boolean | null; lastDay: string }>();
    for (const r of list) {
      const p = posts.get(r.tweet_id);
      if (!p || r.day > p.lastDay) {
        posts.set(r.tweet_id, { tweetId: r.tweet_id, postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null, isReply: r.is_reply, lastDay: r.day });
      }
    }
    const main = pickTaskMainPost(t.postUrl, [...posts.values()]);
    if (!main) continue;
    for (const r of list) {
      if (r.tweet_id !== main.tweetId) continue;
      out.push({ taskId: t.id, day: r.day, views: r.views === null ? null : Number(r.views), bookmarks: r.bookmarks });
    }
  }
  return out;
}

// 장기 캠페인 방문 작업의 단계. 예약 테이블(064)이 없는 DB나 기능이 꺼진 환경에선 빈 맵 —
// campaignStore.reservationByTaskIds와 같은 조건으로 건너뛴다(그때 화면은 전부 '예약 대기'로 본다).
async function visitPhases(sql: postgres.Sql, tasks: Detail['tasks'], today: string): Promise<Record<string, VisitPhase>> {
  const visits = tasks.filter((t) => t.type === 'visit' && t.influencerHandle);
  if (!visits.length) return {};
  if (process.env.EXTENSION_PRODUCT_ENABLED === 'false') return {};
  const [{ ready }] = await sql<Array<{ ready: boolean }>>`select to_regclass('public.visit_reservation') is not null as ready`;
  if (!ready) return {};
  const ids = new Set(visits.map((t) => t.id));
  const facts = await loadTaskFacts(sql, [...new Set(visits.map((t) => t.influencerHandle!.toLowerCase()))]);
  const out: Record<string, VisitPhase> = {};
  for (const f of facts) {
    if (!ids.has(f.id)) continue;   // 같은 핸들의 다른 캠페인 작업은 버린다
    const phase = classifyTask(f, today).visitPhase;
    if (phase) out[f.id] = phase;
  }
  return out;
}
