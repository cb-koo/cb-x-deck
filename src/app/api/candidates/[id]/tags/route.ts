import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { addTag } from '@/lib/candidateStore';

import { requireMember } from '@/lib/authGuard';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name 필수' }, { status: 400 });
  const tag = await addTag(getSql(), id, name, gate.member.id);
  if (!tag) return NextResponse.json({ error: '내 후보가 아니거나 없습니다' }, { status: 404 });
  return NextResponse.json(tag, { status: 201 });
}
