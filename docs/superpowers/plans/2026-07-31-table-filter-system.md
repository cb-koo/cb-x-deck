# 표 보기 필터 시스템 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표 보기에 필터 시스템을 넣는다 — 열을 다중선택 드롭다운으로 바꾸고(칩 제거), 계정·본문·지표·날짜를 조건 행으로 쌓을 수 있게 하며, 수집 설정과 모순되는 조건은 그 자리에서 알려준다.

**Architecture:** 필터는 직렬화 가능한 순수 데이터(`FilterCondition[]`)다. 조건 → SQL 조각 변환, 조건 서술 문구, 클라이언트가 보낸 값 검증, 수집 설정과의 모순 감지를 모두 `src/lib`의 순수 모듈로 분리해 유닛 테스트한다 — 이 저장소에 컴포넌트·라우트 테스트 하네스가 없으므로 검증 가능한 부분을 최대한 순수 함수로 뽑는 것이 확립된 방식이다. 서버는 허용 목록에서 나온 SQL 조각만 조립하고 값은 전부 바인딩 파라미터로 넘긴다. UI는 열 드롭다운과 조건 행을 별개 컴포넌트로 두고 컨테이너가 배선한다.

**Tech Stack:** Next.js 16.2.10 (App Router, `'use client'`), React 19.2.4, Tailwind CSS v4, TypeScript, `postgres`(직접 SQL). 테스트는 `node:test` + `tsx`. **새 의존성·새 마이그레이션·새 인덱스 없음.**

**설계 문서:** `docs/superpowers/specs/2026-07-31-table-filter-system-design.md` — 판단 근거는 전부 여기 있다. 구현 중 판단이 필요하면 계획이 아니라 스펙을 본다. 표 보기 본체는 `.../2026-07-30-deck-table-view-design.md`.

## Global Constraints

- **새 마이그레이션·새 인덱스·새 npm 의존성 없음.** 스펙 §E가 측정 근거와 임계점을 적어뒀다 — 임계점에 도달하기 전에는 인덱스를 넣지 않는다. `pg_trgm`은 일본어에 무효라 넣지 않는다.
- **쿼리 형태를 바꾸지 않는다.** filter-first 재작성은 측정에서 기각됐다(스펙 §E). 기존 `join + group by` 구조에 조건을 붙인다.
- **SQL 안전 규칙**: 축→SQL 식과 연산자는 **허용 목록 맵에서만** 나오고, **값은 예외 없이 바인딩 파라미터**다. 값을 문자열로 이어붙이는 코드를 쓰지 않는다.
- **UI 문구는 한국어, 내부 개념어 금지**(`AGENTS.md` 원칙 1). 확정 문구:
  - 안내 줄: `이미 모은 N건 중에서만 걸러요 (새로 가져오지 않아서 무료)` — N은 실제 건수
  - 모순 (a) 느슨함: `이 열은 좋아요 300 이상만 모으고 있어서 100으로 낮춰도 더 나오지 않아요`
  - 모순 (a) 여러 열: `선택한 열 중 9개는 좋아요 300 이상만 모아요`
  - 모순 (b) 항상 0건: `이 열은 좋아요 300 이상만 모으고 있어서 200 이하로는 한 건도 나오지 않아요`
  - 트리거: `열: 전체` / `열: PDRN 크림` / `열: PDRN 크림 +2`
  - 버튼: `+ 필터` / `필터 지우기` / 조건 삭제 `aria-label="이 조건 지우기"`
  - 빈 상태(조건 있음): `조건에 맞는 글이 없어요` + `필터 지우기`
  - 빈 상태(진짜 0건, 기존 유지): `아직 수집된 글이 없어요 — 카드 보기에서 열을 새로고침하면 여기에 모입니다`
- **연산자 라벨**: `같음` `포함` `제외` `이상` `이하` `이후` `이전`
- **축 라벨**: 지표·날짜는 `SORT_LABEL`(`src/lib/sortKeys.ts`)을 재사용한다 — 표 머리글과 필터 라벨이 갈라지면 안 된다. `계정`·`본문`·`팔로워`·`기준`은 `TABLE_COLUMNS`(`src/lib/tableColumns.ts`)의 라벨을 쓴다.
- **테스트 러너는 `node:test`**, 글로브가 `src/**/*.test.ts`라 테스트 대상은 `.tsx`가 아니어야 한다. DB 테스트는 `node --import tsx --env-file-if-exists=.env --test <파일>`로 돌린다(바로 `npx tsx --test`는 `.env`를 안 읽어 ECONNREFUSED).
- **DB 테스트는 실제 프로덕션 DB에 붙는다.** 접두사(`P`)로 격리하고 `finally`/`after`에서 반드시 지운다. **자기가 만들지 않은 행을 지우는 문장을 쓰지 않는다.**
- **컴포넌트 테스트 하네스가 없다.** React 컴포넌트에 유닛 테스트를 만들지 않는다. `tsc --noEmit` + 브라우저 확인으로 검증한다.
- **린트 기준선 24개(에러 13 + 경고 11).** `npm run lint`는 원래 비정상 종료한다. 총계가 24에서 늘지 않는 것이 기준이다. `react-hooks/set-state-in-effect`는 에러로 강제되므로 effect 본문에서 setState를 직접 호출하지 않는다(기존 2건은 합의된 예외).
- **`tsc --noEmit`은 클린이어야 한다.**
- **커밋 메시지**: `<type>(x-research): <한국어 요약>`, 본문 한국어, 마지막 줄 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. 본문이 여러 줄이면 파일로 써서 `git commit -F <path>`로 넘긴다(여러 `-m`은 분류기에 막힐 수 있음).

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/tableFilter.ts` | 필터 모델·축 명세·연산자·서술 문구·클라이언트 입력 검증·SQL 조각 생성·CSV 파일명 (순수) | 생성 |
| `src/lib/tableFilter.test.ts` | 위 테스트 | 생성 |
| `src/lib/collectionConflict.ts` | 조건 vs 열 수집 설정 모순 감지 (순수) | 생성 |
| `src/lib/collectionConflict.test.ts` | 위 테스트 | 생성 |
| `src/lib/tweetStore.ts` | `columnIds` 다중·`filters` 적용, 열 이름 집계 분리, 열별 건수 함수 추가 | 수정 |
| `src/lib/tweetStore.test.ts` | DB 테스트 추가 | 수정 |
| `src/app/api/tweet-table/route.ts` | `columnIds`·`filters` 수신·검증 | 수정 |
| `src/app/api/tweet-table/counts/route.ts` | 열별 건수 API | 생성 |
| `src/components/ColumnPicker.tsx` | 열 다중선택 드롭다운 | 생성 |
| `src/components/FilterRows.tsx` | 조건 행 + `+ 필터` + 경고 + 안내 줄 | 생성 |
| `src/components/TweetTableView.tsx` | 배선(칩 제거·필터 상태·CSV 파일명·빈 상태) | 수정 |

**단계와 배포 지점** (스펙 §H):

```
[T1 모델] → [T2 SQL조각] → [T3 서버] → [T4 라우트] → [T5 ColumnPicker] → [T6 1차 배선]
                                                                              ↑
                                                    여기서 1단계 완료 = 배포 가능
                                                    (칩 → 드롭다운, 원래 요청 해결)
[T7 모순감지] → [T8 FilterRows] → [T9 2차 배선] → [T10 최종 검증]
```

**병렬 실행 시 커밋 규칙.** 작업 에이전트는 **git 명령을 실행하지 않는다.** 여러 에이전트가 동시에 `git add`/`commit`을 하면 `index.lock` 경합이 나고 남의 스테이징이 섞인다. 커밋은 오케스트레이터가 배치 종료 후 태스크당 하나씩 순차 실행한다. 이 계획의 태스크는 대부분 앞 태스크 산출물을 소비하므로 병렬 여지는 T7(모순감지)이 T2~T6과 독립인 정도다.

---

### Task 1: 필터 모델·축 명세·서술·입력 검증

**Files:**
- Create: `src/lib/tableFilter.ts`
- Test: `src/lib/tableFilter.test.ts`

**Interfaces:**
- Consumes: `SORT_LABEL`(`src/lib/sortKeys.ts`), `TABLE_COLUMNS`(`src/lib/tableColumns.ts`)
- Produces (T2~T9가 쓴다):
  - `type FilterField = 'handle' | 'text' | 'views' | 'likes' | 'retweets' | 'replies' | 'quotes' | 'bookmarks' | 'followers' | 'date' | 'fetchedAt'`
  - `type FilterOp = 'is' | 'contains' | 'notContains' | 'gte' | 'lte' | 'after' | 'before'`
  - `interface FilterCondition { id: string; field: FilterField; op: FilterOp; value: string }`
  - `FIELD_SPECS: Record<FilterField, { label: string; kind: 'text' | 'number' | 'date'; ops: FilterOp[] }>`
  - `OP_LABEL: Record<FilterOp, string>`
  - `FILTER_FIELDS: FilterField[]` (UI 표시 순서)
  - `isComplete(c: FilterCondition): boolean`
  - `describeCondition(c: FilterCondition): string`
  - `parseFilters(raw: unknown): FilterCondition[]`

**왜 `열`이 이 모델에 없는가:** 열은 전용 드롭다운이 유일한 경로다(스펙 §A). 조건 행으로도 넣을 수 있게 하면 같은 축에 UI가 둘 생겨 어느 쪽이 이기는지 사용자가 알 수 없다. 열 선택은 `columnIds: string[]`로 따로 흐른다.

**`parseFilters`가 필요한 이유:** 조건은 클라이언트가 만들어 보낸다. 라우트가 이걸 그대로 믿으면 축·연산자 위치에 임의 문자열이 들어온다. 축은 `FIELD_SPECS`에, 연산자는 그 축의 `ops`에 있어야만 통과시키고, 나머지는 조용히 버린다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tableFilter.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_SPECS, FILTER_FIELDS, OP_LABEL, isComplete, describeCondition, parseFilters,
         type FilterCondition } from './tableFilter.ts';

const c = (over: Partial<FilterCondition> = {}): FilterCondition =>
  ({ id: 'x', field: 'views', op: 'gte', value: '100000', ...over });

test('축 라벨은 표 머리글과 같은 출처를 쓴다 (갈라지면 안 된다)', () => {
  assert.equal(FIELD_SPECS.views.label, '조회수');
  assert.equal(FIELD_SPECS.likes.label, '좋아요');
  assert.equal(FIELD_SPECS.retweets.label, 'RT');
  assert.equal(FIELD_SPECS.handle.label, '계정');
  assert.equal(FIELD_SPECS.text.label, '본문');
  assert.equal(FIELD_SPECS.followers.label, '팔로워');
  assert.equal(FIELD_SPECS.fetchedAt.label, '기준');
});

test('축마다 쓸 수 있는 연산자가 정해져 있다', () => {
  assert.deepEqual(FIELD_SPECS.handle.ops, ['is', 'contains']);
  assert.deepEqual(FIELD_SPECS.text.ops, ['contains', 'notContains']);
  assert.deepEqual(FIELD_SPECS.views.ops, ['gte', 'lte']);
  assert.deepEqual(FIELD_SPECS.date.ops, ['after', 'before']);
  assert.deepEqual(FIELD_SPECS.fetchedAt.ops, ['after', 'before']);
});

test('열은 필터 축이 아니다 — 전용 드롭다운이 유일한 경로', () => {
  assert.ok(!FILTER_FIELDS.includes('columns' as never));
  assert.equal(FILTER_FIELDS.length, 11);
});

test('연산자 라벨은 사용자 말로', () => {
  assert.equal(OP_LABEL.is, '같음');
  assert.equal(OP_LABEL.contains, '포함');
  assert.equal(OP_LABEL.notContains, '제외');
  assert.equal(OP_LABEL.gte, '이상');
  assert.equal(OP_LABEL.lte, '이하');
  assert.equal(OP_LABEL.after, '이후');
  assert.equal(OP_LABEL.before, '이전');
});

test('값이 비면 미완성 — 축만 고른 중간 상태가 결과를 0건으로 만들면 안 된다', () => {
  assert.equal(isComplete(c({ value: '' })), false);
  assert.equal(isComplete(c({ value: '   ' })), false);
  assert.equal(isComplete(c()), true);
  // 숫자 축에 숫자가 아닌 값이 오면 미완성으로 본다 (SQL에 NaN이 흘러가지 않게)
  assert.equal(isComplete(c({ field: 'views', value: 'abc' })), false);
  // 날짜 축은 YYYY-MM-DD 형태만
  assert.equal(isComplete(c({ field: 'date', op: 'after', value: '2026-07' })), false);
  assert.equal(isComplete(c({ field: 'date', op: 'after', value: '2026-07-01' })), true);
});

test('조건을 사용자 말로 서술한다 (칩 라벨용)', () => {
  assert.equal(describeCondition(c()), '조회수 이상 100,000');
  assert.equal(describeCondition(c({ field: 'handle', op: 'contains', value: 'beauty' })), '계정 포함 beauty');
  assert.equal(describeCondition(c({ field: 'date', op: 'before', value: '2026-07-01' })), '날짜 이전 2026-07-01');
});

test('parseFilters: 허용 목록 밖 축·연산자는 조용히 버린다 (클라이언트를 믿지 않는다)', () => {
  const raw = [
    { id: 'a', field: 'views', op: 'gte', value: '100' },
    { id: 'b', field: 'DROP TABLE', op: 'gte', value: '1' },      // 없는 축
    { id: 'c', field: 'text', op: 'gte', value: 'x' },              // 그 축에 없는 연산자
    { id: 'd', field: 'handle', op: 'contains', value: '' },        // 미완성
    { id: 'e', field: 'likes', op: 'lte', value: '5' },
  ];
  const out = parseFilters(raw);
  assert.deepEqual(out.map((x) => x.id), ['a', 'e']);
});

test('parseFilters: 배열이 아니거나 쓰레기가 와도 터지지 않는다', () => {
  assert.deepEqual(parseFilters(null), []);
  assert.deepEqual(parseFilters('nope'), []);
  assert.deepEqual(parseFilters([1, 2, 3]), []);
  assert.deepEqual(parseFilters([{}]), []);
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: FAIL — `Cannot find module './tableFilter.ts'`

- [ ] **Step 3: 구현**

`src/lib/tableFilter.ts`:

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: PASS — `# pass 8`, `# fail 0`

- [ ] **Step 5: 커밋**

메시지 요약: `feat(x-research): 표 필터 모델 + 클라이언트 입력 검증`

---

### Task 2: 조건 → SQL 조각 생성

**Files:**
- Modify: `src/lib/tableFilter.ts` (파일 끝에 추가)
- Modify: `src/lib/tableFilter.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: T1의 `FilterCondition`·`FIELD_SPECS`
- Produces: `buildFilterSql(conditions: FilterCondition[], nextParam: number): { clauses: string[]; params: unknown[] }`
  - `nextParam`은 이미 쓰인 파라미터 다음 번호(1-based). 반환된 `clauses`는 `$nextParam`부터 순서대로 쓴다.

**안전 규칙(Global Constraints):** 축→식과 연산자는 허용 목록 맵에서만 나온다. 값은 예외 없이 `params`로 나간다.

**LIKE 메타문자 이스케이프가 필요한 이유:** 사용자가 본문 검색에 `50%`를 넣으면 `ilike '%50%%'`가 되어 `50`으로 시작하는 모든 글에 걸린다. `_`도 한 글자 와일드카드다. 값 안의 `\` `%` `_`를 이스케이프하고 `escape '\'`를 붙인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tableFilter.test.ts` 끝에 추가하고 import에 `buildFilterSql`을 더한다:

```ts
test('buildFilterSql: 값은 항상 바인딩 파라미터로 나가고 번호가 이어진다', () => {
  const { clauses, params } = buildFilterSql([
    { id: '1', field: 'views', op: 'gte', value: '100000' },
    { id: '2', field: 'likes', op: 'lte', value: '500' },
  ], 3);
  assert.equal(clauses.length, 2);
  assert.ok(clauses[0].includes('$3'), clauses[0]);
  assert.ok(clauses[1].includes('$4'), clauses[1]);
  assert.deepEqual(params, [100000, 500]);
  // 값이 SQL 텍스트에 직접 박히지 않았다
  assert.ok(!clauses.join(' ').includes('100000'));
});

test('buildFilterSql: 지표는 jsonb에서 뽑아 bigint로 캐스팅한다 (정렬식과 같은 형태)', () => {
  const { clauses } = buildFilterSql([{ id: '1', field: 'views', op: 'gte', value: '5' }], 2);
  assert.match(clauses[0], /\(t\.metrics->>'views'\)::bigint >= \$2/);
});

test('buildFilterSql: 팔로워는 실제 컬럼', () => {
  const { clauses } = buildFilterSql([{ id: '1', field: 'followers', op: 'lte', value: '5' }], 1);
  assert.match(clauses[0], /t\.author_followers <= \$1/);
});

test('buildFilterSql: 계정 같음/포함', () => {
  const a = buildFilterSql([{ id: '1', field: 'handle', op: 'is', value: 'beautyfulence' }], 1);
  assert.match(a.clauses[0], /t\.author_handle = \$1/);
  assert.deepEqual(a.params, ['beautyfulence']);
  const b = buildFilterSql([{ id: '1', field: 'handle', op: 'contains', value: 'beauty' }], 1);
  assert.match(b.clauses[0], /t\.author_handle ilike/);
  assert.deepEqual(b.params, ['%beauty%']);
});

test('buildFilterSql: 본문 포함/제외 + LIKE 메타문자 이스케이프', () => {
  const inc = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: 'スキン' }], 1);
  assert.match(inc.clauses[0], /t\.text ilike \$1 escape/);
  assert.deepEqual(inc.params, ['%スキン%']);
  // 50%를 찾으면 %가 와일드카드가 되어 50으로 시작하는 전부에 걸린다 → 이스케이프해야 한다
  const pct = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: '50%' }], 1);
  assert.deepEqual(pct.params, ['%50\\%%']);
  const und = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: 'a_b' }], 1);
  assert.deepEqual(und.params, ['%a\\_b%']);
  const bs = buildFilterSql([{ id: '1', field: 'text', op: 'contains', value: 'a\\b' }], 1);
  assert.deepEqual(bs.params, ['%a\\\\b%']);
  const exc = buildFilterSql([{ id: '1', field: 'text', op: 'notContains', value: 'PR' }], 1);
  assert.match(exc.clauses[0], /t\.text not ilike \$1 escape/);
});

test('buildFilterSql: 날짜 이후는 그 날 포함, 이전은 그 날 미포함', () => {
  const after = buildFilterSql([{ id: '1', field: 'date', op: 'after', value: '2026-07-01' }], 1);
  assert.match(after.clauses[0], /t\.tweet_created_at >= \$1::date/);
  const before = buildFilterSql([{ id: '1', field: 'date', op: 'before', value: '2026-07-01' }], 1);
  assert.match(before.clauses[0], /t\.tweet_created_at < \$1::date/);
  const fetched = buildFilterSql([{ id: '1', field: 'fetchedAt', op: 'after', value: '2026-07-01' }], 1);
  assert.match(fetched.clauses[0], /t\.last_fetched_at >= \$1::date/);
});

test('buildFilterSql: 조건이 없으면 빈 결과', () => {
  const { clauses, params } = buildFilterSql([], 1);
  assert.deepEqual(clauses, []);
  assert.deepEqual(params, []);
});

test('buildFilterSql: 허용 목록 밖 조합은 조각을 만들지 않는다 (parseFilters를 우회해 들어와도)', () => {
  const { clauses } = buildFilterSql([{ id: '1', field: 'text' as never, op: 'gte', value: '5' }], 1);
  assert.deepEqual(clauses, []);
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: FAIL — `buildFilterSql is not a function` (또는 import 오류)

- [ ] **Step 3: 구현**

`src/lib/tableFilter.ts` 끝에 추가:

```ts
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
    const v = c.value.trim();
    switch (c.op) {
      case 'gte': clauses.push(`${expr} >= ${bind(Number(v))}`); break;
      case 'lte': clauses.push(`${expr} <= ${bind(Number(v))}`); break;
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: PASS — `# pass 16`, `# fail 0`

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

메시지 요약: `feat(x-research): 필터 조건을 SQL 조각으로 — 값은 전부 바인딩, LIKE 메타문자 이스케이프`

---

### Task 3: 서버 쿼리 — 열 다중선택·필터·열 이름 분리·열별 건수

**Files:**
- Modify: `src/lib/tweetStore.ts:169-232` (두 함수 시그니처·본문) + 파일 끝(새 함수)
- Modify: `src/lib/tweetStore.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: T1·T2의 `FilterCondition`·`buildFilterSql`
- Produces:
  - `getWorkspaceTableRows(sql, workspaceId, opts: { sort: SortKey; dir?: SortDir; offset?: number; limit?: number; columnIds?: string[]; filters?: FilterCondition[] })`
  - `getWorkspaceTableCount(sql, workspaceId, opts?: { columnIds?: string[]; filters?: FilterCondition[] })`
  - `getWorkspaceColumnCounts(sql, workspaceId): Promise<Array<{ columnId: string; n: number }>>`

**⚠️ 파라미터 번호를 손으로 세지 않는다.** 기존 코드는 `$1`·`$2`·`$3`을 하드코딩했고, 그것 때문에 이미 한 번 `42P18`(쓰이지 않는 자리표시자) 오류가 났다. 조건 개수가 가변이므로 **파라미터 배열을 만들면서 번호를 발급하는 방식**으로 바꾼다.

**같이 고치는 것 — `열` 칸이 필터된 열만 보여주는 문제:** `array_agg(distinct dc.title)`가 필터된 조인 위에서 돌아, 열을 좁히면 그 트윗이 속한 다른 열이 사라진다. 내보낸 파일은 필터보다 오래 남으므로 소속을 축소해 적는 것은 부정직하다. **상관 서브쿼리로 분리**해 항상 워크스페이스 내 모든 소속 열을 적는다. 성능 우려로 미루지 않아도 된다 — 스펙 §E에서 같은 형태를 측정해 13.3ms였다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tweetStore.test.ts` 끝에 추가한다. import 줄에 `getWorkspaceColumnCounts`를 더한다:

```ts
test('표 쿼리 — 열 다중선택은 OR, 열 이름은 필터와 무관하게 전체', async () => {
  const ws = await createWorkspace(sql, P + 'ws-f1');
  const colA = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'A', config: { keywords: ['a'] } });
  const colB = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'B', config: { keywords: ['b'] } });
  const colC = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'C', config: { keywords: ['c'] } });
  try {
    await upsertTweets(sql, [tw('f1', 100), tw('f2', 200), tw('f3', 300)]);
    await linkColumnTweets(sql, colA.id, [P + 'f1', P + 'f2']);
    await linkColumnTweets(sql, colB.id, [P + 'f2']);          // f2는 A·B 양쪽
    await linkColumnTweets(sql, colC.id, [P + 'f3']);

    const ab = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', columnIds: [colA.id, colB.id] });
    assert.deepEqual(ab.map((r) => r.tweetId), [P + 'f2', P + 'f1'], 'A 또는 B에 걸린 것 (OR)');

    // A만 골랐어도 f2의 열 이름에는 B가 함께 나와야 한다 — 내보낸 파일이 소속을 축소하면 안 된다
    const onlyA = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', columnIds: [colA.id] });
    const f2 = onlyA.find((r) => r.tweetId === P + 'f2')!;
    assert.deepEqual([...f2.columnTitles].sort(), [P + 'A', P + 'B']);

    assert.equal(await getWorkspaceTableCount(sql, ws.id, { columnIds: [colA.id, colB.id] }), 2);
    assert.equal(await getWorkspaceTableCount(sql, ws.id), 3);
  } finally {
    await deleteColumn(sql, colA.id); await deleteColumn(sql, colB.id); await deleteColumn(sql, colC.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('표 쿼리 — 조건이 AND로 결합되고 건수도 같은 조건을 쓴다', async () => {
  const ws = await createWorkspace(sql, P + 'ws-f2');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'F', config: { keywords: ['x'] } });
  try {
    await upsertTweets(sql, [
      { ...tw('g1', 500), text: 'スキンケア 良い', authorHandle: 'aaa', authorFollowers: 100 },
      { ...tw('g2', 900), text: 'スキンケア 悪い', authorHandle: 'bbb', authorFollowers: 5000 },
      { ...tw('g3', 900), text: '関係ない', authorHandle: 'aaa', authorFollowers: 5000 },
    ]);
    await linkColumnTweets(sql, col.id, [P + 'g1', P + 'g2', P + 'g3']);

    const f = (field: string, op: string, value: string) => ({ id: field, field, op, value } as never);
    // 조회수 600 이상 AND 본문에 スキンケア 포함 → g2만
    const rows = await getWorkspaceTableRows(sql, ws.id, {
      sort: 'views', filters: [f('views', 'gte', '600'), f('text', 'contains', 'スキンケア')],
    });
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 'g2']);
    assert.equal(await getWorkspaceTableCount(sql, ws.id, {
      filters: [f('views', 'gte', '600'), f('text', 'contains', 'スキンケア')],
    }), 1, '건수와 행 목록이 같은 조건을 써야 라벨이 실제와 맞는다');

    // 본문 제외
    const exc = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', filters: [f('text', 'notContains', 'スキンケア')] });
    assert.deepEqual(exc.map((r) => r.tweetId), [P + 'g3']);

    // 계정 같음 + 팔로워 이상
    const acct = await getWorkspaceTableRows(sql, ws.id, {
      sort: 'views', filters: [f('handle', 'is', 'aaa'), f('followers', 'gte', '1000')],
    });
    assert.deepEqual(acct.map((r) => r.tweetId), [P + 'g3']);

    // 날짜: 픽스처는 2026-07-01 작성 → 이후 포함, 이전 미포함
    assert.equal((await getWorkspaceTableRows(sql, ws.id, { sort: 'views', filters: [f('date', 'after', '2026-07-01')] })).length, 3);
    assert.equal((await getWorkspaceTableRows(sql, ws.id, { sort: 'views', filters: [f('date', 'before', '2026-07-01')] })).length, 0);
  } finally {
    await deleteColumn(sql, col.id); await deleteWorkspace(sql, ws.id);
  }
});

test('표 쿼리 — 열별 건수', async () => {
  const ws = await createWorkspace(sql, P + 'ws-f3');
  const colA = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'CA', config: { keywords: ['a'] } });
  const colB = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'CB', config: { keywords: ['b'] } });
  try {
    await upsertTweets(sql, [tw('h1', 10), tw('h2', 20)]);
    await linkColumnTweets(sql, colA.id, [P + 'h1', P + 'h2']);
    await linkColumnTweets(sql, colB.id, [P + 'h1']);
    const counts = await getWorkspaceColumnCounts(sql, ws.id);
    const byId = new Map(counts.map((c) => [c.columnId, c.n]));
    assert.equal(byId.get(colA.id), 2);
    assert.equal(byId.get(colB.id), 1);
  } finally {
    await deleteColumn(sql, colA.id); await deleteColumn(sql, colB.id); await deleteWorkspace(sql, ws.id);
  }
});
```

`tw()` 헬퍼는 지금 `(id, views)`만 받는다. 위 테스트가 `text`·`authorHandle`·`authorFollowers`를 덮어쓰므로 **스프레드로 덮는 형태(`{ ...tw('g1', 500), text: ... }`)를 그대로 쓴다** — 헬퍼 시그니처를 바꾸지 않는다(다른 테스트가 쓰고 있다).

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetStore.test.ts`
Expected: FAIL — `getWorkspaceColumnCounts is not a function`, 그리고 `columnIds`/`filters`가 무시돼 건수·행이 기대와 다름

- [ ] **Step 3: 두 함수를 파라미터 발급 방식으로 다시 쓴다**

`src/lib/tweetStore.ts:169-232`의 `getWorkspaceTableRows`·`getWorkspaceTableCount`를 이것으로 교체한다. 상단 import에 `import { buildFilterSql, type FilterCondition } from './tableFilter.ts';`를 더한다:

```ts
// 파라미터 번호를 손으로 세지 않는다 — 조건 개수가 가변이라 하드코딩하면 어긋난다.
// (이 파일은 예전에 쓰이지 않는 자리표시자 때문에 42P18 오류를 낸 적이 있다.)
function paramBag() {
  const params: unknown[] = [];
  return { params, bind: (v: unknown) => { params.push(v); return `$${params.length}`; } };
}

// 워크스페이스 안에서 그 트윗이 속한 모든 열 이름. 필터와 분리한다 —
// 열을 좁혔다고 소속을 축소해 적으면 내보낸 파일이 사실을 왜곡한다(설계 §D).
function columnTitlesSubquery(wsParam: string): string {
  return `(select array_agg(distinct dc2.title)
             from column_tweet ct2
             join deck_column dc2 on dc2.id = ct2.column_id and dc2.workspace_id = ${wsParam}
            where ct2.tweet_id = t.tweet_id)`;
}

function tableWhere(
  wsParam: string, bag: ReturnType<typeof paramBag>,
  columnIds?: string[], filters?: FilterCondition[],
): string {
  const parts = [
    `not exists (select 1 from dismissed_tweet d where d.workspace_id = ${wsParam} and d.tweet_id = t.tweet_id)`,
  ];
  const ids = (columnIds ?? []).filter(isUuidLike);
  if (ids.length > 0) parts.push(`ct.column_id = any(${bag.bind(ids)}::uuid[])`);
  const { clauses, params } = buildFilterSql(filters ?? [], bag.params.length + 1);
  for (const p of params) bag.params.push(p);
  parts.push(...clauses);
  return parts.join(' and ');
}

export async function getWorkspaceTableRows(
  sql: postgres.Sql, workspaceId: string,
  opts: { sort: SortKey; dir?: SortDir; offset?: number; limit?: number; columnIds?: string[]; filters?: FilterCondition[] },
): Promise<TableRow[]> {
  if (!isUuidLike(workspaceId)) return [];
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.min(TABLE_MAX, Math.max(1, Math.floor(opts.limit ?? TABLE_PAGE)));
  const orderExpr = ORDER_EXPR[opts.sort] ?? ORDER_EXPR.views;
  const orderDir = opts.dir === 'asc' ? 'asc nulls first' : 'desc nulls last';
  const bag = paramBag();
  const ws = bag.bind(workspaceId);
  const where = tableWhere(ws, bag, opts.columnIds, opts.filters);
  const rows = await sql.unsafe<TableRowRaw[]>(
    // group by tweet_id: 같은 트윗이 여러 열에 걸리면 행이 늘어나므로 한 행으로 묶는다.
    // order by에 tweet_id를 tie-break로 둬야 페이지 경계에서 행이 중복·누락되지 않는다.
    // limit/offset은 위에서 정수로 sanitize해 리터럴로 넣는다(자리표시자로 넘기면 안 쓰이는 번호가 생긴다).
    `select t.tweet_id, t.author_handle, t.author_name, t.author_followers, t.text,
            t.tweet_created_at, t.metrics, t.last_fetched_at,
            ${columnTitlesSubquery(ws)} as column_titles,
            coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.name)
                        from candidate c join member m on m.id = c.member_id
                       where c.tweet_id = t.tweet_id and c.workspace_id = ${ws}), '[]'::json) as saved_by
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id and dc.workspace_id = ${ws}
       join tweet t on t.tweet_id = ct.tweet_id
      where ${where}
      group by t.tweet_id
      order by ${orderExpr} ${orderDir}, t.tweet_id
      limit ${limit} offset ${offset}`,
    bag.params,
  );
  return rows.map((r) => ({
    tweetId: r.tweet_id,
    columnTitles: r.column_titles ?? [],
    authorHandle: r.author_handle,
    authorName: r.author_name,
    authorFollowers: r.author_followers === null ? null : Number(r.author_followers),
    text: r.text,
    tweetCreatedAt: r.tweet_created_at?.toISOString() ?? null,
    metrics: r.metrics,
    savedBy: r.saved_by ?? [],
    lastFetchedAt: r.last_fetched_at.toISOString(),
  }));
}

export async function getWorkspaceTableCount(
  sql: postgres.Sql, workspaceId: string,
  opts: { columnIds?: string[]; filters?: FilterCondition[] } = {},
): Promise<number> {
  if (!isUuidLike(workspaceId)) return 0;
  const bag = paramBag();
  const ws = bag.bind(workspaceId);
  const where = tableWhere(ws, bag, opts.columnIds, opts.filters);
  const rows = await sql.unsafe<Array<{ n: string }>>(
    // distinct tweet_id — 행 병합과 같은 기준이어야 "전체 N건" 라벨이 실제 행 수와 맞는다.
    `select count(distinct t.tweet_id) as n
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id and dc.workspace_id = ${ws}
       join tweet t on t.tweet_id = ct.tweet_id
      where ${where}`,
    bag.params,
  );
  return Number(rows[0]?.n ?? 0);
}

// 열 드롭다운 목록에 붙이는 건수. 다른 조건은 반영하지 않는다 — 그 열의 전체 건수다(설계 §A).
// 조건마다 12개 열을 다시 세면 조작할 때마다 쿼리가 하나 더 붙는다.
export async function getWorkspaceColumnCounts(
  sql: postgres.Sql, workspaceId: string,
): Promise<Array<{ columnId: string; n: number }>> {
  if (!isUuidLike(workspaceId)) return [];
  const rows = await sql<Array<{ column_id: string; n: string }>>`
    select ct.column_id, count(distinct ct.tweet_id) as n
      from column_tweet ct
      join deck_column dc on dc.id = ct.column_id and dc.workspace_id = ${workspaceId}
     where not exists (select 1 from dismissed_tweet d
                        where d.workspace_id = ${workspaceId} and d.tweet_id = ct.tweet_id)
     group by ct.column_id`;
  return rows.map((r) => ({ columnId: r.column_id, n: Number(r.n) }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/tweetStore.test.ts`
Expected: PASS, `# fail 0` (기존 테스트 + 새 3개)

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 실패한다 — 라우트(`src/app/api/tweet-table/route.ts`)가 아직 `columnId`(단수)를 넘긴다. **T4에서 고친다.** 오류가 그 파일 하나에만 있는지 확인하고 다음으로 간다.

- [ ] **Step 6: 커밋**

메시지 요약: `feat(x-research): 표 쿼리에 열 다중선택·필터 조건 + 열 이름 집계 분리 + 열별 건수`

---

### Task 4: API 라우트 — `columnIds`·`filters` 수신과 검증

**Files:**
- Modify: `src/app/api/tweet-table/route.ts`
- Create: `src/app/api/tweet-table/counts/route.ts`

**Interfaces:**
- Consumes: T1의 `parseFilters`, T3의 세 store 함수
- Produces:
  - `GET /api/tweet-table?workspaceId=&sort=&dir=&offset=&limit=&columnIds=<쉼표구분>&filters=<JSON>` → `{ rows, total }`
  - `GET /api/tweet-table/counts?workspaceId=` → `{ counts: Array<{ columnId, n }> }`

`filters`는 URL 인코딩된 JSON 배열이다. **파싱 실패는 조용히 빈 배열로 떨어진다** — 잘못된 필터 때문에 화면이 에러로 죽는 것보다 필터 없이 보이는 게 낫다. 검증은 `parseFilters`가 전담한다(라우트가 축·연산자를 다시 판정하지 않는다 — 판정이 두 곳에 있으면 갈라진다).

- [ ] **Step 1: `route.ts` 수정**

`src/app/api/tweet-table/route.ts`의 `columnId` 처리를 이것으로 바꾸고 import에 `parseFilters`를 더한다:

```ts
  // 쉼표로 구분한 uuid 목록. 형식 검증은 store가 isUuidLike로 한다.
  const columnIds = (sp.get('columnIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // 잘못된 JSON은 필터 없음으로 떨어진다 — 화면이 에러로 죽는 것보다 낫다.
  let filters = undefined;
  const rawFilters = sp.get('filters');
  if (rawFilters) {
    try { filters = parseFilters(JSON.parse(rawFilters)); } catch { filters = []; }
  }
```

그리고 두 store 호출을 이것으로 바꾼다:

```ts
  const [rows, total] = await Promise.all([
    getWorkspaceTableRows(sql, workspaceId, { sort, dir, offset, limit, columnIds, filters }),
    getWorkspaceTableCount(sql, workspaceId, { columnIds, filters }),
  ]);
```

- [ ] **Step 2: 열별 건수 라우트 작성**

`src/app/api/tweet-table/counts/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceColumnCounts } from '@/lib/tweetStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 열 드롭다운에 붙이는 열별 건수. 워크스페이스가 바뀔 때만 부르면 된다 —
// 다른 조건을 반영하지 않으므로 조건이 바뀌어도 다시 부를 필요가 없다(설계 §A).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
  const counts = await getWorkspaceColumnCounts(getSql(), workspaceId);
  return NextResponse.json({ counts });
}
```

- [ ] **Step 3: `더보기`에서 건수를 다시 세지 않게 한다**

스펙 §D: *"건수는 필터·열 선택이 바뀔 때만 계산하고 `더보기`에서는 재사용한다."* 지금은 페이지마다 `count(distinct)`가 다시 돈다 — 조건이 붙으면 매 페이지에 조건부 집계가 한 번 더 도는 셈이다. 같은 조건에서 총계는 변하지 않으므로 셀 이유가 없다.

`src/app/api/tweet-table/route.ts`에서 총계 계산을 조건부로 만든다:

```ts
  // 더보기(offset>0)는 총계를 다시 세지 않는다 — 같은 조건에서 총계는 변하지 않는다(설계 §D).
  const withCount = sp.get('withCount') !== '0';
  const rows = await getWorkspaceTableRows(sql, workspaceId, { sort, dir, offset, limit, columnIds, filters });
  const total = withCount
    ? await getWorkspaceTableCount(sql, workspaceId, { columnIds, filters })
    : undefined;
  return NextResponse.json(total === undefined ? { rows } : { rows, total });
```

`Promise.all`로 묶여 있던 기존 코드를 위 형태로 교체한다. 응답에서 `total`이 없을 수 있으므로 클라이언트는 **없으면 기존 값을 유지**해야 한다 — T9에서 배선한다.

- [ ] **Step 4: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음(T3에서 남았던 오류가 사라진다). 린트 총계 24 유지.

**주의**: `TweetTableView.tsx`가 아직 `columnId`(단수)를 쿼리에 넣는다. 그 파라미터는 이제 서버가 무시하므로 **열 필터가 일시적으로 동작하지 않는다** — T6에서 배선한다. 이 상태로 커밋해도 화면은 깨지지 않는다(전체가 보인다).

- [ ] **Step 4: 커밋**

메시지 요약: `feat(x-research): 표 API가 열 다중선택·필터 조건을 받는다 + 열별 건수 라우트`

---

### Task 5: 열 다중선택 드롭다운

**Files:**
- Create: `src/components/ColumnPicker.tsx`

**Interfaces:**
- Consumes: `ColumnRow`(`@/lib/types`), `formatFull`(`@/lib/format`)
- Produces: `ColumnPicker({ columns, counts, selected, onChange }: { columns: ColumnRow[]; counts: Record<string, number>; selected: string[]; onChange: (ids: string[]) => void })`

기존 `<details>/<summary>` 드롭다운 패턴을 따른다 — `src/components/Column.tsx:288`의 `보기: 전체 ▾`를 먼저 읽고 같은 언어로 맞춘다(둥근 트리거, `absolute right-0 z-20 mt-1 rounded-xl border … shadow-lg` 패널). 키보드·Esc가 네이티브로 따라온다.

체크 상태는 **`<input type="checkbox">`로 노출한다** — 아이콘(✓)만으로 표현하면 스크린리더가 상태를 읽지 못한다(설계 §A 접근성).

- [ ] **Step 1: 컴포넌트 작성**

`src/components/ColumnPicker.tsx`:

```tsx
'use client';
import type { ColumnRow } from '@/lib/types';
import { formatFull } from '@/lib/format';
import { ChevronDownIcon } from './XIcons';

// 열 선택 — 여러 개 고를 수 있다. 빈 배열 = 전체.
// 칩(단일 선택)을 대체한다: 열이 12개면 칩이 툴바 두 줄을 먹고, 열이 늘어나면 계속 늘어난다.
export function ColumnPicker({ columns, counts, selected, onChange }: {
  columns: ColumnRow[];
  counts: Record<string, number>;
  selected: string[];               // 빈 배열 = 전체
  onChange: (ids: string[]) => void;
}) {
  // 트리거가 현재 값을 말한다 — '3개'로만 쓰면 무엇이 걸렸는지 열어봐야 안다(AGENTS.md 원칙 4)
  const names = selected.map((id) => columns.find((c) => c.id === id)?.title).filter(Boolean) as string[];
  const label = names.length === 0 ? '전체'
    : names.length === 1 ? names[0]
    : `${names[0]} +${names.length - 1}`;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <details className="relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full border border-x-border-strong px-2.5 py-1 text-ui text-x-secondary hover:bg-x-hover [&::-webkit-details-marker]:hidden">
        열: <span className="font-medium text-x-text">{label}</span> <ChevronDownIcon className="h-3 w-3" />
      </summary>
      <div className="absolute left-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-x-border bg-white p-1 shadow-lg">
        <button onClick={() => onChange([])}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-ui hover:bg-x-hover ${selected.length === 0 ? 'font-bold text-x-text' : 'text-x-secondary'}`}>
          전체
        </button>
        {columns.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-ui hover:bg-x-hover">
            {/* 체크 상태를 아이콘으로만 표현하지 않는다 — 스크린리더가 읽어야 한다 */}
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-x-text">{c.title}</span>
            <span className="shrink-0 text-caption text-x-muted">{formatFull(counts[c.id] ?? 0)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
```

- [ ] **Step 2: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 24 유지.

- [ ] **Step 3: 커밋**

메시지 요약: `feat(x-research): 열 다중선택 드롭다운 (칩 대체)`

---

### Task 6: 1차 배선 — 칩을 드롭다운으로 (1단계 완료·배포 가능 지점)

**Files:**
- Modify: `src/components/TweetTableView.tsx`

**Interfaces:**
- Consumes: T5의 `ColumnPicker`, T4의 두 라우트
- Produces: 없음 (사용자 대면)

이 태스크가 끝나면 **사용자가 처음 말한 "열 선택 방식"이 해결된다.** 조건 행은 아직 없다.

- [ ] **Step 1: 상태를 다중선택으로 바꾼다**

`src/components/TweetTableView.tsx`에서:

- `const [columnId, setColumnId] = useState<string | null>(null);` → `const [columnIds, setColumnIds] = useState<string[]>([]);   // 빈 배열 = 전체`
- 열별 건수 상태 추가: `const [counts, setCounts] = useState<Record<string, number>>({});`
- `qs` 안의 `if (columnId) p.set('columnId', columnId);` → `if (columnIds.length > 0) p.set('columnIds', columnIds.join(','));`
- `qs`의 deps와 로딩 effect의 deps에서 `columnId` → `columnIds`
- 빈 상태 분기의 `rows.length === 0 && columnId` → `rows.length === 0 && columnIds.length > 0`, 그리고 `전체 보기` 버튼의 `setColumnId(null)` → `setColumnIds([])`

- [ ] **Step 2: 열별 건수를 한 번 불러온다**

`load` 정의 아래에 추가한다. **effect 본문에서 setState를 직접 호출하지 않는다**(`react-hooks/set-state-in-effect`가 에러) — 기존 로딩 effect와 같은 형태로 `useCallback` 로더를 두고 effect가 그것을 호출한다:

```tsx
  const loadCounts = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/tweet-table/counts?workspaceId=${wsId}`);
      if (!r.ok) return;
      const d = await r.json() as { counts: Array<{ columnId: string; n: number }> };
      setCounts(Object.fromEntries(d.counts.map((c) => [c.columnId, c.n])));
    } catch { /* 건수는 부가 정보 — 실패해도 화면은 동작한다 */ }
  }, [wsId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadCounts(); }, [wsId]);
```

- [ ] **Step 3: 칩을 드롭다운으로 교체**

툴바 왼쪽 영역(`<span className="mr-1 text-caption text-x-muted">열</span>`과 그 뒤 칩들, 그리고 `chip`/`on`/`off` 클래스 상수)을 지우고 이것으로 바꾼다. import에 `import { ColumnPicker } from './ColumnPicker';`를 더한다:

```tsx
        <ColumnPicker columns={columns} counts={counts} selected={columnIds} onChange={setColumnIds} />
```

`chip`·`on`·`off` 상수가 다른 곳에서 쓰이지 않는지 확인하고, 안 쓰이면 지운다(안 지우면 unused 린트가 는다).

- [ ] **Step 4: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 **24 유지**. Step 2가 `set-state-in-effect`를 하나 더 만들면 25가 된다 — 그 경우 로더 패턴이 기존 로딩 effect와 같은 형태인지 다시 확인하고, 그래도 늘어나면 정확한 규칙·줄과 함께 보고한다.

- [ ] **Step 5: 커밋**

메시지 요약: `feat(x-research): 열 칩을 다중선택 드롭다운으로 교체 (1단계)`

---

### Task 7: 수집 설정 모순 감지

**Files:**
- Create: `src/lib/collectionConflict.ts`
- Test: `src/lib/collectionConflict.test.ts`

**Interfaces:**
- Consumes: T1의 `FilterCondition`·`FIELD_SPECS`, `ColumnRow`·`SearchConfig`(`@/lib/types`)
- Produces:
  - `interface Conflict { conditionId: string; kind: 'noEffect' | 'alwaysEmpty'; message: string }`
  - `findConflicts(conditions: FilterCondition[], columns: ColumnRow[], selectedColumnIds: string[]): Conflict[]`

**이 모듈이 존재하는 이유(설계 §C):** 표 필터는 이미 모은 것에서만 좁힌다. 수집 기준보다 느슨한 조건은 **아무 효과가 없고**(사용자는 필터가 고장 났다고 오해), 반대 방향은 **결과가 항상 0건**이다(사용자는 값을 이리저리 바꿔보지만 무엇을 해도 0건). 실측 결과 열 38개 중 29개가 수집 필터를 쓰고 있어 실재하는 함정이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/collectionConflict.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConflicts } from './collectionConflict.ts';
import type { ColumnRow } from './types.ts';
import type { FilterCondition } from './tableFilter.ts';

const col = (id: string, title: string, config: Record<string, unknown>): ColumnRow => ({
  id, workspaceId: 'ws', kind: 'search', title, position: 0,
  config: config as never, lastRefreshedAt: null, prevRefreshedAt: null, createdAt: '2026-01-01',
} as unknown as ColumnRow);

const watch = (id: string, title: string): ColumnRow => ({
  id, workspaceId: 'ws', kind: 'watchlist', title, position: 0,
  config: { handle: 'x', userId: '1' } as never, lastRefreshedAt: null, prevRefreshedAt: null, createdAt: '2026-01-01',
} as unknown as ColumnRow);

const c = (over: Partial<FilterCondition>): FilterCondition =>
  ({ id: 'c1', field: 'likes', op: 'gte', value: '100', ...over });

const A = col('a', 'PDRN 크림', { keywords: ['x'], minFaves: 300 });

test('느슨한 조건 — 더 나오지 않는다고 알린다', () => {
  const out = findConflicts([c({})], [A], ['a']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '이 열은 좋아요 300 이상만 모으고 있어서 100으로 낮춰도 더 나오지 않아요');
});

test('반대 방향 — 항상 0건임을 더 강하게 알린다', () => {
  const out = findConflicts([c({ op: 'lte', value: '200' })], [A], ['a']);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'alwaysEmpty');
  assert.equal(out[0].message, '이 열은 좋아요 300 이상만 모으고 있어서 200 이하로는 한 건도 나오지 않아요');
});

test('수집 기준보다 엄격한 조건은 정상 — 경고 없음', () => {
  assert.deepEqual(findConflicts([c({ value: '1000' })], [A], ['a']), []);
});

test('여러 열이면 요약한다', () => {
  const cols = [A, col('b', 'B', { keywords: ['y'], minFaves: 300 }), col('d', 'D', { keywords: ['z'], minFaves: 100 })];
  const out = findConflicts([c({})], cols, []);   // 빈 배열 = 전체
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'noEffect');
  assert.equal(out[0].message, '선택한 열 중 2개는 좋아요 300 이상만 모아요');
});

test('인플루언서 열은 수집 기준이 없어 경고 대상이 아니다', () => {
  assert.deepEqual(findConflicts([c({})], [watch('w', 'W')], ['w']), []);
});

test('축마다 대응하는 수집 설정을 본다', () => {
  const cols = [col('a', 'A', { keywords: ['x'], minRetweets: 50, minReplies: 10, minViews: 100000, sinceDate: '2026-06-01', untilDate: '2026-07-31' })];
  const k = (over: Partial<FilterCondition>) => findConflicts([c(over)], cols, ['a'])[0]?.kind ?? null;
  assert.equal(k({ field: 'retweets', op: 'gte', value: '10' }), 'noEffect');
  assert.equal(k({ field: 'retweets', op: 'lte', value: '10' }), 'alwaysEmpty');
  assert.equal(k({ field: 'replies', op: 'gte', value: '5' }), 'noEffect');
  assert.equal(k({ field: 'views', op: 'gte', value: '1000' }), 'noEffect');
  assert.equal(k({ field: 'date', op: 'after', value: '2026-01-01' }), 'noEffect');
  assert.equal(k({ field: 'date', op: 'before', value: '2026-01-01' }), 'alwaysEmpty');
  assert.equal(k({ field: 'date', op: 'before', value: '2026-12-31' }), 'noEffect');
  assert.equal(k({ field: 'date', op: 'after', value: '2026-12-31' }), 'alwaysEmpty');
});

test('대응 설정이 없는 축은 경고하지 않는다', () => {
  assert.deepEqual(findConflicts([c({ field: 'fetchedAt', op: 'after', value: '2026-01-01' })], [A], ['a']), []);
  assert.deepEqual(findConflicts([c({ field: 'followers', op: 'gte', value: '1' })], [A], ['a']), []);
  assert.deepEqual(findConflicts([c({ field: 'text', op: 'contains', value: 'x' })], [A], ['a']), []);
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/collectionConflict.test.ts`
Expected: FAIL — `Cannot find module './collectionConflict.ts'`

- [ ] **Step 3: 구현**

`src/lib/collectionConflict.ts`:

```ts
// 표 필터 조건이 열의 수집 설정과 모순되는지 본다 (설계 2026-07-31 §C).
//
// 표 필터는 이미 모은 것에서만 좁힌다. 그래서 수집 기준보다
//  - 느슨한 조건은 아무 효과가 없고(사용자는 필터가 고장 났다고 오해)
//  - 반대 방향은 결과가 항상 0건이다(무엇을 해도 0건이라 더 헷갈린다)
// 실측(2026-07-31) 열 38개 중 29개가 수집 필터를 쓰고 있어 실재하는 함정이다.
import { FIELD_SPECS, type FilterCondition } from './tableFilter.ts';
import { formatFull } from './format.ts';
import type { ColumnRow, SearchConfig } from './types.ts';

export interface Conflict {
  conditionId: string;
  kind: 'noEffect' | 'alwaysEmpty';
  message: string;
}

// 축 → 수집 설정 키. 여기 없는 축은 대응 설정이 없어 경고하지 않는다.
const NUM_CONFIG_KEY: Partial<Record<FilterCondition['field'], keyof SearchConfig>> = {
  likes: 'minFaves', retweets: 'minRetweets', replies: 'minReplies', views: 'minViews',
};

function searchConfigs(columns: ColumnRow[], selectedIds: string[]): SearchConfig[] {
  const pool = selectedIds.length > 0 ? columns.filter((c) => selectedIds.includes(c.id)) : columns;
  return pool.filter((c) => c.kind === 'search').map((c) => c.config as SearchConfig);
}

function message(kind: Conflict['kind'], label: string, threshold: string, opWord: string, value: string, hitCount: number, total: number): string {
  if (total > 1 && hitCount > 1) return `선택한 열 중 ${hitCount}개는 ${label} ${threshold} 이상만 모아요`;
  if (kind === 'noEffect') return `이 열은 ${label} ${threshold} 이상만 모으고 있어서 ${value}으로 낮춰도 더 나오지 않아요`;
  return `이 열은 ${label} ${threshold} 이상만 모으고 있어서 ${value} ${opWord}로는 한 건도 나오지 않아요`;
}

export function findConflicts(
  conditions: FilterCondition[], columns: ColumnRow[], selectedColumnIds: string[],
): Conflict[] {
  const configs = searchConfigs(columns, selectedColumnIds);
  if (configs.length === 0) return [];
  const out: Conflict[] = [];

  for (const c of conditions) {
    const label = FIELD_SPECS[c.field]?.label ?? c.field;
    const numKey = NUM_CONFIG_KEY[c.field];

    if (numKey && (c.op === 'gte' || c.op === 'lte')) {
      const v = Number(c.value);
      // 조건보다 엄격하게(=크게) 수집하는 열들
      const stricter = configs.filter((cfg) => {
        const t = cfg[numKey] as number | null | undefined;
        return typeof t === 'number' && v < t;
      });
      if (stricter.length === 0) continue;
      const worst = Math.max(...stricter.map((cfg) => Number(cfg[numKey])));
      const kind = c.op === 'gte' ? 'noEffect' : 'alwaysEmpty';
      out.push({ conditionId: c.id, kind,
        message: message(kind, label, formatFull(worst), '이하', formatFull(v), stricter.length, configs.length) });
      continue;
    }

    if (c.field === 'date' && (c.op === 'after' || c.op === 'before')) {
      const v = c.value.trim();
      // sinceDate보다 과거를 요구하면: '이후'는 무효, '이전'은 항상 0건
      const sinceHits = configs.filter((cfg) => typeof cfg.sinceDate === 'string' && cfg.sinceDate! > v);
      if (sinceHits.length > 0) {
        const worst = sinceHits.map((cfg) => cfg.sinceDate!).sort().reverse()[0];
        const kind = c.op === 'after' ? 'noEffect' : 'alwaysEmpty';
        out.push({ conditionId: c.id, kind,
          message: kind === 'noEffect'
            ? `이 열은 ${worst} 이후만 모으고 있어서 ${v}으로 낮춰도 더 나오지 않아요`
            : `이 열은 ${worst} 이후만 모으고 있어서 ${v} 이전으로는 한 건도 나오지 않아요` });
        continue;
      }
      // untilDate보다 미래를 요구하면: '이전'은 무효, '이후'는 항상 0건
      const untilHits = configs.filter((cfg) => typeof cfg.untilDate === 'string' && cfg.untilDate! < v);
      if (untilHits.length > 0) {
        const worst = untilHits.map((cfg) => cfg.untilDate!).sort()[0];
        const kind = c.op === 'before' ? 'noEffect' : 'alwaysEmpty';
        out.push({ conditionId: c.id, kind,
          message: kind === 'noEffect'
            ? `이 열은 ${worst} 이전만 모으고 있어서 ${v}으로 올려도 더 나오지 않아요`
            : `이 열은 ${worst} 이전만 모으고 있어서 ${v} 이후로는 한 건도 나오지 않아요` });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/collectionConflict.test.ts`
Expected: PASS — `# pass 7`, `# fail 0`. 문구가 한 글자라도 다르면 실패한다. **테스트 문구를 구현에 맞추지 말고 구현을 테스트 문구에 맞춘다** — 문구는 사용자와 확정한 값이다(Global Constraints).

- [ ] **Step 5: 커밋**

메시지 요약: `feat(x-research): 수집 설정 모순 감지 — 무효 조건과 항상 0건 조건을 구분해 알린다`

---

### Task 8: 조건 행 UI

**Files:**
- Create: `src/components/FilterRows.tsx`

**Interfaces:**
- Consumes: T1의 `FILTER_FIELDS`·`FIELD_SPECS`·`OP_LABEL`·`FilterCondition`, T7의 `Conflict`
- Produces: `FilterRows({ conditions, conflicts, onChange, totalLabel })`
  - `conditions: FilterCondition[]`, `conflicts: Conflict[]`, `onChange: (next: FilterCondition[]) => void`, `totalLabel: string`(안내 줄에 넣을 건수 문자열)

- [ ] **Step 1: 컴포넌트 작성**

`src/components/FilterRows.tsx`:

```tsx
'use client';
import { FIELD_SPECS, FILTER_FIELDS, OP_LABEL, type FilterCondition, type FilterField } from '@/lib/tableFilter';
import type { Conflict } from '@/lib/collectionConflict';
import { Button } from './ui';

let seq = 0;
const nextId = () => `f${++seq}`;

// 조건 행 — 건 조건만 보이므로 평소엔 자리를 차지하지 않는다(설계 §A).
// 조건은 모두 AND로 묶인다. 논리 연산자를 노출하지 않는다 — 사용자는 비개발 기획 담당자다.
export function FilterRows({ conditions, conflicts, onChange, totalLabel }: {
  conditions: FilterCondition[];
  conflicts: Conflict[];
  onChange: (next: FilterCondition[]) => void;
  totalLabel: string;
}) {
  function add() {
    const field: FilterField = 'handle';
    onChange([...conditions, { id: nextId(), field, op: FIELD_SPECS[field].ops[0], value: '' }]);
  }
  function patch(id: string, part: Partial<FilterCondition>) {
    onChange(conditions.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...part };
      // 축이 바뀌면 그 축에 없는 연산자가 남을 수 있다 — 첫 연산자로 되돌린다
      if (part.field && !FIELD_SPECS[part.field].ops.includes(next.op)) next.op = FIELD_SPECS[part.field].ops[0];
      return next;
    }));
  }
  const sel = 'rounded border border-x-border-strong bg-white px-1.5 py-1 text-ui text-x-text';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button variant="subtle" onClick={add}>+ 필터</Button>
        {conditions.length > 0 && (
          <Button variant="ghost" onClick={() => onChange([])}>필터 지우기</Button>
        )}
      </div>
      {conditions.map((c) => {
        const spec = FIELD_SPECS[c.field];
        const conflict = conflicts.find((x) => x.conditionId === c.id);
        return (
          <div key={c.id} className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1">
              <select aria-label="필터 항목" value={c.field} className={sel}
                      onChange={(e) => patch(c.id, { field: e.target.value as FilterField })}>
                {FILTER_FIELDS.map((f) => <option key={f} value={f}>{FIELD_SPECS[f].label}</option>)}
              </select>
              <select aria-label="조건" value={c.op} className={sel}
                      onChange={(e) => patch(c.id, { op: e.target.value as FilterCondition['op'] })}>
                {spec.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
              </select>
              <input aria-label="값" value={c.value} className={`${sel} w-44`}
                     inputMode={spec.kind === 'number' ? 'numeric' : undefined}
                     placeholder={spec.kind === 'date' ? '2026-07-01' : ''}
                     onChange={(e) => patch(c.id, { value: e.target.value })} />
              <button aria-label="이 조건 지우기" title="이 조건 지우기"
                      onClick={() => onChange(conditions.filter((x) => x.id !== c.id))}
                      className="rounded px-1.5 py-1 text-ui text-x-muted hover:bg-x-hover hover:text-x-text">✕</button>
            </div>
            {conflict && (
              // 항상 0건은 무효보다 위험하다 — 무엇을 해도 안 나오는데 이유를 알 수 없다. 색으로도 구분한다.
              <p className={`pl-1 text-caption ${conflict.kind === 'alwaysEmpty' ? 'text-red-500' : 'text-amber-600'}`}>
                {conflict.message}
              </p>
            )}
          </div>
        );
      })}
      {conditions.length > 0 && (
        <p className="pl-1 text-caption text-x-muted">
          이미 모은 {totalLabel}건 중에서만 걸러요 (새로 가져오지 않아서 무료)
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 24 유지.

- [ ] **Step 3: 커밋**

메시지 요약: `feat(x-research): 조건 행 UI + 모순 경고 표시`

---

### Task 9: 2차 배선 — 조건 행·CSV 파일명·빈 상태

**Files:**
- Modify: `src/components/TweetTableView.tsx`
- Modify: `src/lib/tableFilter.ts` (파일명 함수 추가)
- Modify: `src/lib/tableFilter.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: T7의 `findConflicts`, T8의 `FilterRows`
- Produces: `csvFileName(opts: { columnNames: string[]; conditionCount: number; date: string }): string`

**CSV 파일명에 조건을 넣는 이유(설계 §F):** `x-deck-table-2026-07-31.csv`는 같은 날 다른 조건으로 두 번 받으면 구분이 안 된다. 필터가 여러 개가 되면서 실제 문제가 된다.

- [ ] **Step 1: 파일명 함수 테스트 작성**

`src/lib/tableFilter.test.ts` 끝에 추가하고 import에 `csvFileName`을 더한다:

```ts
test('csvFileName: 조건을 요약해 같은 날 두 번 받아도 구분된다', () => {
  assert.equal(csvFileName({ columnNames: [], conditionCount: 0, date: '2026-07-31' }),
    'x-deck-table-2026-07-31.csv');
  assert.equal(csvFileName({ columnNames: ['PDRN 크림'], conditionCount: 0, date: '2026-07-31' }),
    'x-deck-table-PDRN크림-2026-07-31.csv');
  assert.equal(csvFileName({ columnNames: ['A', 'B'], conditionCount: 0, date: '2026-07-31' }),
    'x-deck-table-열2개-2026-07-31.csv');
  assert.equal(csvFileName({ columnNames: [], conditionCount: 3, date: '2026-07-31' }),
    'x-deck-table-필터3개-2026-07-31.csv');
  assert.equal(csvFileName({ columnNames: ['PDRN 크림'], conditionCount: 2, date: '2026-07-31' }),
    'x-deck-table-PDRN크림-필터2개-2026-07-31.csv');
  // 파일명에 쓸 수 없는 문자는 제거한다
  assert.equal(csvFileName({ columnNames: ['a/b:c*?"<>|d'], conditionCount: 0, date: '2026-07-31' }),
    'x-deck-table-abcd-2026-07-31.csv');
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: FAIL — `csvFileName is not a function`

- [ ] **Step 3: 파일명 함수 구현**

`src/lib/tableFilter.ts` 끝에 추가:

```ts
// 내보낸 파일이 어떤 조건의 결과인지 이름만 보고 알 수 있게 한다 —
// 같은 날 다른 조건으로 두 번 받으면 (1).csv가 되어 구분이 안 된다(설계 §F).
export function csvFileName(opts: { columnNames: string[]; conditionCount: number; date: string }): string {
  const bad = /[\\/:*?"<>|\s]/g;                       // 파일명에 쓸 수 없는 문자와 공백
  const parts = ['x-deck-table'];
  if (opts.columnNames.length === 1) parts.push(opts.columnNames[0].replace(bad, ''));
  else if (opts.columnNames.length > 1) parts.push(`열${opts.columnNames.length}개`);
  if (opts.conditionCount > 0) parts.push(`필터${opts.conditionCount}개`);
  parts.push(opts.date);
  return `${parts.join('-')}.csv`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tableFilter.test.ts`
Expected: PASS, `# fail 0`

- [ ] **Step 5: 컨테이너 배선**

`src/components/TweetTableView.tsx`에서:

1. import 추가:
```tsx
import { FilterRows } from './FilterRows';
import { findConflicts } from '@/lib/collectionConflict';
import { csvFileName, isComplete, type FilterCondition } from '@/lib/tableFilter';
```

2. 상태 추가 (`columnIds` 아래):
```tsx
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
```

3. `qs`에 완성된 조건만 실어 보낸다. `qs` 안의 `columnIds` 처리 다음에 추가하고, `qs`의 deps에 `conditions`를 더한다:
```tsx
    const ready = conditions.filter(isComplete);
    if (ready.length > 0) p.set('filters', JSON.stringify(ready));
```

4. 로딩 effect의 deps에 `conditions`를 더한다 — 조건이 바뀌면 처음부터 다시 불러온다.

5. `saveCsv`의 파일명을 바꾼다:
```tsx
      a.download = csvFileName({
        columnNames: columnIds.map((id) => columns.find((c) => c.id === id)?.title ?? '').filter(Boolean),
        conditionCount: conditions.filter(isComplete).length,
        date: new Date().toISOString().slice(0, 10),
      });
```

6. 툴바 아래, 신선도 안내 위에 `FilterRows`를 넣는다:
```tsx
      <div className="border-b border-x-border px-4 py-2">
        <FilterRows conditions={conditions} onChange={setConditions}
                    conflicts={findConflicts(conditions.filter(isComplete), columns, columnIds)}
                    totalLabel={total.toLocaleString('en-US')} />
      </div>
```

7. 빈 상태 문구를 일반화한다. `rows.length === 0 && columnIds.length > 0` 분기를 이것으로 바꾼다:
```tsx
        ) : rows.length === 0 && (columnIds.length > 0 || conditions.some(isComplete)) ? (
          <p className="p-4 text-ui text-x-muted">
            조건에 맞는 글이 없어요 — <button onClick={() => { setColumnIds([]); setConditions([]); }} className="underline">필터 지우기</button>
          </p>
```

- [ ] **Step 6: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 24 유지.

- [ ] **Step 7: 커밋**

메시지 요약: `feat(x-research): 조건 행 배선 + CSV 파일명에 조건 요약 + 빈 상태 일반화`

---

### Task 10: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 전부 통과, `# fail 0`. 약 4분(실 DB). 신규: `tableFilter`(17) + `collectionConflict`(7) + `tweetStore`(3).

- [ ] **Step 2: 타입 체크 · 린트 · 프로덕션 빌드**

Run: `npx tsc --noEmit; echo "tsc=$?"; npm run lint 2>&1 | tail -3; npm run build 2>&1 | tail -5`
Expected: `tsc=0`, 린트 24, 빌드 성공(`/api/tweet-table/counts`가 라우트 목록에 등장).

- [ ] **Step 3: 성능 회귀 확인**

조건 4개를 건 상태의 쿼리를 `EXPLAIN (ANALYZE)`로 5회 돌려 **웜 중앙값이 스펙 §E의 12.9ms에서 크게 벗어나지 않는지** 확인하고 수치를 기록한다. 첫 회는 콜드라 버린다.

```
node --import tsx --env-file-if-exists=.env -e "<스펙 §E와 같은 형태의 쿼리를 5회 EXPLAIN ANALYZE>"
```

- [ ] **Step 4: 브라우저 확인**

`npm run dev` → `http://localhost:3000/w/<워크스페이스id>?view=table`

1. `열: 전체 ▾`를 눌러 목록이 열리고, 열마다 건수가 붙어 있다
2. 두 개를 체크하면 트리거가 `열: <첫 이름> +1`로 바뀌고 표가 두 열의 합집합으로 좁혀진다
3. 체크박스가 실제 `<input type="checkbox">`다(스크린리더가 상태를 읽을 수 있게)
4. `+ 필터` → 축·조건·값 세 컨트롤이 한 줄 생긴다. 값을 비워둔 동안 표가 0건으로 튀지 않는다
5. `PDRN 크림`만 고른 뒤 `좋아요 이상 100` → **`이 열은 좋아요 300 이상만 모으고 있어서 100으로 낮춰도 더 나오지 않아요`** 가 뜬다
6. 같은 상태에서 `좋아요 이하 200` → **빨간 문구로 `… 한 건도 나오지 않아요`** 가 뜨고 실제로 0건이 된다
7. 본문에 `50%`를 넣어도 `50`으로 시작하는 전부에 걸리지 않는다(LIKE 이스케이프)
8. `CSV 저장 (전체 N건)`의 N이 필터 결과와 같고, 내려온 파일명에 열 이름·조건 개수가 들어 있다
9. 열을 좁힌 상태에서 CSV를 받아 `열` 칸을 보면 **그 트윗이 속한 다른 열도 적혀 있다**(필터로 소속을 축소하지 않는다)
10. 조건을 걸어 0건이 되면 `조건에 맞는 글이 없어요` + `필터 지우기`가 나오고, 눌러서 복구된다
11. 카드로 돌아갔다 오면 필터가 초기화된다(설계된 동작). 덱 정렬 탭은 여전히 4개다

- [ ] **Step 5: 사용자 확인 요청**

로그인 게이팅으로 제가 볼 수 없는 것과, 판단이 필요한 것을 사용자에게 전달한다: 조건 행 세 컨트롤의 폭·간격이 답답하지 않은지, 경고 문구가 실제로 이해되는지, 조건이 4~5개 쌓였을 때 툴바가 표를 너무 밀어내지 않는지.
