import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { kstToday } from '@/lib/datetime';
import { getSettlementSettings, listCandidates } from '@/lib/settlementStore';

// 후보는 저장하지 않고 계산한다(§2-4). requireMember — 요청자 최근 인용RT 분류(§3-3)에 멤버가 필요하다.
export async function GET() {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const settings = await getSettlementSettings(sql);
  const today = kstToday();
  const candidates = await listCandidates(sql, settings, gate.member.id, today);
  return NextResponse.json({ candidates, settings, today });
}
