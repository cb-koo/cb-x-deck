// 인플루언서 성과 — 취소 안 된 배정 작업 + 작업별 최신 스냅샷 합 + 명부를 한 번에 읽어 인플별로 묶는다(스펙 §7).
// 작업 지표는 캠페인 화면(campaignStore.getCampaignDetail)과 같은 방식 — 본 게시물(post_url의 트윗, pickTaskMainPost) 하나의
// 최신 1건(lateral)이라 두 화면 숫자가 같다. 인플 본인 댓글 등 나머지 게시물은 더하지 않는다(self-replies 스펙 §5).
import type postgres from 'postgres';
import type { PerfInfluencerInput, PerfTask } from './influencerPerformance.ts';
import type { TaskType } from './campaignJudgment.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';
import { pickTaskMainPost } from './selfReplies.ts';

type PostRow = {
  task_id: string; tweet_id: string; posted_at: Date | null; is_reply: boolean | null;
  views: string | number | null; likes: number | null; replies: number | null; bookmarks: number | null; retweets: number | null; quotes: number | null;
};
type Row = {
  id: string; campaign_id: string; campaign_name: string; client_id: string | null; client_name: string | null; type: TaskType; influencer_handle: string;
  posted_at: string | null; post_url: string | null; removed_at: string | null; removed_reason: string; cost: unknown;
  influencer_id: string | null; roster_handle: string | null; display_name: string | null;
  avatar_url: string | null; is_blue_verified: boolean | null;
};
const num = (v: string | number | null) => (v === null ? null : Number(v)); // sum()은 문자열로 온다
// jsonb 모양은 보증되지 않는다 — 검증 통과분만(campaignTaskStore.costOf 태도)
function costOf(v: unknown): TaskCost | null { const p = parseTaskCost(v ?? null); return p.ok ? p.value : null; }

export async function listInfluencerPerformance(sql: postgres.Sql): Promise<PerfInfluencerInput[]> {
  const rows = await sql<Row[]>`
    select t.id, t.campaign_id, c.name as campaign_name, c.client_id, c.client_name, t.type, t.influencer_handle,
           to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, t.post_url, t.cost,
           to_char(t.removed_at, 'YYYY-MM-DD') as removed_at, t.removed_reason,
           i.id as influencer_id, i.handle as roster_handle, i.display_name, i.avatar_url, i.is_blue_verified
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join influencer i on lower(i.handle) = lower(t.influencer_handle)
     where t.cancelled_at is null and t.influencer_handle is not null
     order by t.created_at`;
  const postRows = await sql<PostRow[]>`
    select tp.task_id, tp.tweet_id, tp.posted_at, (s.raw->>'isReply')::boolean as is_reply,
           s.views, s.likes, s.replies, s.bookmarks, s.retweets, s.quotes
      from tracked_post tp
      join campaign_task t on t.id = tp.task_id
      left join lateral (
        select views, likes, replies, bookmarks, retweets, quotes, raw from post_metric_snapshot
         where tracked_post_id = tp.id order by captured_at desc limit 1
      ) s on true
     where t.cancelled_at is null and t.influencer_handle is not null
     order by tp.created_at asc`;
  const postsByTask = new Map<string, PostRow[]>();
  for (const r of postRows) { const l = postsByTask.get(r.task_id); if (l) l.push(r); else postsByTask.set(r.task_id, [r]); }

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
      postedAt: r.posted_at, postUrl: r.post_url, removedAt: r.removed_at, removedReason: r.removed_reason,
      clientId: r.client_id, clientName: r.client_name,
      cost: costOf(r.cost),
      metrics: metricsOf(r.post_url, postsByTask.get(r.id) ?? []),
    };
    inf.tasks.push(task);
  }
  return [...byHandle.values()];
}

// 작업 지표 = 본 게시물 하나(postCount는 붙은 게시물 수 — 댓글 포함). 게시물이 없으면 null.
function metricsOf(postUrl: string | null, rows: PostRow[]): PerfTask['metrics'] {
  const main = pickTaskMainPost(postUrl, rows.map((r) => ({
    ...r, tweetId: r.tweet_id, postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null, isReply: r.is_reply,
  })));
  if (!main) return null;
  return {
    postCount: rows.length, views: num(main.views), likes: main.likes, replies: main.replies,
    bookmarks: main.bookmarks, retweets: main.retweets, quotes: main.quotes,
  };
}
