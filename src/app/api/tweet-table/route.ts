import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceTableRows, getWorkspaceTableCount } from '@/lib/tweetStore';
import { parseFilters, type FilterCondition } from '@/lib/tableFilter';
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
  // 쉼표로 구분한 uuid 목록. 형식 검증은 store가 isUuidLike로 한다.
  const columnIds = (sp.get('columnIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // 잘못된 JSON은 필터 없음으로 떨어진다 — 화면이 에러로 죽는 것보다 낫다.
  let filters: FilterCondition[] | undefined = undefined;
  const rawFilters = sp.get('filters');
  if (rawFilters) {
    try { filters = parseFilters(JSON.parse(rawFilters)); } catch { filters = []; }
  }
  const sql = getSql();
  // 더보기(offset>0)는 총계를 다시 세지 않는다 — 같은 조건에서 총계는 변하지 않는다(설계 §D).
  const withCount = sp.get('withCount') !== '0';
  const rows = await getWorkspaceTableRows(sql, workspaceId, { sort, dir, offset, limit, columnIds, filters });
  const total = withCount
    ? await getWorkspaceTableCount(sql, workspaceId, { columnIds, filters })
    : undefined;
  return NextResponse.json(total === undefined ? { rows } : { rows, total });
}
