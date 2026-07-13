import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { markSeenBatch } from '@/lib/tweetStore';

export async function POST(req: Request) {
  const { memberId, tweetIds } = await req.json().catch(() => ({}));
  if (typeof memberId !== 'string' || !Array.isArray(tweetIds) || tweetIds.some((t) => typeof t !== 'string')) {
    return NextResponse.json({ error: 'memberId·tweetIds(string[]) 필수' }, { status: 400 });
  }
  const marked = await markSeenBatch(getSql(), memberId, tweetIds.slice(0, 500));
  return NextResponse.json({ marked });
}
