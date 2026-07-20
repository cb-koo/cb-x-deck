import type postgres from 'postgres';
import type { DeckTweet, SortDir, SortKey, StoredTweet } from './types.ts';

export async function upsertTweets(sql: postgres.Sql, tweets: DeckTweet[]): Promise<{ inserted: number; updated: number }> {
  let inserted = 0, updated = 0;
  for (const t of tweets) {
    const [row] = await sql<Array<{ is_insert: boolean }>>`
      insert into tweet (tweet_id, author_handle, author_name, author_avatar_url, author_followers,
                         text, media, quoted, metrics, tweet_url, tweet_created_at)
      values (${t.tweetId}, ${t.authorHandle}, ${t.authorName}, ${t.authorAvatarUrl}, ${t.authorFollowers},
              ${t.text}, ${sql.json(t.media as never)}, ${t.quoted ? sql.json(t.quoted as never) : null},
              ${sql.json(t.metrics as never)}, ${t.tweetUrl}, ${t.tweetCreatedAt})
      on conflict (tweet_id) do update set
        author_name = excluded.author_name,
        author_avatar_url = excluded.author_avatar_url,
        author_followers = excluded.author_followers,
        text = excluded.text,
        media = excluded.media,
        quoted = excluded.quoted,
        metrics = excluded.metrics,
        last_fetched_at = now()
      returning (xmax = 0) as is_insert`;
    if (row.is_insert) inserted++; else updated++;
  }
  return { inserted, updated };
}

export async function linkColumnTweets(sql: postgres.Sql, columnId: string, tweetIds: string[]): Promise<void> {
  for (const id of tweetIds) {
    await sql`insert into column_tweet (column_id, tweet_id) values (${columnId}, ${id}) on conflict do nothing`;
  }
}

const ORDER_EXPR: Record<SortKey, string> = {
  views: `(t.metrics->>'views')::bigint`,
  date: `t.tweet_created_at`,
  bookmarks: `(t.metrics->>'bookmarks')::bigint`,
  retweets: `(t.metrics->>'retweets')::bigint`,
};

type TweetRow = {
  tweet_id: string; author_handle: string; author_name: string | null; author_avatar_url: string | null;
  author_followers: string | number | null; text: string; media: StoredTweet['media'];
  quoted: StoredTweet['quoted']; metrics: StoredTweet['metrics']; tweet_url: string | null;
  tweet_created_at: Date | null; first_seen_at: Date; last_fetched_at: Date;
  is_new: boolean; saved_by: StoredTweet['savedBy'];
  quoted_enriched: DeckTweet | null;
};

function toStored(r: TweetRow): StoredTweet {
  return {
    tweetId: r.tweet_id, authorHandle: r.author_handle, authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
    text: r.text, media: r.media ?? [],
    quoted: r.quoted ? { ...r.quoted, enriched: r.quoted_enriched ?? null } : null,
    metrics: r.metrics,
    tweetUrl: r.tweet_url, tweetCreatedAt: r.tweet_created_at?.toISOString() ?? null,
    firstSeenAt: r.first_seen_at.toISOString(), lastFetchedAt: r.last_fetched_at.toISOString(),
    isNew: r.is_new, savedBy: r.saved_by ?? [],
  };
}

// 브리핑 인용 등 ID 집합으로 원본 트윗 스냅샷을 뽑을 때 사용 — 컬럼·워크스페이스 무관 순수 조회.
// 인용 트윗 캐시(quoted_tweet)가 있으면 enriched로 함께 실어 인용RT 카드가 완전하게 렌더된다(getColumnTweets와 동일 조인).
export async function getTweetsByIds(sql: postgres.Sql, tweetIds: string[]): Promise<DeckTweet[]> {
  if (tweetIds.length === 0) return [];
  const rows = await sql<Array<{
    tweet_id: string; author_handle: string; author_name: string | null; author_avatar_url: string | null;
    author_followers: string | number | null; text: string; media: DeckTweet['media'];
    quoted: DeckTweet['quoted']; metrics: DeckTweet['metrics']; tweet_url: string | null;
    tweet_created_at: Date | null; quoted_enriched: DeckTweet | null;
  }>>`
    select t.tweet_id, t.author_handle, t.author_name, t.author_avatar_url, t.author_followers,
           t.text, t.media, t.quoted, t.metrics, t.tweet_url, t.tweet_created_at,
           qt.data as quoted_enriched
      from tweet t
      left join quoted_tweet qt on qt.id = t.quoted->>'id' and qt.status = 'ok'
     where t.tweet_id = any(${tweetIds})`;
  return rows.map((r) => ({
    tweetId: r.tweet_id, authorHandle: r.author_handle, authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
    text: r.text, media: r.media ?? [],
    quoted: (r.quoted ? { ...r.quoted, enriched: r.quoted_enriched ?? null } : null) as DeckTweet['quoted'],
    metrics: r.metrics,
    tweetUrl: r.tweet_url, tweetCreatedAt: r.tweet_created_at?.toISOString() ?? null,
  }));
}

export const PAGE_SIZE = 200;

export async function getColumnTweets(
  sql: postgres.Sql, columnId: string,
  opts: { sort: SortKey; offset?: number; dismissed?: 'exclude' | 'only'; dir?: SortDir },
): Promise<StoredTweet[]> {
  const [col] = await sql<Array<{ workspace_id: string }>>`select workspace_id from deck_column where id = ${columnId}`;
  if (!col) return [];
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const orderExpr = ORDER_EXPR[opts.sort] ?? ORDER_EXPR.views;
  const orderDir = opts.dir === 'asc' ? 'asc nulls first' : 'desc nulls last';
  const rows = await sql.unsafe<TweetRow[]>(
    // is_new: 직전 새로고침(prev_refreshed_at) 이후 이 컬럼에 처음 들어온 트윗.
    // prev가 null(첫 새로고침 이전/직후)이면 전부 false — 전부 신규일 땐 배지가 정보가 아니므로.
    `select t.*,
            qt.data as quoted_enriched,
            coalesce(ct.first_appeared_at > dc.prev_refreshed_at, false) as is_new,
            coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.name)
                        from candidate c join member m on m.id = c.member_id
                       where c.tweet_id = t.tweet_id and c.workspace_id = $2), '[]'::json) as saved_by
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id
       join tweet t on t.tweet_id = ct.tweet_id
       left join quoted_tweet qt on qt.id = t.quoted->>'id' and qt.status = 'ok'
      where ct.column_id = $1
        and ${opts.dismissed === 'only'
              ? `exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`
              : `not exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`}
      order by ${orderExpr} ${orderDir}, t.tweet_id
      limit ${PAGE_SIZE} offset $3`,
    [columnId, col.workspace_id, offset],
  );
  return rows.map(toStored);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getColumnTweetCount(
  sql: postgres.Sql, columnId: string, opts: { dismissed?: 'exclude' | 'only' } = {},
): Promise<number> {
  // columnId가 uuid 형식이 아니면 조회 없이 즉시 0 반환 — deck_column.id는 uuid 컬럼이라
  // 형식이 안 맞는 문자열을 그대로 넘기면 postgres가 "없음"이 아니라 캐스팅 오류(22P02)를 던진다.
  if (!UUID_RE.test(columnId)) return 0;
  const [col] = await sql<Array<{ workspace_id: string }>>`select workspace_id from deck_column where id = ${columnId}`;
  if (!col) return 0;
  const [row] = await sql.unsafe<Array<{ n: string }>>(
    `select count(*)::text as n
       from column_tweet ct
       join tweet t on t.tweet_id = ct.tweet_id
      where ct.column_id = $1
        and ${opts.dismissed === 'only'
              ? `exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`
              : `not exists (select 1 from dismissed_tweet d where d.workspace_id = $2 and d.tweet_id = t.tweet_id)`}`,
    [columnId, col.workspace_id],
  );
  return Number(row?.n ?? 0);
}
