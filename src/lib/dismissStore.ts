import type postgres from 'postgres';

export async function dismiss(sql: postgres.Sql, a: { workspaceId: string; tweetId: string; memberId?: string | null }): Promise<void> {
  await sql`insert into dismissed_tweet (workspace_id, tweet_id, dismissed_by)
            values (${a.workspaceId}, ${a.tweetId}, ${a.memberId ?? null})
            on conflict (workspace_id, tweet_id) do nothing`;
}

export async function undismiss(sql: postgres.Sql, a: { workspaceId: string; tweetId: string }): Promise<void> {
  await sql`delete from dismissed_tweet where workspace_id = ${a.workspaceId} and tweet_id = ${a.tweetId}`;
}

export async function listDismissed(sql: postgres.Sql, workspaceId: string): Promise<string[]> {
  const rows = await sql<{ tweet_id: string }[]>`select tweet_id from dismissed_tweet where workspace_id = ${workspaceId}`;
  return rows.map((r) => r.tweet_id);
}
