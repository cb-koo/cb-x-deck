// 표 보기 필터의 모델과 순수 로직 (설계 2026-07-31).
// 열(columns)은 여기 없다 — 전용 드롭다운이 유일한 경로이고 columnIds로 따로 흐른다(설계 §A).
import { TABLE_COLUMNS } from './tableColumns.ts';
import { SORT_LABEL } from './sortKeys.ts';
import { formatFull } from './format.ts';

export type FilterField =
  | 'handle' | 'text'
  | 'views' | 'likes' | 'retweets' | 'replies' | 'quotes' | 'bookmarks' | 'followers'
  | 'date' | 'fetchedAt';

export type FilterOp = 'is' | 'contains' | 'notContains' | 'gte' | 'lte' | 'after' | 'before';

export interface FilterCondition {
  id: string;          // UI 행 식별용. 서버는 쓰지 않는다
  field: FilterField;
  op: FilterOp;
  value: string;       // UI 입력이 문자열이라 모델도 문자열로 통일한다. 변환은 SQL 만들 때
}

export const OP_LABEL: Record<FilterOp, string> = {
  is: '같음', contains: '포함', notContains: '제외',
  gte: '이상', lte: '이하', after: '이후', before: '이전',
};

const NUM_OPS: FilterOp[] = ['gte', 'lte'];
const DATE_OPS: FilterOp[] = ['after', 'before'];

// 표 머리글에서 축 라벨을 가져온다 (설계 제약: 표와 필터의 라벨이 갈라지면 안 된다)
function getLabelFromTable(key: string): string {
  const col = TABLE_COLUMNS.find(c => c.key === key);
  return col?.label ?? key;
}

// 라벨은 표 머리글과 같은 출처를 쓴다 — 두 화면의 축 이름이 갈라지면 안 된다.
export const FIELD_SPECS: Record<FilterField, { label: string; kind: 'text' | 'number' | 'date'; ops: FilterOp[] }> = {
  handle: { label: getLabelFromTable('handle'), kind: 'text', ops: ['is', 'contains'] },
  text: { label: getLabelFromTable('text'), kind: 'text', ops: ['contains', 'notContains'] },
  views: { label: SORT_LABEL.views, kind: 'number', ops: NUM_OPS },
  likes: { label: SORT_LABEL.likes, kind: 'number', ops: NUM_OPS },
  retweets: { label: SORT_LABEL.retweets, kind: 'number', ops: NUM_OPS },
  replies: { label: SORT_LABEL.replies, kind: 'number', ops: NUM_OPS },
  quotes: { label: SORT_LABEL.quotes, kind: 'number', ops: NUM_OPS },
  bookmarks: { label: SORT_LABEL.bookmarks, kind: 'number', ops: NUM_OPS },
  followers: { label: getLabelFromTable('followers'), kind: 'number', ops: NUM_OPS },
  date: { label: SORT_LABEL.date, kind: 'date', ops: DATE_OPS },
  fetchedAt: { label: getLabelFromTable('fetchedAt'), kind: 'date', ops: DATE_OPS },
};

// UI 표시 순서 — 자주 쓰는 것부터
export const FILTER_FIELDS: FilterField[] = [
  'handle', 'text', 'views', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks', 'followers', 'date', 'fetchedAt',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// DATE_RE는 모양만 본다 — 2026-13-40도 통과시켜 그대로 $1::date로 넘어가면 Postgres가 던지고
// 라우트엔 try/catch가 없어 500이 된다. 달력에 실재하는 날짜인지 왕복 검증한다:
// Date.UTC는 넘친 값을 다음 달/해로 굴려버리므로, 굴러간 결과가 원래 입력과 같은지로 판별한다.
function isValidCalendarDate(v: string): boolean {
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 미완성 조건은 쿼리에 보내지 않는다 — 축만 고르고 값을 아직 안 넣은 중간 상태에서
// 결과가 0건으로 튀면 사용자는 자기가 뭘 잘못했다고 생각한다.
export function isComplete(c: FilterCondition): boolean {
  const v = c.value.trim();
  if (!v) return false;
  const spec = FIELD_SPECS[c.field];
  if (!spec) return false;
  // 정수만, 15자리까지 — SQL에 NaN이 흘러가지 않게, 그리고 자릿수 제한 없는 숫자는
  // 1e+30 같은 값이 되어 bigint 캐스팅에서 Postgres가 던진다(실재하는 지표 어떤 것도 이 자릿수를 넘지 않는다).
  if (spec.kind === 'number') return /^\d{1,15}$/.test(v);
  if (spec.kind === 'date') return DATE_RE.test(v) && isValidCalendarDate(v);
  return true;
}

export function describeCondition(c: FilterCondition): string {
  const spec = FIELD_SPECS[c.field];
  const v = spec?.kind === 'number' ? formatFull(Number(c.value)) : c.value.trim();
  return `${spec?.label ?? c.field} ${OP_LABEL[c.op] ?? c.op} ${v}`;
}

// 클라이언트가 보낸 값을 믿지 않는다. 축은 FIELD_SPECS에, 연산자는 그 축의 ops에 있어야만 통과.
// 미완성 조건도 여기서 버린다 — 서버가 빈 값으로 쿼리를 만들 이유가 없다.
export function parseFilters(raw: unknown): FilterCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterCondition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const field = o.field as FilterField;
    const op = o.op as FilterOp;
    if (typeof field !== 'string' || typeof op !== 'string' || typeof o.value !== 'string') continue;
    const spec = FIELD_SPECS[field];
    if (!spec || !spec.ops.includes(op)) continue;
    const c: FilterCondition = { id: typeof o.id === 'string' ? o.id : '', field, op, value: o.value };
    if (!isComplete(c)) continue;
    out.push(c);
  }
  return out;
}

// 축 → SQL 식. 허용 목록이다. 여기 없는 축은 조각을 만들지 못한다.
// 지표는 정렬식(tweetStore.ORDER_EXPR)과 같은 형태를 쓴다 — 나중에 표현식 인덱스를 넣을 때
// 식이 정확히 일치해야 인덱스가 쓰인다(설계 §E).
const FIELD_EXPR: Record<FilterField, string> = {
  handle: 't.author_handle',
  text: 't.text',
  views: `(t.metrics->>'views')::bigint`,
  likes: `(t.metrics->>'likes')::bigint`,
  retweets: `(t.metrics->>'retweets')::bigint`,
  replies: `(t.metrics->>'replies')::bigint`,
  quotes: `(t.metrics->>'quotes')::bigint`,
  bookmarks: `(t.metrics->>'bookmarks')::bigint`,
  followers: 't.author_followers',
  date: 't.tweet_created_at',
  fetchedAt: 't.last_fetched_at',
};

// LIKE 패턴 메타문자를 죽인다. 사용자가 '50%'를 찾으면 %가 와일드카드가 되어
// 50으로 시작하는 글 전부에 걸린다. '_'도 한 글자 와일드카드다.
function escapeLike(v: string): string {
  return v.replace(/([\\%_])/g, '\\$1');
}

export function buildFilterSql(
  conditions: FilterCondition[], nextParam: number,
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let n = nextParam;
  const bind = (v: unknown) => { params.push(v); return `$${n++}`; };

  for (const c of conditions) {
    const spec = FIELD_SPECS[c.field];
    const expr = FIELD_EXPR[c.field];
    if (!spec || !expr || !spec.ops.includes(c.op)) continue;   // 허용 목록 밖이면 조각 없음
    // 계정 열은 화면·CSV에 '@handle'로 보이지만 저장은 '@' 없이 되어 있다 — 화면에서 복사한
    // '@beautyfulence'를 그대로 넣으면 0건이 된다. 이 축만 앞의 '@' 하나를 벗겨서 맞춘다.
    const v = c.field === 'handle' ? c.value.trim().replace(/^@/, '') : c.value.trim();
    switch (c.op) {
      case 'gte':
      case 'lte':
        // 정수만 — SQL에 NaN이 흘러가지 않게
        if (!/^\d+$/.test(v)) continue;
        clauses.push(`${expr} ${c.op === 'gte' ? '>=' : '<='} ${bind(Number(v))}`);
        break;
      case 'is': clauses.push(`${expr} = ${bind(v)}`); break;
      case 'contains': clauses.push(`${expr} ilike ${bind(`%${escapeLike(v)}%`)} escape '\\'`); break;
      case 'notContains': clauses.push(`${expr} not ilike ${bind(`%${escapeLike(v)}%`)} escape '\\'`); break;
      // '이후'는 그 날짜 포함, '이전'은 그 날짜 미포함 — 두 조건을 겹쳐 범위를 만들 때
      // 경계 하루가 양쪽에 들어가지 않게 한쪽만 포함한다.
      case 'after': clauses.push(`${expr} >= ${bind(v)}::date`); break;
      case 'before': clauses.push(`${expr} < ${bind(v)}::date`); break;
    }
  }
  return { clauses, params };
}

// 내보낸 파일이 어떤 조건의 결과인지 이름만 보고 알 수 있게 한다 —
// 같은 날 다른 조건으로 두 번 받으면 (1).csv가 되어 구분이 안 된다(설계 §F).
export function csvFileName(opts: { columnNames: string[]; conditionCount: number; date: string }): string {
  const bad = /[\\/:*?"<>|\s]/g;                       // 파일명에 쓸 수 없는 문자와 공백
  const parts = ['x-deck-table'];
  if (opts.columnNames.length === 1) {
    // 제목이 전부 금지 문자·공백뿐이면(예: '***') 지우고 나면 빈 문자열이 남는다 —
    // 그걸 그대로 넣으면 '--'가 생겨 이름이 아니라 구분자 두 개로 보인다.
    const name = opts.columnNames[0].replace(bad, '');
    if (name) parts.push(name);
  } else if (opts.columnNames.length > 1) parts.push(`열${opts.columnNames.length}개`);
  if (opts.conditionCount > 0) parts.push(`필터${opts.conditionCount}개`);
  parts.push(opts.date);
  return `${parts.join('-')}.csv`;
}
