import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { listAnalysisTweets } from '@/lib/pillarStore';
import { getTweetsByIds } from '@/lib/tweetStore';
import {
  BRIEFING_WEEKS, briefingPeriod, filterPeriod, computeBriefingStats,
  selectBriefingTweets, generateBriefing, type BriefingTweet,
} from '@/lib/briefing';
import { saveBriefing, listBriefings, getBriefing } from '@/lib/briefingStore';
import { MODEL } from '@/lib/suggest';

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listBriefings(getSql(), workspaceId));
}

export async function POST(req: Request) {
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as { columnId?: string; weeks?: number; memberId?: string | null };
  const weeks = body.weeks as (typeof BRIEFING_WEEKS)[number];
  if (!body.columnId || !BRIEFING_WEEKS.includes(weeks)) {
    return NextResponse.json({ error: 'columnId와 weeks(2·4·8)가 필요해요' }, { status: 400 });
  }
  const col = await getColumn(sql, body.columnId);
  if (!col) return NextResponse.json({ error: `column not found: ${body.columnId}` }, { status: 404 });

  const now = new Date().toISOString();
  const rows = await listAnalysisTweets(sql, col.id, { limit: 2000 });
  // tweet_url은 listAnalysisTweets에 없음 — 트윗 ID로 X 상세 URL 구성(카드의 기존 관행과 동일 포맷)
  const all: BriefingTweet[] = rows.map((r) => ({
    tweetId: r.tweetId, text: r.text, likes: r.likes, createdAt: r.createdAt,
    tweetUrl: `https://x.com/i/status/${r.tweetId}`,
  }));
  const { from, toExclusive } = briefingPeriod(now, weeks);
  const inPeriod = filterPeriod(all, from, toExclusive);
  if (inPeriod.length === 0) {
    return NextResponse.json({ error: '이 기간엔 트윗이 없어요 — 먼저 새로고침하세요' }, { status: 400 });
  }

  const stats = computeBriefingStats(all, now, weeks);
  let content;
  try {
    content = await generateBriefing({ columnTitle: col.title, tweets: selectBriefingTweets(inPeriod), stats });
  } catch {
    return NextResponse.json({ error: '생성 실패 — 다시 시도해주세요' }, { status: 502 });
  }
  if (!content) return NextResponse.json({ error: '생성 실패 — 다시 시도해주세요' }, { status: 502 });

  // 인용을 실트윗 스냅샷으로 하이드레이트 — 근거 트윗 카드(작성자·아바타·지표·미디어) 렌더링용, 저장 시점에 박제
  const cited = await getTweetsByIds(sql, content.citations.map((c) => c.tweetId));
  const byId = new Map(cited.map((t) => [t.tweetId, t]));
  content = { ...content, citations: content.citations.map((c) => ({ ...c, tweet: byId.get(c.tweetId) })) };

  const id = await saveBriefing(sql, {
    workspaceId: col.workspaceId, columnId: col.id,
    periodFrom: stats.periodFrom, periodTo: stats.periodTo,
    sampleSize: stats.totalCount, content, model: MODEL(), memberId: body.memberId ?? null,
  });
  return NextResponse.json(await getBriefing(sql, id));
}
