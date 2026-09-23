import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { loadTweetPreview, TweetFetchError } from '@/lib/tweetPreview';

// 인용·RT 대상 미리보기(설계 §7-1) — 게시물 한 건. X 조회는 캐시에 없을 때만(게시물당 처음 한 번).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const url = new URL(req.url).searchParams.get('url') ?? '';
  try {
    return NextResponse.json(await loadTweetPreview(getSql(), url));
  } catch (e) {
    // X 조회 실패만 502로 안내한다 — DB 오류 등 그 밖의 예외는 그대로 던져 500으로 표면화한다.
    if (e instanceof TweetFetchError) {
      return NextResponse.json({ error: '게시물을 확인하지 못했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
    }
    throw e;
  }
}
