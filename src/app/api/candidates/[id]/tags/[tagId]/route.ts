import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { removeTag } from '@/lib/candidateStore';

import { requireMember } from '@/lib/authGuard';
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; tagId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, tagId } = await ctx.params;
  const ok = await removeTag(getSql(), id, tagId, gate.member.id);
  if (!ok) return NextResponse.json({ error: '내 후보가 아니거나 없습니다' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
