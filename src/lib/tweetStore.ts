import type postgres from 'postgres';
import type { DeckTweet, SortDir, SortKey, StoredTweet, TableRow } from './types.ts';
import { TABLE_MAX, TABLE_PAGE } from './tableLimits.ts';
import { buildFilterSql, type FilterCondition } from './tableFilter.ts';

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

// 정렬용 SQL 식. metrics는 jsonb라 텍스트로 뽑아 bigint 캐스팅한다.
// 7종 전부 있는 이유: 표 보기가 지표 6종 + 날짜로 정렬한다(설계 §D).
const ORDER_EXPR: Record<SortKey, string> = {
  views: `(t.metrics->>'views')::bigint`,
  date: `t.tweet_created_at`,
  bookmarks: `(t.metrics->>'bookmarks')::bigint`,
  retweets: `(t.metrics->>'retweets')::bigint`,
  likes: `(t.metrics->>'likes')::bigint`,
  replies: `(t.metrics->>'replies')::bigint`,
  quotes: `(t.metrics->>'quotes')::bigint`,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuidLike(id: string): boolean {
  return UUID_RE.test(id);
}

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
  // columnId가 uuid 형식이 아니면 조회 없이 즉시 [] 반환 — deck_column.id는 uuid 컬럼이라
  // 형식이 안 맞는 문자열을 그대로 넘기면 postgres가 "없음"이 아니라 캐스팅 오류(22P02)를 던진다.
  if (!isUuidLike(columnId)) return [];
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

export async function getColumnTweetCount(
  sql: postgres.Sql, columnId: string, opts: { dismissed?: 'exclude' | 'only' } = {},
): Promise<number> {
  // columnId가 uuid 형식이 아니면 조회 없이 즉시 0 반환 — deck_column.id는 uuid 컬럼이라
  // 형식이 안 맞는 문자열을 그대로 넘기면 postgres가 "없음"이 아니라 캐스팅 오류(22P02)를 던진다.
  if (!isUuidLike(columnId)) return 0;
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

// 표 보기 — 워크스페이스의 모든 컬럼을 한 목록으로. 새 마이그레이션 없이 기존 조인만 쓴다(설계 §G).

type TableRowRaw = {
  tweet_id: string; column_titles: string[]; author_handle: string; author_name: string | null;
  author_followers: string | number | null; text: string; tweet_created_at: Date | null;
  metrics: TableRow['metrics']; saved_by: TableRow['savedBy']; last_fetched_at: Date;
};

// 파라미터 번호를 손으로 세지 않는다 — 조건 개수가 가변이라 하드코딩하면 어긋난다.
// (이 파일은 예전에 쓰이지 않는 자리표시자 때문에 42P18 오류를 낸 적이 있다.)
function paramBag() {
  const params: unknown[] = [];
  return { params, bind: (v: unknown) => { params.push(v); return `$${params.length}`; } };
}

// 워크스페이스 안에서 그 트윗이 속한 모든 컬럼 이름. 필터와 분리한다 —
// 컬럼을 좁혔다고 소속을 축소해 적으면 내보낸 파일이 사실을 왜곡한다(설계 §D).
function columnTitlesSubquery(wsParam: string): string {
  return `(select array_agg(distinct dc2.title)
             from column_tweet ct2
             join deck_column dc2 on dc2.id = ct2.column_id and dc2.workspace_id = ${wsParam}
            where ct2.tweet_id = t.tweet_id)`;
}

function tableWhere(
  wsParam: string, bag: ReturnType<typeof paramBag>,
  columnIds?: string[], filters?: FilterCondition[],
): string {
  const parts = [
    `not exists (select 1 from dismissed_tweet d where d.workspace_id = ${wsParam} and d.tweet_id = t.tweet_id)`,
  ];
  const ids = (columnIds ?? []).filter(isUuidLike);
  if (ids.length > 0) parts.push(`ct.column_id = any(${bag.bind(ids)}::uuid[])`);
  const { clauses, params } = buildFilterSql(filters ?? [], bag.params.length + 1);
  for (const p of params) bag.params.push(p);
  parts.push(...clauses);
  return parts.join(' and ');
}

export async function getWorkspaceTableRows(
  sql: postgres.Sql, workspaceId: string,
  opts: { sort: SortKey; dir?: SortDir; offset?: number; limit?: number; columnIds?: string[]; filters?: FilterCondition[] },
): Promise<TableRow[]> {
  if (!isUuidLike(workspaceId)) return [];
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.min(TABLE_MAX, Math.max(1, Math.floor(opts.limit ?? TABLE_PAGE)));
  const orderExpr = ORDER_EXPR[opts.sort] ?? ORDER_EXPR.views;
  const orderDir = opts.dir === 'asc' ? 'asc nulls first' : 'desc nulls last';
  const bag = paramBag();
  const ws = bag.bind(workspaceId);
  const where = tableWhere(ws, bag, opts.columnIds, opts.filters);
  const rows = await sql.unsafe<TableRowRaw[]>(
    // group by tweet_id: 같은 트윗이 여러 컬럼에 걸리면 행이 늘어나므로 한 행으로 묶는다.
    // order by에 tweet_id를 tie-break로 둬야 페이지 경계에서 행이 중복·누락되지 않는다.
    // limit/offset은 위에서 정수로 sanitize해 리터럴로 넣는다(자리표시자로 넘기면 안 쓰이는 번호가 생긴다).
    `select t.tweet_id, t.author_handle, t.author_name, t.author_followers, t.text,
            t.tweet_created_at, t.metrics, t.last_fetched_at,
            ${columnTitlesSubquery(ws)} as column_titles,
            coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.name)
                        from candidate c join member m on m.id = c.member_id
                       where c.tweet_id = t.tweet_id and c.workspace_id = ${ws}), '[]'::json) as saved_by
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id and dc.workspace_id = ${ws}
       join tweet t on t.tweet_id = ct.tweet_id
      where ${where}
      group by t.tweet_id
      order by ${orderExpr} ${orderDir}, t.tweet_id
      limit ${limit} offset ${offset}`,
    bag.params as never[],
  );
  return rows.map((r) => ({
    tweetId: r.tweet_id,
    columnTitles: r.column_titles ?? [],
    authorHandle: r.author_handle,
    authorName: r.author_name,
    authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
    text: r.text,
    tweetCreatedAt: r.tweet_created_at?.toISOString() ?? null,
    metrics: r.metrics,
    savedBy: r.saved_by ?? [],
    lastFetchedAt: r.last_fetched_at.toISOString(),
  }));
}

export async function getWorkspaceTableCount(
  sql: postgres.Sql, workspaceId: string,
  opts: { columnIds?: string[]; filters?: FilterCondition[] } = {},
): Promise<number> {
  if (!isUuidLike(workspaceId)) return 0;
  const bag = paramBag();
  const ws = bag.bind(workspaceId);
  const where = tableWhere(ws, bag, opts.columnIds, opts.filters);
  const rows = await sql.unsafe<Array<{ n: string }>>(
    // distinct tweet_id — 행 병합과 같은 기준이어야 "전체 N건" 라벨이 실제 행 수와 맞는다.
    `select count(distinct t.tweet_id) as n
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id and dc.workspace_id = ${ws}
       join tweet t on t.tweet_id = ct.tweet_id
      where ${where}`,
    bag.params as never[],
  );
  return Number(rows[0]?.n ?? 0);
}

// 컬럼 드롭다운 목록에 붙이는 건수. 다른 조건은 반영하지 않는다 — 그 컬럼의 전체 건수다(설계 §A).
// 조건마다 12개 컬럼을 다시 세면 조작할 때마다 쿼리가 하나 더 붙는다.
export async function getWorkspaceColumnCounts(
  sql: postgres.Sql, workspaceId: string,
): Promise<Array<{ columnId: string; n: number }>> {
  if (!isUuidLike(workspaceId)) return [];
  const rows = await sql<Array<{ column_id: string; n: string }>>`
    select ct.column_id, count(distinct ct.tweet_id) as n
      from column_tweet ct
      join deck_column dc on dc.id = ct.column_id and dc.workspace_id = ${workspaceId}
     where not exists (select 1 from dismissed_tweet d
                        where d.workspace_id = ${workspaceId} and d.tweet_id = ct.tweet_id)
     group by ct.column_id`;
  return rows.map((r) => ({ columnId: r.column_id, n: Number(r.n) }));
}
