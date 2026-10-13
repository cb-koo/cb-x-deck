import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { setAutoSend } from '@/lib/settlementAutoStore';

// 자동 전송 켜기/끄기(2026-10-13 koo) — 정산 설정 탭의 스위치. 예약 실행은 그대로 돌고, 꺼져 있으면 아무것도 보내지 않는다.
// 행 버튼([보내기]·[바로 보내기])은 스위치와 상관없이 된다.
export async function PUT(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: '켜기·끄기 값이 필요해요' }, { status: 400 });
  const sw = await setAutoSend(getSql(), body.enabled, { id: gate.member.id, name: gate.member.name });
  return NextResponse.json({ autoSend: sw });
}
