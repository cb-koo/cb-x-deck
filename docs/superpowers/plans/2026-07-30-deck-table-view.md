# 덱 표 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 덱에 표 보기 모드를 추가해 워크스페이스의 모든 열에 수집된 트윗을 한 표로 훑고, 지표로 정렬하고, 노션·엑셀로 빼낼 수 있게 한다.

**Architecture:** 값 표기·직렬화·칸 정의를 순수 함수 모듈로 분리해 유닛 테스트한다(이 저장소에 컴포넌트 테스트 하네스가 없으므로 테스트 가능한 부분을 최대한 순수 함수로 뽑는 것이 확립된 방식이다). 데이터는 새 서버 쿼리 하나가 `column_tweet → deck_column → tweet`을 조인하고 `tweet_id`로 묶어 지표 기준으로 정렬한다 — 정렬이 서버 SQL이므로 "조회수 상위 200건"이 전체에서의 진짜 상위 200건이 된다. UI는 컨테이너(데이터·상태·내보내기)와 표 렌더를 나눈다.

**Tech Stack:** Next.js 16.2.10 (App Router, `'use client'`), React 19.2.4, Tailwind CSS v4, TypeScript, `postgres` (직접 SQL). 테스트는 `node:test` + `tsx`. 새 의존성 없음.

**설계 문서:** `docs/superpowers/specs/2026-07-30-deck-table-view-design.md` — 판단 근거는 전부 여기 있다. 구현 중 판단이 필요하면 계획이 아니라 스펙을 본다.

## Global Constraints

- **DB 마이그레이션 없음.** 기존 테이블 조인만 쓴다. `migrations/`에 파일을 추가하지 않는다.
- **새 npm 의존성 없음.** CSV·TSV 직렬화는 직접 쓴다.
- **UI 문구는 한국어, 내부 개념어 금지**(`AGENTS.md` UX 원칙 1). 확정 문구는 정확히 이것들이다:
  - 보기 토글: `보기:` / `카드` / `표`
  - 신선도 안내: `지표는 각 글을 마지막으로 가져온 시점 기준이에요 — 카드 보기에서 열을 새로고침하면 갱신됩니다`
  - 내보내기 버튼: `표 복사 (200줄)` / `CSV 저장 (전체 1,240건)` — 괄호 안 숫자는 실제 값
  - 복사 성공: `표 200줄을 복사했어요` / CSV 성공: `CSV 1,240줄을 저장했어요` (숫자는 실제 값)
  - 복사 실패: `표를 복사하지 못했어요 — 브라우저 권한을 확인해 주세요`
  - 상한 초과: `상위 5,000줄만 저장했어요 — 열 칩으로 범위를 좁혀보세요`
  - 로딩: `불러오는 중…` / 에러: `표를 불러오지 못했어요.` + `재시도`
  - 진짜 0건: `아직 수집된 글이 없어요 — 카드 보기에서 열을 새로고침하면 여기에 모입니다`
  - 열 없음: `아직 열이 없어요 — 카드 보기에서 열을 만들어보세요`
  - 필터 0건: `이 열에는 글이 없어요` + `전체 보기`
- **테스트 러너는 `node:test`.** `npm test` = `node --import tsx --env-file-if-exists=.env --test --test-concurrency=1 "src/**/*.test.ts"`. 글로브가 `.ts`만 잡으므로 **테스트 대상은 `.tsx`가 아니어야 한다.**
- **컴포넌트·라우트 테스트 하네스가 없다.** React 컴포넌트에 유닛 테스트를 새로 만들지 않는다. `tsc --noEmit` + 실제 브라우저 확인으로 검증한다.
- **`react-hooks/set-state-in-effect`가 에러로 강제된다.** effect 본문에서 setState를 직접 호출하면 린트 문제가 늘어난다. 기존 코드가 쓰는 방식(`useCallback` 로더를 effect에서 호출)은 이미 기준선에 포함된 위반이므로 **새로 늘리지만 않으면 된다.**
- **린트 기준선은 22개(에러 11 + 경고 11).** `npm run lint`는 원래 비정상 종료한다. 판정 기준은 **총 22개에서 증가하지 않음**이다.
- **`tsc --noEmit`은 현재 클린이다.** 작업 후에도 클린이어야 한다.
- **DB 테스트는 실제 DB에 붙는다.** `.env`의 프로덕션 DB를 쓴다(로컬·프로덕션 동일 DB). 그래서 테스트 데이터는 **접두사로 격리하고 `after`에서 반드시 지운다** — 기존 `src/lib/tweetStore.test.ts:10,21-26` 방식을 그대로 따른다.
- **커밋 메시지**: `<type>(x-research): <한국어 요약>`, 본문도 한국어, 마지막 줄에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `src/lib/types.ts` | `SortKey` 7종 확장 + `TableRow` 타입 | 수정 |
| `src/lib/sortKeys.ts` | 정렬 키 라벨·방향 문구·덱이 노출하는 키 목록 (순수) | 생성 |
| `src/lib/sortKeys.test.ts` | 위 테스트 (덱 탭이 4개로 고정되는지 회귀 포함) | 생성 |
| `src/components/Column.tsx` | 라벨·방향 문구를 `sortKeys.ts`에서 가져오고, 탭 목록을 명시적 배열로 | 수정 |
| `src/lib/tableColumns.ts` | 표 칸 정의 + 화면값/내보내기값 추출 (순수) | 생성 |
| `src/lib/tableColumns.test.ts` | 위 테스트 | 생성 |
| `src/lib/tableExport.ts` | TSV·CSV 직렬화 (순수) | 생성 |
| `src/lib/tableExport.test.ts` | 위 테스트 | 생성 |
| `src/lib/tableLimits.ts` | 페이지 크기·CSV 상한 상수 (서버·API·클라이언트 공용) | 생성 |
| `src/lib/tweetStore.ts` | `ORDER_EXPR` 3종 추가 + `getWorkspaceTableRows`·`getWorkspaceTableCount` | 수정 |
| `src/lib/tweetStore.test.ts` | 새 쿼리 DB 테스트 추가 | 수정 |
| `src/app/api/tweet-table/route.ts` | 표 데이터 API | 생성 |
| `src/components/TweetTable.tsx` | 표 렌더 전담 (머리글·`aria-sort`·행) | 생성 |
| `src/components/TweetTableView.tsx` | 컨테이너 — 로딩/에러/빈 상태·정렬·열 칩·칸 더보기·더보기·내보내기 | 생성 |
| `src/app/w/[wsId]/page.tsx` | `보기: 카드/표` 토글 + `?view=table` 분기 | 수정 |

**의존 순서와 병렬 가능 구간:**

```
[Task 1 sortKeys + SortKey 확장 + TableRow]
        │
        ├──────────────┐
[Task 2 tableColumns]  [Task 4 서버 쿼리]      ← 병렬 가능 (파일 안 겹침)
        │                     │
[Task 3 tableExport]   [Task 5 API 라우트]     ← 병렬 가능
        └──────────┬──────────┘
             [Task 6 TweetTable 렌더]
                    │
             [Task 7 TweetTableView 컨테이너]
                    │
             [Task 8 덱 토글 + ?view=table]
                    │
             [Task 9 최종 검증 + 육안]
```

**병렬 실행 시 커밋 규칙.** 각 태스크의 커밋 단계는 **병렬로 실행하면 안 된다.** 같은 저장소에서 여러 에이전트가 동시에 `git add`/`git commit`을 하면 `index.lock` 경합이 나고, A가 스테이징해둔 파일이 B의 커밋에 섞인다. 병렬로 돌릴 때는 작업 에이전트가 **편집·테스트·타입체크까지만** 하고 git 명령을 실행하지 않는다. 커밋은 오케스트레이터가 배치가 끝난 뒤 계획에 적힌 메시지로 **태스크당 하나씩 순차** 실행한다.

---

### Task 1: 정렬 키 7종으로 확장 + 라벨 모듈 분리

**Files:**
- Modify: `src/lib/types.ts:1` (`SortKey`), 파일 끝(`TableRow` 추가)
- Create: `src/lib/sortKeys.ts`
- Test: `src/lib/sortKeys.test.ts`
- Modify: `src/components/Column.tsx:4,25,28-35,275`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type SortKey = 'views' | 'date' | 'bookmarks' | 'retweets' | 'likes' | 'replies' | 'quotes'`
  - `interface TableRow { tweetId: string; columnTitles: string[]; authorHandle: string; authorName: string | null; authorFollowers: number | null; text: string; tweetCreatedAt: string | null; metrics: DeckMetrics; savedBy: Member[]; lastFetchedAt: string }`
  - `SORT_LABEL: Record<SortKey, string>`, `DECK_SORTS: SortKey[]`, `dirText(sort, dir): string`, `dirLabel(sort, dir): string`

**왜 라벨을 옮기는가:** 표도 같은 라벨·같은 방향 문구를 써야 한다(`조회수 많은순 — 다시 누르면 정렬 순서가 바뀝니다`). 지금은 `Column.tsx`에 module-private로 있어 재사용할 수 없고, 복사하면 두 화면의 문구가 갈라진다.

**⚠️ 반드시 지킬 함정:** `Column.tsx:275`는 정렬 탭을 **`Object.keys(SORT_LABEL)`로 그린다.** `SortKey`를 7종으로 늘리고 라벨도 7개를 채우면 **덱 컬럼에 정렬 탭이 갑자기 7개 생긴다.** 그래서 탭 목록을 명시적 배열 `DECK_SORTS`(4종)로 바꾼다. 덱 UI는 변하지 않아야 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/sortKeys.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SORT_LABEL, DECK_SORTS, dirText, dirLabel } from './sortKeys.ts';
import type { SortKey } from './types.ts';

test('정렬 키 7종 모두 라벨이 있다 (표 머리글이 빈칸이 되면 안 됨)', () => {
  const keys: SortKey[] = ['views', 'date', 'bookmarks', 'retweets', 'likes', 'replies', 'quotes'];
  for (const k of keys) assert.ok(SORT_LABEL[k]?.trim(), `라벨 없음: ${k}`);
});

test('덱이 노출하는 정렬 탭은 정확히 4개 — 표 때문에 덱 UI가 늘어나면 안 된다', () => {
  assert.deepEqual(DECK_SORTS, ['views', 'date', 'bookmarks', 'retweets']);
});

test('방향 문구는 날짜만 최신/오래된, 나머지는 많은/적은', () => {
  assert.equal(dirText('date', 'desc'), '최신순');
  assert.equal(dirText('date', 'asc'), '오래된순');
  assert.equal(dirText('views', 'desc'), '많은순');
  assert.equal(dirText('likes', 'asc'), '적은순');
});

test('dirLabel은 현재 상태와 다시 누르면 뒤집힌다는 안내를 함께 준다', () => {
  assert.equal(dirLabel('views', 'desc'), '조회수 많은순 — 다시 누르면 정렬 순서가 바뀝니다');
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/sortKeys.test.ts`
Expected: FAIL — `Cannot find module './sortKeys.ts'`

- [ ] **Step 3: `SortKey` 확장 + `TableRow` 추가**

`src/lib/types.ts:1` 을 이것으로 바꾼다:

```ts
// 정렬 키. 덱 컬럼은 이 중 4종만 탭으로 노출하고(sortKeys.ts의 DECK_SORTS) 표 보기는 7종을 쓴다.
export type SortKey = 'views' | 'date' | 'bookmarks' | 'retweets' | 'likes' | 'replies' | 'quotes';
```

그리고 같은 파일 **맨 끝**에 추가한다:

```ts
// 표 보기 한 행. StoredTweet을 쓰지 않는 이유: 표는 미디어·인용RT를 안 쓰는데
// CSV 저장은 최대 5,000행을 한 번에 받으므로 그 JSON이 페이로드를 크게 부풀린다.
export interface TableRow {
  tweetId: string;
  columnTitles: string[];        // 이 트윗이 걸린 열 이름들 (여러 열에 걸리면 여러 개)
  authorHandle: string;
  authorName: string | null;
  authorFollowers: number | null;
  text: string;
  tweetCreatedAt: string | null; // ISO
  metrics: DeckMetrics;
  savedBy: Member[];
  lastFetchedAt: string;         // ISO — 지표 기준 시각
}
```

- [ ] **Step 4: `sortKeys.ts` 작성**

`src/lib/sortKeys.ts`:

```ts
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx tsx --test src/lib/sortKeys.test.ts`
Expected: PASS — `# pass 4`, `# fail 0`

- [ ] **Step 6: `Column.tsx`가 새 모듈을 쓰게 바꾼다 (덱 UI는 불변)**

`src/components/Column.tsx:25-35` 의 `SORT_LABEL`·`dirText`·`dirLabel` **세 정의를 삭제**하고, 파일 상단 import에 추가한다:

```tsx
import { SORT_LABEL, DECK_SORTS, dirText, dirLabel } from '@/lib/sortKeys';
```

그리고 `Column.tsx:275` 를 이것으로 바꾼다:

```tsx
          {DECK_SORTS.map((k) => {
```

`ORDER_EXPR`은 Task 4에서 손댄다(같은 파일 충돌 방지 — 여기서는 건드리지 않는다).

- [ ] **Step 7: 타입 체크 + 린트 확인**

Run: `npx tsc --noEmit`
Expected: 실패한다. `src/lib/tweetStore.ts:34`의 `ORDER_EXPR: Record<SortKey, string>` 이 7종을 다 채우지 않아 오류가 난다:
```
src/lib/tweetStore.ts:34:7 - error TS2739: Type '{ views: string; date: string; bookmarks: string; retweets: string; }' is missing the following properties ... 'likes', 'replies', 'quotes'
```
**이 오류는 이 태스크에서 고친다** — 타입 확장이 만든 구멍이므로 남겨두면 안 된다. `src/lib/tweetStore.ts:34-39` 를 이것으로 바꾼다:

```ts
// 정렬용 SQL 식. metrics는 jsonb라 텍스트로 뽑아 bigint 캐스팅한다.
// 7종 전부 있는 이유: 표 보기가 지표 6종 + 날짜로 정렬한다(설계 §D).
const ORDER_EXPR: Record<SortKey, string> = {
  views: `(t.metrics->>'views')::bigint`,
  date: `t.tweet_created_at`,
  bookmarks: `(t.metrics->>'bookmarks')::bigint`,
  retweets: `(t.metrics->>'retweets')::bigint`,
  likes: `(t.metrics->>'likes')::bigint`,
  replies: `(t.metrics->>'replies')::bigint`,
  quotes: `(t.metrics->>'quotes')::bigint`,
};
```

다시 Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 `22 problems` 유지.

- [ ] **Step 8: 덱 정렬이 실제로 안 변했는지 회귀 확인**

Run: `npx tsx --test src/lib/tweetStore.test.ts`
Expected: PASS(기존 테스트 전부). `getColumnTweets`의 기존 4종 정렬 동작이 그대로여야 한다.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/types.ts src/lib/sortKeys.ts src/lib/sortKeys.test.ts src/components/Column.tsx src/lib/tweetStore.ts
git commit -m "$(cat <<'EOF'
refactor(x-research): 정렬 키 7종 확장 + 라벨을 sortKeys로 분리

표 보기가 지표 6종 정렬을 쓰려면 likes·replies·quotes가 필요하다.
덱 탭은 DECK_SORTS 4종으로 명시 — Object.keys(SORT_LABEL)로 그리던 걸
바꿔서 키를 늘려도 덱 UI가 늘어나지 않게 한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 표 칸 정의 + 화면값/내보내기값 추출

**Files:**
- Create: `src/lib/tableColumns.ts`
- Test: `src/lib/tableColumns.test.ts`

**Interfaces:**
- Consumes: Task 1의 `TableRow`, `SortKey`, `SORT_LABEL`
- Produces:
  - `interface TableColumn { key: string; label: string; sort?: SortKey; group: 'base' | 'more'; numeric?: boolean }`
  - `TABLE_COLUMNS: TableColumn[]` (14개, 표시 순서대로)
  - `visibleColumns(showMore: boolean): TableColumn[]`
  - `exportColumns(showMore: boolean): TableColumn[]` — 보이는 칸 + `기준` 강제 포함
  - `cellDisplay(row: TableRow, col: TableColumn): string` — 화면용 (축약 표기)
  - `cellExport(row: TableRow, col: TableColumn): string` — 내보내기용 (원값)

**핵심 규칙(설계 §F "값 표기"):** 화면은 `128K`, 내보내기는 `128000`. `128K`는 엑셀에서 문자열이 되어 정렬·합계가 깨지고 "데이터 분석 목적"이라는 요청 자체가 무의미해진다. 값이 없으면 **양쪽 다 빈칸이 아니라** — 화면은 기존 `formatCount`의 `–`, 내보내기는 빈 문자열이다(0으로 채우면 평균이 왜곡된다).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tableColumns.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_COLUMNS, visibleColumns, exportColumns, cellDisplay, cellExport } from './tableColumns.ts';
import type { TableRow } from './types.ts';

const ROW: TableRow = {
  tweetId: '1234567890',
  columnTitles: ['니키비', 'PDRN'],
  authorHandle: 'tester', authorName: '테스터', authorFollowers: 128000,
  text: '첫 줄\n둘째 줄', tweetCreatedAt: '2026-07-11T04:05:06Z',
  metrics: { views: 128000, likes: 512, retweets: 34, replies: null, quotes: 0, bookmarks: 211 },
  savedBy: [{ id: 'm1', name: '박구건', color: '#111' }, { id: 'm2', name: '모에카', color: '#222' }],
  lastFetchedAt: '2026-07-30T01:02:03Z',
};

test('기본은 8칸, 더보기를 켜면 14칸', () => {
  assert.equal(visibleColumns(false).length, 8);
  assert.equal(visibleColumns(true).length, 14);
  assert.equal(TABLE_COLUMNS.length, 14);
});

test('기본 8칸의 순서와 구성이 설계와 같다', () => {
  assert.deepEqual(visibleColumns(false).map((c) => c.key),
    ['columns', 'handle', 'date', 'text', 'views', 'likes', 'retweets', 'link']);
});

test('내보내기 칸은 접혀 있어도 기준(fetchedAt)을 항상 포함한다', () => {
  const keys = exportColumns(false).map((c) => c.key);
  assert.ok(keys.includes('fetchedAt'), '기준 시각 없는 지표 표는 잘못된 비교가 된다');
  assert.equal(keys.length, 9); // 기본 8 + 기준
  // 더보기를 켜도 중복되지 않는다
  assert.equal(exportColumns(true).length, 14);
});

test('지표는 화면에선 축약, 내보내기는 원숫자 — 엑셀에서 계산되어야 한다', () => {
  const views = TABLE_COLUMNS.find((c) => c.key === 'views')!;
  assert.equal(cellDisplay(ROW, views), '128K');
  assert.equal(cellExport(ROW, views), '128000');
});

test('값이 없는 지표는 내보낼 때 0이 아니라 빈칸 (0은 평균을 왜곡한다)', () => {
  const replies = TABLE_COLUMNS.find((c) => c.key === 'replies')!;
  assert.equal(cellExport(ROW, replies), '');
  // 0은 0으로 나간다 — 모름과 다르다
  const quotes = TABLE_COLUMNS.find((c) => c.key === 'quotes')!;
  assert.equal(cellExport(ROW, quotes), '0');
});

test('날짜는 양쪽 다 YYYY-MM-DD — 상대 표기(2시간 전)를 쓰지 않는다', () => {
  const date = TABLE_COLUMNS.find((c) => c.key === 'date')!;
  assert.equal(cellDisplay(ROW, date), '2026-07-11');
  assert.equal(cellExport(ROW, date), '2026-07-11');
});

test('열·저장은 여러 값을 셀 하나에 쉼표로 담는다', () => {
  const cols = TABLE_COLUMNS.find((c) => c.key === 'columns')!;
  const saved = TABLE_COLUMNS.find((c) => c.key === 'saved')!;
  assert.equal(cellExport(ROW, cols), '니키비, PDRN');
  assert.equal(cellExport(ROW, saved), '박구건, 모에카');
});

test('링크는 x.com 정규형 — 링크 복사 기능과 같은 주소가 나와야 한다', () => {
  const link = TABLE_COLUMNS.find((c) => c.key === 'link')!;
  assert.equal(cellExport(ROW, link), 'https://x.com/tester/status/1234567890');
});

test('본문은 화면에선 그대로 넘기고(말줄임은 CSS), 내보낼 때도 원문 그대로', () => {
  const text = TABLE_COLUMNS.find((c) => c.key === 'text')!;
  assert.equal(cellExport(ROW, text), '첫 줄\n둘째 줄');
});

test('정렬 가능한 칸은 7개 — 지표 6종 + 날짜', () => {
  const sortable = TABLE_COLUMNS.filter((c) => c.sort);
  assert.equal(sortable.length, 7);
  assert.deepEqual(sortable.map((c) => c.sort).sort(),
    ['bookmarks', 'date', 'likes', 'quotes', 'replies', 'retweets', 'views']);
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableColumns.test.ts`
Expected: FAIL — `Cannot find module './tableColumns.ts'`

- [ ] **Step 3: 구현**

`src/lib/tableColumns.ts`:

```ts
// 표 보기의 칸 정의와 셀 값. 화면값과 내보내기값을 나누는 것이 이 모듈의 핵심 책임이다
// (설계 2026-07-30 §F "값 표기") — 화면의 128K는 읽기 편한 축약이고, 엑셀에 필요한 것은 원값 128000이다.
import { formatCount } from './format.ts';
import { tweetPermalink } from './tweetLink.ts';
import { SORT_LABEL } from './sortKeys.ts';
import type { SortKey, TableRow } from './types.ts';

export interface TableColumn {
  key: string;
  label: string;
  sort?: SortKey;            // 있으면 이 칸 머리글로 정렬할 수 있다
  group: 'base' | 'more';    // base=기본 8칸, more='칸 더보기'로 펼침
  numeric?: boolean;         // 우측 정렬 + 화면에서 축약 표기
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

function metricOf(row: TableRow, key: string): number | null | undefined {
  return (row.metrics as unknown as Record<string, number | null>)[key];
}

// 화면용 — 숫자는 X식 축약(128K), 없는 값은 formatCount의 '–'
export function cellDisplay(row: TableRow, col: TableColumn): string {
  switch (col.key) {
    case 'columns': return row.columnTitles.join(', ');
    case 'handle': return `@${row.authorHandle}`;
    case 'date': return ymd(row.tweetCreatedAt);
    case 'text': return row.text;
    case 'link': return tweetPermalink(row.authorHandle, row.tweetId);
    case 'followers': return formatCount(row.authorFollowers);
    case 'saved': return row.savedBy.map((m) => m.name).join(', ');
    case 'fetchedAt': return ymd(row.lastFetchedAt);
    default: return formatCount(metricOf(row, col.key) ?? null);
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
    case 'fetchedAt': return ymd(row.lastFetchedAt);
    default: {
      const v = metricOf(row, col.key);
      return v === null || v === undefined ? '' : String(v);
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tableColumns.test.ts`
Expected: PASS — `# pass 10`, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/tableColumns.ts src/lib/tableColumns.test.ts
git commit -m "$(cat <<'EOF'
feat(x-research): 표 칸 정의 + 화면값/내보내기값 분리

화면은 128K, 내보내기는 128000 — 축약을 그대로 붙여넣으면 엑셀에서
문자열이 되어 정렬·합계가 깨진다. 없는 지표는 0이 아니라 빈칸.
내보내기 칸에는 접혀 있어도 '기준'(지표 시각)을 강제 포함한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: TSV·CSV 직렬화

**Files:**
- Create: `src/lib/tableExport.ts`
- Test: `src/lib/tableExport.test.ts`

**Interfaces:**
- Consumes: Task 1의 `TableRow`, Task 2의 `TableColumn`·`cellExport`
- Produces:
  - `toTsv(rows: TableRow[], cols: TableColumn[]): string`
  - `toCsv(rows: TableRow[], cols: TableColumn[]): string` — 앞에 UTF-8 BOM 포함
  - `CSV_BOM = '﻿'`

**왜 두 형식인가:** TSV는 클립보드용(노션·엑셀·구글시트에 붙이면 셀로 갈라짐), CSV는 파일용. **CSV에 BOM을 붙이는 이유**: 본문이 대부분 일본어인데 BOM 없는 UTF-8 CSV는 엑셀이 깨서 읽는다.

**이스케이프 주의:** 본문에 **줄바꿈이 흔하다**(트윗은 여러 줄). TSV는 셀 안 줄바꿈을 표현할 수 없어 공백으로 바꿔야 하고, CSV는 따옴표로 감싸면 줄바꿈을 담을 수 있다. 이 차이를 테스트로 박는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tableExport.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTsv, toCsv, CSV_BOM } from './tableExport.ts';
import { visibleColumns, exportColumns } from './tableColumns.ts';
import type { TableRow } from './types.ts';

function row(over: Partial<TableRow> = {}): TableRow {
  return {
    tweetId: '111', columnTitles: ['A'], authorHandle: 'h', authorName: null, authorFollowers: 10,
    text: 'plain', tweetCreatedAt: '2026-07-11T00:00:00Z',
    metrics: { views: 5, likes: 4, retweets: 3, replies: 2, quotes: 1, bookmarks: 0 },
    savedBy: [], lastFetchedAt: '2026-07-30T00:00:00Z', ...over,
  };
}

test('TSV 첫 줄은 머리글, 칸은 탭으로 갈라진다', () => {
  const cols = visibleColumns(false);
  const out = toTsv([row()], cols);
  const [head, first] = out.split('\n');
  assert.deepEqual(head.split('\t'), ['열', '계정', '날짜', '본문', '조회수', '좋아요', 'RT', '링크']);
  assert.equal(first.split('\t').length, 8);
});

test('TSV는 셀 안 줄바꿈·탭을 공백으로 바꾼다 (탭 구분이 깨지면 셀이 어긋난다)', () => {
  const out = toTsv([row({ text: '첫 줄\n둘째\t줄' })], visibleColumns(false));
  const body = out.split('\n')[1];
  assert.equal(out.split('\n').length, 2, '본문 줄바꿈이 행을 쪼개면 안 된다');
  assert.ok(body.includes('첫 줄 둘째 줄'), body);
});

test('CSV는 줄바꿈·쉼표·따옴표를 따옴표로 감싸 보존한다', () => {
  const out = toCsv([row({ text: 'a,b "q"\n다음 줄' })], visibleColumns(false));
  assert.ok(out.includes('"a,b ""q""\n다음 줄"'), out);
});

test('CSV는 BOM으로 시작한다 (없으면 엑셀이 일본어를 깬다)', () => {
  const out = toCsv([row()], visibleColumns(false));
  assert.ok(out.startsWith(CSV_BOM), 'BOM 없음');
  assert.equal(CSV_BOM, '﻿');
});

test('CSV 줄 구분은 CRLF (엑셀 호환)', () => {
  const out = toCsv([row(), row()], visibleColumns(false));
  assert.ok(out.includes('\r\n'), out.slice(0, 80));
});

test('행이 없어도 머리글은 나온다 (빈 표를 붙여도 칸 이름은 남아야 한다)', () => {
  const out = toTsv([], visibleColumns(false));
  assert.equal(out.split('\n').length, 1);
  assert.ok(out.startsWith('열\t계정'));
});

test('내보내기 칸을 쓰면 기준 칸이 마지막에 붙는다', () => {
  const out = toTsv([row()], exportColumns(false));
  const head = out.split('\n')[0].split('\t');
  assert.equal(head[head.length - 1], '기준');
  const body = out.split('\n')[1].split('\t');
  assert.equal(body[body.length - 1], '2026-07-30');
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tableExport.test.ts`
Expected: FAIL — `Cannot find module './tableExport.ts'`

- [ ] **Step 3: 구현**

`src/lib/tableExport.ts`:

```ts
// 표를 붙여넣기용 TSV와 파일용 CSV로 직렬화. 두 형식의 차이는 셀 안 줄바꿈을 담을 수 있는지다 —
// 트윗 본문은 여러 줄이 흔하다(설계 2026-07-30 §F).
import { cellExport, type TableColumn } from './tableColumns.ts';
import type { TableRow } from './types.ts';

// 엑셀은 BOM 없는 UTF-8 CSV를 깨서 읽는다. 본문이 대부분 일본어라 특히 중요하다.
export const CSV_BOM = '﻿';

// TSV 셀: 탭·줄바꿈을 공백으로. 탭 구분 형식은 셀 안에 그 둘을 담을 방법이 없다 —
// 그대로 두면 행·칸 경계가 어긋나 붙여넣은 표가 밀린다.
function tsvCell(v: string): string {
  return v.replace(/[\t\r\n]+/g, ' ').trim();
}

// CSV 셀: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표를 두 번 쓴다(RFC 4180).
function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function serialize(
  rows: TableRow[], cols: TableColumn[],
  cell: (v: string) => string, sep: string, eol: string,
): string {
  const lines = [cols.map((c) => cell(c.label)).join(sep)];
  for (const r of rows) lines.push(cols.map((c) => cell(cellExport(r, c))).join(sep));
  return lines.join(eol);
}

export function toTsv(rows: TableRow[], cols: TableColumn[]): string {
  return serialize(rows, cols, tsvCell, '\t', '\n');
}

export function toCsv(rows: TableRow[], cols: TableColumn[]): string {
  return CSV_BOM + serialize(rows, cols, csvCell, ',', '\r\n');
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tableExport.test.ts`
Expected: PASS — `# pass 7`, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/tableExport.ts src/lib/tableExport.test.ts
git commit -m "$(cat <<'EOF'
feat(x-research): 표 TSV/CSV 직렬화 — 붙여넣기용과 파일용

TSV는 셀 안 줄바꿈·탭을 공백으로(형식상 담을 수 없어 표가 밀린다),
CSV는 따옴표로 감싸 보존 + CRLF + UTF-8 BOM(없으면 엑셀이 일본어를 깬다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 교차 열 서버 쿼리

**Files:**
- Create: `src/lib/tableLimits.ts`
- Modify: `src/lib/tweetStore.ts` (파일 끝에 함수 2개 추가)
- Test: `src/lib/tweetStore.test.ts` (파일 끝에 테스트 추가)

**Interfaces:**
- Consumes: Task 1의 `TableRow`·`SortKey`, 같은 파일의 `ORDER_EXPR`(Task 1에서 7종으로 확장됨)
- Produces:
  - `TABLE_PAGE = 200`, `TABLE_MAX = 5000` (`src/lib/tableLimits.ts`) — Task 5·7이 같은 상수를 가져다 쓴다
  - `getWorkspaceTableRows(sql, workspaceId, opts: { sort: SortKey; dir?: SortDir; offset?: number; limit?: number; columnId?: string }): Promise<TableRow[]>`
  - `getWorkspaceTableCount(sql, workspaceId, opts?: { columnId?: string }): Promise<number>`

**상수를 별도 파일에 두는 이유:** 페이지 크기 200은 이미 `tweetStore.PAGE_SIZE`와 `Column.tsx:114`의 `PAGE`에 두 벌 있다(설계 §G가 지적한 문제). 표에서 **세 번째·네 번째 사본을 만들지 않기 위해** 표가 쓰는 상수는 한 파일에 두고 서버·API·클라이언트가 모두 거기서 가져온다. `tweetStore.ts`를 클라이언트에서 import하면 서버 전용 모듈이 클라이언트 번들로 끌려 들어가므로 상수만 분리해야 한다.

**설계상 반드시 지켜야 하는 성질(§G):** 정렬이 **서버 SQL**이어야 한다. 그래서 "조회수 많은순 200건"이 전체에서의 진짜 상위 200건이 된다. 클라이언트가 200건 받아 그 안에서 정렬하면 이 기능은 쓸모가 없다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/tweetStore.test.ts` 파일 **맨 끝**에 추가한다. import 줄(`:4`)에 `getWorkspaceTableRows, getWorkspaceTableCount`를 더한다:

```ts
test('표 쿼리 — 여러 열에 걸린 트윗은 한 행, 버림 제외, 워크스페이스 격리, 서버 정렬', async () => {
  const ws = await createWorkspace(sql, P + 'ws-tbl');
  const other = await createWorkspace(sql, P + 'ws-other');
  const m = await createMember(sql, P + 'M', '#333333');
  const colA = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'A', config: { keywords: ['a'] } });
  const colB = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'B', config: { keywords: ['b'] } });
  const colX = await createColumn(sql, { workspaceId: other.id, kind: 'search', title: P + 'X', config: { keywords: ['x'] } });
  try {
    await upsertTweets(sql, [tw('t1', 100), tw('t2', 300), tw('t3', 200), tw('t4', 999)]);
    await linkColumnTweets(sql, colA.id, [P + 't1', P + 't2', P + 't3']);
    await linkColumnTweets(sql, colB.id, [P + 't2']);              // t2는 두 열에 걸림
    await linkColumnTweets(sql, colX.id, [P + 't4']);              // 다른 워크스페이스
    await sql`insert into dismissed_tweet (workspace_id, tweet_id, dismissed_by) values (${ws.id}, ${P + 't3'}, ${m.id})`;

    const rows = await getWorkspaceTableRows(sql, ws.id, { sort: 'views' });
    // t3=버림 제외, t4=다른 워크스페이스 → t2, t1 두 행
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 't2', P + 't1'], '조회수 많은순 + 버림·타 워크스페이스 제외');
    const t2 = rows[0];
    assert.deepEqual([...t2.columnTitles].sort(), [P + 'A', P + 'B'], '두 열에 걸려도 한 행, 열 이름은 모두');
    assert.equal(t2.metrics.views, 300);
    assert.ok(t2.lastFetchedAt, '기준 시각이 실려야 한다 (지표 신선도 표시용)');

    const count = await getWorkspaceTableCount(sql, ws.id);
    assert.equal(count, 2, '중복 병합·버림 제외가 건수에도 반영');

    // 열 칩 필터
    const onlyB = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', columnId: colB.id });
    assert.deepEqual(onlyB.map((r) => r.tweetId), [P + 't2']);
    assert.equal(await getWorkspaceTableCount(sql, ws.id, { columnId: colB.id }), 1);

    // 방향 뒤집기 + 다른 지표로 정렬(likes는 이번에 새로 정렬 가능해진 키)
    const asc = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', dir: 'asc' });
    assert.deepEqual(asc.map((r) => r.tweetId), [P + 't1', P + 't2']);
    const byLikes = await getWorkspaceTableRows(sql, ws.id, { sort: 'likes' });
    assert.equal(byLikes.length, 2);

    // 페이지네이션
    const page = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', limit: 1, offset: 1 });
    assert.deepEqual(page.map((r) => r.tweetId), [P + 't1']);
  } finally {
    await sql`delete from dismissed_tweet where workspace_id = ${ws.id}`;
    await deleteColumn(sql, colA.id); await deleteColumn(sql, colB.id); await deleteColumn(sql, colX.id);
    await deleteWorkspace(sql, ws.id); await deleteWorkspace(sql, other.id);
  }
});

test('표 쿼리 — limit 상한 5000을 넘겨 요청해도 잘린다', async () => {
  const ws = await createWorkspace(sql, P + 'ws-cap');
  try {
    const rows = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', limit: 99999 });
    assert.deepEqual(rows, []); // 데이터가 없어도 오류 없이 통과 — 상한 처리에서 SQL 오류가 나지 않는지 확인
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인**

Run: `npx tsx --test src/lib/tweetStore.test.ts`
Expected: FAIL — `getWorkspaceTableRows is not a function` (또는 import 오류)

- [ ] **Step 3: 구현**

먼저 `src/lib/tableLimits.ts`를 만든다:

```ts
// 표 보기가 쓰는 크기 상수. 서버(tweetStore)·API 라우트·클라이언트가 모두 여기서 가져온다 —
// 페이지 크기는 이미 tweetStore.PAGE_SIZE와 Column.tsx의 PAGE에 두 벌 있어(설계 §G),
// 표에서 사본을 더 만들지 않기 위해 한 곳에 둔다.
// tweetStore.ts를 클라이언트에서 import하면 서버 전용 모듈이 클라이언트 번들로 끌려오므로 상수만 분리한다.
export const TABLE_PAGE = 200;   // 한 번에 받는 행 수 (더보기 단위)
export const TABLE_MAX = 5000;   // CSV 저장이 한 번에 받는 상한 — 넘으면 잘렸다고 말한다
```

그다음 `src/lib/tweetStore.ts` **맨 끝**에 추가한다. 파일 상단 import(`:2`)에 `TableRow`를 더하고, 새 import 줄을 넣는다:

```ts
import { TABLE_MAX, TABLE_PAGE } from './tableLimits.ts';
```

```ts
// 표 보기 — 워크스페이스의 모든 열을 한 목록으로. 새 마이그레이션 없이 기존 조인만 쓴다(설계 §G).

type TableRowRaw = {
  tweet_id: string; column_titles: string[]; author_handle: string; author_name: string | null;
  author_followers: string | number | null; text: string; tweet_created_at: Date | null;
  metrics: TableRow['metrics']; saved_by: TableRow['savedBy']; last_fetched_at: Date;
};

export async function getWorkspaceTableRows(
  sql: postgres.Sql, workspaceId: string,
  opts: { sort: SortKey; dir?: SortDir; offset?: number; limit?: number; columnId?: string },
): Promise<TableRow[]> {
  if (!isUuidLike(workspaceId)) return [];
  if (opts.columnId !== undefined && !isUuidLike(opts.columnId)) return [];
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.min(TABLE_MAX, Math.max(1, Math.floor(opts.limit ?? TABLE_PAGE)));
  const orderExpr = ORDER_EXPR[opts.sort] ?? ORDER_EXPR.views;
  const orderDir = opts.dir === 'asc' ? 'asc nulls first' : 'desc nulls last';
  const rows = await sql.unsafe<TableRowRaw[]>(
    // group by tweet_id: 같은 트윗이 여러 열에 걸리면 행이 늘어나므로 한 행으로 묶고 열 이름을 모은다.
    // order by에 tweet_id를 tie-break로 둬야 페이지 경계에서 행이 중복·누락되지 않는다.
    `select t.tweet_id, t.author_handle, t.author_name, t.author_followers, t.text,
            t.tweet_created_at, t.metrics, t.last_fetched_at,
            array_agg(distinct dc.title) as column_titles,
            coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name, 'color', m.color) order by m.name)
                        from candidate c join member m on m.id = c.member_id
                       where c.tweet_id = t.tweet_id and c.workspace_id = $1), '[]'::json) as saved_by
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id and dc.workspace_id = $1
       join tweet t on t.tweet_id = ct.tweet_id
      where not exists (select 1 from dismissed_tweet d where d.workspace_id = $1 and d.tweet_id = t.tweet_id)
        ${opts.columnId ? `and ct.column_id = $4` : ``}
      group by t.tweet_id
      order by ${orderExpr} ${orderDir}, t.tweet_id
      limit ${limit} offset $2`,
    opts.columnId ? [workspaceId, offset, limit, opts.columnId] : [workspaceId, offset, limit],
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
  sql: postgres.Sql, workspaceId: string, opts: { columnId?: string } = {},
): Promise<number> {
  if (!isUuidLike(workspaceId)) return 0;
  if (opts.columnId !== undefined && !isUuidLike(opts.columnId)) return 0;
  const rows = await sql.unsafe<Array<{ n: string }>>(
    // distinct tweet_id — 행 병합과 같은 기준이어야 "전체 N건" 라벨이 실제 행 수와 맞는다.
    `select count(distinct t.tweet_id) as n
       from column_tweet ct
       join deck_column dc on dc.id = ct.column_id and dc.workspace_id = $1
       join tweet t on t.tweet_id = ct.tweet_id
      where not exists (select 1 from dismissed_tweet d where d.workspace_id = $1 and d.tweet_id = t.tweet_id)
        ${opts.columnId ? `and ct.column_id = $2` : ``}`,
    opts.columnId ? [workspaceId, opts.columnId] : [workspaceId],
  );
  return Number(rows[0]?.n ?? 0);
}
```

**주의:** `limit`·`offset`을 문자열 보간이 아니라 파라미터로 넘긴 자리($2)와 리터럴로 넣은 자리(`limit ${limit}`)가 섞여 있다. `limit`은 위에서 `Math.min/Math.max/Math.floor`로 정수로 만든 값이라 안전하고, 기존 `getColumnTweets`(`:127`)도 같은 방식이다. **사용자 입력을 그대로 보간하지 않는다.**

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/lib/tweetStore.test.ts`
Expected: PASS — 기존 테스트 + 새 테스트 2개 전부. `# fail 0`

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음, 종료 코드 0

- [ ] **Step 6: 커밋**

```bash
git add src/lib/tweetStore.ts src/lib/tweetStore.test.ts
git commit -m "$(cat <<'EOF'
feat(x-research): 표 보기용 교차 열 쿼리 — 워크스페이스 전체를 한 목록으로

column_tweet→deck_column→tweet 조인 + 버림 제외 + tweet_id로 병합.
정렬은 서버 SQL이라 '조회수 상위 200'이 전체에서의 진짜 상위 200이다.
DB 마이그레이션 없음. 상한 5000.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 표 데이터 API 라우트

**Files:**
- Create: `src/app/api/tweet-table/route.ts`

**Interfaces:**
- Consumes: Task 4의 `getWorkspaceTableRows`·`getWorkspaceTableCount`·`TABLE_MAX`, Task 1의 `SortKey`
- Produces: `GET /api/tweet-table?workspaceId=&sort=&dir=&offset=&limit=&columnId=` → `{ rows: TableRow[]; total: number }`

기존 라우트(`src/app/api/columns/[id]/tweets/route.ts`)와 같은 형태를 따른다 — `requireAllowedUser()` 게이트, 쿼리 파라미터 allowlist, `NextResponse.json`.

- [ ] **Step 1: 라우트 작성**

`src/app/api/tweet-table/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getWorkspaceTableRows, getWorkspaceTableCount } from '@/lib/tweetStore';
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
  const columnId = sp.get('columnId') || undefined;
  const sql = getSql();
  const [rows, total] = await Promise.all([
    getWorkspaceTableRows(sql, workspaceId, { sort, dir, offset, limit, columnId }),
    getWorkspaceTableCount(sql, workspaceId, { columnId }),
  ]);
  return NextResponse.json({ rows, total });
}
```

- [ ] **Step 2: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 22개 유지.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/tweet-table/route.ts
git commit -m "$(cat <<'EOF'
feat(x-research): 표 데이터 API — 워크스페이스 교차 열 조회

정렬 7종 allowlist, limit 상한 5000, 열 칩 필터(columnId).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 표 렌더 컴포넌트

**Files:**
- Create: `src/components/TweetTable.tsx`

**Interfaces:**
- Consumes: Task 1의 `TableRow`·`SortKey`·`SortDir`, Task 1의 `dirLabel`·`SORT_LABEL`, Task 2의 `TableColumn`·`cellDisplay`, `tweetPermalink`
- Produces: `TweetTable({ rows, columns, sort, dir, onSort }: { rows: TableRow[]; columns: TableColumn[]; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void })`

**접근성(설계 §D):** 진짜 `<table>` + `<th scope="col">`, 정렬 가능한 머리글은 `<th>`에 `aria-sort`. 스크린리더 사용자가 "지금 무엇으로 정렬돼 있는지"를 알 수 없으면 정렬 기능이 없는 것과 같다.

컴포넌트 테스트 하네스가 없으므로 이 태스크의 검증은 `tsc --noEmit` + Task 9의 육안 확인이다.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/TweetTable.tsx`:

```tsx
'use client';
import type { SortDir, SortKey, TableRow } from '@/lib/types';
import { cellDisplay, type TableColumn } from '@/lib/tableColumns';
import { dirLabel, SORT_LABEL } from '@/lib/sortKeys';
import { tweetPermalink } from '@/lib/tweetLink';

export function TweetTable({ rows, columns, sort, dir, onSort }: {
  rows: TableRow[]; columns: TableColumn[]; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}) {
  return (
    // 넓은 표는 화면을 밀지 않고 자기 안에서 가로 스크롤한다
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-ui">
        <thead className="sticky top-0 z-10 bg-x-surface">
          <tr className="border-b border-x-border-strong text-left">
            {columns.map((c) => {
              const active = !!c.sort && c.sort === sort;
              return (
                <th key={c.key} scope="col"
                    // aria-sort는 정렬 가능한 칸에만. 없으면 스크린리더가 현재 정렬을 알 수 없다.
                    aria-sort={c.sort ? (active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
                    className={`whitespace-nowrap px-2 py-2 font-medium ${c.numeric ? 'text-right' : 'text-left'} ${active ? 'text-x-text' : 'text-x-secondary'}`}>
                  {c.sort ? (
                    <button type="button" onClick={() => onSort(c.sort!)}
                            aria-label={active ? dirLabel(c.sort, dir) : `${SORT_LABEL[c.sort]} 기준으로 정렬`}
                            title={active ? dirLabel(c.sort, dir) : `${SORT_LABEL[c.sort]} 기준으로 정렬`}
                            className="rounded px-1 py-0.5 hover:bg-x-text/5">
                      {c.label}{active && <span aria-hidden> {dir === 'desc' ? '↓' : '↑'}</span>}
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tweetId} className="border-b border-x-border align-top hover:bg-x-hover">
              {columns.map((c) => (
                <td key={c.key}
                    className={`px-2 py-2 ${c.numeric ? 'whitespace-nowrap text-right tabular-nums' : ''} ${c.key === 'text' ? 'min-w-[18rem] max-w-[28rem]' : ''}`}>
                  {c.key === 'link'
                    ? <a href={tweetPermalink(r.authorHandle, r.tweetId)} target="_blank" rel="noopener"
                         className="text-x-blue-text hover:underline">원문 ↗</a>
                    : c.key === 'text'
                      // 본문은 2줄 말줄임 — 전문은 카드 보기에서 본다(설계 §C)
                      ? <span className="line-clamp-2 whitespace-pre-wrap">{cellDisplay(r, c)}</span>
                      : <span className={c.key === 'columns' || c.key === 'saved' ? 'text-x-secondary' : ''}>{cellDisplay(r, c)}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 린트**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 22개 유지.

- [ ] **Step 3: 커밋**

```bash
git add src/components/TweetTable.tsx
git commit -m "$(cat <<'EOF'
feat(x-research): 표 렌더 컴포넌트 — 정렬 머리글 + aria-sort

진짜 table/th scope + 정렬 가능한 칸에 aria-sort. 링크 칸은 원문 새 탭,
본문은 2줄 말줄임(전문은 카드 보기).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 표 컨테이너 — 상태·컨트롤·내보내기

**Files:**
- Create: `src/components/TweetTableView.tsx`

**Interfaces:**
- Consumes: Task 5의 `/api/tweet-table`, Task 6의 `TweetTable`, Task 2의 `visibleColumns`·`exportColumns`, Task 3의 `toTsv`·`toCsv`, `useToast`(`@/lib/toastContext`), `apiFetch`(`@/lib/apiFetch`), `ColumnRow`(`@/lib/types`)
- Produces: `TweetTableView({ wsId, columns }: { wsId: string; columns: ColumnRow[] })`

**4상태(설계 §G-2)를 반드시 구분한다.** 보관함에서 이미 같은 버그를 겪었다 — 로딩 중 '없음'이 번쩍이고 에러가 빈 상태로 위장했다. `loaded` 플래그로 첫 로드 완료를 구분하고, **진짜 0건과 필터 0건의 문구를 다르게** 한다.

- [ ] **Step 1: 컴포넌트 작성**

`src/components/TweetTableView.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ColumnRow, SortDir, SortKey, TableRow } from '@/lib/types';
import { exportColumns, visibleColumns } from '@/lib/tableColumns';
import { toCsv, toTsv } from '@/lib/tableExport';
import { TABLE_MAX, TABLE_PAGE } from '@/lib/tableLimits';
import { useToast } from '@/lib/toastContext';
import { Button } from './ui';
import { TweetTable } from './TweetTable';

const MORE_KEY = 'table-show-more';   // 칸 더보기 상태 (개인 보기 취향이라 localStorage)

export function TweetTableView({ wsId, columns }: { wsId: string; columns: ColumnRow[] }) {
  const { show } = useToast();
  const [rows, setRows] = useState<TableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<SortKey>('views');
  const [dir, setDir] = useState<SortDir>('desc');
  const [columnId, setColumnId] = useState<string | null>(null);   // null = 전체
  const [showMore, setShowMore] = useState(false);
  const [loaded, setLoaded] = useState(false);   // 첫 로드 완료 — 로딩 중 빈 상태 문구를 막는다
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setShowMore(localStorage.getItem(MORE_KEY) === '1'); } catch { /* 접근 거부 시 기본값 */ }
  }, []);
  function toggleMore() {
    const next = !showMore;
    setShowMore(next);
    try { localStorage.setItem(MORE_KEY, next ? '1' : '0'); } catch { /* 저장 못 해도 화면은 동작 */ }
  }

  const qs = useCallback((extra: Record<string, string>) => {
    const p = new URLSearchParams({ workspaceId: wsId, sort, dir, ...extra });
    if (columnId) p.set('columnId', columnId);
    return p.toString();
  }, [wsId, sort, dir, columnId]);

  const load = useCallback(async (append: boolean) => {
    setBusy(true); setErr(false);
    try {
      const r = await apiFetch(`/api/tweet-table?${qs({ offset: append ? String(rows.length) : '0', limit: String(TABLE_PAGE) })}`);
      if (!r.ok) { setErr(true); return; }
      const d = await r.json() as { rows: TableRow[]; total: number };
      setRows((cur) => (append ? [...cur, ...d.rows] : d.rows));
      setTotal(d.total);
    } catch { setErr(true); } finally { setBusy(false); setLoaded(true); }
  }, [qs, rows.length]);

  // 정렬·필터가 바뀌면 처음부터 다시 — append=false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(false); }, [wsId, sort, dir, columnId]);

  function onSort(k: SortKey) {
    if (k === sort) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(k); setDir(k === 'date' ? 'desc' : 'desc'); }
  }

  async function copyTable() {
    const text = toTsv(rows, exportColumns(showMore));
    try {
      await navigator.clipboard.writeText(text);
      show(`표 ${rows.length.toLocaleString('en-US')}줄을 복사했어요`, { duration: 2500 });
    } catch {
      show('표를 복사하지 못했어요 — 브라우저 권한을 확인해 주세요');
    }
  }

  async function saveCsv() {
    setBusy(true);
    try {
      // 파일은 '이 데이터 전체'가 자연스러운 기대다(설계 §F) — 화면에 로드된 행이 아니라 전체를 다시 받는다.
      const r = await apiFetch(`/api/tweet-table?${qs({ offset: '0', limit: String(TABLE_MAX) })}`);
      if (!r.ok) { show('CSV를 저장하지 못했어요 — 잠시 후 다시 시도해주세요'); return; }
      const d = await r.json() as { rows: TableRow[]; total: number };
      const csv = toCsv(d.rows, exportColumns(showMore));
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `x-deck-table-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      show(d.total > d.rows.length
        ? `상위 ${d.rows.length.toLocaleString('en-US')}줄만 저장했어요 — 열 칩으로 범위를 좁혀보세요`
        : `CSV ${d.rows.length.toLocaleString('en-US')}줄을 저장했어요`);
    } catch {
      show('CSV를 저장하지 못했어요 — 잠시 후 다시 시도해주세요');
    } finally { setBusy(false); }
  }

  const chip = 'rounded-full border px-2 py-0.5 text-ui hover:bg-x-hover';
  const on = 'border-x-text font-bold text-x-text';
  const off = 'border-x-border-strong text-x-secondary';
  const cols = visibleColumns(showMore);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 열 칩 + 칸 더보기 + 내보내기 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-x-border px-4 py-2">
        <span className="mr-1 text-caption text-x-muted">열</span>
        <button onClick={() => setColumnId(null)} aria-pressed={columnId === null} className={`${chip} ${columnId === null ? on : off}`}>전체</button>
        {columns.map((c) => (
          <button key={c.id} onClick={() => setColumnId(c.id)} aria-pressed={columnId === c.id} className={`${chip} ${columnId === c.id ? on : off}`}>
            {c.title}
          </button>
        ))}
        <Button variant="subtle" onClick={toggleMore} className="ml-auto"
                title={showMore ? '답글·인용·북마크·팔로워·저장·기준 칸을 접어요' : '답글·인용·북마크·팔로워·저장·기준 칸을 펼쳐요'}>
          {showMore ? '− 칸 접기' : '+ 칸 더보기'}
        </Button>
        <Button variant="subtle" onClick={copyTable} disabled={rows.length === 0}
                title="지금 표에 보이는 줄을 탭 구분으로 복사해요 — 노션·엑셀에 붙이면 칸이 갈라집니다">
          표 복사 ({rows.length.toLocaleString('en-US')}줄)
        </Button>
        <Button variant="subtle" onClick={saveCsv} disabled={busy || total === 0}
                title="조건에 맞는 전체를 CSV 파일로 저장해요">
          CSV 저장 (전체 {total.toLocaleString('en-US')}건)
        </Button>
      </div>

      {/* 지표 신선도 — '카드 보기에서'를 빼면 표 모드에 없는 버튼을 가리키는 죽은 안내가 된다(설계 §E) */}
      <p className="border-b border-x-border px-4 py-1 text-caption text-x-muted">
        지표는 각 글을 마지막으로 가져온 시점 기준이에요 — 카드 보기에서 열을 새로고침하면 갱신됩니다
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded ? (
          <p className="p-4 text-ui text-x-muted">불러오는 중…</p>
        ) : err ? (
          <p className="p-4 text-ui text-red-500">
            표를 불러오지 못했어요. <button onClick={() => void load(false)} className="underline">재시도</button>
          </p>
        ) : columns.length === 0 ? (
          <p className="p-4 text-ui text-x-muted">아직 열이 없어요 — 카드 보기에서 열을 만들어보세요</p>
        ) : rows.length === 0 && columnId ? (
          <p className="p-4 text-ui text-x-muted">
            이 열에는 글이 없어요 — <button onClick={() => setColumnId(null)} className="underline">전체 보기</button>
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-ui text-x-muted">아직 수집된 글이 없어요 — 카드 보기에서 열을 새로고침하면 여기에 모입니다</p>
        ) : (
          <>
            <TweetTable rows={rows} columns={cols} sort={sort} dir={dir} onSort={onSort} />
            {rows.length < total && (
              <div className="p-4 text-center">
                <Button variant="subtle" onClick={() => void load(true)} disabled={busy}>
                  {busy ? '불러오는 중…' : `더보기 (${rows.length.toLocaleString('en-US')} / ${total.toLocaleString('en-US')})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 린트 확인**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 **22개에서 증가 없음**.

린트가 늘어나면: `useEffect` 안의 `void load(false)`가 `react-hooks/set-state-in-effect`로 잡힐 수 있다. 이 저장소의 기존 페이지들도 같은 패턴을 쓰고 이미 기준선에 포함돼 있다(`page.tsx:32`, `library/page.tsx:44`). **새 위반이 1건 늘면 그 1건은 허용하고 보고한다** — 대안(effect 없이 로딩)은 이 화면 구조에서 성립하지 않는다. 다만 그 외 규칙 위반은 고친다.

- [ ] **Step 3: 커밋**

```bash
git add src/components/TweetTableView.tsx
git commit -m "$(cat <<'EOF'
feat(x-research): 표 컨테이너 — 4상태·열 칩·칸 더보기·복사/CSV

진짜 0건과 필터 0건 문구를 분리(보관함에서 겪은 버그 재발 방지).
표 복사는 로드된 줄, CSV는 전체를 다시 받아 저장 — 파일은 '전체'가
자연스러운 기대라서. 잘리면 잘렸다고 말한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 덱에 보기 토글 + `?view=table`

**Files:**
- Modify: `src/app/w/[wsId]/page.tsx` (import, 토글 UI, 본문 분기)

**Interfaces:**
- Consumes: Task 7의 `TweetTableView`
- Produces: 없음 (최종 사용자 대면)

`?view=table`을 쓰는 이유: 새로고침·북마크·팀에 링크 공유로 표 상태가 유지된다. Next 16에서 클라이언트 컴포넌트는 `useSearchParams()`로 읽고 `useRouter().replace()`로 쓴다(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md:276-300`). 이 페이지는 이미 전체가 `'use client'`이므로 Suspense 경계를 새로 만들 필요가 없다.

- [ ] **Step 1: import 추가**

`src/app/w/[wsId]/page.tsx`의 `useParams` import 줄을 이것으로 바꾸고,

```tsx
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
```

`Column` import 아래에 추가한다:

```tsx
import { TweetTableView } from '@/components/TweetTableView';
```

- [ ] **Step 2: 보기 모드 상태**

`const { wsId } = useParams<{ wsId: string }>();` 아래에 추가한다:

```tsx
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') === 'table' ? 'table' : 'cards';
  // 주소에 보기 모드를 남긴다 — 새로고침·북마크·링크 공유로 유지된다
  function setView(next: 'cards' | 'table') {
    const p = new URLSearchParams(searchParams.toString());
    if (next === 'table') p.set('view', 'table'); else p.delete('view');
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }
```

- [ ] **Step 3: 툴바에 토글 추가**

`<HelpButton onClick={() => start('deck', deckSteps())} />` **앞**에 넣는다:

```tsx
        {/* 같은 데이터의 다른 표현 — 카드는 한 건을 깊게, 표는 여러 건을 지표로 비교 */}
        <div className="flex items-center gap-1">
          <span className="text-caption text-x-muted">보기</span>
          {(['cards', 'table'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                    title={v === 'cards' ? 'X와 같은 카드로 봐요' : '지표를 나란히 놓고 비교하거나 노션·엑셀로 빼내요'}
                    className={`rounded-full border px-2.5 py-1 text-ui ${view === v ? 'border-x-text font-bold text-x-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
              {v === 'cards' ? '카드' : '표'}
            </button>
          ))}
        </div>
```

**토글 `div`에 `ml-auto`를 넣지 않는다.** `HelpButton`은 자기 안에 `ml-auto`를 갖고 있어(`src/components/HelpButton.tsx:10`) 이미 툴바 오른쪽 끝으로 밀려 있다. 토글에도 `ml-auto`를 주면 두 요소가 남는 공간을 나눠 가져 위치가 어정쩡해진다. 결과 배치는 `+ 컬럼 | 보기 [카드|표] ……… ?`가 된다.

**`HelpButton`을 수정하지 않는다** — 브리핑 화면도 같은 컴포넌트를 쓴다.

- [ ] **Step 4: 본문 분기**

기존 `<main>` 블록(여는 `<main ref={deckRef} …>` 부터 닫는 `</main>` 까지)의 **내용은 한 글자도 바꾸지 않고 앞뒤만 감싼다.**

여는 `<main ref={deckRef} className="flex flex-1 overflow-x-auto">` **바로 앞 줄**에 넣는다:

```tsx
      {view === 'table' ? (
        <TweetTableView wsId={wsId} columns={columns} />
      ) : (
```

닫는 `</main>` **바로 다음 줄**에 넣는다:

```tsx
      )}
```

즉 `<main>`의 자식들(`columns.length === 0` 안내와 `columns.map(...)`)은 그대로 둔다. 들여쓰기는 맞추지 않아도 된다 — 린트가 들여쓰기를 검사하지 않는다.

**주의:** 표 모드에서 `<main>`이 언마운트되므로 `deckRef`가 null이 된다. 드래그 훅(`useDeckDrag`)과 새 컬럼 스크롤 effect는 `deckRef.current`가 없으면 아무것도 하지 않게 이미 작성돼 있다(`getColumnEl`이 `?? null` 반환). 표 모드에서 컬럼을 만들 수 없으므로 새 컬럼 스크롤도 발생하지 않는다. **기존 훅을 조건부로 호출하지 않는다** — 훅 순서가 깨진다.

- [ ] **Step 5: 타입 체크 + 린트 + 빌드**

Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` 출력 없음. 린트 총계 증가 없음(Task 7에서 1건 늘었다면 그 값 유지).

Run: `npm run build 2>&1 | tail -20`
Expected: 빌드 성공. **이 단계를 건너뛰지 않는다** — `useSearchParams`는 프리렌더링과 상호작용하는 Next 16 민감 지점이라 dev에서는 안 나던 오류가 빌드에서 날 수 있다. 실패하면 오류 전문을 보고한다.

- [ ] **Step 6: 커밋**

```bash
git add "src/app/w/[wsId]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(x-research): 덱에 보기 토글 — 카드 / 표

?view=table을 주소에 남겨 새로고침·북마크·링크 공유로 유지된다.
표는 전체 폭을 쓴다(컬럼은 280~720px로 제한돼 표가 안 들어간다).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 최종 검증 + 육안 확인

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 전부 통과, `# fail 0`. 약 4분. 새로 추가된 테스트는 `sortKeys`(4) + `tableColumns`(10) + `tableExport`(7) + `tweetStore`(2) = 23개.

- [ ] **Step 2: 타입 체크 + 린트 + 프로덕션 빌드**

Run: `npx tsc --noEmit; echo "tsc=$?"; npm run lint 2>&1 | tail -3; npm run build 2>&1 | tail -5`
Expected: `tsc=0`, 린트 총계 22(또는 Task 7에서 보고된 23), 빌드 성공.

- [ ] **Step 3: 육안 확인 (로컬 dev + 실제 로그인 세션)**

Run: `npm run dev` 후 `http://localhost:3000/w/<워크스페이스id>` 접속.

확인 항목:
1. 툴바에 `보기 [카드|표]`가 있고, `표`를 누르면 주소가 `?view=table`로 바뀐다. **새로고침해도 표가 유지된다.**
2. 표에 `열` 칸이 있고, 두 열에 걸린 트윗이 **한 행**으로 나오며 열 이름이 둘 다 적혀 있다.
3. `조회수` 머리글을 누르면 방향이 뒤집히고 화살표가 바뀐다. `좋아요`·`답글`·`인용`으로도 정렬된다(이번에 새로 가능해진 것).
4. `+ 칸 더보기`를 누르면 6칸이 늘고, **새로고침해도 펼친 상태가 유지된다**(localStorage).
5. `표 복사` 버튼 라벨의 줄 수가 실제 행 수와 같다. 누르면 `표 N줄을 복사했어요` 토스트.
6. `CSV 저장` 라벨의 `전체 N건`이 `더보기` 옆 총계와 같다. 누르면 파일이 내려오고 토스트가 뜬다.
7. 열 칩으로 좁히면 행이 줄고, 글이 없는 열을 고르면 **`이 열에는 글이 없어요` + `전체 보기`** 가 나온다(진짜 0건 문구와 다름).
8. 표 상단 신선도 안내에 **"카드 보기에서"** 가 들어 있다.
9. `카드`로 돌아오면 덱이 그대로다 — 열 순서·폭·스크롤이 유지되고 드래그도 여전히 된다.
10. 덱 컬럼 헤더의 정렬 탭이 **여전히 4개**다(조회수·날짜·북마크·RT). 7개로 늘어나 있으면 Task 1의 `DECK_SORTS`가 안 먹은 것이다.

- [ ] **Step 4: 붙여넣기 확인 — 사용자 요청 항목**

이 두 가지는 사용자 쪽 앱에서만 확인된다. 사용자에게 확인을 요청한다:

1. **노션**: `표 복사` → 노션 페이지에 붙여넣기 → 칸이 셀로 갈라지는지
2. **엑셀**: `CSV 저장` → 엑셀로 열기 → **일본어 본문이 깨지지 않는지**(BOM), 그리고 **조회수가 숫자로 인식되는지**(`128000`이 아니라 `128K`로 들어가 있으면 Task 2의 `cellExport`가 잘못된 것)

- [ ] **Step 5: 커밋 (필요 시)**

검증에서 고친 것이 있으면 그 변경만 커밋한다. 없으면 커밋하지 않는다.
