import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumnTweets } from '@/lib/tweetStore';
import type { SortKey } from '@/lib/types';

const SORTS: SortKey[] = ['views', 'date', 'bookmarks', 'retweets'];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const sort = (SORTS.includes(sp.get('sort') as SortKey) ? sp.get('sort') : 'views') as SortKey;
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
  return NextResponse.json(await getColumnTweets(getSql(), id, { sort, offset }));
}
