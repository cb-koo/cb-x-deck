import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listInfluencerPerformance } from '@/lib/influencerPerformanceStore';
import { summarizeInfluencer } from '@/lib/influencerPerformance';

// 인플루언서 성과 비교(스펙 §7) — 워크스페이스 무관(명부와 같은 최상위). 읽기 전용.
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const inputs = await listInfluencerPerformance(getSql());
  return NextResponse.json(inputs.map(summarizeInfluencer));
}
