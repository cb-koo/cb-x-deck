import type postgres from 'postgres';
import type { CandidateRow } from './types.ts';

async function loadCandidates(sql: postgres.Sql, where: { id?: string; tag?: string }): Promise<CandidateRow[]> {
  const rows = await sql.unsafe<Array<Record<string, never>>>(
    `select c.id, c.memo, c.saved_at, c.source_column_id,
            t.*,
            coalesce(json_agg(json_build_object('id', tg.id, 'name', tg.name) order by tg.name)
                     filter (where tg.id is not null), '[]') as tags
       from candidate c
       join tweet t on t.tweet_id = c.tweet_id
       left join candidate_tag ctg on ctg.candidate_id = c.id
       left join tag tg on tg.id = ctg.tag_id
      ${where.id ? 'where c.id = $1' : where.tag ? `where exists (select 1 from candidate_tag x join tag g on g.id = x.tag_id where x.candidate_id = c.id and g.name = $1)` : ''}
      group by c.id, t.tweet_id
      order by c.saved_at desc`,
    where.id ? [where.id] : where.tag ? [where.tag] : [],
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    memo: r.memo as string,
    savedAt: (r.saved_at as Date).toISOString(),
    sourceColumnId: (r.source_column_id as string | null),
    tags: r.tags as CandidateRow['tags'],
    tweet: {
      tweetId: r.tweet_id as string, authorHandle: r.author_handle as string,
      authorName: r.author_name as string | null, authorAvatarUrl: r.author_avatar_url as string | null,
      authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
      text: r.text as string, media: (r.media ?? []) as CandidateRow['tweet']['media'],
      quoted: r.quoted as CandidateRow['tweet']['quoted'], metrics: r.metrics as CandidateRow['tweet']['metrics'],
      tweetUrl: r.tweet_url as string | null,
      tweetCreatedAt: (r.tweet_created_at as Date | null)?.toISOString() ?? null,
      firstSeenAt: (r.first_seen_at as Date).toISOString(),
      lastFetchedAt: (r.last_fetched_at as Date).toISOString(),
      seenAt: (r.seen_at as Date | null)?.toISOString() ?? null,
      isCandidate: true,
    },
  }));
}

export async function saveCandidate(sql: postgres.Sql, tweetId: string, sourceColumnId?: string | null): Promise<CandidateRow> {
  const [row] = await sql<Array<{ id: string }>>`
    insert into candidate (tweet_id, source_column_id) values (${tweetId}, ${sourceColumnId ?? null})
    on conflict (tweet_id) do update set tweet_id = excluded.tweet_id
    returning id`;
  return (await loadCandidates(sql, { id: row.id }))[0];
}

export async function removeCandidateByTweetId(sql: postgres.Sql, tweetId: string): Promise<void> {
  await sql`delete from candidate where tweet_id = ${tweetId}`;
}

export async function setMemo(sql: postgres.Sql, candidateId: string, memo: string): Promise<void> {
  await sql`update candidate set memo = ${memo} where id = ${candidateId}`;
}

export async function addTag(sql: postgres.Sql, candidateId: string, name: string): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  const [tag] = await sql<Array<{ id: string; name: string }>>`
    insert into tag (name) values (${trimmed})
    on conflict (name) do update set name = excluded.name
    returning id, name`;
  await sql`insert into candidate_tag (candidate_id, tag_id) values (${candidateId}, ${tag.id}) on conflict do nothing`;
  return tag;
}

export async function removeTag(sql: postgres.Sql, candidateId: string, tagId: string): Promise<void> {
  await sql`delete from candidate_tag where candidate_id = ${candidateId} and tag_id = ${tagId}`;
}

export async function listCandidates(sql: postgres.Sql, opts?: { tag?: string }): Promise<CandidateRow[]> {
  return loadCandidates(sql, { tag: opts?.tag });
}

export async function listAllTags(sql: postgres.Sql): Promise<Array<{ id: string; name: string; count: number }>> {
  const rows = await sql<Array<{ id: string; name: string; count: string }>>`
    select tg.id, tg.name, count(ctg.candidate_id)::text as count
      from tag tg left join candidate_tag ctg on ctg.tag_id = tg.id
     group by tg.id order by tg.name`;
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }));
}
