import type postgres from 'postgres';
import type { DeckTweet, SortKey, StoredTweet, ViewMode } from './types.ts';

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

type TweetRow = {
  tweet_id: string; author_handle: string; author_name: string | null; author_avatar_url: string | null;
  author_followers: string | number | null; text: string; media: StoredTweet['media'];
  quoted: StoredTweet['quoted']; metrics: StoredTweet['metrics']; tweet_url: string | null;
  tweet_created_at: Date | null; first_seen_at: Date; last_fetched_at: Date; seen_at: Date | null;
  is_candidate: boolean;
};

function toStored(r: TweetRow): StoredTweet {
  return {
    tweetId: r.tweet_id, authorHandle: r.author_handle, authorName: r.author_name,
    authorAvatarUrl: r.author_avatar_url,
    authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
    text: r.text, media: r.media ?? [], quoted: r.quoted, metrics: r.metrics,
    tweetUrl: r.tweet_url, tweetCreatedAt: r.tweet_created_at?.toISOString() ?? null,
    firstSeenAt: r.first_seen_at.toISOString(), lastFetchedAt: r.last_fetched_at.toISOString(),
    seenAt: r.seen_at?.toISOString() ?? null, isCandidate: r.is_candidate,
  };
}

const ORDER: Record<SortKey, string> = {
  views: `(t.metrics->>'views')::bigint desc nulls last`,
  date: `t.tweet_created_at desc nulls last`,
  bookmarks: `(t.metrics->>'bookmarks')::bigint desc nulls last`,
  retweets: `(t.metrics->>'retweets')::bigint desc nulls last`,
};

export async function getColumnTweets(
  sql: postgres.Sql, columnId: string, opts: { sort: SortKey; mode: ViewMode },
): Promise<StoredTweet[]> {
  const rows = await sql.unsafe<TweetRow[]>(
    `select t.*, (c.id is not null) as is_candidate
       from column_tweet ct
       join tweet t on t.tweet_id = ct.tweet_id
       left join candidate c on c.tweet_id = t.tweet_id
      where ct.column_id = $1 ${opts.mode === 'new' ? 'and t.seen_at is null' : ''}
      order by ${ORDER[opts.sort] ?? ORDER.views}
      limit 200`,
    [columnId],
  );
  return rows.map(toStored);
}

export async function markSeen(sql: postgres.Sql, tweetId: string): Promise<void> {
  await sql`update tweet set seen_at = now() where tweet_id = ${tweetId} and seen_at is null`;
}

export async function markAllSeen(sql: postgres.Sql, columnId: string): Promise<number> {
  const rows = await sql`
    update tweet set seen_at = now()
    where seen_at is null and tweet_id in (select tweet_id from column_tweet where column_id = ${columnId})
    returning tweet_id`;
  return rows.length;
}
