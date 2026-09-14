import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { sanitizeSettlementSettings } from '@/lib/settlementSettings';
import { getSettlementSettings, saveSettlementSettings, listSettlementVersions } from '@/lib/settlementStore';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const [settings, versions] = await Promise.all([getSettlementSettings(sql), listSettlementVersions(sql, 5)]);
  return NextResponse.json({ settings, versions });
}

export async function PUT(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { settings?: unknown };
  const clean = sanitizeSettlementSettings(body.settings);
  if (typeof clean === 'string') return NextResponse.json({ error: clean }, { status: 400 });
  await saveSettlementSettings(getSql(), clean, gate.member.id);   // 저장자 = 서버가 해석한 멤버(프롬프트 설정 관례)
  return NextResponse.json({ settings: clean });
}
