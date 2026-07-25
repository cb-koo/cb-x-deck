import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listLibraryTweets, removeLibraryTweet } from '@/lib/candidateStore';
import { requireMember } from '@/lib/authGuard';

export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listLibraryTweets(getSql(), workspaceId));
}

// 팀 보관함에서 빼기: 트윗의 library_item + 모든 코멘트 삭제(워크스페이스 범위). 허용 멤버 누구나.
export async function DELETE(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId'), tweetId = sp.get('tweetId');
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await removeLibraryTweet(getSql(), { workspaceId, tweetId });
  return NextResponse.json({ ok: true });
}
