// 표 보기의 칸 정의와 셀 값. 화면값과 내보내기값을 나누는 것이 이 모듈의 핵심 책임이다
// (설계 2026-07-30 §F "값 표기"). 숫자는 화면·내보내기 모두 축약 없는 원값이고, 갈리는 것은
// 값이 없을 때다 — 화면은 '–'(모른다는 표시), 내보내기는 빈칸(0으로 채우면 평균이 왜곡된다).
import { formatFull } from './format.ts';
import { tweetPermalink } from './tweetLink.ts';
import { SORT_LABEL } from './sortKeys.ts';
import type { SortKey, TableRow } from './types.ts';

export interface TableColumn {
  key: string;
  label: string;
  sort?: SortKey;            // 있으면 이 칸 머리글로 정렬할 수 있다
  group: 'base' | 'more';    // base=기본 8칸, more='칸 더보기'로 펼침
  numeric?: boolean;         // 우측 정렬 + 자리수 고정 글꼴
}

const M = (key: string, sort: SortKey, group: 'base' | 'more'): TableColumn =>
  ({ key, label: SORT_LABEL[sort], sort, group, numeric: true });

// 표시 순서대로. 기본 8칸을 먼저 두고 더보기 6칸이 뒤따른다 —
// 지표를 다 펼치면 본문 칸이 밀려 "어떤 글인지" 파악이 안 되기 때문(설계 §C).
export const TABLE_COLUMNS: TableColumn[] = [
  { key: 'columns', label: '열', group: 'base' },
  { key: 'handle', label: '계정', group: 'base' },
  { key: 'date', label: SORT_LABEL.date, sort: 'date', group: 'base' },
  { key: 'text', label: '본문', group: 'base' },
  M('views', 'views', 'base'),
  M('likes', 'likes', 'base'),
  M('retweets', 'retweets', 'base'),
  { key: 'link', label: '링크', group: 'base' },
  M('replies', 'replies', 'more'),
  M('quotes', 'quotes', 'more'),
  M('bookmarks', 'bookmarks', 'more'),
  { key: 'followers', label: '팔로워', group: 'more', numeric: true },
  { key: 'saved', label: '저장', group: 'more' },
  { key: 'fetchedAt', label: '기준', group: 'more' },
];

export function visibleColumns(showMore: boolean): TableColumn[] {
  return showMore ? TABLE_COLUMNS : TABLE_COLUMNS.filter((c) => c.group === 'base');
}

// 내보내기 칸 = 보이는 칸 + '기준'. 화면에서 접어놨어도 넣는다 —
// 기준 시각 없는 지표 표는 스프레드시트에서 그냥 틀린 비교가 된다(설계 §E).
export function exportColumns(showMore: boolean): TableColumn[] {
  const cols = visibleColumns(showMore);
  if (cols.some((c) => c.key === 'fetchedAt')) return cols;
  return [...cols, TABLE_COLUMNS.find((c) => c.key === 'fetchedAt')!];
}

function ymd(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10);   // ISO는 앞 10자가 YYYY-MM-DD — 표는 정렬 축이라 상대 표기를 쓰지 않는다
}

// '기준'(last_fetched_at) 전용. 날짜만 찍으면 같은 날 09:00에 새로고침한 열과 22:00에 새로고침한
// 열이 같은 값으로 보여 "비교 가능"으로 오인된다(설계 §E) — 시:분까지 찍어 그 착시를 막는다.
// 날짜(tweetCreatedAt)는 요일 단위로 묶어보는 축이라 그대로 YYYY-MM-DD를 쓴다.
function ymdHm(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 16).replace('T', ' ');   // YYYY-MM-DD HH:MM
}

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
