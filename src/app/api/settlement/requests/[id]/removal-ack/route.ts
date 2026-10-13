import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { ackRemoval } from '@/lib/settlementAutoStore';

// 보낸 뒤 글이 내려감 → [그대로 두기](스펙 2026-10-12 §2-7). 기록만 하고 정산팀 폴링 시각은 바꾸지 않는다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const ok = await ackRemoval(getSql(), id, { name: gate.member.name });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: '이미 확인했거나 취소된 요청이에요' }, { status: 409 });
}
