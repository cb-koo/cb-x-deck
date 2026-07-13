import type postgres from 'postgres';
import type { DeckTweet } from './types.ts';

// 인용 트윗 보강 캐시 (quoted_tweet 테이블) — ID당 평생 1회 조회 원칙.
// status='missing'은 삭제·비공개 tombstone: 재조회 대상에서 영구 제외.

export async function missingQuotedIds(sql: postgres.Sql, ids: string[]): Promise<string[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const rows = await sql<{ id: string }[]>`
    select u.id from unnest(${uniq}::text[]) as u(id)
    where not exists (select 1 from quoted_tweet q where q.id = u.id)`;
  return rows.map((r) => r.id);
}

export async function upsertQuoted(sql: postgres.Sql, id: string, tweet: DeckTweet | null): Promise<void> {
  await sql`
    insert into quoted_tweet (id, status, data)
    values (${id}, ${tweet ? 'ok' : 'missing'}, ${tweet ? sql.json(tweet as never) : null})
    on conflict (id) do update set status = excluded.status, data = excluded.data, fetched_at = now()`;
}

export async function getQuotedMap(sql: postgres.Sql, ids: string[]): Promise<Record<string, DeckTweet>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return {};
  const rows = await sql<{ id: string; data: DeckTweet }[]>`
    select id, data from quoted_tweet where id = any(${uniq}::text[]) and status = 'ok'`;
  return Object.fromEntries(rows.map((r) => [r.id, r.data]));
}
