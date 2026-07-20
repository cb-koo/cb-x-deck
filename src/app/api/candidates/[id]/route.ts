import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { setMemo } from '@/lib/candidateStore';

import { requireMember } from '@/lib/authGuard';
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const { memo } = await req.json();
  const ok = await setMemo(getSql(), id, String(memo ?? ''), gate.member.id);
  if (!ok) return NextResponse.json({ error: '내 후보가 아니거나 없습니다' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
