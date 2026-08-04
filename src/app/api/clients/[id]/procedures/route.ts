import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { createProcedure } from '@/lib/clientStore';
import { requireMember } from '@/lib/authGuard';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as
    { name?: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] };
  if (!body.name?.trim()) return NextResponse.json({ error: '시술 이름이 필요해요' }, { status: 400 });
  return NextResponse.json(await createProcedure(getSql(), id, { ...body, name: body.name.trim() }));
}
