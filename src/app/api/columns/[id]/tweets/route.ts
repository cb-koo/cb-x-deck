import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumnTweets } from '@/lib/tweetStore';
import type { SortKey } from '@/lib/types';

import { requireAllowedUser } from '@/lib/authGuard';
const SORTS: SortKey[] = ['views', 'date', 'bookmarks', 'retweets'];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const sort = (SORTS.includes(sp.get('sort') as SortKey) ? sp.get('sort') : 'views') as SortKey;
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
  const dismissed = sp.get('dismissed') === 'only' ? 'only' : 'exclude';
  return NextResponse.json(await getColumnTweets(getSql(), id, { sort, offset, dismissed }));
}
