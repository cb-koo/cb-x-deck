import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { deriveTopics, classifyTweets, MAX_ANALYSIS_TWEETS } from '@/lib/pillar';
import { computePillarStats, type PillarPayload } from '@/lib/pillarStats';
import { getAnalysis, saveAnalysis, addAssignments, listAnalysisTweets } from '@/lib/pillarStore';
import type postgres from 'postgres';

async function payload(sql: postgres.Sql, columnId: string): Promise<PillarPayload> {
  const analysis = await getAnalysis(sql, columnId);
  if (!analysis) return { analysis: null, stats: null, tweetTopics: {}, unassignedCount: 0, samplePeriod: null };
  const tweets = await listAnalysisTweets(sql, columnId, { limit: MAX_ANALYSIS_TWEETS });
  const stats = computePillarStats(
    tweets.map((t) => ({ tweetId: t.tweetId, likes: t.likes, isQuote: t.isQuote, topicId: t.topicId })),
    analysis.topics,
  );
  const classified = tweets.filter((t) => t.topicId !== null);
  const dates = classified.map((t) => t.createdAt).filter((d): d is string => d !== null).sort();
  return {
    analysis: { topics: analysis.topics, sampleSize: analysis.sampleSize, analyzedAt: analysis.analyzedAt },
    stats,
    tweetTopics: Object.fromEntries(classified.map((t) => [t.tweetId, t.topicId!])),
    unassignedCount: tweets.length - classified.length,
    samplePeriod: dates.length ? [dates[0], dates[dates.length - 1]] : null,
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(await payload(getSql(), id));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();
  const col = await getColumn(sql, id);
  if (!col) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });
  if (col.kind !== 'watchlist') return NextResponse.json({ error: '주제 분석은 계정 컬럼 전용입니다' }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === 'incremental' ? 'incremental' : 'full';

  if (mode === 'incremental') {
    const analysis = await getAnalysis(sql, id);
    if (!analysis) return NextResponse.json({ error: '먼저 전체 분석을 실행하세요' }, { status: 400 });
    const unassigned = await listAnalysisTweets(sql, id, { onlyUnassigned: true, limit: MAX_ANALYSIS_TWEETS });
    if (unassigned.length > 0) {
      let asg;
      try {
        asg = await classifyTweets(analysis.topics, unassigned.map((t) => ({ tweetId: t.tweetId, text: t.text })));
      } catch {
        // LLM 예외(타임아웃·429·API 키 부재 등) — 미분류로 남아 무해, addAssignments 미호출
        return NextResponse.json({ error: '분석 실패 — 다시 시도해주세요' }, { status: 502 });
      }
      await addAssignments(sql, id, asg);
    }
    return NextResponse.json(await payload(sql, id));
  }

  const tweets = await listAnalysisTweets(sql, id, { limit: MAX_ANALYSIS_TWEETS });
  if (tweets.length === 0) {
    return NextResponse.json({ error: '분석할 트윗이 없어요 — 먼저 새로고침하세요' }, { status: 400 });
  }
  let derived;
  try {
    derived = await deriveTopics(tweets.map((t) => ({ tweetId: t.tweetId, text: t.text })));
  } catch {
    // LLM 예외(타임아웃·429·API 키 부재 등) — saveAnalysis 미호출로 기존 스냅샷 보존
    return NextResponse.json({ error: '분석 실패 — 다시 시도해주세요' }, { status: 502 });
  }
  // 파싱 실패 시에도 기존 스냅샷을 덮지 않는다 — saveAnalysis 자체를 호출하지 않음
  if (!derived) return NextResponse.json({ error: '분석 실패 — 다시 시도해주세요' }, { status: 502 });
  await saveAnalysis(sql, {
    columnId: id, topics: derived.topics, sampleSize: tweets.length,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
    assignments: derived.assignments,
  });
  return NextResponse.json(await payload(sql, id));
}
