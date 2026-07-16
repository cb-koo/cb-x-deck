import type postgres from 'postgres';
import type { Member } from './types.ts';

export interface ScoutInput {
  workspaceId: string;
  handle: string;
  name?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  followers?: number | null;
  verified?: boolean;
  sourceTweetId?: string | null;
  memberId?: string | null;
}

export interface ScoutRow {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  followers: number | null;
  verified: boolean;
  sourceTweetId: string | null;
  sourceTweetUrl: string | null;
  savedAt: string;
  member: Member | null;
}

// sourceTweetId가 tweet에 없으면 FK 위반 — 존재하는 것만 참조하도록 서브쿼리로 soft화
export async function saveScout(sql: postgres.Sql, input: ScoutInput): Promise<void> {
  await sql`
    insert into scout_account (workspace_id, handle, name, avatar_url, bio, followers, verified, source_tweet_id, saved_by)
    values (
      ${input.workspaceId}, ${input.handle}, ${input.name ?? null}, ${input.avatarUrl ?? null}, ${input.bio ?? null},
      ${input.followers ?? null}, ${input.verified ?? false},
      (select tweet_id from tweet where tweet_id = ${input.sourceTweetId ?? null}),
      ${input.memberId ?? null}
    )
    on conflict (workspace_id, handle) do update set
      name = excluded.name, avatar_url = excluded.avatar_url, bio = excluded.bio,
      followers = excluded.followers, verified = excluded.verified`;
}

export async function removeScout(sql: postgres.Sql, a: { workspaceId: string; handle: string }): Promise<void> {
  await sql`delete from scout_account where workspace_id = ${a.workspaceId} and handle = ${a.handle}`;
}

export async function listScouts(sql: postgres.Sql, workspaceId: string): Promise<ScoutRow[]> {
  const rows = await sql<Array<{
    handle: string; name: string | null; avatar_url: string | null; bio: string | null;
    followers: number | null; verified: boolean;
    source_tweet_id: string | null; source_tweet_url: string | null;
    saved_at: Date;
    member_id: string | null; member_name: string | null; member_color: string | null;
  }>>`
    select s.handle, s.name, s.avatar_url, s.bio, s.followers, s.verified,
           s.source_tweet_id, t.tweet_url as source_tweet_url, s.saved_at,
           m.id as member_id, m.name as member_name, m.color as member_color
      from scout_account s
      left join member m on m.id = s.saved_by
      left join tweet t on t.tweet_id = s.source_tweet_id
     where s.workspace_id = ${workspaceId}
     order by s.saved_at desc`;
  return rows.map((r) => ({
    handle: r.handle,
    name: r.name,
    avatarUrl: r.avatar_url,
    bio: r.bio,
    followers: r.followers,
    verified: r.verified,
    sourceTweetId: r.source_tweet_id,
    sourceTweetUrl: r.source_tweet_url,
    savedAt: r.saved_at.toISOString(),
    member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  }));
}

export async function listScoutHandles(sql: postgres.Sql, workspaceId: string): Promise<string[]> {
  const rows = await sql<Array<{ handle: string }>>`
    select handle from scout_account where workspace_id = ${workspaceId}`;
  return rows.map((r) => r.handle);
}
