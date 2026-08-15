import type { LibraryEntry } from './candidateStore.ts';

// 보관함 표: 컬럼 정의·정렬·셀 파생값. 순수 함수만 — 컴포넌트는 이 모듈이 계산한 값을 그린다.
// 숫자 표기 규칙은 덱 표와 동일(축약 금지·null은 '–')하되, TableRow에 결합된 tableColumns.ts는 재사용하지 않는다.
export type LibrarySortKey = 'addedAt' | 'date' | 'followers' | 'views' | 'likes' | 'retweets' | 'bookmarks' | 'replies' | 'comments';
export type LibrarySortDir = 'asc' | 'desc';
export interface LibrarySort { key: LibrarySortKey; dir: LibrarySortDir }
export interface LibraryTableColumn { key: string; label: string; sort?: LibrarySortKey; numeric?: boolean }

export const LIBRARY_TABLE_COLUMNS: LibraryTableColumn[] = [
  { key: 'text', label: '본문' },
  { key: 'handle', label: '계정' },
  { key: 'followers', label: '팔로워', sort: 'followers', numeric: true },
  { key: 'date', label: '게시일', sort: 'date' },
  { key: 'views', label: '조회수', sort: 'views', numeric: true },
  { key: 'likes', label: '좋아요', sort: 'likes', numeric: true },
  { key: 'retweets', label: '리포스트', sort: 'retweets', numeric: true },
  { key: 'bookmarks', label: '북마크', sort: 'bookmarks', numeric: true },
  { key: 'replies', label: '답글', sort: 'replies', numeric: true },
  { key: 'savedBy', label: '저장한 사람' },
  { key: 'comments', label: '코멘트', sort: 'comments' },
  { key: 'addedAt', label: '담은 시각', sort: 'addedAt' },
  { key: 'link', label: '링크' },
];

// 메모가 있는 후보행만 코멘트로 센다 — 저장만 하고 메모를 안 단 행은 코멘트가 아니다(카드 뷰와 같은 해석)
function memoEntries(e: LibraryEntry) {
  return e.candidates.filter((c) => c.memo?.trim());
}

function sortValue(e: LibraryEntry, key: LibrarySortKey): number | string | null {
  switch (key) {
    case 'addedAt': return e.addedAt;
    case 'date': return e.tweet.tweetCreatedAt;
    case 'followers': return e.tweet.authorFollowers;
    case 'comments': return memoEntries(e).length;
    default: return e.tweet.metrics[key];
  }
}

// null·undefined는 방향과 무관하게 항상 뒤로 — 모르는 값이 1등이 되면 안 된다
export function sortLibraryEntries(entries: LibraryEntry[], sort: LibrarySort): LibraryEntry[] {
  const mul = sort.dir === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'string' && typeof vb === 'string') return mul * va.localeCompare(vb);
    return mul * ((va as number) - (vb as number));
  });
}

// 'N · 최신 메모 첫 줄' (1개면 첫 줄만) — candidates는 savedAt 오름차순이라 마지막이 최신
export function commentSummary(e: LibraryEntry): string {
  const memos = memoEntries(e);
  if (memos.length === 0) return '–';
  const firstLine = memos[memos.length - 1].memo.trim().split('\n')[0];
  return memos.length > 1 ? `${memos.length} · ${firstLine}` : firstLine;
}

// 코멘트(=저장) 행 멤버 나열, 아무도 없으면 담은 사람 폴백 — 카드 풋터의 '담은 사람' 표기와 같은 해석
export function savedByLabel(e: LibraryEntry): string {
  if (e.candidates.length > 0) return e.candidates.map((c) => c.member.name).join(', ');
  return e.addedBy ? `${e.addedBy.name} (담음)` : '–';
}
