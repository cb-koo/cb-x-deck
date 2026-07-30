// 정렬 키의 사용자 문구. 덱 컬럼(Column.tsx)과 표 보기(TweetTable.tsx)가 함께 쓴다 —
// 복사해두면 두 화면의 문구가 갈라진다.
import type { SortDir, SortKey } from './types.ts';

export const SORT_LABEL: Record<SortKey, string> = {
  views: '조회수', date: '날짜', bookmarks: '북마크', retweets: 'RT',
  likes: '좋아요', replies: '답글', quotes: '인용',
};

// 덱 컬럼 헤더가 탭으로 노출하는 정렬 키 — 좁은 컬럼에 7개를 늘어놓지 않는다.
// 명시적 배열이어야 한다: Object.keys(SORT_LABEL)로 그리면 키를 늘릴 때 덱 UI가 조용히 늘어난다.
export const DECK_SORTS: SortKey[] = ['views', 'date', 'bookmarks', 'retweets'];

// 활성 기준에 방향을 말로 붙임 (기준에 따라 문구 분기)
export function dirText(sort: SortKey, dir: SortDir): string {
  if (sort === 'date') return dir === 'desc' ? '최신순' : '오래된순';
  return dir === 'desc' ? '많은순' : '적은순';
}

// 호버/스크린리더용 — 현재 정렬 상태 + 다시 누르면 뒤집힌다는 안내
export function dirLabel(sort: SortKey, dir: SortDir): string {
  return `${SORT_LABEL[sort]} ${dirText(sort, dir)} — 다시 누르면 정렬 순서가 바뀝니다`;
}
