import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { removeTag } from '@/lib/candidateStore';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; tagId: string }> }) {
  const { id, tagId } = await ctx.params;
  await removeTag(getSql(), id, tagId);
  return NextResponse.json({ ok: true });
}
