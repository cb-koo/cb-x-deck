import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { updateProcedure, deleteProcedure } from '@/lib/clientStore';
import { requireMember } from '@/lib/authGuard';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as
    { name?: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] };
  if (body.name !== undefined) {
    body.name = body.name?.trim();
    if (!body.name) return NextResponse.json({ error: '시술 이름은 비울 수 없어요' }, { status: 400 });
  }
  await updateProcedure(getSql(), id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await deleteProcedure(getSql(), id);
  return NextResponse.json({ ok: true });
}
