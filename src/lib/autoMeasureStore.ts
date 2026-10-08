import type postgres from 'postgres';
import { dueCheckpoint, tweetIdToDate, LAST_CHECKPOINT_MS } from './autoMeasure.ts';

// 자동 측정 대상 = 캠페인 작업의 본 게시물(작업 post_url의 게시물 번호와 같은 것 — 본인 댓글은 성과에 넣지 않으므로 제외),
// 작업이 살아 있고(취소·삭제 아님), 게시물이 사라지지 않았고, 게시 후 7일(+여유 1시간) 안인 것.
// 그중 지금 잴 시점이 온 것만 돌려준다(시점 판단은 autoMeasure.dueCheckpoint).
export type DueMeasurement = { trackedPostId: string; tweetId: string; checkpointMs: number };

export async function listDueMeasurements(sql: postgres.Sql, now: Date, limit: number): Promise<DueMeasurement[]> {
  const windowStart = new Date(now.getTime() - LAST_CHECKPOINT_MS - 60 * 60_000);
  const rows = await sql<Array<{ id: string; tweet_id: string; posted_at: Date | null; last_at: Date | null }>>`
    select tp.id, tp.tweet_id, tp.posted_at,
           (select max(s.captured_at) from post_metric_snapshot s where s.tracked_post_id = tp.id) as last_at
    from tracked_post tp
    join campaign_task t on t.id = tp.task_id
    where t.removed_at is null and t.cancelled_at is null
      and t.post_url ~ ('/status/' || tp.tweet_id || '([/?#]|$)')
      and tp.unavailable_at is null
      and coalesce(tp.posted_at, tp.created_at) >= ${windowStart}
    order by tp.posted_at nulls last`;
  const due: DueMeasurement[] = [];
  for (const r of rows) {
    const postedAt = r.posted_at ? new Date(r.posted_at) : tweetIdToDate(r.tweet_id);
    if (!postedAt) continue;
    const c = dueCheckpoint(postedAt, r.last_at ? new Date(r.last_at) : null, now);
    if (c !== null) due.push({ trackedPostId: r.id, tweetId: r.tweet_id, checkpointMs: c });
    if (due.length >= limit) break;
  }
  return due;
}
