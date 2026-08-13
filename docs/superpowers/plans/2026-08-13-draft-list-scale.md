# 원고 목록 규모 대응 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원고가 50건을 넘어도 검색·필터·건수가 전부 정직하게 동작하게 하고, 화면에 그리는 개수만 제한해 렌더 비용을 통제한다.

**Architecture:** 데이터는 상한 1000으로 전량 가져와 기존 클라이언트 측 검색·필터·집계 로직을 그대로 쓴다(전부 전체 기준이 된다). 화면에 그리는 개수만 따로 제한하고, 남은 개수를 버튼에 적어 잘렸다는 사실을 항상 드러낸다. 칸반은 "지금 할 일" 보드로 좁혀 종착 상태(전달됨·미사용)는 최근 몇 장만 두고 표 뷰로 넘긴다.

**Tech Stack:** Next.js 16.2.10 (App Router) · React 19.2.4 · postgres.js · `node:test` + `tsx`

## Global Constraints

- **설계 문서**: `docs/superpowers/specs/2026-08-13-draft-list-scale-design.md` — 판단 근거는 전부 여기 있다. 충돌하면 스펙이 우선이다.
- **Next.js 주의**: 이 저장소의 Next는 학습 데이터와 다르다. 라우트 규약을 새로 쓰기 전에 `node_modules/next/dist/docs/`의 해당 가이드를 읽는다 (AGENTS.md).
- **UX 원칙**: 사용자는 비개발 콘텐츠 기획 담당자다. 라벨에 내부 개념어를 쓰지 않고, 결과는 판단까지 서술하며, **라벨과 값은 항상 일치시킨다** (AGENTS.md). 이번 작업은 특히 마지막 항목이 주제다.
- **깨면 안 되는 규칙**: *"보이지 않는 것은 건드리지 않는다"* — 일괄 처리의 유일한 안전장치다(2026-08-13 일괄 처리 설계 §화면). 렌더 상한을 넣는 순간 이 규칙의 "보이는 것"이 재정의되므로, 선택 관련 코드를 만질 때 반드시 이 기준으로 판단한다.
- **테스트 실행**: 순수 함수는 `node --import tsx --test src/lib/<파일>.test.ts`로 수초. `npm test`는 실 DB에 붙어 약 4분. `.env`는 이 워크트리에 심볼릭 링크로 이미 있다.
- **린트 기준선**: 기존 경고 24개. 늘리지 않는다.
- **라우트·컴포넌트 테스트 하네스가 없다.** 로직은 `src/lib/`의 순수 함수로 빼서 거기서 테스트한다.
- **커밋 메시지**: 한국어. 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **한국어 문구**: 사용자에게 보이는 모든 문자열은 한국어, 기존 어투("~해요")를 따른다.

## 파일 구조

| 파일 | 책임 | Task |
|---|---|---|
| `src/lib/draftViews.ts` | 수정 — `searchDrafts`에 `title` 추가 | A |
| `src/lib/draftViews.test.ts` | 수정 | A |
| `src/lib/draftPaging.ts` | 신규 — 표시 개수·남은 건수·상한 도달 판정(순수) | A |
| `src/lib/draftPaging.test.ts` | 신규 | A |
| `src/lib/kanbanColumns.ts` | 신규 — 진행/종착 분류, 열별 상한, 고정 카드 정렬(순수) | A |
| `src/lib/kanbanColumns.test.ts` | 신규 | A |
| `src/app/api/drafts/route.ts` | 수정 — `GET`에 `limit` 파라미터 | B |
| `src/lib/draftStore.test.ts` | 수정 — `limit` 경계 실 DB 테스트 | B |
| `src/components/DraftTable.tsx` | 수정 — 정렬 상태를 prop으로 받도록(리프팅) | C |
| `src/components/DraftKanban.tsx` | 수정 — 열 스크롤·진행/종착·더 보기·고정 카드 | D |
| `src/components/ShowMoreButton.tsx` | 신규 — `더 보기 (남은 N건)` 공용 버튼 | D |
| `src/app/generate/page.tsx` | 수정 — 표시 개수 상태, 정렬 리프팅, 폴링 limit, 상한 안내, 칸반 배선 | E |

## 실행 순서와 병렬성

파일이 겹치는 작업은 같은 Task로 묶었다.

```
Wave 1 (병렬):  A(순수 함수 3종)    B(라우트 limit)
Wave 2 (병렬):  C(표 정렬 리프팅)   D(칸반 + 공용 버튼)
Wave 3:         E(페이지 — A~D를 전부 배선)
```

---

### Task A: 순수 함수 (검색 보강 · 표시 개수 · 칸반 열)

**Files:**
- Modify: `src/lib/draftViews.ts`, `src/lib/draftViews.test.ts`
- Create: `src/lib/draftPaging.ts`, `src/lib/draftPaging.test.ts`
- Create: `src/lib/kanbanColumns.ts`, `src/lib/kanbanColumns.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `searchDrafts`가 `title`도 뒤진다(타입에 `title: string | null` 추가)
  - `PAGE_STEP = 50`
  - `remaining(total: number, shown: number): number`
  - `atCap(loaded: number, cap: number): boolean`
  - `KANBAN_ACTIVE: DraftStatus[]` / `KANBAN_DONE: DraftStatus[]`
  - `columnLimit(status: DraftStatus): number`
  - `orderColumn<T extends { id: string }>(rows: T[], pinnedIds: ReadonlySet<string>): T[]`

- [ ] **Step 1: 실패하는 테스트 — 제목 검색**

`src/lib/draftViews.test.ts`의 `searchDrafts` 테스트 근처에 추가:

```ts
test('searchDrafts: 사람이 붙인 제목도 검색 대상이다', () => {
  const rows = [
    { title: '보톡스 다운타임 훅', koTitle: null, koLatest: null, direction: '',
      content: { posts: [{ text: '本文' }] }, edited: null },
    { title: null, koTitle: '자동 제목', koLatest: null, direction: '',
      content: { posts: [{ text: '다른 본문' }] }, edited: null },
  ];
  assert.equal(searchDrafts(rows, '다운타임').length, 1);
  assert.equal(searchDrafts(rows, '보톡스 훅').length, 1, '공백 토큰 AND도 제목 안에서 동작');
  assert.equal(searchDrafts(rows, '자동').length, 1, '자동 제목 검색은 그대로');
});
```

기존 `searchDrafts` 테스트의 객체들에도 `title: null,`을 추가한다(타입이 요구한다).

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/draftViews.test.ts`
Expected: FAIL — `title` 프로퍼티가 타입에 없거나, '다운타임' 검색이 0건

- [ ] **Step 3: searchDrafts 확장**

`src/lib/draftViews.ts`의 `searchDrafts`를 고친다. 제네릭 제약과 `hay` 양쪽에 `title`을 넣는다:

```ts
// 검색 — 공백 분리 토큰 전부(AND)가 이름·제목·대역·원문(최신 버전)·방향성 중 어딘가에 포함(대소문자 무시).
// 사람이 붙인 title이 맨 앞인 이유는 그것이 사용자가 "이 원고"라고 부르는 이름이기 때문이다 —
// 이름을 붙여놓고 그 이름으로 못 찾으면 이름을 붙일 이유가 없다(2026-08-13 누락 수정).
export function searchDrafts<T extends {
  title: string | null; koTitle: string | null; koLatest: string[] | null; direction: string;
  content: PreviewSource; edited: PreviewSource | null;
}>(list: T[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return list;
  return list.filter((d) => {
    const hay = [
      d.title ?? '', d.koTitle ?? '', ...(d.koLatest ?? []),
      ...(d.edited ?? d.content).posts.map((p) => p.text),
      d.direction,
    ].join('\n').toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/draftViews.test.ts`
Expected: PASS (기존 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/draftViews.ts src/lib/draftViews.test.ts
git commit -m "fix(draft): 사람이 붙인 제목도 검색에 걸리게

이름을 붙여놓고 그 이름으로 못 찾는 상태였다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: 실패하는 테스트 — 표시 개수**

`src/lib/draftPaging.test.ts` 신규 생성:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_STEP, remaining, atCap } from './draftPaging.ts';

test('PAGE_STEP: 한 번에 늘리는 개수', () => {
  assert.equal(PAGE_STEP, 50);
});

test('remaining: 아직 안 그린 개수 — 음수가 되지 않는다', () => {
  assert.equal(remaining(312, 50), 262);
  assert.equal(remaining(40, 50), 0, '전체가 표시 개수보다 적으면 0');
  assert.equal(remaining(50, 50), 0);
  assert.equal(remaining(0, 50), 0);
});

test('atCap: 로드된 수가 상한과 같으면 더 있을 수 있다는 뜻', () => {
  assert.equal(atCap(1000, 1000), true);
  assert.equal(atCap(999, 1000), false);
  assert.equal(atCap(0, 1000), false);
});
```

- [ ] **Step 7: 실패 확인**

Run: `node --import tsx --test src/lib/draftPaging.test.ts`
Expected: FAIL — `Cannot find module './draftPaging.ts'`

- [ ] **Step 8: draftPaging 구현**

`src/lib/draftPaging.ts` 신규 생성:

```ts
// 화면에 그리는 개수의 계산 — 데이터를 자르는 것이 아니라 '그리는 양'만 자른다(설계 §A).
// 통신은 병목이 아니다(1000건 gzip 450KB). 병목은 카드 500장이 한 번에 DOM에 올라가는 쪽이다.

export const PAGE_STEP = 50; // '더 보기' 한 번에 늘어나는 개수

// 목록 조회 상한. 라우트(서버)와 안내 문구(클라이언트)가 같은 수를 봐야 한다 —
// 두 곳에 따로 적으면 한쪽만 바뀌었을 때 "1000건만 보고 있어요"가 거짓말이 된다.
export const LIST_CAP = 1000;

// 아직 안 그린 개수. 이 수를 버튼에 적는 것이 이 설계의 핵심이다 —
// 지금의 진짜 문제는 잘리는 것이 아니라 잘렸다는 걸 아무도 모르는 것이다(설계 §C).
export function remaining(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

// 서버가 상한 개수를 꽉 채워 돌려줬다 = 더 있을 수 있다. 정확히 상한과 같을 때도 참이 되지만
// 안내 문구("최근 N건만 보고 있어요")가 그 경우에도 사실이라 해롭지 않다(설계 §B).
export function atCap(loaded: number, cap: number): boolean {
  return loaded >= cap;
}
```

- [ ] **Step 9: 통과 확인**

Run: `node --import tsx --test src/lib/draftPaging.test.ts`
Expected: PASS (3개)

- [ ] **Step 10: 실패하는 테스트 — 칸반 열**

`src/lib/kanbanColumns.test.ts` 신규 생성:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KANBAN_ACTIVE, KANBAN_DONE, columnLimit, orderColumn, isDoneColumn } from './kanbanColumns.ts';

test('열 분류: 진행 3개 · 종착 2개, 겹치지 않고 빠짐도 없다', () => {
  assert.deepEqual(KANBAN_ACTIVE, ['draft', 'review', 'approved']);
  assert.deepEqual(KANBAN_DONE, ['delivered', 'unused']);
  assert.equal(KANBAN_ACTIVE.length + KANBAN_DONE.length, 5);
});

test('isDoneColumn: 결정이 끝난 상태만 true', () => {
  assert.equal(isDoneColumn('delivered'), true);
  assert.equal(isDoneColumn('unused'), true);
  assert.equal(isDoneColumn('draft'), false);
  assert.equal(isDoneColumn('approved'), false);
});

test('columnLimit: 진행 열은 넉넉히, 종착 열은 최근 몇 장만', () => {
  assert.equal(columnLimit('draft'), 50);
  assert.equal(columnLimit('review'), 50);
  assert.equal(columnLimit('approved'), 50);
  assert.equal(columnLimit('delivered'), 10);
  assert.equal(columnLimit('unused'), 10);
});

test('orderColumn: 방금 옮긴 카드를 맨 앞으로 — 나머지 순서는 그대로', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(orderColumn(rows, new Set(['c'])).map((r) => r.id), ['c', 'a', 'b', 'd']);
});

test('orderColumn: 고정이 여러 개면 원래 순서를 유지한 채 앞으로', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(orderColumn(rows, new Set(['d', 'b'])).map((r) => r.id), ['b', 'd', 'a', 'c']);
});

test('orderColumn: 고정이 없거나 이 열에 없으면 원본 그대로 — 원본 배열은 변형하지 않는다', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(orderColumn(rows, new Set()).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(orderColumn(rows, new Set(['zzz'])).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b']);
});
```

- [ ] **Step 11: 실패 확인**

Run: `node --import tsx --test src/lib/kanbanColumns.test.ts`
Expected: FAIL — `Cannot find module './kanbanColumns.ts'`

- [ ] **Step 12: kanbanColumns 구현**

`src/lib/kanbanColumns.ts` 신규 생성:

```ts
import type { DraftStatus } from './draftStatus.ts';

// 칸반은 "지금 할 일" 보드다(설계 §F). 상태 축은 원래 진행도 라벨이라
// draft→review→approved는 아직 할 일이 남은 상태이고, delivered·unused는 결정이 끝난 종착이다.
// 종착 상태는 시간이 갈수록 쌓이기만 한다 — 1년 뒤 '전달됨' 열의 900장을 스크롤할 일은 없고,
// 그건 검색·정렬을 가진 표 뷰가 할 일이다.
export const KANBAN_ACTIVE: DraftStatus[] = ['draft', 'review', 'approved'];
export const KANBAN_DONE: DraftStatus[] = ['delivered', 'unused'];

export function isDoneColumn(status: DraftStatus): boolean {
  return (KANBAN_DONE as string[]).includes(status);
}

// 열마다 그리는 상한. 종착 열이 작은 것은 "여기는 확인용 창구"라는 뜻이고,
// 그래서 종착 열에는 표 뷰로 데려가는 버튼이 함께 붙는다(설계 §F).
export function columnLimit(status: DraftStatus): number {
  return isDoneColumn(status) ? 10 : 50;
}

// 방금 드래그로 옮긴 카드를 열 맨 앞에 세운다.
//
// 이게 없으면: 열은 최신순으로 정렬되는데(groupByStatus) 상위 N장만 그리므로,
// 3개월 된 원고를 '전달됨'으로 떨구는 순간 그 카드는 200번째쯤으로 정렬돼 화면에서 사라진다.
// 사용자에겐 "옮겼는데 없어졌다"이다(설계 §H). 실제 칸반 도구들이 드롭한 자리에 카드를
// 남겨두는 것과 같은 처리다.
//
// 고정끼리는 원본 순서를 유지한다 — 여러 장을 옮겼을 때 서로 자리가 뒤바뀌면 그것도 놀라움이다.
export function orderColumn<T extends { id: string }>(rows: T[], pinnedIds: ReadonlySet<string>): T[] {
  if (pinnedIds.size === 0) return [...rows];
  const pinned = rows.filter((r) => pinnedIds.has(r.id));
  const rest = rows.filter((r) => !pinnedIds.has(r.id));
  return [...pinned, ...rest];
}
```

- [ ] **Step 13: 통과 확인**

Run: `node --import tsx --test src/lib/kanbanColumns.test.ts`
Expected: PASS (6개)

- [ ] **Step 14: 린트와 커밋**

Run: `npm run lint`
Expected: 새 경고 없음(24개 이하)

```bash
git add src/lib/draftPaging.ts src/lib/draftPaging.test.ts src/lib/kanbanColumns.ts src/lib/kanbanColumns.test.ts
git commit -m "feat(draft): 표시 개수·칸반 열 분류 순수 함수

그리는 양만 자르고 남은 개수를 드러내기 위한 계산, 그리고 칸반을
'지금 할 일' 보드로 좁히는 열 분류·고정 카드 정렬.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B: 라우트 `limit` 파라미터

**Files:**
- Modify: `src/app/api/drafts/route.ts`
- Test: `src/lib/draftStore.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `GET /api/drafts?limit=<n>` — 미지정 시 1000, 1~1000으로 클램프

- [ ] **Step 1: Next.js 라우트 규약 확인**

Run: `ls node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`
그 다음 `route.md`를 읽는다. 이 저장소의 Next 16.2.10은 학습 데이터와 다를 수 있다.

- [ ] **Step 2: 실패하는 테스트 — limit 경계**

`src/lib/draftStore.test.ts` 맨 아래에 추가:

```ts
test('listDrafts: limit이 실제로 개수를 자른다', async () => {
  const mk = () => insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + 'limit', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  const ids = [await mk(), await mk(), await mk()];

  const two = await listDrafts(sql, { limit: 2 });
  assert.equal(two.length, 2);
  // 최신순이므로 마지막에 만든 것이 먼저 온다
  assert.equal(two[0].id, ids[2]);

  const many = await listDrafts(sql, { limit: 1000 });
  assert.ok(many.length >= 3, '상한을 크게 주면 최소한 방금 만든 3건은 들어온다');

  await removeDraftsBulk(sql, ids);
});
```

- [ ] **Step 3: 실패 확인 (또는 이미 통과)**

Run: `npm test -- --test-name-pattern="listDrafts: limit"`
Expected: PASS — `listDrafts`는 이미 `limit` 옵션을 지원한다. 이 테스트는 **라우트를 고치기 전에 스토어 동작을 고정하는 회귀 방지용**이다. 실패하면 스토어에 문제가 있다는 뜻이니 멈추고 원인을 보고한다.

- [ ] **Step 4: 라우트에 limit 파라미터 추가**

`src/app/api/drafts/route.ts`의 `GET`을 고친다. 상한은 **Task A의 `draftPaging.ts`에서 가져온다** — 안내 문구를 그리는 클라이언트와 같은 수를 봐야 하고, 두 곳에 따로 적으면 한쪽만 바뀌었을 때 "1000건만 보고 있어요"가 거짓말이 된다:

```ts
import { LIST_CAP } from '@/lib/draftPaging';
```

`GET` 안에서 `status` 검증 아래에 추가하고, `listDrafts` 호출에 넘긴다:

```ts
  // 폴링은 방금 만들어진 것만 찾으므로 작은 값으로 부른다(설계 §I) — 취소 한 번에
  // 5초 간격 24회가 나가는데 그때마다 전량을 받으면 수 MB가 오간다.
  // 숫자가 아니거나 범위를 벗어난 값은 오류로 세우지 않고 상한으로 클램프한다 — 목록 조회는
  // 읽기 전용이고, 여기서 400을 주면 낡은 클라이언트가 목록을 통째로 못 보는 쪽이 더 나쁘다.
  const rawLimit = Number(params.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), LIST_CAP) : LIST_CAP;
```

```ts
  return NextResponse.json(await listDrafts(getSql(), { clientId, status: status ?? undefined, limit }));
```

- [ ] **Step 5: 타입·린트 확인**

Run: `npx tsc --noEmit` 그리고 `npm run lint`
Expected: 오류 0건, 새 경고 없음

- [ ] **Step 6: 라우트 동작 확인**

Run: `npm run dev` 후 다른 터미널에서 (인증 쿠키가 없어 401이 정상 — 라우트가 살아 있음을 확인):

```bash
curl -s -o /dev/null -w "%{http_code}\n" "localhost:3000/api/drafts?limit=20"
```

Expected: `401`

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/drafts/route.ts src/lib/draftStore.test.ts
git commit -m "feat(draft): 목록 조회에 limit 파라미터(기본·상한 1000)

50건 상한이 곧 닿는다. 데이터는 전량 가져와 검색·건수·필터를 전체
기준으로 되돌리고, 폴링만 작은 값으로 부른다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C: 표 정렬 상태 리프팅

**Files:**
- Modify: `src/components/DraftTable.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: `DraftTable`이 정렬 상태를 **직접 갖지 않고** prop으로 받는다 —
  - `sort: TableSort`
  - `onSortChange: (next: TableSort) => void`
  - `drafts`는 **이미 정렬·절단이 끝난 배열**로 받는다(컴포넌트가 `sortDrafts`를 부르지 않는다)

**왜:** 페이지에서 먼저 50개로 자르면 표는 "최근 50건을 클라이언트명으로 정렬"을 보여주는데, 사용자는 그걸 "전체를 클라이언트명으로 정렬한 상위 50"으로 읽는다(설계 §D). 정렬이 자르기보다 먼저 일어나야 하므로 두 작업을 같은 곳(페이지)에서 한다.

- [ ] **Step 1: 정렬 상태를 prop으로 바꾼다**

`src/components/DraftTable.tsx`를 고친다.

(1) props에 둘을 더하고, 내부 `useState`와 `sortDrafts` 호출을 제거한다:

```tsx
export function DraftTable({ drafts, clientNameOf, onChangeStatus, onOpenCard, selectedIds, onToggleId, onToggleAll, sort, onSortChange }: {
  drafts: DraftRow[];        // 이미 정렬·절단이 끝난 배열 — 이 컴포넌트는 순서를 바꾸지 않는다(설계 §D)
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
  selectedIds: ReadonlySet<string>;
  onToggleId: (id: string) => void;
  onToggleAll: () => void;
  sort: TableSort;
  onSortChange: (next: TableSort) => void;
}) {
  const rows = drafts;
```

`useState` import와 `sortDrafts` import가 더 이상 안 쓰이면 지운다(안 지우면 린트 경고가 늘어난다). `TableSort`·`TableSortKey` 타입 import는 남긴다.

(2) `sortBtn`을 콜백을 쓰도록 바꾼다:

```tsx
  const sortBtn = (key: TableSortKey, label: string) => (
    <button onClick={() => onSortChange({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })}
            className="flex items-center gap-1 hover:text-x-text">
      {label}{sort.key === key && <span aria-hidden>{sort.dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );
```

(3) `aria-sort`를 읽는 세 곳(`sort.key === 'client'` 등)은 그대로 둔다 — 이제 prop을 읽을 뿐 동작은 같다.

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit`
Expected: `page.tsx`에서 "`sort`, `onSortChange` 누락" 오류만 난다 — Task E가 채운다. `DraftTable.tsx` 자체 오류는 없어야 한다.

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 새 경고 없음. 특히 안 쓰는 import가 남지 않았는지 확인한다.

- [ ] **Step 4: 커밋**

```bash
git add src/components/DraftTable.tsx
git commit -m "refactor(draft-table): 정렬 상태를 페이지로 리프팅

정렬이 자르기보다 먼저 일어나야 한다. 표 안에서 정렬하면 '최근 50건만
정렬한 결과'를 전체 정렬로 읽게 된다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task D: 칸반 재설계 + 공용 더 보기 버튼

**Files:**
- Create: `src/components/ShowMoreButton.tsx`
- Modify: `src/components/DraftKanban.tsx`

**Interfaces:**
- Consumes: `KANBAN_ACTIVE`·`KANBAN_DONE`·`columnLimit`·`orderColumn`·`isDoneColumn` (Task A) · `remaining` (Task A)
- Produces:
  - `ShowMoreButton({ total, shown, onMore })`
  - `DraftKanban`에 prop 추가: `pinnedIds: ReadonlySet<string>`, `onGoToTable: (status: DraftStatus) => void`

- [ ] **Step 1: 공용 더 보기 버튼**

`src/components/ShowMoreButton.tsx` 신규 생성. 카드·표·칸반이 같은 버튼을 쓴다 — 같은 성격의 "잘렸음"이 화면마다 다르게 보이면 안 된다:

```tsx
'use client';
import { remaining } from '@/lib/draftPaging';

// 남은 개수를 버튼에 적는 것이 이 컴포넌트의 존재 이유다(설계 §C).
// 잘렸다는 사실을 말하지 않는 목록은, 사용자가 "예전 거가 없네?"를 겪고도 원인을 알 수 없다.
export function ShowMoreButton({ total, shown, onMore }: {
  total: number; shown: number; onMore: () => void;
}) {
  const left = remaining(total, shown);
  if (left === 0) return null;
  return (
    <button type="button" onClick={onMore}
            className="mt-3 w-full rounded-lg border border-x-border-strong bg-white py-2 text-ui font-bold text-x-secondary hover:bg-x-hover">
      더 보기 <span className="font-normal text-x-muted">(남은 {left}건)</span>
    </button>
  );
}
```

- [ ] **Step 2: 칸반 열을 진행/종착으로 나누고 스크롤·상한을 넣는다**

`src/components/DraftKanban.tsx`를 고친다.

(1) import와 props:

```tsx
import { useState } from 'react';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import { columnLimit, isDoneColumn, orderColumn } from '@/lib/kanbanColumns';
import { ShowMoreButton } from '@/components/ShowMoreButton';
```

```tsx
export function DraftKanban({ drafts, clientNameOf, onChangeStatus, onOpenCard, pinnedIds, onGoToTable }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
  // 방금 드래그로 옮긴 카드 — 그 열 맨 위에 세운다(설계 §H). 세션 한정이라 페이지가 소유한다.
  pinnedIds: ReadonlySet<string>;
  // 종착 열의 '전체 보기' — 표 뷰로 전환하며 그 상태 필터를 건다. 안내문이 아니라 실제로 데려간다.
  onGoToTable: (status: DraftStatus) => void;
}) {
```

(2) 열마다 표시 개수를 갖는다. 열별로 독립이라 상태도 열별이다:

```tsx
  const [shown, setShown] = useState<Partial<Record<DraftStatus, number>>>({});
  const byStatus = groupByStatus(drafts);
```

(3) 열 렌더를 고친다. 지금은 `DRAFT_STATUSES.map((s) => (` 로 JSX를 바로 돌려주고 있다. 계산이 필요하므로 **블록 본문으로 바꾸고 `return (`을 넣는다**(닫는 괄호도 `))` → `);})`로 맞춰야 한다 — 여기서 괄호를 놓치는 실수가 잦다). 블록 안 맨 위에:

```tsx
        const all = orderColumn(byStatus[s], pinnedIds);
        const limit = shown[s] ?? columnLimit(s);
        const rows = all.slice(0, limit);
        const done = isDoneColumn(s);
```

그리고 열 바깥 `<div>`의 className에 높이·스크롤을 준다. 지금은 높이 제한이 없어서 가장 긴 열이 페이지 전체를 끌고 늘어난다:

```tsx
             className={`flex max-h-[calc(100vh-220px)] min-h-[220px] min-w-[230px] max-w-[360px] flex-1 shrink-0 flex-col rounded-xl border p-2 ${overCol === s ? 'border-x-blue bg-x-blue/5' : 'border-x-border bg-x-surface'}`}>
```

(4) 열 머리의 건수는 **자른 뒤가 아니라 전체 기준**이어야 한다. `byStatus[s].length`를 그대로 둔다 — 10장만 그려도 "전달됨 302"는 진짜 302다.

(5) 카드 목록을 감싼 `<div className="flex flex-col gap-2">`에 스크롤을 준다:

```tsx
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
```

(6) `byStatus[s].map(...)`을 `rows.map(...)`으로 바꾼다. 카드 안에 고정 표식을 단다 — 카드 `<div>`의 첫 자식으로:

```tsx
                {pinnedIds.has(d.id) && (
                  <p className="mb-1 text-caption font-bold text-x-blue-text">방금 옮김</p>
                )}
```

(7) 빈 상태 조건을 `rows.length === 0`으로 바꾸고, 목록 아래(스크롤 div 안 마지막)에 더 보기 / 전체 보기를 단다:

```tsx
            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed border-x-border-strong p-3 text-center text-caption leading-relaxed text-x-muted">
                여기로 끌어다 놓으면<br />상태가 바뀝니다
              </p>
            )}
            {/* 종착 열은 '확인용 창구'다 — 더 보기 대신 표로 데려간다(설계 §F).
                검색·정렬이 필요한 일이고 그건 표가 하는 일이다. */}
            {done && all.length > rows.length && (
              <button type="button" onClick={() => onGoToTable(s)}
                      className="mt-2 w-full rounded-lg border border-x-border-strong bg-white px-2 py-2 text-caption font-bold text-x-secondary hover:bg-x-hover">
                {STATUS_LABEL[s]} 원고 {all.length}건 전체 보기 →
              </button>
            )}
            {!done && (
              <ShowMoreButton total={all.length} shown={rows.length}
                              onMore={() => setShown((cur) => ({ ...cur, [s]: (cur[s] ?? columnLimit(s)) + 50 }))} />
            )}
```

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit` 그리고 `npm run lint`
Expected: `page.tsx`에서 "`pinnedIds`, `onGoToTable` 누락" 오류만 난다(Task E가 채운다). `DraftKanban.tsx`·`ShowMoreButton.tsx` 자체 오류·경고는 없어야 한다.

- [ ] **Step 4: 커밋**

```bash
git add src/components/ShowMoreButton.tsx src/components/DraftKanban.tsx
git commit -m "feat(kanban): '지금 할 일' 보드로 — 열 스크롤·진행/종착 분리

종착 상태(전달됨·미사용)는 쌓이기만 하므로 최근 10장만 두고 표로
데려간다. 열마다 자체 스크롤을 줘 가장 긴 열이 페이지를 끌고 늘어나던
것도 없앤다. 방금 옮긴 카드는 정렬에 밀려 사라지지 않게 맨 위에 세운다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task E: 페이지 배선

**Files:**
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: Task A~D 전부
- Produces: 없음 (최종 소비자)

**주의:** 이 파일은 낙관적 갱신의 경합 방지 패턴이 여러 개 얽혀 있다. 기존 패턴을 따르고 새 패턴을 발명하지 않는다. 특히 **선택(selectedIds) 관련 코드를 만질 때는 "보이지 않는 것은 건드리지 않는다"가 유일한 판단 기준**이다.

- [ ] **Step 1: 목록 조회에 상한을 명시하고 폴링만 작게 부른다**

초기 로드(`apiFetch('/api/drafts')`)는 그대로 둔다 — 라우트 기본값이 이미 1000이다. 폴링(`cancelGenerate` 안)만 바꾼다:

```ts
        const r = await apiFetch('/api/drafts?limit=20');
```

주석을 남긴다:

```ts
        // 폴링이 찾는 것은 방금 만들어진 것뿐이고 새 원고는 항상 최신순 맨 앞에 온다(시안 최대 5개).
        // 전량을 5초마다 다시 받으면 취소 한 번에 수 MB가 오간다(설계 §I).
```

- [ ] **Step 2: 표시 개수 상태와 리셋**

`selectedIds` 선언 근처에 추가:

```ts
  // 화면에 그리는 개수 — 데이터는 전량 로드하고 이것만 제한한다(설계 §A).
  const [shownCount, setShownCount] = useState(PAGE_STEP);
  // 표 정렬 — 자르기보다 먼저 정렬해야 하므로 상태가 여기 있어야 한다(설계 §D)
  const [tableSort, setTableSort] = useState<TableSort>({ key: 'createdAt', dir: 'desc' });
```

import에 더한다:

```ts
import { PAGE_STEP, LIST_CAP, atCap } from '@/lib/draftPaging';
import { sortDrafts, type TableSort } from '@/lib/draftViews';
import { ShowMoreButton } from '@/components/ShowMoreButton';
```

`sortDrafts`·`TableSort`는 이미 `@/lib/draftViews`에서 다른 것들을 가져오고 있으니 그 import 문에 이름만 더한다.

조건이 바뀌면 표시 개수를 처음으로 되돌린다. 새 조건에서 이전에 늘려둔 개수가 남으면 "왜 이만큼 보이지"가 설명되지 않는다:

```ts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 조건 변경 시 1회 리셋(옵션-선택 리셋과 같은 관례)
    setShownCount(PAGE_STEP);
  }, [filter.status, filter.clientId, query, procFilter, period, view]);
```

- [ ] **Step 3: 정렬 → 자르기 순서로 파생값을 만든다**

`visibleDrafts` 아래를 이렇게 바꾼다. **`visibleIds`가 잘라낸 배열에서 나와야 한다** — 그러지 않으면 표 전체 선택이 화면에 없는 것까지 고르고, 그대로 일괄 삭제된다(설계 §E):

```ts
  // 표는 정렬한 뒤에 자른다 — 순서가 뒤바뀌면 "최근 50건만 정렬한 결과"를 전체 정렬로 읽게 된다(설계 §D).
  // 카드 뷰는 정렬 개념이 없어 목록 순서(최신순) 그대로 자른다.
  const orderedDrafts = useMemo(
    () => (view === 'table' ? sortDrafts(visibleDrafts, tableSort, clientNameOf) : visibleDrafts),
    [view, visibleDrafts, tableSort, clientNameOf]);
  const shownDrafts = useMemo(() => orderedDrafts.slice(0, shownCount), [orderedDrafts, shownCount]);
  // 선택의 '보이는 것'은 실제로 그려진 것이다(설계 §E) — 이 한 줄이 일괄 삭제의 안전장치다.
  const visibleIds = useMemo(() => shownDrafts.map((d) => d.id), [shownDrafts]);
```

기존 `const visibleIds = useMemo(() => visibleDrafts.map((d) => d.id), [visibleDrafts]);` 줄은 지운다(위 것으로 대체된다).

- [ ] **Step 4: 칸반 고정 카드와 표 이동**

`changeStatus` 아래에 추가:

```ts
  // 칸반에서 방금 옮긴 카드 — 세션 한정. 열은 최신순 정렬 + 상위 N장만 그리므로, 오래된 원고를
  // 옮기면 정렬에 밀려 화면에서 사라진다. 그 카드를 열 맨 위에 세워 "옮겼는데 없어졌다"를 막는다(설계 §H).
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set());
```

(선언은 다른 `useState`들 근처로 옮겨도 된다 — 훅 순서만 지키면 위치는 자유다.)

칸반 렌더에서 상태 변경을 감쌀 핸들러를 만든다:

```ts
  function kanbanChangeStatus(d: DraftRow, s: DraftStatus) {
    setPinnedIds((cur) => new Set([...cur, d.id]));
    changeStatus(d, s);
  }
  // 종착 열의 '전체 보기' — 표 뷰로 전환하며 그 상태 필터를 건다(설계 §F).
  function goToTable(status: DraftStatus) {
    setFilter((f) => ({ ...f, status }));
    setView('table');
  }
```

- [ ] **Step 5: 렌더 배선**

(1) 상한 도달 안내를 결과 영역 맨 위(빈 상태 문구들 위)에 넣는다:

```tsx
          {atCap(drafts.length, LIST_CAP) && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-ui text-amber-800">
              원고가 1000건을 넘어 최근 1000건만 보고 있어요 — 예전 원고는 아직 검색·필터에 잡히지 않아요.
            </p>
          )}
```

(2) 카드 뷰: `visibleDrafts.map` → `shownDrafts.map`으로 바꾸고, 목록 뒤에 더 보기를 단다:

```tsx
          {view === 'cards' && shownDrafts.map((d) => (
            ...기존 DraftCard 그대로...
          ))}
          {view === 'cards' && (
            <div className="w-full max-w-[600px]">
              <ShowMoreButton total={orderedDrafts.length} shown={shownDrafts.length}
                              onMore={() => setShownCount((n) => n + PAGE_STEP)} />
            </div>
          )}
```

(3) 표 뷰: `drafts={shownDrafts}`로 바꾸고 정렬 prop을 넘기고, 표 아래에 더 보기를 단다:

```tsx
          {view === 'table' && loaded && shownDrafts.length > 0 && (
            <>
              <DraftTable drafts={shownDrafts} clientNameOf={clientNameOf}
                          onChangeStatus={changeStatus} onOpenCard={setPeekId}
                          selectedIds={selectedIds}
                          onToggleId={(id) => setSelectedIds((cur) => toggleId(cur, id))}
                          onToggleAll={() => setSelectedIds((cur) => toggleAll(cur, visibleIds))}
                          sort={tableSort} onSortChange={setTableSort} />
              <ShowMoreButton total={orderedDrafts.length} shown={shownDrafts.length}
                              onMore={() => setShownCount((n) => n + PAGE_STEP)} />
              {selectedIds.size > 0 && (
                ...기존 BulkActionBar 그대로...
              )}
            </>
          )}
```

빈 상태 가드(`visibleDrafts.length === 0`)는 그대로 둔다 — 그건 "조건에 맞는 게 없다"는 판정이고 표시 개수와 무관하다.

(4) 칸반: prop 둘을 넘긴다:

```tsx
            <DraftKanban drafts={scoped} clientNameOf={clientNameOf}
                         onChangeStatus={kanbanChangeStatus} onOpenCard={setPeekId}
                         pinnedIds={pinnedIds} onGoToTable={goToTable} />
```

- [ ] **Step 6: 타입·린트·빌드**

Run: `npx tsc --noEmit` → 오류 0건
Run: `npm run lint` → 24개 이하
Run: `npm run build` → 성공

- [ ] **Step 7: 커밋**

```bash
git add src/app/generate/page.tsx
git commit -m "feat(generate): 전량 로드 + 점진 렌더 배선

검색·상태 탭 건수·기간 필터가 전체 기준으로 정확해진다. 그리는 개수만
제한하고 남은 건수를 버튼에 적는다. 표는 정렬 뒤에 자르고, 선택의
'보이는 것'은 실제로 그려진 것만을 뜻한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 최종 확인 (모든 Task 완료 후)

- [ ] `npm test` — 실패 0건 (약 4분)
- [ ] `npm run lint` — 24개 이하
- [ ] `npm run build` — 성공
- [ ] **로컬 화면 확인** (`npm run dev`, 사용자가 직접):
  - 원고 44건 상태에서 카드·표에 "더 보기"가 뜨지 않는다(50건 미만이므로)
  - 상태 탭 건수가 전체 기준과 일치한다
  - 표에서 클라이언트명으로 정렬 → 전체가 정렬된 결과의 앞부분이 보인다
  - 표에서 헤더 체크박스로 전체 선택 → 화면에 그려진 행만 선택된다
  - 칸반 열이 각각 스크롤되고, 종착 열(전달됨·미사용)에 "전체 보기" 버튼이 뜬다
  - 칸반에서 오래된 카드를 '전달됨'으로 끌어다 놓으면 그 열 맨 위에 "방금 옮김"으로 남는다
  - 원고 이름으로 검색하면 찾아진다
