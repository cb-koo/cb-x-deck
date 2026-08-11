import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listInfluencerHandles } from '@/lib/draftStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 배정된 적 있는 핸들 전체 — 자동완성 후보. 읽기 전용이므로 /api/drafts GET과 동일 등급 게이트.
// 이 라우트가 미래의 교체 지점이다: 인플루언서 목록 DB가 생기면 조회 대상만 바뀐다(URL·응답 형태·호출부는 그대로).
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listInfluencerHandles(getSql()));
}
