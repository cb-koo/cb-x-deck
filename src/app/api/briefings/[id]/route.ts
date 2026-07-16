import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getBriefing, removeBriefing } from '@/lib/briefingStore';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await getBriefing(getSql(), id);
  if (!row) return NextResponse.json({ error: `briefing not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await removeBriefing(getSql(), id);
  return NextResponse.json({ ok: true });
}
