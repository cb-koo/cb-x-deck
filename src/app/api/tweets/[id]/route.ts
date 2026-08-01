import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceTweet } from '@/lib/tweetStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 표 보기에서 행을 눌렀을 때 카드에 필요한 한 건. 표 목록 API(/api/tweet-table)는 CSV가
// 최대 5,000행을 받는 경로라 카드용 데이터를 싣지 않는다 — 그래서 여기서 따로 받는다.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  const tweet = await getWorkspaceTweet(getSql(), workspaceId, id);
  if (!tweet) return NextResponse.json({ error: `tweet not found: ${id}` }, { status: 404 });
  return NextResponse.json({ tweet });
}
