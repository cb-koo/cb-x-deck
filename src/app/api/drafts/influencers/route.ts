import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listOptions } from '@/lib/influencerStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 배정 자동완성 후보 — 읽기 전용이므로 /api/drafts GET과 동일 등급 게이트.
// 명부 테이블 조회 — 2026-08-13 스펙으로 교체 완료.
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listOptions(getSql()));
}
