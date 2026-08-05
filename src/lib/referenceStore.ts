import type postgres from 'postgres';
import type { DeckMedia, DeckMetrics } from './types.ts';

const EMPTY_METRICS: DeckMetrics = { views: null, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null };

// 보관함 전역 읽기 — 레퍼런스 선택용 (스펙 §2 /api/references, 보관함 구조 A안).
// 트윗 본체(tweet)는 전역 PK이므로 워크스페이스 간 병합은 소속(library_item)·메모(candidate) 차원에서만 일어난다.
export interface ReferenceRow {
  tweetId: string; authorHandle: string; authorName: string | null; authorAvatarUrl: string | null;
  text: string; media: DeckMedia[]; likes: number | null; metrics: DeckMetrics;
  memos: Array<{ member: string; text: string }>;
  tags: string[];
  workspaces: Array<{ id: string; name: string }>;
  addedAt: string;
}

type ItemRow = {
  tweet_id: string; added_at: Date; workspace_id: string; workspace_name: string;
  author_handle: string; author_name: string | null; author_avatar_url: string | null;
  text: string; media: DeckMedia[] | null; likes: number | null; metrics: DeckMetrics | null;
};
type CandRow = { tweet_id: string; memo: string; member_name: string; tags: string[] };

async function fetchRows(
  sql: postgres.Sql,
  scope: 'all' | { workspaceId: string },
  tweetIds: string[] | null,
): Promise<ReferenceRow[]> {
  const wsItems = scope === 'all' ? sql`true` : sql`li.workspace_id = ${scope.workspaceId}`;
  const idFilter = tweetIds ? sql`li.tweet_id in ${sql(tweetIds)}` : sql`true`;
  const items = await sql<ItemRow[]>`
    select li.tweet_id, li.added_at, li.workspace_id, w.name as workspace_name,
           t.author_handle, t.author_name, t.author_avatar_url, t.text, t.media, t.metrics,
           nullif(t.metrics->>'likes', '')::int as likes
      from library_item li
      join tweet t on t.tweet_id = li.tweet_id
      join workspace w on w.id = li.workspace_id
     where ${wsItems} and ${idFilter}
     order by li.added_at desc`;
  if (items.length === 0) return [];

  const ids = [...new Set(items.map((r) => r.tweet_id))];
  const wsCands = scope === 'all' ? sql`true` : sql`c.workspace_id = ${scope.workspaceId}`;
  const cands = await sql<CandRow[]>`
    select c.tweet_id, c.memo, m.name as member_name,
           coalesce(array_agg(tg.name) filter (where tg.name is not null), '{}') as tags
      from candidate c
      join member m on m.id = c.member_id
      left join candidate_tag ct on ct.candidate_id = c.id
      left join tag tg on tg.id = ct.tag_id
     where c.tweet_id in ${sql(ids)} and ${wsCands}
     group by c.id, m.name
     order by c.saved_at`;

  const byTweet = new Map<string, ReferenceRow>();
  for (const r of items) {
    const cur = byTweet.get(r.tweet_id);
    if (cur) { cur.workspaces.push({ id: r.workspace_id, name: r.workspace_name }); continue; }
    byTweet.set(r.tweet_id, {
      tweetId: r.tweet_id, authorHandle: r.author_handle, authorName: r.author_name,
      authorAvatarUrl: r.author_avatar_url, text: r.text, media: r.media ?? [],
      likes: r.likes, metrics: r.metrics ?? EMPTY_METRICS,
      memos: [], tags: [], workspaces: [{ id: r.workspace_id, name: r.workspace_name }],
      addedAt: r.added_at.toISOString(),
    });
  }
  for (const c of cands) {
    const row = byTweet.get(c.tweet_id);
    if (!row) continue;
    if (c.memo.trim()) row.memos.push({ member: c.member_name, text: c.memo });
    for (const t of c.tags) if (!row.tags.includes(t)) row.tags.push(t);
  }
  // 메모 있는 것 우선(메모=teaching note가 생성 품질에 직접 기여), 그 안에서 최근 저장순
  return [...byTweet.values()].sort((a, b) =>
    (b.memos.length > 0 ? 1 : 0) - (a.memos.length > 0 ? 1 : 0) || b.addedAt.localeCompare(a.addedAt));
}

export async function listReferences(
  sql: postgres.Sql,
  opts: { scope: 'all' | { workspaceId: string }; tag?: string },
): Promise<ReferenceRow[]> {
  const rows = await fetchRows(sql, opts.scope, null);
  return opts.tag ? rows.filter((r) => r.tags.includes(opts.tag as string)) : rows;
}

export async function getReferencesByIds(sql: postgres.Sql, tweetIds: string[]): Promise<ReferenceRow[]> {
  if (tweetIds.length === 0) return [];
  return fetchRows(sql, 'all', tweetIds);
}
