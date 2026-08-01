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

// 표의 날짜·시각은 전부 한국 시간으로 보여준다. 서버는 UTC로 저장하고(timestamptz),
// 필터 경계도 SQL에서 Asia/Seoul 자정으로 계산하므로(tableFilter.ts) 표시가 같은 시간대여야
// "보이는 날짜"와 "걸러지는 경계"가 일치한다.
// 고정 +9시간인 이유: 한국은 1988년 이후 서머타임이 없어 Asia/Seoul은 항상 UTC+9다.
// Intl에 맡기면 런타임 시간대 데이터에 의존해 테스트가 환경에 흔들린다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 파싱 불가한 값에는 빈 문자열을 돌려준다. 이 함수는 셀마다 불리므로 던지면 표 전체 렌더가
// 죽는다 — 셀 하나가 비는 것보다 나쁘다. 오늘은 값이 Postgres timestamptz에서 오므로 도달하지
// 않지만, 실패 양상의 차이가 커서 막아둔다.
function toKstIso(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + KST_OFFSET_MS).toISOString();
}

// 표와 카드 팝업이 같은 함수를 쓴다 — 팝업은 표 바로 위에 뜨므로 같은 값이 다른 날짜로
// 보이면 안 된다(2차 설계 §B). 규칙을 두 번 구현하지 않으려고 export 한다.
export function ymd(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 10);   // 표는 정렬 축이라 상대 표기를 쓰지 않는다
}

// '최종 수집 시간'(last_fetched_at) 전용. 날짜만 찍으면 같은 날 09:00에 새로고침한 컬럼과
// 22:00에 새로고침한 컬럼이 같은 값으로 보여 "비교 가능"으로 오인된다(설계 §E) — 시:분까지 찍는다.
// ymd와 함께 카드 팝업 헤더도 쓴다(2차 설계 §B).
export function ymdHm(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 16).replace('T', ' ');   // YYYY-MM-DD HH:MM
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
