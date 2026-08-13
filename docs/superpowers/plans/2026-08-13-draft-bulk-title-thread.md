# 초안 일괄 처리 · 제목 수정 · 스레드 칸 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /generate 워크벤치에서 원고를 여러 건 골라 한 번에 정돈하고, 목록에 나올 이름을 직접 붙이고, 스레드 칸을 손으로 늘리거나 줄일 수 있게 한다.

**Architecture:** 표 뷰에만 다중 선택을 붙이고(카드는 X 미러링 보존, 칸반은 드래그와 충돌), 일괄 변경은 개별 PATCH를 N번 쏘는 대신 새 컬렉션 라우트에서 단일 SQL로 처리한다. 사람이 붙인 제목은 자동 제목(`ko_title`)과 표시 규칙이 정반대라 별도 컬럼(`title`)에 둔다. 칸 수가 바뀌면 `format` 컬럼을 서버가 함께 갱신해 다시쓰기가 칸을 잘라내는 기존 결함을 없앤다.

**Tech Stack:** Next.js 16.2.10 (App Router, `proxy.ts` 미들웨어) · React 19.2.4 · postgres.js · Supabase(인증·스토리지) · `node:test` + `tsx`

## Global Constraints

- **설계 문서**: `docs/superpowers/specs/2026-08-13-draft-bulk-title-thread-design.md` — 판단 근거는 전부 여기 있다. 충돌하면 스펙이 우선이다.
- **Next.js 주의**: 이 저장소의 Next는 학습 데이터와 다르다. 라우트·규약을 새로 쓰기 전에 `node_modules/next/dist/docs/`의 해당 가이드를 읽는다 (AGENTS.md).
- **UX 원칙**: 사용자는 비개발 콘텐츠 기획 담당자다. 라벨에 내부 개념어를 쓰지 않고, 결과는 숫자만 던지지 말고 판단까지 서술하며, 라벨과 값은 항상 일치시킨다 (AGENTS.md 전문).
- **테스트 실행**: 순수 함수는 `node --import tsx --test src/lib/<파일>.test.ts`로 수초 안에 돈다. `npm test`는 실 DB에 붙어 약 4분 걸린다.
- **린트 기준선**: 기존 경고 24개. 새 경고를 늘리지 않는다. `npm run lint`로 확인.
- **라우트·컴포넌트 테스트 하네스가 없다.** 라우트와 React 컴포넌트는 단위 테스트를 쓰지 않는다 — 로직은 `src/lib/`의 순수 함수로 빼서 거기서 테스트한다.
- **커밋 메시지**: 한국어 한 줄 요약 + 필요 시 본문. 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **한국어 문구**: 사용자에게 보이는 모든 문자열은 한국어. 기존 문구의 어투(존댓말, "~해요")를 따른다.

## 선행 조건 (사람이 해야 함)

이 워크트리에는 `.env`가 없다(gitignore). DB 테스트와 마이그레이션 적용에 필요하다:

```
vercel link            # 대화형 — cb-x-deck 프로젝트를 고른다
cat .vercel/project.json   # projectName이 cb-x-deck인지 반드시 확인 (다른 프로젝트에 붙는 사고 이력 있음)
vercel env pull .env --environment=production
```

`.env` 없이도 Task B·D는 그대로 진행된다(순수 함수·컴포넌트). Task A의 DB 테스트와 Task C·E·F의 통합 확인은 `.env`가 있어야 한다.

## 파일 구조

| 파일 | 책임 | 담당 Task |
|---|---|---|
| `migrations/025_draft_title.sql` | 신규 — `draft.title` 컬럼 | A |
| `src/lib/draftStore.ts` | 수정 — `title` 읽기/쓰기, 벌크 update/delete | A |
| `src/lib/draftStore.test.ts` | 수정 — 위 두 가지 실 DB 왕복 | A |
| `src/lib/draftViews.ts` | 수정 — `draftLabel` 4단 폴백 | B |
| `src/lib/draftViews.test.ts` | 수정 — 폴백 순서 | B |
| `src/lib/draftSelection.ts` | 신규 — 선택 집합 계산(순수) | B |
| `src/lib/draftSelection.test.ts` | 신규 | B |
| `src/lib/draftFormat.ts` | 신규 — 칸 수 → format 파생, 칸 추가/삭제 배열 변환(순수) | B |
| `src/lib/draftFormat.test.ts` | 신규 | B |
| `src/app/api/drafts/route.ts` | 수정 — `PATCH`/`DELETE` 컬렉션 라우트 | C |
| `src/app/api/drafts/[id]/route.ts` | 수정 — `title` 필드, `format` 파생, 인플루언서 검증 공용화 | C |
| `src/lib/influencerPatch.ts` | 신규 — 인플루언서 값 정규화(두 라우트 공용) | C |
| `src/components/DraftTable.tsx` | 수정 — 체크박스 열 | D |
| `src/app/generate/page.tsx` | 수정 — 선택 상태·액션 바·일괄 핸들러·삭제 일반화·flush | E |
| `src/components/BulkActionBar.tsx` | 신규 — 액션 바(표시 전용) | E |
| `src/components/DraftEditModal.tsx` | 수정 — 제목 입력, 칸 추가/삭제 | F |

## 실행 순서와 병렬성

파일이 겹치는 작업은 같은 Task로 묶었다. Task 사이 의존은 이렇다:

```
Wave 1 (병렬):  A(스토어·마이그레이션)    B(순수 함수 3종)
Wave 2 (병렬):  C(라우트, A 필요)         D(표 체크박스, B 필요)
Wave 3 (병렬):  E(페이지, C·D 필요)       F(편집 모달, C 필요)
```

---

### Task A: 마이그레이션 · 스토어 (title + 벌크)

**Files:**
- Create: `migrations/025_draft_title.sql`
- Modify: `src/lib/draftStore.ts`
- Test: `src/lib/draftStore.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `DraftRow.title: string | null` (인터페이스 필드 추가)
  - `updateDraft(sql, id, patch)` 의 `patch`에 `title?: string | null` 추가 — `null`·빈 문자열 = 제목 지움, 문자열 = 설정, `undefined` = 건드리지 않음
  - `updateDraftsBulk(sql: postgres.Sql, ids: string[], patch: { status?: DraftStatus; influencerHandle?: string | null }): Promise<void>`
  - `removeDraftsBulk(sql: postgres.Sql, ids: string[]): Promise<void>`

- [ ] **Step 1: 마이그레이션 파일 작성**

`migrations/025_draft_title.sql`:

```sql
-- 025: 사람이 붙인 원고 제목. ko_title(자동 생성)과 컬럼을 나누는 이유는 표시 규칙이 정반대이기 때문이다.
-- ko_title은 최신 본문 해시와 일치할 때만 보여준다(낡은 자동 제목을 숨기는 장치). 반대로 이 title은
-- 본문을 고쳐도 살아남아야 한다 — 사람이 지어 붙인 이름이 편집 때문에 사라지면 목록에서 원고를 잃는다.
-- null = 제목 없음(목록 라벨은 ko_title → 한국어 대역 첫 줄 → 원문 첫 줄로 폴백). 재실행 안전.
alter table draft add column if not exists title text;
```

- [ ] **Step 2: 실패하는 테스트 작성 — title 왕복**

`src/lib/draftStore.test.ts` 맨 아래에 추가 (파일 상단 import에 아직 없는 함수는 함께 추가한다):

```ts
test('title: 설정·유지·지움 — 본문을 편집해도 살아남는다', async () => {
  const id = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + 'title 왕복', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });

  // 처음엔 없다
  assert.equal((await getDraft(sql, id))!.title, null);

  // 설정
  await updateDraft(sql, id, { title: '보톡스 다운타임 훅' });
  assert.equal((await getDraft(sql, id))!.title, '보톡스 다운타임 훅');

  // 본문을 편집해도 제목은 그대로 (ko_title과 다른 지점 — 해시 검사를 타지 않는다)
  await updateDraft(sql, id, { edited: { posts: [{ text: '고친 본문', media: [] }] } });
  assert.equal((await getDraft(sql, id))!.title, '보톡스 다운타임 훅');

  // 건드리지 않으면 유지
  await updateDraft(sql, id, { status: 'review' });
  assert.equal((await getDraft(sql, id))!.title, '보톡스 다운타임 훅');

  // 빈 문자열 = 지움
  await updateDraft(sql, id, { title: '' });
  assert.equal((await getDraft(sql, id))!.title, null);

  await removeDraft(sql, id);
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test -- --test-name-pattern="title: 설정"`
Expected: FAIL — `column "title" does not exist` 또는 `title` 프로퍼티가 `undefined`

- [ ] **Step 4: 마이그레이션 적용**

Run: `npm run migrate`
Expected: `== applying migrations/025_draft_title.sql` 가 출력되고 `== done`으로 끝난다

- [ ] **Step 5: draftStore에 title 배선**

`src/lib/draftStore.ts` 세 곳을 고친다.

(1) `DraftRow` 인터페이스에서 `koTitle` 줄 바로 위에 추가:

```ts
  // 사람이 붙인 제목 — ko_title과 달리 해시 검사를 타지 않는다(본문을 고쳐도 남는다, 설계 §A)
  title: string | null;
```

(2) `type Row`에서 `ko_title: string | null;` 줄 바로 위에 `title: string | null;` 추가.

(3) `toRow`의 반환 객체에서 `koTitle:` 줄 바로 위에 `title: r.title,` 추가.

(4) `SELECT` 상수의 컬럼 목록에 `d.title,`을 `d.ko_title` 앞에 넣는다.

(5) `updateDraft`의 `patch` 타입에 추가:

```ts
           title?: string | null; // '' · null = 지움 · 문자열 = 설정 · undefined = 건드리지 않음
```

그리고 SQL의 `ko_title = ...` 줄 **위**에 추가한다. `coalesce`를 쓰지 않는 이유는 `influencer_handle`과 같다 — `coalesce`는 "null이면 기존값 유지"라 '지움'을 표현할 방법이 없다:

```ts
      -- undefined = 건드리지 않음 · '' 또는 null = 지움 · 문자열 = 설정 (influencer_handle과 같은 구조)
      title = case when ${patch.title !== undefined}
                then ${patch.title ? patch.title : null}::text
                else title end,
```

- [ ] **Step 6: 통과 확인**

Run: `npm test -- --test-name-pattern="title: 설정"`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add migrations/025_draft_title.sql src/lib/draftStore.ts src/lib/draftStore.test.ts
git commit -m "feat(draft): 사람이 붙이는 제목(title) 컬럼 추가

ko_title과 컬럼을 나눈다 — ko_title은 최신 본문 해시와 일치할 때만 보여주는
자동 제목이고, title은 본문을 고쳐도 남아야 하는 사람이 지은 이름이다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: 실패하는 테스트 작성 — 벌크 update/delete**

`src/lib/draftStore.test.ts` 맨 아래에 추가:

```ts
test('벌크: 여러 건 상태·배정 한 번에, 그리고 한 번에 삭제', async () => {
  const mk = () => insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '벌크', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  const ids = [await mk(), await mk(), await mk()];

  await updateDraftsBulk(sql, ids, { status: 'approved' });
  for (const id of ids) assert.equal((await getDraft(sql, id))!.status, 'approved');

  // 배정: 상태는 건드리지 않는다(undefined = 유지)
  await updateDraftsBulk(sql, ids, { influencerHandle: 'mika_jp' });
  for (const id of ids) {
    const got = (await getDraft(sql, id))!;
    assert.equal(got.influencerHandle, 'mika_jp');
    assert.equal(got.status, 'approved');
  }

  // null = 배정 해제
  await updateDraftsBulk(sql, ids, { influencerHandle: null });
  assert.equal((await getDraft(sql, ids[0]))!.influencerHandle, null);

  // 빈 배열은 아무 것도 하지 않는다 (SQL을 쏘지 않는다)
  await updateDraftsBulk(sql, [], { status: 'unused' });
  assert.equal((await getDraft(sql, ids[0]))!.status, 'approved');

  await removeDraftsBulk(sql, ids);
  for (const id of ids) assert.equal(await getDraft(sql, id), null);
});
```

- [ ] **Step 9: 실패 확인**

Run: `npm test -- --test-name-pattern="벌크: 여러 건"`
Expected: FAIL — `updateDraftsBulk is not defined`

- [ ] **Step 10: 벌크 함수 구현**

`src/lib/draftStore.ts`의 `updateDraft` 바로 아래에 추가:

```ts
// 일괄 변경 — 개별 updateDraft를 N번 부르지 않는다. 50건을 고르면 커넥션 50개가 동시에 붙는데,
// 이 저장소는 이미 커넥션 고갈로 목록이 비는 회귀를 겪었다(설계 §B). 한 문장으로 끝낸다.
// null·undefined 의미는 updateDraft와 같다: undefined = 건드리지 않음, null = 배정 해제.
export async function updateDraftsBulk(
  sql: postgres.Sql, ids: string[],
  patch: { status?: DraftStatus; influencerHandle?: string | null },
): Promise<void> {
  if (ids.length === 0) return; // any(빈 배열)은 0건을 맞히지만, 쿼리를 안 쏘는 편이 정직하다
  await sql`update draft set
      status = coalesce(${patch.status ?? null}, status),
      influencer_handle = case when ${patch.influencerHandle !== undefined}
                            then ${patch.influencerHandle ?? null}::text
                            else influencer_handle end
    where id = any(${ids}::uuid[])`;
}

export async function removeDraftsBulk(sql: postgres.Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`delete from draft where id = any(${ids}::uuid[])`;
}
```

- [ ] **Step 11: 통과 확인**

Run: `npm test -- --test-name-pattern="벌크: 여러 건"`
Expected: PASS

- [ ] **Step 12: 전체 테스트와 린트**

Run: `npm test` (약 4분) 그리고 `npm run lint`
Expected: 실패 0건, 린트 경고가 24개를 넘지 않음

- [ ] **Step 13: 커밋**

```bash
git add src/lib/draftStore.ts src/lib/draftStore.test.ts
git commit -m "feat(draft): 일괄 상태 변경·배정·삭제 스토어 함수

개별 PATCH를 N번 쏘는 대신 단일 SQL로 처리한다 — 50건 선택이 곧
커넥션 50개가 되는 것을 막는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B: 순수 함수 3종 (라벨 폴백 · 선택 집합 · 칸 편집)

**Files:**
- Modify: `src/lib/draftViews.ts`
- Test: `src/lib/draftViews.test.ts`
- Create: `src/lib/draftSelection.ts`, `src/lib/draftSelection.test.ts`
- Create: `src/lib/draftFormat.ts`, `src/lib/draftFormat.test.ts`

**Interfaces:**
- Consumes: 없음 (`DraftRow`의 `title` 필드는 구조적 타입으로만 참조 — Task A와 병렬 가능)
- Produces:
  - `draftLabel(d: { title: string | null; koTitle: string | null; koLatest: string[] | null; content; edited }): { text: string; kind: 'title' | 'ko' | 'original' }` — `kind`에 `'title'`이 두 경로(사람·자동)에서 나온다
  - `toggleId(selected: ReadonlySet<string>, id: string): Set<string>`
  - `toggleAll(selected: ReadonlySet<string>, visibleIds: string[]): Set<string>`
  - `allSelected(selected: ReadonlySet<string>, visibleIds: string[]): boolean`
  - `pruneSelection(selected: ReadonlySet<string>, visibleIds: string[]): Set<string>`
  - `siblingWarning(rows: Array<{ id: string; batchId: string | null }>, selectedIds: ReadonlySet<string>): number` — 함께 선택된 형제 시안의 최대 개수. 2 이상이면 경고
  - `formatForPosts(count: number): 'single' | 'thread'`
  - `addSlot<T>(arr: T[], empty: T): T[]`
  - `removeSlot<T>(arr: T[], index: number): T[]`

- [ ] **Step 1: 실패하는 테스트 작성 — draftLabel 4단 폴백**

`src/lib/draftViews.test.ts`의 기존 `draftLabel` 테스트들 **아래**에 추가:

```ts
test('draftLabel: 사람이 붙인 title이 자동 koTitle보다 앞선다', () => {
  const label = draftLabel({
    title: '사람이 붙인 이름',
    koTitle: '자동 제목',
    koLatest: ['번역본 첫 줄'],
    content: post('원문 첫 줄'),
    edited: null,
  });
  assert.deepEqual(label, { text: '사람이 붙인 이름', kind: 'title' });
});

test('draftLabel: title이 공백뿐이면 없는 것으로 본다', () => {
  const label = draftLabel({
    title: '   ',
    koTitle: '자동 제목',
    koLatest: null,
    content: post('원문 첫 줄'),
    edited: null,
  });
  assert.deepEqual(label, { text: '자동 제목', kind: 'title' });
});

test('draftLabel: 제목이 둘 다 없으면 기존 폴백 그대로', () => {
  assert.deepEqual(
    draftLabel({ title: null, koTitle: null, koLatest: ['번역 첫 줄'], content: post('원문'), edited: null }),
    { text: '번역 첫 줄', kind: 'ko' });
  assert.deepEqual(
    draftLabel({ title: null, koTitle: null, koLatest: null, content: post('원문 첫 줄'), edited: null }),
    { text: '원문 첫 줄', kind: 'original' });
});
```

기존 `draftLabel` 테스트 3개에도 `title: null,`을 첫 필드로 추가한다(타입이 요구한다).

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/draftViews.test.ts`
Expected: FAIL — `사람이 붙인 title이 자동 koTitle보다 앞선다`에서 `'자동 제목'`이 나온다

- [ ] **Step 3: draftLabel 확장**

`src/lib/draftViews.ts`의 `draftLabel`을 교체한다:

```ts
// 목록·보드 항목 라벨 폴백 체인 — 사람이 붙인 제목 → 자동 제목 → 한국어 대역 첫 줄 → 원문 첫 줄
// (5차 스펙 §표시를 2026-08-13 설계 §A로 확장). 사람이 붙인 제목이 맨 앞인 이유는 그것만이
// 본문 편집에도 살아남는 값이라, 사용자가 "내가 지은 이름"으로 원고를 찾을 수 있어야 하기 때문이다.
export function draftLabel(d: { title: string | null; koTitle: string | null; koLatest: string[] | null; content: PreviewSource; edited: PreviewSource | null }):
  { text: string; kind: 'title' | 'ko' | 'original' } {
  const manual = d.title?.trim();
  if (manual) return { text: manual, kind: 'title' };
  if (d.koTitle) return { text: d.koTitle, kind: 'title' };
  const ko = draftKoLine(d);
  if (ko) return { text: ko, kind: 'ko' };
  return { text: draftPreviewLine(d) || '(내용 없음)', kind: 'original' };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/draftViews.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/draftViews.ts src/lib/draftViews.test.ts
git commit -m "feat(draft): 목록 라벨에 사람이 붙인 제목을 최우선으로

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: 실패하는 테스트 작성 — 선택 집합**

`src/lib/draftSelection.test.ts` 신규 생성:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleId, toggleAll, allSelected, pruneSelection, siblingWarning } from './draftSelection.ts';

test('toggleId: 없으면 넣고 있으면 뺀다 — 원본은 그대로', () => {
  const base = new Set(['a']);
  assert.deepEqual([...toggleId(base, 'b')], ['a', 'b']);
  assert.deepEqual([...toggleId(base, 'a')], []);
  assert.deepEqual([...base], ['a'], '입력 집합을 변형하지 않는다');
});

test('toggleAll: 보이는 것이 전부 선택돼 있으면 해제, 아니면 전부 선택', () => {
  assert.deepEqual([...toggleAll(new Set(), ['a', 'b'])], ['a', 'b']);
  assert.deepEqual([...toggleAll(new Set(['a']), ['a', 'b'])], ['a', 'b'], '일부만 선택 → 전부 선택');
  assert.deepEqual([...toggleAll(new Set(['a', 'b']), ['a', 'b'])], []);
});

test('toggleAll: 보이지 않는 선택은 건드리지 않는다', () => {
  // 'z'는 필터에 걸려 화면에 없다 — 전체 해제가 화면 밖 선택까지 지우면 안 된다
  assert.deepEqual([...toggleAll(new Set(['a', 'b', 'z']), ['a', 'b'])], ['z']);
});

test('allSelected: 보이는 것이 없으면 false', () => {
  assert.equal(allSelected(new Set(), []), false);
  assert.equal(allSelected(new Set(['a']), ['a']), true);
  assert.equal(allSelected(new Set(['a']), ['a', 'b']), false);
});

test('pruneSelection: 화면에서 사라진 id를 떨군다', () => {
  assert.deepEqual([...pruneSelection(new Set(['a', 'b']), ['b', 'c'])], ['b']);
});

test('siblingWarning: 같은 batchId가 2개 이상 함께 선택되면 그 최대 개수', () => {
  const rows = [
    { id: 'a', batchId: 'B1' }, { id: 'b', batchId: 'B1' }, { id: 'c', batchId: 'B1' },
    { id: 'd', batchId: 'B2' }, { id: 'e', batchId: null }, { id: 'f', batchId: null },
  ];
  assert.equal(siblingWarning(rows, new Set(['a', 'b', 'c'])), 3);
  assert.equal(siblingWarning(rows, new Set(['a', 'b'])), 2);
  assert.equal(siblingWarning(rows, new Set(['a', 'd'])), 1, '서로 다른 묶음은 형제가 아니다');
  assert.equal(siblingWarning(rows, new Set(['e', 'f'])), 1, 'batchId가 null인 단일 생성끼리는 형제가 아니다');
  assert.equal(siblingWarning(rows, new Set()), 0);
});
```

- [ ] **Step 7: 실패 확인**

Run: `node --import tsx --test src/lib/draftSelection.test.ts`
Expected: FAIL — `Cannot find module './draftSelection.ts'`

- [ ] **Step 8: draftSelection 구현**

`src/lib/draftSelection.ts` 신규 생성:

```ts
// 표 뷰 다중 선택의 계산 — 순수 함수로 두는 이유는 컴포넌트 테스트 하네스가 없기 때문이다.
// 규칙 하나가 전부를 지배한다: "보이지 않는 것은 건드리지 않는다". 필터에 걸려 화면에 없는 원고가
// 전체 선택·전체 해제에 휩쓸리면, 사용자가 보지 못한 원고가 함께 지워진다.

export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function allSelected(selected: ReadonlySet<string>, visibleIds: string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
}

export function toggleAll(selected: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const next = new Set(selected);
  if (allSelected(selected, visibleIds)) visibleIds.forEach((id) => next.delete(id));
  else visibleIds.forEach((id) => next.add(id));
  return next;
}

// 필터·검색이 바뀌거나 목록이 갱신됐을 때 — 더 이상 보이지 않는 선택을 떨군다.
export function pruneSelection(selected: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}

// 함께 선택된 형제 시안(같은 batchId)의 최대 개수. 2 이상이면 일괄 배정 전에 경고한다 —
// "배정 단위는 시안 하나"라는 원칙(draftStore.ts influencer_handle 주석)이 깨지는 순간이기 때문이다.
// batchId가 null인 초안들은 단일 생성이라 서로 형제가 아니다.
export function siblingWarning(
  rows: Array<{ id: string; batchId: string | null }>, selectedIds: ReadonlySet<string>,
): number {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.batchId === null || !selectedIds.has(r.id)) continue;
    counts.set(r.batchId, (counts.get(r.batchId) ?? 0) + 1);
  }
  return selectedIds.size === 0 ? 0 : Math.max(1, ...counts.values(), 1);
}
```

- [ ] **Step 9: 통과 확인**

Run: `node --import tsx --test src/lib/draftSelection.test.ts`
Expected: PASS (6개 테스트)

- [ ] **Step 10: 실패하는 테스트 작성 — 칸 편집·형식 파생**

`src/lib/draftFormat.test.ts` 신규 생성:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatForPosts, addSlot, removeSlot } from './draftFormat.ts';

test('formatForPosts: 2칸 이상이면 스레드', () => {
  assert.equal(formatForPosts(1), 'single');
  assert.equal(formatForPosts(2), 'thread');
  assert.equal(formatForPosts(5), 'thread');
  assert.equal(formatForPosts(0), 'single', '0칸은 저장될 수 없지만 파생은 정의돼 있어야 한다');
});

test('addSlot: 끝에 빈 값을 붙인다 — 원본 불변', () => {
  const texts = ['첫 칸'];
  assert.deepEqual(addSlot(texts, ''), ['첫 칸', '']);
  assert.deepEqual(texts, ['첫 칸']);
  assert.deepEqual(addSlot([['a']], []), [['a'], []]);
});

test('removeSlot: 해당 인덱스만 뺀다 — 원본 불변', () => {
  const texts = ['a', 'b', 'c'];
  assert.deepEqual(removeSlot(texts, 1), ['a', 'c']);
  assert.deepEqual(texts, ['a', 'b', 'c']);
});

test('removeSlot: 범위 밖 인덱스는 그대로 돌려준다', () => {
  assert.deepEqual(removeSlot(['a'], 5), ['a']);
  assert.deepEqual(removeSlot(['a'], -1), ['a']);
});
```

- [ ] **Step 11: 실패 확인**

Run: `node --import tsx --test src/lib/draftFormat.test.ts`
Expected: FAIL — `Cannot find module './draftFormat.ts'`

- [ ] **Step 12: draftFormat 구현**

`src/lib/draftFormat.ts` 신규 생성:

```ts
import type { DraftFormat } from './draftTypes.ts';

// 칸 수에서 형식을 파생한다. format 컬럼을 실제 칸 수와 맞춰두지 않으면 표시가 아니라 동작이 깨진다 —
// generate.ts의 다시쓰기가 draft.format을 프롬프트에 넣고 'single'이면 결과를 1칸으로 잘라내기 때문에,
// 손으로 늘린 칸이 다시쓰기 한 번에 사라진다(설계 §E).
export function formatForPosts(count: number): DraftFormat {
  return count > 1 ? 'thread' : 'single';
}

// 칸 추가·삭제는 텍스트 배열과 미디어 배열에 똑같이 적용돼야 한다(둘의 길이가 어긋나면
// edited JSON이 깨진다). 그래서 배열 종류를 가리지 않는 제네릭으로 둔다.
export function addSlot<T>(arr: T[], empty: T): T[] {
  return [...arr, empty];
}

export function removeSlot<T>(arr: T[], index: number): T[] {
  if (index < 0 || index >= arr.length) return [...arr];
  return arr.filter((_, i) => i !== index);
}
```

- [ ] **Step 13: 통과 확인**

Run: `node --import tsx --test src/lib/draftFormat.test.ts`
Expected: PASS (4개 테스트)

- [ ] **Step 14: 린트와 커밋**

Run: `npm run lint`
Expected: 새 경고 없음

```bash
git add src/lib/draftSelection.ts src/lib/draftSelection.test.ts src/lib/draftFormat.ts src/lib/draftFormat.test.ts
git commit -m "feat(draft): 선택 집합·칸 편집 순수 함수

선택은 '보이지 않는 것은 건드리지 않는다'가 유일한 규칙이다. 형제 시안
경고 판정도 여기서 계산한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task C: 라우트 (컬렉션 벌크 + 단건 title/format)

**Files:**
- Create: `src/lib/influencerPatch.ts`
- Modify: `src/app/api/drafts/route.ts`
- Modify: `src/app/api/drafts/[id]/route.ts`

**Interfaces:**
- Consumes: `updateDraftsBulk`, `removeDraftsBulk`, `DraftRow.title` (Task A) · `formatForPosts` (Task B)
- Produces:
  - `PATCH /api/drafts` — 요청 `{ ids: string[], status?, influencerHandle? }` → `{ ok: true, updated: number }`
  - `DELETE /api/drafts` — 요청 `{ ids: string[] }` → `{ ok: true, removed: number }`
  - `PATCH /api/drafts/[id]` — 기존 필드에 `title?: string | null` 추가
  - `normalizeInfluencerPatch(v: string | null | undefined): { ok: true; value: string | null | undefined } | { ok: false; message: string }`

- [ ] **Step 1: Next.js 라우트 규약 확인**

Run: `ls node_modules/next/dist/docs/`
그 다음 라우트 핸들러 관련 문서를 읽는다. 이 저장소의 Next(16.2.10)는 학습 데이터와 다를 수 있다 — 특히 `params`가 `Promise`인 점(`ctx.params: Promise<{id: string}>`)은 기존 코드에서 확인된다.

- [ ] **Step 2: 인플루언서 검증 공용화**

`src/lib/influencerPatch.ts` 신규 생성. 내용은 `src/app/api/drafts/[id]/route.ts`의 기존 검증 블록을 그대로 옮긴 것이다 — 두 라우트가 같은 규칙을 써야 하고, 복사해 두면 한쪽만 고쳐지는 드리프트가 난다:

```ts
import { parseXHandle, handleParseMessage } from './xHandle.ts';

// undefined = 건드리지 않음 · null·공백뿐인 문자열 = 배정 해제 · 그 외 = parseXHandle 정규화.
// 빈 값을 파서에 넣지 않는다 — 'empty' 오류가 배정 해제 요청에 잘못 붙는 것을 막는다.
export function normalizeInfluencerPatch(v: string | null | undefined):
  { ok: true; value: string | null | undefined } | { ok: false; message: string } {
  if (v === undefined) return { ok: true, value: undefined };
  const trimmed = v == null ? null : v.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = parseXHandle(trimmed);
  if (!parsed.ok) return { ok: false, message: handleParseMessage(parsed.reason) };
  return { ok: true, value: parsed.handle };
}
```

- [ ] **Step 3: 단건 라우트를 공용 함수로 바꾸고 title·format 추가**

`src/app/api/drafts/[id]/route.ts`의 `PATCH`를 고친다.

(1) import 추가:

```ts
import { normalizeInfluencerPatch } from '@/lib/influencerPatch';
import { formatForPosts } from '@/lib/draftFormat';
```

(2) body 타입에 `title?: string | null` 추가.

(3) 기존 인플루언서 검증 블록(`let influencerHandle ... }` 전체)을 이걸로 교체:

```ts
  const inf = normalizeInfluencerPatch(body.influencerHandle);
  if (!inf.ok) return NextResponse.json({ error: inf.message }, { status: 400 });
  const influencerHandle = inf.value;
```

(4) `title` 검증을 `status` 검증 바로 아래에 추가. 제목은 목록에서 한 줄로 보이는 값이라 길면 라벨이 아니라 문단이 된다:

```ts
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== 'string') {
      return NextResponse.json({ error: '제목 형식이 올바르지 않아요' }, { status: 400 });
    }
    if (body.title.trim().length > 80) {
      return NextResponse.json({ error: '제목은 80자까지 쓸 수 있어요' }, { status: 400 });
    }
  }
```

(5) `edited`가 들어왔을 때 `format`을 함께 갱신한다. `body.edited = {...}` 대입 **아래**에 추가:

```ts
    // 칸 수가 바뀌었으면 format도 맞춘다 — 클라이언트가 보낸 값을 믿지 않고 본문에서 파생한다.
    // 어긋난 채 저장되면 다시쓰기가 손으로 늘린 칸을 잘라낸다(설계 §E).
    derivedFormat = formatForPosts((body.edited as DraftContent).posts.length);
```

`PATCH` 함수 상단(`const body = ...` 아래)에 `let derivedFormat: DraftFormat | undefined;`를 선언하고, `DraftFormat` 타입을 `@/lib/draftTypes`에서 import한다.

(6) `updateDraft` 호출에 `title`과 `format`을 넘긴다:

```ts
  await updateDraft(getSql(), id, {
    ...(body as { edited?: DraftContent; dismissedFlags?: string[]; status?: DraftStatus; title?: string | null }),
    influencerHandle,
    ...(derivedFormat ? { format: derivedFormat } : {}),
  });
```

- [ ] **Step 4: updateDraft에 format 쓰기 추가**

`src/lib/draftStore.ts`의 `updateDraft` `patch` 타입에 `format?: DraftFormat;`을 추가하고, SQL에 한 줄 넣는다(값이 항상 있거나 없으므로 `coalesce`로 충분하다 — '지움'이라는 개념이 없다):

```ts
      format = coalesce(${patch.format ?? null}, format),
```

- [ ] **Step 5: 컬렉션 라우트 작성**

`src/app/api/drafts/route.ts` 맨 아래에 추가. import에 `updateDraftsBulk`, `removeDraftsBulk`(`@/lib/draftStore`), `normalizeInfluencerPatch`(`@/lib/influencerPatch`), `isUuidLike`(`@/lib/uuid` — 함수 이름이 `isUuid`가 아니라 `isUuidLike`다)를 더한다:

```ts
// 일괄 처리 상한. UI는 최근 50건까지만 보여줘 넘길 수 없지만, 라우트는 UI를 믿지 않는다.
const BULK_MAX = 100;

// 두 벌크 라우트가 공유하는 ids 검증. 형식이 틀린 요청은 UI가 보낼 수 없는 값이다(손상된 요청).
function parseIds(v: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(v) || v.length === 0) return { ok: false, error: '대상을 하나 이상 골라주세요' };
  if (v.length > BULK_MAX) return { ok: false, error: `한 번에 ${BULK_MAX}개까지 처리할 수 있어요` };
  if (v.some((x) => typeof x !== 'string' || !isUuidLike(x))) {
    return { ok: false, error: '요청 형식이 올바르지 않아요' };
  }
  return { ok: true, ids: v as string[] };
}

export async function PATCH(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as
    { ids?: unknown; status?: unknown; influencerHandle?: string | null };
  const parsed = parseIds(body.ids);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (body.status !== undefined && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  const inf = normalizeInfluencerPatch(body.influencerHandle);
  if (!inf.ok) return NextResponse.json({ error: inf.message }, { status: 400 });
  if (body.status === undefined && inf.value === undefined) {
    return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  }
  await updateDraftsBulk(getSql(), parsed.ids, {
    status: body.status as DraftStatus | undefined,
    ...(inf.value !== undefined ? { influencerHandle: inf.value } : {}),
  });
  return NextResponse.json({ ok: true, updated: parsed.ids.length });
}

export async function DELETE(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const parsed = parseIds(body.ids);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await removeDraftsBulk(getSql(), parsed.ids);
  return NextResponse.json({ ok: true, removed: parsed.ids.length });
}
```

`DraftStatus` 타입 import를 파일 상단에 추가한다.

- [ ] **Step 6: 타입·린트 확인**

Run: `npx tsc --noEmit` 그리고 `npm run lint`
Expected: 오류 0건, 새 린트 경고 없음

- [ ] **Step 7: 라우트 수동 확인**

Run: `npm run dev` 후 다른 터미널에서 — 인증 쿠키가 없으므로 401이 나오는 것이 정상이고, 이걸로 라우트가 등록됐음을 확인한다:

```bash
curl -s -X PATCH localhost:3000/api/drafts -H 'Content-Type: application/json' -d '{"ids":[]}' -i | head -3
```

Expected: `HTTP/1.1 401` (라우트가 없으면 405 또는 404가 나온다)

- [ ] **Step 8: 커밋**

```bash
git add src/lib/influencerPatch.ts src/lib/draftStore.ts src/app/api/drafts/route.ts "src/app/api/drafts/[id]/route.ts"
git commit -m "feat(draft): 일괄 처리 컬렉션 라우트 + 제목·형식 배선

PATCH/DELETE /api/drafts를 새로 연다. 단건 라우트는 title을 받고,
edited가 오면 posts 길이에서 format을 파생해 함께 갱신한다 —
클라이언트가 보낸 형식을 믿으면 다시쓰기가 칸을 잘라낸다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task D: 표 뷰 체크박스 열

**Files:**
- Modify: `src/components/DraftTable.tsx`

**Interfaces:**
- Consumes: `allSelected` (Task B) · `draftLabel`의 새 시그니처 (Task B)
- Produces: `DraftTable`에 세 prop 추가 —
  - `selectedIds: ReadonlySet<string>`
  - `onToggleId: (id: string) => void`
  - `onToggleAll: () => void`

- [ ] **Step 1: 체크박스 열 추가**

`src/components/DraftTable.tsx`를 고친다.

(1) props에 셋을 더한다:

```ts
export function DraftTable({ drafts, clientNameOf, onChangeStatus, onOpenCard, selectedIds, onToggleId, onToggleAll }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
  selectedIds: ReadonlySet<string>;
  onToggleId: (id: string) => void;
  onToggleAll: () => void;
}) {
```

(2) `import { allSelected } from '@/lib/draftSelection';`를 더하고, `rows` 계산 아래에 추가:

```ts
  const headChecked = allSelected(selectedIds, rows.map((d) => d.id));
  // 일부만 골랐을 때 헤더 체크박스는 '중간' 상태로 — 전부 선택된 것처럼 보이면 안 된다
  const headIndeterminate = !headChecked && rows.some((d) => selectedIds.has(d.id));
```

(3) `<thead>`의 `<tr>` 맨 앞에 헤더 셀을 넣는다:

```tsx
            <th className="w-10 px-3 py-2 font-normal">
              <input type="checkbox" checked={headChecked}
                     ref={(el) => { if (el) el.indeterminate = headIndeterminate; }}
                     onChange={onToggleAll}
                     aria-label="보이는 원고 전체 선택"
                     className="h-4 w-4 cursor-pointer accent-x-blue" />
            </th>
```

(4) `<tbody>`의 각 `<tr>` 맨 앞에 셀을 넣는다. `stopPropagation`이 필요한 이유는 상태 칩 셀과 같다 — 체크하려던 클릭이 카드 열기까지 하면 두 일이 동시에 일어난 것처럼 보인다:

```tsx
              <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selectedIds.has(d.id)}
                       onChange={() => onToggleId(d.id)}
                       aria-label={`${label.text} 선택`}
                       className="h-4 w-4 cursor-pointer accent-x-blue" />
              </td>
```

(5) 선택된 행에 배경을 준다 — `<tr>`의 `className`에서 `border-b border-x-border`를 이렇게 바꾼다:

```tsx
                className={`cursor-pointer border-b border-x-border focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue ${selectedIds.has(d.id) ? 'bg-x-blue/5' : 'hover:bg-x-hover'}`}>
```

(6) `opensCard`는 그대로 둔다 — 체크박스는 `<td>`의 `stopPropagation`에서 이미 걸린다.

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit`
Expected: `page.tsx`에서 "필수 prop 3개 누락" 오류가 난다 — Task E가 채운다. 그 오류 **외에** `DraftTable.tsx` 자체 오류가 없어야 한다.

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 새 경고 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/DraftTable.tsx
git commit -m "feat(draft): 표 뷰 체크박스 열 — 선택 상태는 페이지가 소유

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task E: 페이지 — 선택 상태 · 액션 바 · 삭제 일반화

**Files:**
- Create: `src/components/BulkActionBar.tsx`
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `PATCH`/`DELETE /api/drafts` (Task C) · `toggleId`/`toggleAll`/`pruneSelection`/`siblingWarning` (Task B) · `DraftTable`의 새 prop (Task D)
- Produces: 없음 (최종 소비자)

**주의:** `page.tsx`는 581줄이고 낙관적 갱신의 경합 방지 패턴이 여러 개 얽혀 있다. 기존 `changeStatus`·`assignInfluencer`의 **조건부 롤백**(이 요청이 세팅한 값이 아직 표시 중일 때만 되돌린다)을 그대로 따른다. 새 패턴을 발명하지 않는다.

- [ ] **Step 1: 액션 바 컴포넌트 작성**

`src/components/BulkActionBar.tsx` 신규 생성. 표시 전용이다 — 판단과 저장은 전부 페이지가 한다:

```tsx
'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption } from '@/lib/draftTypes';

// 표 뷰에서 여러 건을 고르면 뜨는 바. 결과 패널 스크롤 컨테이너 하단에 sticky로 붙는다 —
// 50행을 내려가 고른 뒤 액션을 찾아 다시 올라오는 일이 없도록.
export function BulkActionBar({ count, options, onStatus, onInfluencer, onDelete, onClear }: {
  count: number;
  options: InfluencerOption[];
  onStatus: (s: DraftStatus) => void;
  onInfluencer: (handle: string | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center gap-2 border-t border-x-border bg-white px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <span className="text-ui font-bold">{count}개 선택됨</span>

      <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-x-border-strong bg-white px-2.5 text-ui font-bold text-x-secondary focus-within:ring-2 focus-within:ring-x-blue">
        상태 변경 <span aria-hidden className="opacity-60">⌄</span>
        <select value="" onChange={(e) => { if (e.target.value) onStatus(e.target.value as DraftStatus); }}
                aria-label="선택한 원고의 상태 변경" className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">상태 고르기</option>
          {DRAFT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </label>

      {/* 일괄 배정은 이미 배정된 적 있는 후보에서만 고른다 — 새 핸들을 여기서 타이핑하게 하면
          오타 하나가 여러 건에 한꺼번에 박힌다. 새 핸들은 카드에서 한 건 배정하면 후보에 들어온다. */}
      <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-x-border-strong bg-white px-2.5 text-ui font-bold text-x-secondary focus-within:ring-2 focus-within:ring-x-blue">
        인플루언서 <span aria-hidden className="opacity-60">⌄</span>
        <select value="" onChange={(e) => { if (e.target.value) onInfluencer(e.target.value === '__clear__' ? null : e.target.value); }}
                aria-label="선택한 원고의 인플루언서 배정" className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">인플루언서 고르기</option>
          {options.map((o) => <option key={o.handle} value={o.handle}>@{o.handle}</option>)}
          <option value="__clear__">배정 해제</option>
        </select>
      </label>

      <button onClick={onDelete}
              className="h-8 rounded-lg border border-red-200 px-2.5 text-ui font-bold text-red-600 hover:bg-red-50">
        삭제
      </button>

      <button onClick={onClear} className="ml-auto text-ui text-x-secondary hover:underline">선택 해제</button>
    </div>
  );
}
```

`InfluencerOption`의 실제 필드 이름은 `src/lib/draftTypes.ts`에서 확인하고 맞춘다.

- [ ] **Step 2: 페이지에 선택 상태 배선**

`src/app/generate/page.tsx`를 고친다.

(1) import 추가:

```ts
import { toggleId, toggleAll, pruneSelection, siblingWarning } from '@/lib/draftSelection';
import { BulkActionBar } from '@/components/BulkActionBar';
```

(2) `peekId` 상태 근처에 추가:

```ts
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
```

(3) `visibleDrafts`가 계산된 **아래**에 선택 정리 이펙트를 넣는다. 필터·검색이 바뀌거나 목록이 갱신되면 화면에서 사라진 선택을 떨군다 — 보이지 않는 원고가 함께 지워지는 것을 막는 유일한 장치다:

```ts
  const visibleIds = useMemo(() => visibleDrafts.map((d) => d.id), [visibleDrafts]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 파생 정합 유지(옵션-선택 리셋과 같은 관례), 변화가 있을 때만
    setSelectedIds((cur) => {
      const next = pruneSelection(cur, visibleIds);
      return next.size === cur.size ? cur : next; // 같은 크기면 참조를 유지해 무한 루프를 막는다
    });
  }, [visibleIds]);
```

(4) 뷰가 표가 아니면 선택을 비운다. `view` 상태를 바꾸는 자리(또는 별도 이펙트)에 추가:

```ts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 뷰 전환 시 1회 정리
    if (view !== 'table') setSelectedIds((cur) => (cur.size === 0 ? cur : new Set()));
  }, [view]);
```

- [ ] **Step 3: 일괄 핸들러 작성**

`assignInfluencer` 함수 **아래**에 추가:

```ts
  // 일괄 변경 — 개별 patchDraft를 N번 부르지 않는다(설계 §B). 낙관적 갱신 + 실패 시 전체 롤백:
  // 단건과 달리 서버가 전부 성공/전부 실패로 답하므로 조건부 롤백을 행마다 할 필요가 없다.
  async function bulkPatch(ids: string[], body: { status?: DraftStatus } | { influencerHandle: string | null }) {
    const prev = drafts;
    setDrafts((cur) => cur.map((d) => (ids.includes(d.id) ? { ...d, ...body } : d)));
    const r = await apiFetch('/api/drafts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, ...body }),
    });
    if (r.ok) return true;
    setDrafts(prev);
    setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    return false;
  }

  function bulkStatus(status: DraftStatus) {
    void bulkPatch([...selectedIds], { status }); // 선택은 유지 — 같은 묶음에 담당자도 이어서 지정한다
  }

  function bulkInfluencer(handle: string | null) {
    const ids = [...selectedIds];
    // "배정 단위는 시안 하나"라는 원칙이 깨지는 순간만 확인을 받는다(설계 §F). 막지는 않는다 —
    // 결정은 사람 몫이고, 상태 축이 전이 제약을 두지 않은 것과 같은 이유다.
    const siblings = siblingWarning(drafts, selectedIds);
    if (handle !== null && siblings >= 2) {
      const ok = window.confirm(
        `같은 조건에서 나온 시안 ${siblings}개가 함께 선택돼 있어요.\n` +
        `셋 다 같은 분께 배정하면 원고 ${siblings}개를 전달한 것으로 기록됩니다.\n\n그래도 배정할까요?`);
      if (!ok) return;
    }
    void bulkPatch(ids, { influencerHandle: handle });
  }
```

- [ ] **Step 4: 삭제를 배열로 일반화하고 flush를 넣는다**

기존 `pendingRemove` 상태를 배열로 바꾼다(단건이 길이 1인 특수 케이스가 되어 코드가 줄어든다):

```ts
  const [pendingRemove, setPendingRemove] = useState<DraftRow[]>([]);
```

`requestRemove`·`undoRemove`를 교체:

```ts
  // 삭제: 낙관적 제거 + 5초 실행취소 (보관함 패턴). 단건·일괄이 같은 경로를 쓴다 — 단건은 길이 1이다.
  function flushRemove(rows: DraftRow[]) {
    if (rows.length === 0) return;
    void apiFetch('/api/drafts', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: rows.map((r) => r.id) }),
    });
  }

  function requestRemove(rows: DraftRow[]) {
    if (rows.length === 0) return;
    setToast(null); // 죽은 에러 토스트가 삭제 직후 다시 뜨는 것을 방지
    if (removeTimer.current) clearTimeout(removeTimer.current);
    flushRemove(pendingRemove); // 앞선 실행취소 대기분을 먼저 확정
    rows.forEach((d) => { delete dismissedRef.current[d.id]; });
    setPendingRemove(rows);
    const ids = new Set(rows.map((r) => r.id));
    setDrafts((cur) => cur.filter((x) => !ids.has(x.id)));
    setSelectedIds(new Set()); // 지운 것을 고른 채로 두지 않는다 (설계 §화면 — 삭제만 선택을 비운다)
    removeTimer.current = setTimeout(() => {
      flushRemove(rows);
      setPendingRemove([]);
    }, 5000);
  }

  function undoRemove() {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove.length > 0) setPendingRemove([]);
    setDrafts((cur) => [...pendingRemove, ...cur]);
  }
```

`pendingRemove`를 참조하는 나머지 자리를 모두 고친다:
- `onDelete={() => requestRemove(d)}` → `requestRemove([d])` (카드 뷰와 peek 두 곳)
- 토스트: `{pendingRemove.length > 0 && <Toast message={...} .../>}`, 문구는 개수에 따라 —
  ```tsx
  <Toast message={pendingRemove.length === 1 ? '초안을 삭제했어요' : `원고 ${pendingRemove.length}개를 삭제했어요`}
         actionLabel="실행 취소" onAction={undoRemove} />
  ```
- `{toast && !pendingRemove && ...}` → `{toast && pendingRemove.length === 0 && ...}`

그리고 **언마운트·이탈 시 확정**을 추가한다. 지금은 5초 안에 페이지를 떠나면 서버 DELETE가 영영 안 나가고, 사용자는 "삭제했어요"를 봤는데 새로고침하면 초안이 살아 있다(설계 §G). `pendingRemove`를 ref로 미러링해 cleanup 클로저가 낡은 값을 보지 않게 한다:

```ts
  const pendingRemoveRef = useRef<DraftRow[]>([]);
  useEffect(() => { pendingRemoveRef.current = pendingRemove; }, [pendingRemove]);
  useEffect(() => {
    const onLeave = () => flushRemove(pendingRemoveRef.current);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      if (removeTimer.current) clearTimeout(removeTimer.current);
      flushRemove(pendingRemoveRef.current); // 언마운트가 주 경로다 — 사이드바로 이동하는 경우
    };
  }, []);
```

- [ ] **Step 5: 표와 액션 바를 렌더에 연결**

`view === 'table'` 블록을 교체한다:

```tsx
          {view === 'table' && loaded && visibleDrafts.length > 0 && (
            <>
              <DraftTable drafts={visibleDrafts} clientNameOf={clientNameOf}
                          onChangeStatus={changeStatus} onOpenCard={setPeekId}
                          selectedIds={selectedIds}
                          onToggleId={(id) => setSelectedIds((cur) => toggleId(cur, id))}
                          onToggleAll={() => setSelectedIds((cur) => toggleAll(cur, visibleIds))} />
              {selectedIds.size > 0 && (
                <BulkActionBar count={selectedIds.size} options={influencerOptions}
                               onStatus={bulkStatus} onInfluencer={bulkInfluencer}
                               onDelete={() => requestRemove(drafts.filter((d) => selectedIds.has(d.id)))}
                               onClear={() => setSelectedIds(new Set())} />
              )}
            </>
          )}
```

- [ ] **Step 6: 타입·린트 확인**

Run: `npx tsc --noEmit` 그리고 `npm run lint`
Expected: 오류 0건. 린트 경고가 24개를 넘지 않음(추가한 `eslint-disable-next-line`은 기존 관례를 따른 것이라 새 경고가 아니다)

- [ ] **Step 7: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 8: 커밋**

```bash
git add src/components/BulkActionBar.tsx src/app/generate/page.tsx
git commit -m "feat(generate): 표 뷰 일괄 삭제·상태 변경·배정

선택은 보이는 것만 다룬다 — 필터가 바뀌면 화면 밖 선택을 떨군다.
형제 시안이 함께 선택된 채 일괄 배정하면 확인을 받는다.
삭제 실행취소 대기분을 언마운트·이탈 시 확정한다 — 지금까지는 5초 안에
페이지를 떠나면 서버 DELETE가 아예 나가지 않았다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task F: 편집 모달 — 제목 · 칸 추가/삭제

**Files:**
- Modify: `src/components/DraftEditModal.tsx`

**Interfaces:**
- Consumes: `PATCH /api/drafts/[id]`의 `title` 필드와 `format` 파생 (Task C) · `addSlot`/`removeSlot` (Task B)
- Produces: 없음 (최종 소비자)

**주의:** 이 모달은 텍스트를 "저장" 버튼으로, 이미지를 즉시 저장으로 처리하고 둘이 같은 `edited` JSON을 쓴다. `savedTexts`는 "마지막으로 서버에 반영된 텍스트"이고, 이미지 PATCH는 반드시 `savedTexts`를 실어 보낸다 — `texts`(저장 안 누른 편집 중)를 보내면 "저장 안 눌렀는데 텍스트가 저장됐다"는 사고가 난다. 칸 추가·삭제는 배열 길이를 바꾸므로 **즉시 저장**이고, 저장 후 `savedTexts`도 함께 갱신해야 한다(설계 §D).

- [ ] **Step 1: 제목 입력 추가**

(1) 상태를 더한다:

```ts
  const [title, setTitle] = useState(draft.title ?? '');
```

(2) `dirty` 판정에 제목 변경을 포함한다 — 제목만 고치고 닫으면 경고 없이 사라지면 안 된다:

```ts
  const dirty = textsChanged(savedTexts, texts) || title.trim() !== (draft.title ?? '').trim();
```

(3) `save()` 안의 PATCH body에 `title`을 더한다. 빈 문자열은 서버가 '지움'으로 받는다:

```ts
    const r = await apiFetch(`/api/drafts/${draft.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edited, title: title.trim() }),
    });
```

`patchMedia()`와 새로 만들 `saveSlots()`의 body에는 `title`을 넣지 **않는다**. 이미지·칸 구조 저장이 아직 저장 버튼을 안 누른 제목까지 함께 반영하면, `savedTexts`를 따로 두는 이유와 같은 사고("저장 안 눌렀는데 저장됐다")가 제목에서 반복된다.

(4) ✕ 줄 **아래**, 본문 스크롤 영역 **위**에 제목 줄을 넣는다. placeholder로 "지금 목록엔 이렇게 나오고 있다"를 보여준다 — 사용자는 이 값이 어디에 쓰이는지 모른 채로는 뭘 적어야 할지 알 수 없다(AGENTS 원칙 2):

```tsx
        <div className="border-b border-x-border px-4 pb-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
                 placeholder={currentLabel}
                 aria-label="원고 제목"
                 className="w-full text-[17px] font-bold outline-none placeholder:font-normal placeholder:text-x-muted" />
          <p className="text-caption text-x-muted">
            목록과 보드에서 이 원고를 부를 이름이에요 — 비워두면 자동 제목이 쓰여요
          </p>
        </div>
```

`currentLabel`은 컴포넌트 상단에서 계산한다:

```ts
  // 비어 있을 때 보여줄 것 — 지금 목록에 실제로 나오고 있는 라벨이다
  const currentLabel = draftLabel(draft).text;
```

`import { draftLabel } from '@/lib/draftViews';`를 더한다.

- [ ] **Step 2: 렌더 루프를 texts 기준으로 바꾼다**

`{base.posts.map((_p, i) => {` 를 `{texts.map((_t, i) => {` 로 바꾼다. 같은 블록 안의 `base.posts.length`(칸 번호 표시)도 `texts.length`로 바꾼다.

'원본과 비교' 모드는 `draft.content.posts[i]`를 읽는데 새로 추가한 칸은 원본이 없다. 그 자리를 이렇게 바꾼다:

```tsx
                        <p className="whitespace-pre-wrap rounded-lg bg-x-surface p-3 text-[17px] leading-normal text-x-secondary">
                          {draft.content.posts[i]?.text ?? '새로 추가한 칸 — 생성 원본 없음'}
                        </p>
```

- [ ] **Step 3: 칸 추가·삭제 버튼과 즉시 저장**

`import { addSlot, removeSlot } from '@/lib/draftFormat';`를 더하고, 즉시 저장 함수를 만든다. 이미지 즉시 저장 경로와 같은 `busyPost` 잠금을 쓴다 — 두 PATCH가 동시에 나가면 같은 `edited` JSON을 서로 덮는다:

```ts
  // 칸 추가·삭제는 텍스트·미디어 배열의 길이를 동시에 바꾼다. 저장 버튼까지 미루면 그 사이에
  // 새 칸으로 이미지를 붙이는 순간 savedTexts(옛 길이)와 media(새 길이)가 어긋난 PATCH가 나간다.
  // 그래서 이미지와 같은 즉시 저장으로 둔다(설계 §D). format은 서버가 posts 길이에서 파생한다.
  async function saveSlots(nextTexts: string[], nextMedia: DeckMedia[][]) {
    // -1 = 전체 잠금. 구조 변경은 특정 포스트의 일이 아니다. busyPost는 `busyPost === i`("올리는 중…"
    // 표시)와 `busyPost !== null`(잠금) 두 곳에서만 읽히므로, 실제 인덱스와 겹치지 않는 -1이 안전하다.
    setBusyPost(-1);
    setErr('');
    try {
      const edited: DraftContent = {
        posts: nextTexts.map((text, i) => ({ text, media: nextMedia[i] ?? [] })),
      };
      const r = await apiFetch(`/api/drafts/${draft.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edited }),
      });
      if (!r.ok) {
        setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '칸을 저장하지 못했어요');
        return false;
      }
      setTexts(nextTexts);
      setSavedTexts(nextTexts); // 즉시 저장이므로 '서버에 반영된 텍스트'가 곧 이 값이다
      setMedia(nextMedia);
      onMediaSaved((await r.json()) as DraftRow); // 목록만 갱신하고 모달은 열어둔다
      return true;
    } finally {
      setBusyPost(null);
    }
  }
```

`mediaBusy` 계산(`saving || busyPost !== null`)이 이미 있으므로 구조 변경 중에는 이미지 컨트롤도 자동으로 잠긴다.

칸마다 삭제 버튼을 단다. 칸이 1개면 숨긴다(0칸은 서버가 400으로 막는다). 이미지가 붙은 칸일 때만 확인을 받는다 — 텍스트만 있는 칸은 편집 저장과 같은 무게다:

```tsx
                  {texts.length > 1 && !compare && (
                    <button type="button" disabled={mediaBusy}
                            onClick={() => {
                              if (media[i].length > 0 &&
                                  !window.confirm(`이 칸의 이미지 ${media[i].length}장도 함께 빠져요. 칸을 지울까요?`)) return;
                              void saveSlots(removeSlot(texts, i), removeSlot(media, i));
                            }}
                            className="text-caption text-x-muted hover:text-red-600 disabled:opacity-40">
                      칸 지우기
                    </button>
                  )}
```

포스트 루프 **밖**, 스크롤 영역 마지막에 추가 버튼을 둔다:

```tsx
          {!compare && (
            <button type="button" disabled={mediaBusy}
                    onClick={() => void saveSlots(addSlot(texts, ''), addSlot(media, []))}
                    className="mt-2 w-full rounded-lg border border-dashed border-x-border-strong py-2 text-ui font-bold text-x-secondary hover:bg-x-hover disabled:opacity-40">
              + 칸 추가 {texts.length === 1 && <span className="font-normal text-x-muted">— 스레드로 이어 쓸 수 있어요</span>}
            </button>
          )}
```

- [ ] **Step 4: 타입·린트 확인**

Run: `npx tsc --noEmit` 그리고 `npm run lint`
Expected: 오류 0건, 새 경고 없음

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add src/components/DraftEditModal.tsx
git commit -m "feat(draft): 편집 모달에 제목 입력과 스레드 칸 추가·삭제

칸 추가·삭제는 이미지와 같은 즉시 저장이다 — 텍스트·미디어 배열 길이가
동시에 바뀌므로 저장 버튼까지 미루면 어긋난 PATCH가 나간다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 최종 확인 (모든 Task 완료 후)

- [ ] **전체 테스트**: `npm test` — 실패 0건 (약 4분, `.env` 필요)
- [ ] **린트**: `npm run lint` — 경고 24개 이하
- [ ] **빌드**: `npm run build` — 성공
- [ ] **마이그레이션**: `npm run migrate` — 025가 적용됨
- [ ] **화면 확인은 사용자 몫**: 이 저장소는 구글 OAuth 도메인 게이팅이라 개발자가 화면에 접근할 수 없다. 배포 후 사용자가 직접 확인한다. 확인 항목:
  - 표 뷰에서 여러 건 체크 → 하단 바 등장 → 상태 변경/배정/삭제
  - 형제 시안 여러 개를 골라 배정하면 경고가 뜨는지
  - 삭제 후 5초 안에 사이드바로 이동 → 돌아왔을 때 실제로 지워져 있는지
  - 편집 모달에서 제목 입력 → 표·칸반 라벨이 바뀌는지 → 본문을 고쳐도 제목이 남는지
  - 단문 원고에 칸 추가 → 카드에서 스레드로 보이는지 → 다시쓰기해도 칸이 유지되는지
