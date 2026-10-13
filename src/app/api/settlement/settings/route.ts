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
  // 자동 전송 스위치는 이 저장으로 바뀌지 않는다 — 화면이 오래된 값을 들고 [저장]해도 스위치를 되돌리지 않게 서버 값을 그대로 잇는다
  const sql = getSql();
  const cur = await getSettlementSettings(sql);
  const next = cur.autoSend ? { ...clean, autoSend: cur.autoSend } : { categories: clean.categories, rateKrwPerJpy: clean.rateKrwPerJpy };
  await saveSettlementSettings(sql, next, gate.member.id);   // 저장자 = 서버가 해석한 멤버(프롬프트 설정 관례)
  return NextResponse.json({ settings: next });
}
