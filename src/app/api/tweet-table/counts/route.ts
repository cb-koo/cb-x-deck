import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceColumnCounts, getWorkspaceTableCount } from '@/lib/tweetStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 열 드롭다운에 붙이는 열별 건수. 워크스페이스가 바뀔 때만 부르면 된다 —
// 다른 조건을 반영하지 않으므로 조건이 바뀌어도 다시 부를 필요가 없다(설계 §A).
// total: 필터·열 선택과 무관한 워크스페이스 전체 수집 건수(A1) — "이미 모은 N건 중에서만 걸러요"가
// 필터링 결과가 아니라 실제로 모은 풀의 크기를 말하려면 이 값이 필요하다. 이 라우트가 워크스페이스당
// 정확히 한 번만 불리는 자리라 opts 없는 getWorkspaceTableCount를 여기 얹는다.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
  const sql = getSql();
  const [counts, total] = await Promise.all([
    getWorkspaceColumnCounts(sql, workspaceId),
    getWorkspaceTableCount(sql, workspaceId),
  ]);
  return NextResponse.json({ counts, total });
}
