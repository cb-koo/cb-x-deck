import type postgres from 'postgres';
import type { Assignment, PillarTopic } from './pillarTypes.ts';

export interface PillarAnalysisRow {
  columnId: string;
  topics: PillarTopic[];
  sampleSize: number;
  model: string | null;
  analyzedAt: string; // ISO
}

export interface AnalysisTweet {
  tweetId: string;
  text: string;
  likes: number | null;
  isQuote: boolean;
  createdAt: string | null; // ISO
  topicId: string | null;   // null = 미분류
}

// 전체 분석 결과 저장 — 스냅샷·배정을 트랜잭션으로 통째 교체 (실패 시 기존 분석 무손상)
export async function saveAnalysis(
  sql: postgres.Sql,
  a: { columnId: string; topics: PillarTopic[]; sampleSize: number; model: string | null; assignments: Assignment[] },
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      insert into pillar_analysis (column_id, topics, sample_size, model, analyzed_at)
      values (${a.columnId}, ${tx.json(a.topics as never)}, ${a.sampleSize}, ${a.model}, now())
      on conflict (column_id) do update set
        topics = excluded.topics, sample_size = excluded.sample_size,
        model = excluded.model, analyzed_at = now()`;
    await tx`delete from tweet_topic where column_id = ${a.columnId}`;
    for (const as of a.assignments) {
      await tx`insert into tweet_topic (column_id, tweet_id, topic_id)
               values (${a.columnId}, ${as.tweetId}, ${as.topicId}) on conflict do nothing`;
    }
  });
}

export async function addAssignments(sql: postgres.Sql, columnId: string, assignments: Assignment[]): Promise<void> {
  for (const a of assignments) {
    await sql`insert into tweet_topic (column_id, tweet_id, topic_id)
              values (${columnId}, ${a.tweetId}, ${a.topicId}) on conflict do nothing`;
  }
}

export async function getAnalysis(sql: postgres.Sql, columnId: string): Promise<PillarAnalysisRow | null> {
  const rows = await sql<Array<{ topics: PillarTopic[]; sample_size: number; model: string | null; analyzed_at: Date }>>`
    select topics, sample_size, model, analyzed_at from pillar_analysis where column_id = ${columnId}`;
  const r = rows[0];
  if (!r) return null;
  return { columnId, topics: r.topics, sampleSize: r.sample_size, model: r.model, analyzedAt: r.analyzed_at.toISOString() };
}

type AnalysisRow = {
  tweet_id: string; text: string; likes: string | number | null;
  is_quote: boolean; tweet_created_at: Date | null; topic_id: string | null;
};

// 분석 대상 트윗 — 버림(dismissed) 제외, 최신순, 기본 상한 500
export async function listAnalysisTweets(
  sql: postgres.Sql, columnId: string, opts?: { onlyUnassigned?: boolean; limit?: number },
): Promise<AnalysisTweet[]> {
  const rows = await sql.unsafe<AnalysisRow[]>(
    `select t.tweet_id, t.text, (t.metrics->>'likes')::bigint as likes,
            (t.quoted is not null) as is_quote, t.tweet_created_at, tt.topic_id
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id
       join tweet t on t.tweet_id = ct.tweet_id
       left join tweet_topic tt on tt.column_id = ct.column_id and tt.tweet_id = t.tweet_id
      where ct.column_id = $1
        and not exists (select 1 from dismissed_tweet d
                         where d.workspace_id = dc.workspace_id and d.tweet_id = t.tweet_id)
        ${opts?.onlyUnassigned ? 'and tt.topic_id is null' : ''}
      order by t.tweet_created_at desc nulls last, t.tweet_id
      limit $2`,
    [columnId, opts?.limit ?? 500],
  );
  return rows.map((r) => ({
    tweetId: r.tweet_id, text: r.text,
    likes: r.likes === null ? null : Number(r.likes),
    isQuote: r.is_quote,
    createdAt: r.tweet_created_at?.toISOString() ?? null,
    topicId: r.topic_id,
  }));
}
