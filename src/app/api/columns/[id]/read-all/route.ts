import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { markAllSeen } from '@/lib/tweetStore';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ marked: await markAllSeen(getSql(), id) });
}
