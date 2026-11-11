import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listOtherKinds } from '@/lib/campaignTaskStore';

// 기타 협찬(088)의 '무엇을 했는지' 추천 — 전에 쓴 말, 많이 쓴 순(koo 11-06 결정 2). 별도 표 없이 작업에서 모은다.
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listOtherKinds(getSql()));
}
