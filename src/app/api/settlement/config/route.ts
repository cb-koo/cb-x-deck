import { NextResponse } from 'next/server';
import { requireAllowedUser } from '@/lib/authGuard';
import { isRevisionV2 } from '@/lib/settlementRevisionFlag';

// 정산 화면 설정값 — 클라이언트 컴포넌트는 환경 변수를 못 읽으므로 스위치 상태를 여기서 받는다(스펙 2026-09-07 §2).
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json({ revisionV2: isRevisionV2() }, { headers: { 'Cache-Control': 'no-store' } });
}
