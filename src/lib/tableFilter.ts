// 표 보기 필터의 모델과 순수 로직 (설계 2026-07-31).
// 열(columns)은 여기 없다 — 전용 드롭다운이 유일한 경로이고 columnIds로 따로 흐른다(설계 §A).
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

// 라벨은 표 머리글과 같은 출처를 쓴다 — 두 화면의 축 이름이 갈라지면 안 된다.
export const FIELD_SPECS: Record<FilterField, { label: string; kind: 'text' | 'number' | 'date'; ops: FilterOp[] }> = {
  handle: { label: '계정', kind: 'text', ops: ['is', 'contains'] },
  text: { label: '본문', kind: 'text', ops: ['contains', 'notContains'] },
  views: { label: SORT_LABEL.views, kind: 'number', ops: NUM_OPS },
  likes: { label: SORT_LABEL.likes, kind: 'number', ops: NUM_OPS },
  retweets: { label: SORT_LABEL.retweets, kind: 'number', ops: NUM_OPS },
  replies: { label: SORT_LABEL.replies, kind: 'number', ops: NUM_OPS },
  quotes: { label: SORT_LABEL.quotes, kind: 'number', ops: NUM_OPS },
  bookmarks: { label: SORT_LABEL.bookmarks, kind: 'number', ops: NUM_OPS },
  followers: { label: '팔로워', kind: 'number', ops: NUM_OPS },
  date: { label: SORT_LABEL.date, kind: 'date', ops: DATE_OPS },
  fetchedAt: { label: '기준', kind: 'date', ops: DATE_OPS },
};

// UI 표시 순서 — 자주 쓰는 것부터
export const FILTER_FIELDS: FilterField[] = [
  'handle', 'text', 'views', 'likes', 'retweets', 'replies', 'quotes', 'bookmarks', 'followers', 'date', 'fetchedAt',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 미완성 조건은 쿼리에 보내지 않는다 — 축만 고르고 값을 아직 안 넣은 중간 상태에서
// 결과가 0건으로 튀면 사용자는 자기가 뭘 잘못했다고 생각한다.
export function isComplete(c: FilterCondition): boolean {
  const v = c.value.trim();
  if (!v) return false;
  const spec = FIELD_SPECS[c.field];
  if (!spec) return false;
  if (spec.kind === 'number') return /^\d+$/.test(v);          // 정수만 — SQL에 NaN이 흘러가지 않게
  if (spec.kind === 'date') return DATE_RE.test(v);
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
