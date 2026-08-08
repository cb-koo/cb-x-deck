import type { ReferenceRow } from './referenceStore.ts';

// 레퍼런스 시트 검색·정렬 (스펙 §2) — 전부 클라이언트 사이드 세션용 렌즈.
// 서버 기본 순서(메모 우선·최신)는 'default'가 그대로 보존한다.

export type RefSortKey = 'default' | 'likes' | 'views' | 'bookmarks' | 'recent';

export const REF_SORT_LABEL: Record<RefSortKey, string> = {
  default: '기본 (메모 우선·최신)', likes: '좋아요순', views: '조회순', bookmarks: '북마크순', recent: '최신순',
};

// 검색 대상: 본문·작성자(이름+핸들)·메모(작성자명 포함)·태그·번역문(캐시에 있을 때만).
// 공백으로 나눈 모든 토큰이 매칭돼야 통과(AND), 대소문자 무시.
export function matchesRefSearch(row: ReferenceRow, query: string, translation?: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [
    row.text, row.authorName ?? '', row.authorHandle,
    ...row.memos.flatMap((m) => [m.member, m.text]),
    ...row.tags,
    translation ?? '',
  ].join(' ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

const METRIC: Record<Exclude<RefSortKey, 'default' | 'recent'>, (r: ReferenceRow) => number> = {
  likes: (r) => r.metrics.likes ?? -1,      // null 지표는 맨 뒤
  views: (r) => r.metrics.views ?? -1,
  bookmarks: (r) => r.metrics.bookmarks ?? -1,
};

export function sortRefRows(rows: ReferenceRow[], key: RefSortKey): ReferenceRow[] {
  if (key === 'default') return rows;
  const byAdded = (a: ReferenceRow, b: ReferenceRow) => Date.parse(b.addedAt) - Date.parse(a.addedAt);
  if (key === 'recent') return [...rows].sort(byAdded);
  const metric = METRIC[key];
  return [...rows].sort((a, b) => (metric(b) - metric(a)) || byAdded(a, b)); // 동률은 최신순
}
