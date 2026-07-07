import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumnTweets } from '@/lib/tweetStore';
import type { SortKey, ViewMode } from '@/lib/types';

const SORTS = new Set(['views', 'date', 'bookmarks', 'retweets']);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const sort = (url.searchParams.get('sort') ?? 'views') as SortKey;
  const mode = (url.searchParams.get('mode') ?? 'new') as ViewMode;
  if (!SORTS.has(sort)) return NextResponse.json({ error: 'bad sort' }, { status: 400 });
  return NextResponse.json(await getColumnTweets(getSql(), id, { sort, mode: mode === 'all' ? 'all' : 'new' }));
}
