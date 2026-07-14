import type postgres from 'postgres';
import type { CandidateRow, DeckQuoted, DeckTweet } from './types.ts';

async function loadCandidates(
  sql: postgres.Sql,
  where: { id?: string; workspaceId?: string; tag?: string; memberId?: string },
): Promise<CandidateRow[]> {
  const conds: string[] = [];
  const params: string[] = [];
  const add = (fragment: string, value: string) => { params.push(value); conds.push(fragment.replace('?', `$${params.length}`)); };
  if (where.id) add('c.id = ?', where.id);
  if (where.workspaceId) add('c.workspace_id = ?', where.workspaceId);
  if (where.memberId) add('c.member_id = ?', where.memberId);
  if (where.tag) add('exists (select 1 from candidate_tag x join tag g on g.id = x.tag_id where x.candidate_id = c.id and g.name = ?)', where.tag);

  const rows = await sql.unsafe<Array<Record<string, unknown>>>(
    `select c.id, c.memo, c.saved_at, c.source_column_id, c.workspace_id,
            m.id as member_id, m.name as member_name, m.color as member_color,
            t.*, qt.data as quoted_enriched,
            coalesce(json_agg(json_build_object('id', tg.id, 'name', tg.name) order by tg.name)
                     filter (where tg.id is not null), '[]') as tags
       from candidate c
       join member m on m.id = c.member_id
       join tweet t on t.tweet_id = c.tweet_id
       left join quoted_tweet qt on qt.id = t.quoted->>'id' and qt.status = 'ok'
       left join candidate_tag ctg on ctg.candidate_id = c.id
       left join tag tg on tg.id = ctg.tag_id
      ${conds.length ? 'where ' + conds.join(' and ') : ''}
      group by c.id, m.id, t.tweet_id, qt.data
      order by c.saved_at desc`,
    params,
  );
  return rows.map((r) => ({
    id: r.id as string,
    memo: r.memo as string,
    savedAt: (r.saved_at as Date).toISOString(),
    sourceColumnId: r.source_column_id as string | null,
    workspaceId: r.workspace_id as string,
    member: { id: r.member_id as string, name: r.member_name as string, color: r.member_color as string },
    tags: r.tags as CandidateRow['tags'],
    tweet: {
      tweetId: r.tweet_id as string, authorHandle: r.author_handle as string,
      authorName: r.author_name as string | null, authorAvatarUrl: r.author_avatar_url as string | null,
      authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
      text: r.text as string, media: (r.media ?? []) as CandidateRow['tweet']['media'],
      quoted: r.quoted
        ? { ...(r.quoted as DeckQuoted), enriched: (r.quoted_enriched ?? null) as DeckTweet | null }
        : null,
      metrics: r.metrics as CandidateRow['tweet']['metrics'],
      tweetUrl: r.tweet_url as string | null,
      tweetCreatedAt: (r.tweet_created_at as Date | null)?.toISOString() ?? null,
      firstSeenAt: (r.first_seen_at as Date).toISOString(),
      lastFetchedAt: (r.last_fetched_at as Date).toISOString(),
      isNew: false,
      savedBy: [{ id: r.member_id as string, name: r.member_name as string, color: r.member_color as string }],
    },
  }));
}

export async function saveCandidate(
  sql: postgres.Sql,
  input: { tweetId: string; workspaceId: string; memberId: string; sourceColumnId?: string | null },
): Promise<CandidateRow> {
  const [row] = await sql<Array<{ id: string }>>`
    insert into candidate (tweet_id, workspace_id, member_id, source_column_id)
    values (${input.tweetId}, ${input.workspaceId}, ${input.memberId}, ${input.sourceColumnId ?? null})
    on conflict (tweet_id, workspace_id, member_id) do update set tweet_id = excluded.tweet_id
    returning id`;
  return (await loadCandidates(sql, { id: row.id }))[0];
}

export async function removeCandidate(
  sql: postgres.Sql,
  input: { tweetId: string; workspaceId: string; memberId: string },
): Promise<void> {
  await sql`delete from candidate where tweet_id = ${input.tweetId} and workspace_id = ${input.workspaceId} and member_id = ${input.memberId}`;
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

export async function listCandidates(
  sql: postgres.Sql, workspaceId: string, opts?: { tag?: string; memberId?: string },
): Promise<CandidateRow[]> {
  return loadCandidates(sql, { workspaceId, tag: opts?.tag, memberId: opts?.memberId });
}

export async function listAllTags(
  sql: postgres.Sql, workspaceId: string,
): Promise<Array<{ id: string; name: string; count: number }>> {
  const rows = await sql<Array<{ id: string; name: string; count: string }>>`
    select tg.id, tg.name, count(distinct c.tweet_id)::text as count
      from tag tg
      left join candidate_tag ctg on ctg.tag_id = tg.id
      left join candidate c on c.id = ctg.candidate_id and c.workspace_id = ${workspaceId}
     group by tg.id order by tg.name`;
  return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }));
}
