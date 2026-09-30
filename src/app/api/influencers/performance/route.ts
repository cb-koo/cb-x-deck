import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listInfluencerPerformance } from '@/lib/influencerPerformanceStore';

// 인플루언서 성과 비교(스펙 §7) — 워크스페이스 무관(명부와 같은 최상위). 읽기 전용.
// 요약 전의 인플별 작업을 그대로 내려준다 — 기간·클라이언트·유형 필터는 작업을 거른 뒤 다시 집계해야 해서(스펙 §15-3)
// 화면이 buildFilteredRows로 거르고 요약한다. 게시된 작업이 있는 인플만 남기는 것도 거기서(§12-3).
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listInfluencerPerformance(getSql()));
}
