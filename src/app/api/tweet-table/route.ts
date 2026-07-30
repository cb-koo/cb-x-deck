import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceTableRows, getWorkspaceTableCount } from '@/lib/tweetStore';
import { TABLE_MAX, TABLE_PAGE } from '@/lib/tableLimits';
import { requireAllowedUser } from '@/lib/authGuard';
import type { SortKey } from '@/lib/types';

// 표 보기는 지표 6종 + 날짜로 정렬한다(덱 컬럼은 4종만 — sortKeys.ts의 DECK_SORTS).
const SORTS: SortKey[] = ['views', 'date', 'bookmarks', 'retweets', 'likes', 'replies', 'quotes'];

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId') ?? '';
  const sort = (SORTS.includes(sp.get('sort') as SortKey) ? sp.get('sort') : 'views') as SortKey;
  const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0);
  const limit = Math.min(TABLE_MAX, Math.max(1, parseInt(sp.get('limit') ?? String(TABLE_PAGE), 10) || TABLE_PAGE));
  const columnId = sp.get('columnId') || undefined;
  const sql = getSql();
  const [rows, total] = await Promise.all([
    getWorkspaceTableRows(sql, workspaceId, { sort, dir, offset, limit, columnId }),
    getWorkspaceTableCount(sql, workspaceId, { columnId }),
  ]);
  return NextResponse.json({ rows, total });
}
