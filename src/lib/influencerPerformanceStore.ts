// 인플루언서 성과 — 취소 안 된 배정 작업 + 작업별 최신 스냅샷 합 + 명부를 한 번에 읽어 인플별로 묶는다(스펙 §7).
// 작업 지표는 캠페인 화면(campaignStore.getCampaignDetail)과 같은 방식 — 게시물마다 최신 1건(lateral)을 합산해 두 화면 숫자가 같다.
import type postgres from 'postgres';
import type { PerfInfluencerInput, PerfTask } from './influencerPerformance.ts';
import type { TaskType } from './campaignJudgment.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';

type Row = {
  id: string; campaign_id: string; campaign_name: string; type: TaskType; influencer_handle: string;
  posted_at: string | null; post_url: string | null; cost: unknown;
  post_count: number; views: string | null; likes: string | null; replies: string | null;
  bookmarks: string | null; retweets: string | null; quotes: string | null;
  influencer_id: string | null; roster_handle: string | null; display_name: string | null;
  avatar_url: string | null; is_blue_verified: boolean | null;
};
const num = (v: string | number | null) => (v === null ? null : Number(v)); // sum()은 문자열로 온다
// jsonb 모양은 보증되지 않는다 — 검증 통과분만(campaignTaskStore.costOf 태도)
function costOf(v: unknown): TaskCost | null { const p = parseTaskCost(v ?? null); return p.ok ? p.value : null; }

export async function listInfluencerPerformance(sql: postgres.Sql): Promise<PerfInfluencerInput[]> {
  const rows = await sql<Row[]>`
    select t.id, t.campaign_id, c.name as campaign_name, t.type, t.influencer_handle,
           to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, t.post_url, t.cost,
           p.post_count, p.views, p.likes, p.replies, p.bookmarks, p.retweets, p.quotes,
           i.id as influencer_id, i.handle as roster_handle, i.display_name, i.avatar_url, i.is_blue_verified
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join lateral (
        select count(tp.id)::int as post_count, sum(s.views) as views, sum(s.likes) as likes, sum(s.replies) as replies,
               sum(s.bookmarks) as bookmarks, sum(s.retweets) as retweets, sum(s.quotes) as quotes
          from tracked_post tp
          left join lateral (
            select views, likes, replies, bookmarks, retweets, quotes from post_metric_snapshot
             where tracked_post_id = tp.id order by captured_at desc limit 1
          ) s on true
         where tp.task_id = t.id
      ) p on true
      left join influencer i on lower(i.handle) = lower(t.influencer_handle)
     where t.cancelled_at is null and t.influencer_handle is not null
     order by t.created_at`;

  const byHandle = new Map<string, PerfInfluencerInput>();
  for (const r of rows) {
    const key = r.influencer_handle.toLowerCase();
    let inf = byHandle.get(key);
    if (!inf) {
      inf = {
        handle: r.roster_handle ?? r.influencer_handle, influencerId: r.influencer_id, displayName: r.display_name,
        avatarUrl: r.avatar_url, isBlueVerified: r.is_blue_verified, tasks: [],
      };
      byHandle.set(key, inf);
    }
    const task: PerfTask = {
      id: r.id, campaignId: r.campaign_id, campaignName: r.campaign_name, type: r.type,
      postedAt: r.posted_at, postUrl: r.post_url, cost: costOf(r.cost),
      metrics: r.post_count > 0 ? {
        postCount: r.post_count, views: num(r.views), likes: num(r.likes), replies: num(r.replies),
        bookmarks: num(r.bookmarks), retweets: num(r.retweets), quotes: num(r.quotes),
      } : null,
    };
    inf.tasks.push(task);
  }
  return [...byHandle.values()];
}
