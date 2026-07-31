import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceColumnCounts } from '@/lib/tweetStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 열 드롭다운에 붙이는 열별 건수. 워크스페이스가 바뀔 때만 부르면 된다 —
// 다른 조건을 반영하지 않으므로 조건이 바뀌어도 다시 부를 필요가 없다(설계 §A).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
  const counts = await getWorkspaceColumnCounts(getSql(), workspaceId);
  return NextResponse.json({ counts });
}
