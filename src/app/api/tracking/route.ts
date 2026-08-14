import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { fetchPost } from '@/lib/postMetrics';
import { addTrackedPost, findByTweetId, listTrackedPosts } from '@/lib/trackingStore';

const UNAVAILABLE = '볼 수 없는 게시물이에요 — 삭제됐거나 비공개일 수 있어요';
const FETCH_FAILED = '지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listTrackedPosts(getSql()));
}

// 등록 = 첫 측정. 링크는 서버에서 재검증한다 — 클라이언트 인라인 검증만 믿지 않는다(같은 파서).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };

  const parsed = parseTweetLink(String(body.url ?? ''));
  if (!parsed.ok) return NextResponse.json({ error: tweetLinkParseMessage(parsed.reason) }, { status: 400 });

  // 이미 추적 중이면 오류가 아니라 정보 — 기존 행을 돌려주고 API 콜도 아낀다(influencers POST 관례).
  const existing = await findByTweetId(sql, parsed.tweetId);
  if (existing) return NextResponse.json({ created: false, row: existing });

  const result = await fetchPost(parsed.tweetId);
  if (result.kind === 'unavailable') return NextResponse.json({ error: UNAVAILABLE }, { status: 404 });
  if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });

  const { created, row } = await addTrackedPost(sql, {
    tweetId: result.post.tweetId, authorHandle: result.post.authorHandle,
    text: result.post.text, postedAt: result.post.postedAt,
    createdBy: gate.member.id, metrics: result.post.metrics, raw: result.post.raw,
  });
  return NextResponse.json({ created, row });
}
