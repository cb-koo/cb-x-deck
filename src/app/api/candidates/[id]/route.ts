import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { setMemo } from '@/lib/candidateStore';

import { requireAllowedUser } from '@/lib/authGuard';
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const { memo } = await req.json();
  await setMemo(getSql(), id, String(memo ?? ''));
  return NextResponse.json({ ok: true });
}
