import type postgres from 'postgres';
import type { PostMetrics } from './postMetrics.ts';

export interface TrackedPostRow {
  id: string; tweetId: string; authorHandle: string | null; text: string;
  postedAt: string | null;            // ISO or null
  draftId: string | null;
  draftLabel: string | null;          // coalesce(draft.title, draft.ko_title) — 목록 표시용
  source: string;
  unavailableAt: string | null;       // ISO or null
  createdAt: string;                  // ISO
  metrics: PostMetrics | null;        // 최신 스냅샷 (없으면 null — 이론상 등록=첫 측정이라 항상 있음)
  capturedAt: string | null;          // 최신 스냅샷 시각 (ISO)
}

type Row = {
  id: string; tweet_id: string; author_handle: string | null; text: string;
  posted_at: Date | null; draft_id: string | null;
  draft_title: string | null; draft_ko_title: string | null;
  source: string; unavailable_at: Date | null; created_at: Date;
  views: string | number | null; likes: number | null; retweets: number | null;
  replies: number | null; bookmarks: number | null; quotes: number | null;
  captured_at: Date | null;
};

// 목록·단건이 같은 정의를 쓴다(드리프트 방지) — lateral join으로 최신 스냅샷 1건만 붙인다.
const SELECT = (sql: postgres.Sql) => sql`
  select tp.id, tp.tweet_id, tp.author_handle, tp.text, tp.posted_at, tp.draft_id,
         d.title as draft_title, d.ko_title as draft_ko_title,
         tp.source, tp.unavailable_at, tp.created_at,
         s.views, s.likes, s.retweets, s.replies, s.bookmarks, s.quotes, s.captured_at
    from tracked_post tp
    left join draft d on d.id = tp.draft_id
    left join lateral (
      select * from post_metric_snapshot where tracked_post_id = tp.id
      order by captured_at desc limit 1
    ) s on true`;

function toRow(r: Row): TrackedPostRow {
  const hasSnapshot = r.captured_at !== null;
  return {
    id: r.id, tweetId: r.tweet_id, authorHandle: r.author_handle, text: r.text,
    postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
    draftId: r.draft_id,
    draftLabel: r.draft_title ?? r.draft_ko_title ?? null,
    source: r.source,
    unavailableAt: r.unavailable_at ? new Date(r.unavailable_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    metrics: hasSnapshot ? {
      views: r.views === null ? null : Number(r.views), // bigint는 postgres.js가 문자열로 준다
      likes: r.likes, retweets: r.retweets, replies: r.replies,
      bookmarks: r.bookmarks, quotes: r.quotes,
    } : null,
    capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : null,
  };
}

export async function listTrackedPosts(sql: postgres.Sql): Promise<TrackedPostRow[]> {
  const rows = await sql<Row[]>`${SELECT(sql)} order by tp.created_at desc`;
  return rows.map(toRow);
}

export async function findByTweetId(sql: postgres.Sql, tweetId: string): Promise<TrackedPostRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where tp.tweet_id = ${tweetId}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function findTrackedPostById(sql: postgres.Sql, id: string): Promise<TrackedPostRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where tp.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

// 명부+첫 스냅샷을 한 트랜잭션으로 — 등록은 항상 측정과 함께다(등록만 하고 지표 없는 상태는 없다).
// tweet_id 충돌 시(동시 등록 경합의 최후 방어) 스냅샷을 만들지 않고 기존 행을 그대로 돌려준다.
export async function addTrackedPost(sql: postgres.Sql, args: {
  tweetId: string; authorHandle: string | null; text: string; postedAt: string | null;
  createdBy: string | null; metrics: PostMetrics; raw: unknown;
}): Promise<{ created: boolean; row: TrackedPostRow }> {
  return sql.begin(async (tx) => {
    const ins = await tx<Array<{ id: string }>>`
      insert into tracked_post (tweet_id, author_handle, text, posted_at, created_by)
      values (${args.tweetId}, ${args.authorHandle}, ${args.text}, ${args.postedAt}, ${args.createdBy})
      on conflict (tweet_id) do nothing
      returning id`;

    // sql.begin의 tx는 TransactionSql — postgres.Sql과 호환되지만 타입이 별도라 캐스트한다(생성기 선례).
    const txSql = tx as unknown as postgres.Sql;

    if (ins.length === 0) {
      const existing = await findByTweetId(txSql, args.tweetId);
      return { created: false, row: existing as TrackedPostRow };
    }

    const id = ins[0].id;
    const m = args.metrics;
    await tx`insert into post_metric_snapshot (tracked_post_id, views, likes, retweets, replies, bookmarks, quotes, raw)
      values (${id}, ${m.views}, ${m.likes}, ${m.retweets}, ${m.replies}, ${m.bookmarks}, ${m.quotes},
              ${args.raw ? tx.json(args.raw as never) : null})`;

    const row = await findTrackedPostById(txSql, id);
    return { created: true, row: row as TrackedPostRow };
  });
}

// 스냅샷 추가 + unavailable_at을 null로(복귀 수용 — 스펙): 다시 측정이 됐다는 것 자체가 복귀 증거다.
export async function appendSnapshot(
  sql: postgres.Sql, trackedPostId: string, metrics: PostMetrics, raw: unknown,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into post_metric_snapshot (tracked_post_id, views, likes, retweets, replies, bookmarks, quotes, raw)
      values (${trackedPostId}, ${metrics.views}, ${metrics.likes}, ${metrics.retweets}, ${metrics.replies},
              ${metrics.bookmarks}, ${metrics.quotes}, ${raw ? tx.json(raw as never) : null})`;
    await tx`update tracked_post set unavailable_at = null where id = ${trackedPostId}`;
  });
}

// 이미 기록돼 있으면 시각 유지(최초 확인 시각 보존) — coalesce가 두 번째 호출을 no-op으로 만든다.
export async function markUnavailable(sql: postgres.Sql, trackedPostId: string): Promise<void> {
  await sql`update tracked_post set unavailable_at = coalesce(unavailable_at, now()) where id = ${trackedPostId}`;
}

export async function setDraftLink(
  sql: postgres.Sql, trackedPostId: string, draftId: string | null,
): Promise<boolean> {
  const rows = await sql`update tracked_post set draft_id = ${draftId} where id = ${trackedPostId} returning id`;
  return rows.length > 0;
}

export async function deleteTrackedPost(sql: postgres.Sql, trackedPostId: string): Promise<boolean> {
  const rows = await sql`delete from tracked_post where id = ${trackedPostId} returning id`; // 스냅샷은 cascade
  return rows.length > 0;
}
