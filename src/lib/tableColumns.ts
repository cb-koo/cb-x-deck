// 표 보기의 칸 정의와 셀 값. 화면값과 내보내기값을 나누는 것이 이 모듈의 핵심 책임이다
// (설계 2026-07-30 §F "값 표기"). 숫자는 화면·내보내기 모두 축약 없는 원값이고, 갈리는 것은
// 값이 없을 때다 — 화면은 '–'(모른다는 표시), 내보내기는 빈칸(0으로 채우면 평균이 왜곡된다).
import { formatFull } from './format.ts';
import { tweetPermalink } from './tweetLink.ts';
import { SORT_LABEL } from './sortKeys.ts';
import type { SortKey, TableRow } from './types.ts';
import { kstDate, kstDateTime } from './datetime.ts';

export interface TableColumn {
  key: string;
  label: string;
  sort?: SortKey;            // 있으면 이 칸 머리글로 정렬할 수 있다
  numeric?: boolean;         // 우측 정렬 + 자리수 고정 글꼴
}

const M = (key: string, sort: SortKey): TableColumn =>
  ({ key, label: SORT_LABEL[sort], sort, numeric: true });

// 표시 순서대로. 늘 14칸 전부를 보여준다 — 칸 폭은 드래그로 조절할 수 있어(TweetTable.tsx)
// 본문 칸이 밀리는 문제는 그쪽에서 다룬다(설계 2026-07-31 "칸 더보기 제거").
export const TABLE_COLUMNS: TableColumn[] = [
  { key: 'columns', label: '컬럼명' },
  { key: 'handle', label: '계정' },
  { key: 'date', label: SORT_LABEL.date, sort: 'date' },
  { key: 'text', label: '본문' },
  M('views', 'views'),
  M('likes', 'likes'),
  M('retweets', 'retweets'),
  { key: 'link', label: '링크' },
  M('replies', 'replies'),
  M('quotes', 'quotes'),
  M('bookmarks', 'bookmarks'),
  { key: 'followers', label: '팔로워', numeric: true },
  { key: 'saved', label: '저장' },
  { key: 'fetchedAt', label: '최종 수집 시간' },
];

// 날짜·시각 표기는 src/lib/datetime.ts 한 곳에서 나온다(설계 §A). 여기 있던 고정 +9 구현이
// 그 모듈로 승격됐다 — 표 밖(카드·브리핑·사용량)도 같은 규칙을 써야 하는데 표 전용 파일에
// 갇혀 있었기 때문이다. 표 쪽 호출부를 건드리지 않으려고 이름 그대로 다시 내보낸다.
export const ymd = kstDate;
export const ymdHm = kstDateTime;

function metricOf(row: TableRow, key: string): number | null | undefined {
  return (row.metrics as unknown as Record<string, number | null>)[key];
}

// 화면용 — 숫자는 축약 없이 콤마 표기(128,000), 없는 값은 '–'.
// 카드뷰는 X와 같아 보이는 것이 목적이라 X식 축약(formatCount)을 쓰지만, 표는 숫자를 나란히
// 놓고 비교하는 화면이라 23.7M처럼 줄이면 자리수를 눈으로 맞출 수 없다 (2026-07-31 사용자 결정).
export function cellDisplay(row: TableRow, col: TableColumn): string {
  switch (col.key) {
    case 'columns': return row.columnTitles.join(', ');
    case 'handle': return `@${row.authorHandle}`;
    case 'date': return ymd(row.tweetCreatedAt);
    case 'text': return row.text;
    case 'link': return tweetPermalink(row.authorHandle, row.tweetId);
    case 'followers': return formatFull(row.authorFollowers);
    case 'saved': return row.savedBy.map((m) => m.name).join(', ');
    case 'fetchedAt': return ymdHm(row.lastFetchedAt);
    default: return formatFull(metricOf(row, col.key) ?? null);
  }
}

// 내보내기용 — 숫자는 원값(엑셀에서 계산되어야 한다), 없는 값은 빈칸(0으로 채우면 평균이 왜곡된다)
export function cellExport(row: TableRow, col: TableColumn): string {
  switch (col.key) {
    case 'columns': return row.columnTitles.join(', ');
    case 'handle': return `@${row.authorHandle}`;
    case 'date': return ymd(row.tweetCreatedAt);
    case 'text': return row.text;
    case 'link': return tweetPermalink(row.authorHandle, row.tweetId);
    case 'followers': return row.authorFollowers === null ? '' : String(row.authorFollowers);
    case 'saved': return row.savedBy.map((m) => m.name).join(', ');
    case 'fetchedAt': return ymdHm(row.lastFetchedAt);
    default: {
      const v = metricOf(row, col.key);
      return v === null || v === undefined ? '' : String(v);
    }
  }
}
