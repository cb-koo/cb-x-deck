import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { getAnalysis, listAnalysisTweets } from '@/lib/pillarStore';
import { computeWeeklyTrend, computeTopicTrend, type TrendPayload, type TopicTrendRow } from '@/lib/trend';

import { requireAllowedUser } from '@/lib/authGuard';
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
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
  // 상한 도달 = 오래된 주가 잘렸을 수 있음(최신순 로드) — 가짜 ▲ 방지용으로 화면에 안내
  const payload: TrendPayload = { ...base, topicTrends, capped: tweets.length >= 2000 };
  return NextResponse.json(payload);
}
