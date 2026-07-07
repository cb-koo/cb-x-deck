import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { markSeen } from '@/lib/tweetStore';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await markSeen(getSql(), id);
  return NextResponse.json({ ok: true });
}
