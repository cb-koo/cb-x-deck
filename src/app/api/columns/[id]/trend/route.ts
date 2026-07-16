import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { getAnalysis, listAnalysisTweets } from '@/lib/pillarStore';
import { computeWeeklyTrend, computeTopicTrend, type TrendPayload, type TopicTrendRow } from '@/lib/trend';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();
  const col = await getColumn(sql, id);
  if (!col) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });

  const now = new Date().toISOString();
  const tweets = await listAnalysisTweets(sql, id, { limit: 2000 }); // 추이 창(12주+)을 덮는 상한
  const base = computeWeeklyTrend(tweets, now);

  let topicTrends: TopicTrendRow[] | null = null;
  if (col.kind === 'watchlist') {
    const analysis = await getAnalysis(sql, id);
    if (analysis) topicTrends = computeTopicTrend(tweets, analysis.topics, now);
  }
  const payload: TrendPayload = { ...base, topicTrends };
  return NextResponse.json(payload);
}
