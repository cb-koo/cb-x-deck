import type postgres from 'postgres';
import { dueWatch, tweetIdToDate, WATCH_QUERY_WINDOW_MS, type WatchDue } from './autoMeasure.ts';
import { firstLinkOf } from './selfReplies.ts';

// 자동 측정 대상 = 캠페인 작업에 붙은 게시물 중
//  · 본 게시물(작업 post_url의 게시물 번호와 같은 것) — 측정 시점 일정대로 잰다
//  · 링크가 든 인플 본인 댓글(2026-10-12 koo 결정 3) — 하루 한 번 살아 있나 본다(성과엔 안 넣지만 링크가 사라지면 클릭 길이 끊긴다)
// 링크 없는 본인 댓글은 대상이 아니다. 작업이 취소가 아니고, 게시 후 7일(+여유 1시간) 안인 것.
// 내림 표시된 작업도 본다 — 내림 뒤에 다시 보이면 화면이 알려 준다(내림을 자동으로 풀지는 않는다).
// 지금 X에서 안 보이는 게시물도 본다 — 확정 전이면 1시간 뒤, 확정 뒤면 하루 한 번(시점 판단은 autoMeasure.dueWatch).
export type DueMeasurement = { trackedPostId: string; tweetId: string; due: WatchDue };

type Row = {
  id: string; tweet_id: string; text: string; posted_at: Date | null; is_main: boolean; raw_urls: unknown;
  last_at: Date | null; missing_checked_at: Date | null; unavailable_at: Date | null;
};

export async function listDueMeasurements(sql: postgres.Sql, now: Date, limit: number): Promise<DueMeasurement[]> {
  const windowStart = new Date(now.getTime() - WATCH_QUERY_WINDOW_MS);
  const rows = await sql<Row[]>`
    select tp.id, tp.tweet_id, tp.text, tp.posted_at, tp.missing_checked_at, tp.unavailable_at,
           coalesce(t.post_url ~ ('/status/' || tp.tweet_id || '([/?#]|$)'), false) as is_main,
           s.captured_at as last_at, s.raw #> '{entities,urls}' as raw_urls
    from tracked_post tp
    join campaign_task t on t.id = tp.task_id
    left join lateral (
      select captured_at, raw from post_metric_snapshot where tracked_post_id = tp.id order by captured_at desc limit 1
    ) s on true
    where t.cancelled_at is null
      and coalesce(tp.posted_at, tp.created_at) >= ${windowStart}
    order by tp.posted_at nulls last`;
  const due: DueMeasurement[] = [];
  for (const r of rows) {
    const kind = r.is_main ? 'main' : firstLinkOf(r.text, r.raw_urls) ? 'link' : null;
    if (!kind) continue;
    const postedAt = r.posted_at ? new Date(r.posted_at) : tweetIdToDate(r.tweet_id);
    if (!postedAt) continue;
    const d = dueWatch({
      kind, postedAt,
      lastCapturedAt: r.last_at ? new Date(r.last_at) : null,
      missingCheckedAt: r.missing_checked_at ? new Date(r.missing_checked_at) : null,
      unavailableAt: r.unavailable_at ? new Date(r.unavailable_at) : null,
    }, now);
    if (d) due.push({ trackedPostId: r.id, tweetId: r.tweet_id, due: d });
    if (due.length >= limit) break;
  }
  return due;
}
