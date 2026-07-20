import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { removeTag } from '@/lib/candidateStore';

import { requireAllowedUser } from '@/lib/authGuard';
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; tagId: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id, tagId } = await ctx.params;
  await removeTag(getSql(), id, tagId);
  return NextResponse.json({ ok: true });
}
