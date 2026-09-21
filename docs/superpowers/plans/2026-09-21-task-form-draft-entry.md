# 새 작업 폼에서 원고까지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/campaigns/flow`의 **새 작업 폼**에 원고 칸을 두고, `[만들기]` 한 번이 "작업 생성 + 원고 부착"을 한 트랜잭션으로 끝낸다.

**Architecture:** **서버·스키마 변경 없음.** `createTasks`가 이미 같은 트랜잭션에서 `attachDraft`를 부르고(`src/lib/campaignTaskStore.ts:163`), `TaskCreateRequest.draftId`도 이미 있다(`src/lib/campaignApi.ts:64`) — 08-31 "원고 카드 → 작업 만들기"가 쓰는 길이다. 이번 작업은 **화면만** 바꾼다: ① 원고 모드의 세 갈래가 '작업'뿐 아니라 '폼'도 호스트로 받게 하고(부착 대신 고르기) ② 새 작업 폼에 원고 칸을 켜고 ③ `[만들기]` 본문에 `draftId`를 싣는다.

**Tech Stack:** Next.js App Router(`'use client'`), React 19, Tailwind(X 팔레트 토큰), `node --test`(연습용 DB).

**입력 문서:** `docs/superpowers/specs/2026-09-21-task-form-draft-entry-design.md` — 이 계획의 모든 결정은 그 스펙에서 온다. 근거 리서치는 `docs/research/parent-child-save-patterns-20260921.md`.

## Global Constraints

- **서버 코드·마이그레이션을 만들지 않는다.** `src/app/api/**`와 `migrations/`는 이번 계획에서 건드리지 않는다. 필요해 보이면 멈추고 보고할 것 — 스펙 §2가 "이미 있다"고 판정한 부분이다.
- **편집 패널(edit 모드)의 동작을 바꾸지 않는다.** 세 탭의 부착 경로·실패 복구·잠금은 그대로 둔다. 이번 변경은 "폼일 때의 갈래"를 더하는 것이다.
- **잠기는 것은 인플루언서·유형 둘뿐**(스펙 §4-3). 비용·게시 예정일·방문일·대상·메모는 원고가 있어도 계속 고칠 수 있다.
- **문구는 사실만 말한다**(UX 원칙 1·2, 거짓 어포던스 금지). 폼에서는 아직 붙지 않았으므로 '붙이기'라 쓰지 않고, 닫을 때 '사라져요'라고 말하지 않는다(안 사라진다).
- **RT 유형은 원고 칸이 없다** — `PANEL_FIELD_ORDER.rt`에 `'draft'`가 원래 없다. 따로 막는 코드를 쓰지 말 것.
- 검증: `npx tsc --noEmit` · `npx eslint src/app/campaigns/flow src/lib`(새 문제 0) · `npx eslint src`(기준선 **24건** 유지) · 바꾼 순수 함수의 테스트 파일 · `npm run build`. **전체 `npm test`는 컨트롤러가 돌린다** — 태스크 안에서 돌리지 말 것.
- 단일 테스트 파일 실행: `node --import tsx --env-file-if-exists=.env.staging --test src/lib/<file>.test.ts`
- 커밋: 한글 제목 `feat(task-form-draft): …` / `fix(...)` / `docs(...)`, 본문에 왜, 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. **경로 명시 스테이징**(`git add <파일>`), `git add -A` 금지 — 이 워크트리는 다른 세션과 공유된다.

---

## 파일 구조

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/lib/draftHost.ts` (신규) | 원고 모드의 호스트 타입(`DraftHost`)과 폼/작업에서 만드는 함수, 주인 불일치 안내 문구 | 1 |
| `src/lib/draftHost.test.ts` (신규) | 위의 순수 함수 테스트 | 1 |
| `src/lib/taskCreateBody.ts` (신규) | 폼 상태 → `TaskCreateRequest` 매핑 한 곳(지금은 `TaskPanel` 안에 인라인) | 1 |
| `src/lib/taskCreateBody.test.ts` (신규) | 위 매핑 테스트 — `draftId` 포함·`influencers` 1개 이하·`count` 배타 | 1 |
| `src/app/campaigns/flow/draft/DraftGenerate.tsx` | `task` → `host`, 폼이면 부착 대신 고르기 | 2 |
| `src/app/campaigns/flow/draft/DraftWrite.tsx` | 같음 — 폼이면 `taskId` 없이 저장하고 고르기 | 2 |
| `src/app/campaigns/flow/TaskPanel.tsx` | 새 작업 칸에서 `'draft'`를 빼던 필터 제거, 원고 칸 렌더, 잠금, 떠나기 확인, 본문에 `draftId` | 3·5 |
| `src/app/campaigns/flow/FlowDetail.tsx` | 폼 맥락으로 세 갈래를 만들고, 고른 원고를 들고 있다가 `[만들기]`·`[만들고 하나 더]`에서 처리 | 4·5 |
| `src/content/updates.ts` | 배포 안내 한 건 | 6 |
| 스펙 문서 §8 자리 | 구현 중 드러난 미결을 적는다 | 6 |

---

### Task 1: 순수 함수 둘 — 호스트 타입과 만들기 본문

**Files:**
- Create: `src/lib/draftHost.ts`, `src/lib/draftHost.test.ts`
- Create: `src/lib/taskCreateBody.ts`, `src/lib/taskCreateBody.test.ts`
- Read first: `src/app/campaigns/flow/TaskPanel.tsx:225-240`(지금의 본문 조립), `src/lib/campaignApi.ts:64-70`(`TaskCreateRequest`)

**Interfaces:**
- Produces:
  - `type DraftHost = { kind: 'task'; taskId: string; draftId: string | null; influencerHandle: string | null } | { kind: 'form'; influencerHandle: string | null }`
  - `pickedHandleNotice(formHandle: string | null, draftHandle: string | null): { fill: string | null; notice: string | null }`
  - `buildTaskCreateBody(input: TaskCreateFormState): TaskCreateRequest`

- [ ] **Step 1: 실패하는 테스트를 쓴다 — `src/lib/draftHost.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickedHandleNotice } from './draftHost';

test('폼이 비어 있으면 원고의 주인으로 채운다', () => {
  assert.deepEqual(pickedHandleNotice(null, 'asyako0520'), { fill: 'asyako0520', notice: null });
});

test('원고에 주인이 없으면 채울 것도 알릴 것도 없다', () => {
  assert.deepEqual(pickedHandleNotice('toppogi0102', null), { fill: null, notice: null });
});

test('주인이 다르면 채우지 않고 사실을 알린다', () => {
  const r = pickedHandleNotice('toppogi0102', 'asyako0520');
  assert.equal(r.fill, null);
  assert.equal(r.notice, '이 원고는 @asyako0520으로 쓴 글이에요. @toppogi0102 작업에 붙이면 @toppogi0102 것이 돼요.');
});

test('같은 주인이면 아무 일도 없다', () => {
  assert.deepEqual(pickedHandleNotice('asyako0520', 'ASYAKO0520'), { fill: null, notice: null });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env.staging --test src/lib/draftHost.test.ts`
Expected: FAIL — `Cannot find module './draftHost'`

- [ ] **Step 3: `src/lib/draftHost.ts`를 만든다**

```ts
// 원고 모드(캠페인 v2 §5)가 누구 밑에서 열렸는지 — 저장된 작업인지, 아직 안 만든 폼인지.
// 세 갈래(DraftGenerate·DraftWrite·DraftPick)는 이 값 하나로 "붙이기"와 "고르기"를 가른다.
// 스펙: docs/superpowers/specs/2026-09-21-task-form-draft-entry-design.md §4-2
export type DraftHost =
  | { kind: 'task'; taskId: string; draftId: string | null; influencerHandle: string | null }
  | { kind: 'form'; influencerHandle: string | null };

// 있는 원고를 고를 때의 주인 불일치(스펙 §4-3). 서버는 작업의 인플루언서를 우선하고(coalesce)
// 원고의 주인을 작업 값으로 덮어쓰므로, 화면이 그 사실을 먼저 말한다. 막지는 않는다.
export function pickedHandleNotice(
  formHandle: string | null, draftHandle: string | null,
): { fill: string | null; notice: string | null } {
  if (!draftHandle) return { fill: null, notice: null };
  if (!formHandle) return { fill: draftHandle, notice: null };
  if (formHandle.toLowerCase() === draftHandle.toLowerCase()) return { fill: null, notice: null };
  return {
    fill: null,
    notice: `이 원고는 @${draftHandle}으로 쓴 글이에요. @${formHandle} 작업에 붙이면 @${formHandle} 것이 돼요.`,
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env.staging --test src/lib/draftHost.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 만들기 본문 테스트를 쓴다 — `src/lib/taskCreateBody.test.ts`**

`TaskPanel.tsx:225-240`의 지금 조립을 그대로 옮긴 뒤 `draftId`만 더한 것이다. 옮기면서 규칙이 드러나야 한다:
서버는 `draftId`를 `influencers` 1개 이하일 때만 받고 `count`와 함께 받지 않는다(`campaignTaskStore.ts:144` 주석).

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskCreateBody } from './taskCreateBody';

const base = { type: 'post' as const, handle: null, cost: null, scheduledOn: null, visitOn: null, note: '', target: null, draftId: null };

test('인플루언서가 없으면 빈 배열 — 서버가 미배정 한 행을 만든다', () => {
  const b = buildTaskCreateBody(base);
  assert.deepEqual(b.influencers, []);
  assert.equal(b.draftId, undefined);
});

test('인플루언서가 있으면 그 사람 한 줄에 비용이 실린다', () => {
  const b = buildTaskCreateBody({ ...base, handle: 'asyako0520', cost: { amount: 80000, currency: 'KRW' } });
  assert.deepEqual(b.influencers, [{ handle: 'asyako0520', cost: { amount: 80000, currency: 'KRW' } }]);
  assert.equal(b.cost, undefined);   // 사람 줄에 실렸으면 위쪽 cost는 안 보낸다
});

test('고른 원고가 있으면 draftId가 실린다 — 작업 생성과 부착이 한 번에 간다', () => {
  const b = buildTaskCreateBody({ ...base, handle: 'asyako0520', draftId: 'd-1' });
  assert.equal(b.draftId, 'd-1');
  assert.equal(b.influencers.length, 1);   // 서버 제약: draftId는 1개 이하일 때만
  assert.equal(b.count, undefined);        // 서버 제약: count와 함께 못 쓴다
});

test('방문협찬이 아니면 방문일은 보내지 않는다', () => {
  assert.equal(buildTaskCreateBody({ ...base, visitOn: '2026-09-25' }).visitOn, null);
  assert.equal(buildTaskCreateBody({ ...base, type: 'visit', visitOn: '2026-09-25' }).visitOn, '2026-09-25');
});

test('대상은 작업 선택과 링크 둘 중 하나로만 실린다', () => {
  assert.equal(buildTaskCreateBody({ ...base, type: 'rt', target: { taskId: 't-1' } }).targetTaskId, 't-1');
  assert.equal(buildTaskCreateBody({ ...base, type: 'rt', target: { url: 'https://x.com/a/status/1' } }).targetTweetUrl, 'https://x.com/a/status/1');
});
```

- [ ] **Step 6: 실패를 확인하고 구현한다**

Run: `node --import tsx --env-file-if-exists=.env.staging --test src/lib/taskCreateBody.test.ts` → FAIL

`src/lib/taskCreateBody.ts`를 만든다. 입력 타입은 이렇게 둔다(폼의 로컬 상태 이름과 맞춘다):

```ts
export type TaskCreateFormState = {
  type: TaskType;
  handle: string | null;
  cost: TaskCost | null;
  scheduledOn: string | null;
  visitOn: string | null;
  note: string;
  target: { taskId: string } | { url: string } | null;
  draftId: string | null;
};
```

 **`TaskPanel.tsx:225-240`의 조립을 그대로 옮기고 `draftId` 한 줄만 더한다** — 새 규칙을 지어내지 말 것. `TaskCreateFormState`는 그 자리의 로컬 상태들(`newType`·`handle`·`newCost`·`scheduledOn`·`visitOn`·`note`·`target`)과 이름을 맞춘다.

- [ ] **Step 7: 통과 확인 + 커밋**

Run: 두 테스트 파일 + `npx tsc --noEmit`
Expected: PASS · 타입 오류 0

```bash
git add src/lib/draftHost.ts src/lib/draftHost.test.ts src/lib/taskCreateBody.ts src/lib/taskCreateBody.test.ts
git commit -m "feat(task-form-draft): 호스트 타입과 만들기 본문을 순수 함수로 꺼낸다"
```

---

### Task 2: 세 갈래가 '폼'도 호스트로 받는다 — 부착 대신 고르기

**Files:**
- Modify: `src/app/campaigns/flow/draft/DraftGenerate.tsx`(`task` prop → `host`, 고르기 갈래)
- Modify: `src/app/campaigns/flow/draft/DraftWrite.tsx`(같음 — 폼이면 `taskId` 없이 저장)
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`(호출부를 `host={{ kind: 'task', … }}`로)
- Modify: `src/app/campaigns/flow/draft/DraftPick.tsx`(`onAttach`·`attaching` → `onPick`·`picking` — 폼에서는 붙이지 않으므로 이름이 거짓이 된다. 동작은 그대로, 이름만 바꾼다)
- Read first: 두 파일의 prop 주석 전체 — 실패 복구·잠금 계약이 길게 적혀 있고 **그 계약을 깨지 않는 것이 이 태스크의 핵심**이다

**Interfaces:**
- Consumes: `DraftHost`(Task 1)
- Produces: 두 컴포넌트가 `host: DraftHost`와 `onChosen: (d: DraftRow) => void`를 받는다. `onChosen`은 `host.kind === 'form'`일 때만 불린다.

- [ ] **Step 1: `DraftGenerate`의 prop을 바꾼다**

- `task: FlowRow` → `host: DraftHost`. 이 파일이 쓰는 `task` 필드는 `task.id`·`task.draftId` 둘뿐이다(확인됨).
  - `task.id` → `host.kind === 'task' ? host.taskId : null`
  - `task.draftId` → `host.kind === 'task' ? host.draftId : null`
- `[이 시안 붙이기]` 누름 처리에 갈래를 하나 더한다:

```tsx
// 폼에서는 붙일 작업이 아직 없다(스펙 §4-2) — 서버를 부르지 않고 고른 사실만 위로 올린다.
// 부착은 [만들기]가 작업 생성과 한 트랜잭션으로 한다.
if (host.kind === 'form') { onChosen(d); return; }
// 이하 기존 부착 경로 그대로 (patchDraftApi → onAttached → 실패 시 onAttachFailed)
```

- 버튼 라벨도 갈래를 탄다: `host.kind === 'form' ? '이 시안 쓰기' : '이 시안 붙이기'`

- [ ] **Step 2: `DraftWrite`의 prop을 바꾼다**

- 쓰는 `task` 필드는 `task.id`·`task.influencerHandle` 둘뿐이다. 후자는 컴포저의 아바타·핸들이라 `host.influencerHandle`로 그대로 온다(폼에서도 있다).
- 저장 호출에서 `taskId`를 갈래로 나눈다 — **폼이면 보내지 않는다**(`/api/drafts/manual`의 `taskId`는 선택 인자):

```tsx
const r = await createManualDraftApi({
  posts, clientId, procedureIds,
  ...(host.kind === 'task' ? { taskId: host.taskId } : {}),
});
```

- 저장 성공 뒤: `host.kind === 'form'`이면 **PATCH를 건너뛰고** `onChosen(r.data)`. 기존의 `attachedRef`(같은 글로 두 벌 만들지 않게 하는 장치)는 폼 갈래에서도 똑같이 세운다 — 저장이 이미 끝났으므로 다시 누르면 또 만들어진다.
- 버튼 라벨: `host.kind === 'form' ? '저장하고 쓰기' : '저장하고 붙이기'`

- [ ] **Step 3: `FlowDetail`의 기존 호출부를 고친다**

```tsx
<DraftGenerate host={{ kind: 'task', taskId: t.id, draftId: t.draftId, influencerHandle: t.influencerHandle }} … />
<DraftWrite    host={{ kind: 'task', taskId: t.id, draftId: t.draftId, influencerHandle: t.influencerHandle }} … />
```

`onChosen`은 이 자리에서는 `() => {}`가 아니라 **넘기지 않는다**(선택 prop) — 작업 호스트에서는 불릴 일이 없다.

- [ ] **Step 4: 검증하고 커밋한다**

Run: `npx tsc --noEmit` · `npx eslint src/app/campaigns/flow` · `npm run build`
Expected: 오류 0, 기존 화면 동작 변화 없음(편집 패널은 여전히 붙인다)

```bash
git add src/app/campaigns/flow/draft/DraftGenerate.tsx src/app/campaigns/flow/draft/DraftWrite.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(task-form-draft): 원고 모드가 작업뿐 아니라 폼도 호스트로 받는다"
```

---

### Task 3: 폼에 원고 칸을 켠다 (TaskPanel)

**Files:**
- Modify: `src/app/campaigns/flow/TaskPanel.tsx`
- Read first: `TaskPanel.tsx:320-355`(편집 패널의 원고 칸 — **같은 모양으로 만든다**), `:410-411`(지금의 필터)

**Interfaces:**
- Consumes: `DraftHost`·`pickedHandleNotice`(Task 1), `newDraft` prop(Task 4에서 `FlowDetail`이 내려준다)
- Produces: `newDraft`가 있을 때 폼이 잠그는 칸의 판정과 원고 칸 렌더

- [ ] **Step 1: 필터를 없앤다**

```tsx
// 새 작업 칸 — 원고 칸도 그대로 쓴다(스펙 §4-1). RT는 PANEL_FIELD_ORDER.rt에 'draft'가 없어 자동으로 빠진다.
const newFieldOrder: PanelField[] = newType ? PANEL_FIELD_ORDER[newType] : [];
```

- [ ] **Step 2: `renderNewField`에 `'draft'` 갈래를 더한다**

- 원고 없음: `[AI로 만들기] [직접 쓰기] [있는 원고 고르기 n]` — **편집 패널(`:343-351`)과 같은 라벨·같은 배치**. 누르면 `setDraftTab(...)` + `setDraftMode('draft')`(이미 있는 상태 전환을 그대로 쓴다).
- 원고 있음(`newDraft`): `제목 · 상태` + `[열기] [떼기]`, 그 아래 한 줄 — `만들기를 누르면 이 원고가 함께 붙어요`.
  - `[열기]`는 `setDraftMode('draft')`. 카드가 뜨는 판정은 Task 4에서 `attached`로 내려온다.
  - `[떼기]`는 서버를 부르지 않는다 — `onNewDraftChange(null)`. 확인 문구: `폼에서 내려놓을까요? 원고는 지워지지 않고 '있는 원고 고르기'에 남아요.`

- [ ] **Step 3: 인플루언서·유형을 잠근다**

- `newDraft`가 있으면 유형 탭과 인플루언서 칸을 칩(읽기 전용)으로 바꾸고 옆에 `원고를 떼면 바꿀 수 있어요`.
- **비용·게시 예정일·방문일·대상·메모는 잠그지 않는다**(Global Constraints).

- [ ] **Step 4: 떠나기 확인을 사실대로 고친다**

- `isNewDirty`에 `newDraft !== null`을 더한다.
- 원고만 있고 다른 칸은 비었을 때의 확인 문구는 `입력한 내용이 사라져요`가 아니라 **`고른 원고는 '있는 원고 고르기'에 남아요. 닫을까요?`**. 두 상황이 섞이면(칸도 채웠고 원고도 골랐으면) 기존 문구 뒤에 이 한 줄을 붙인다 — 잃는 것과 안 잃는 것을 함께 말한다.

- [ ] **Step 5: 검증하고 커밋한다**

Run: `npx tsc --noEmit` · `npx eslint src/app/campaigns/flow` · `npm run build`

```bash
git add src/app/campaigns/flow/TaskPanel.tsx
git commit -m "feat(task-form-draft): 새 작업 폼에 원고 칸을 켠다 — 고르면 인플·유형이 잠긴다"
```

---

### Task 4: 배선 — 폼 맥락으로 세 갈래를 만든다 (FlowDetail)

**Files:**
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`
- Modify: `src/app/campaigns/flow/TaskPanel.tsx`(맥락을 위로 알리는 콜백 하나)
- Read first: `FlowDetail.tsx:740-762`(지금 세 갈래를 만드는 자리)

**Interfaces:**
- Consumes: Task 2의 `host`/`onChosen`, Task 3의 원고 칸
- Produces: `FlowDetail`이 `formDraft: DraftRow | null`을 들고, `TaskPanel`에 `newDraft`·`onNewDraftChange`로 내려준다

- [ ] **Step 1: 상태의 주인을 정한다 (스펙 §4-6)**

- **`FlowDetail`이 든다**: `formDraft`(폼에서 고른 원고), `formCtx`(`{ type, handle }` — `TaskPanel`이 바뀔 때 알려 준다).
- **`TaskPanel`이 든다**: 폼 입력값 전부(지금 그대로).
- 새 상태 보관소를 만들지 않는다. `TaskPanel`은 `onNewContextChange({ type, handle })`로 알리기만 한다(`onDirtyChange`와 같은 관례).

- [ ] **Step 2: 폼 모드일 때의 세 갈래를 만든다**

```tsx
// 폼(아직 안 만든 작업)의 원고 모드 — 호스트만 다르고 알맹이는 작업 모드와 같은 컴포넌트다(스펙 §4-6).
const formHost: DraftHost = { kind: 'form', influencerHandle: formCtx.handle };
```

- `DraftGenerate`: `host={formHost}` · `onChosen={(d) => setFormDraft(d)}` · `targetRef`는 폼의 대상 값에서 만든다(인용RT에서 대상 링크가 있을 때만, 없으면 `null`).
- `DraftWrite`: `host={formHost}` · `onChosen={(d) => setFormDraft(d)}`.
- `DraftPick`: `onAttach`가 폼에서는 붙이지 않는다 — `pickedHandleNotice(formCtx.handle, d.influencerHandle)`를 먼저 적용해 `fill`이 있으면 폼 인플루언서를 채우고(`TaskPanel`에 내려주는 콜백), `notice`가 있으면 토스트로 알린 뒤 `setFormDraft(d)`.
- `attached` 판정: 폼에서는 `!!formDraft` — 고른 뒤 `[열기]`를 누르면 `DraftCard`가 뜬다.
- `DraftCard`의 `onDetach`: 폼에서는 서버 detach가 아니라 `setFormDraft(null)`(스펙 §4-1).

- [ ] **Step 3: 검증하고 커밋한다**

Run: `npx tsc --noEmit` · `npx eslint src/app/campaigns/flow src/lib` · `npm run build`

```bash
git add src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/flow/TaskPanel.tsx
git commit -m "feat(task-form-draft): 폼 맥락으로 원고 세 갈래를 만든다 — 상태 주인을 하나로"
```

---

### Task 5: `[만들기]`가 원고까지 데려간다

**Files:**
- Modify: `src/app/campaigns/flow/TaskPanel.tsx`(본문에 `draftId`, `buildTaskCreateBody` 사용)
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`(`createTask`의 `more` 갈래에서 `formDraft` 비우기, 409 문구)

**Interfaces:**
- Consumes: `buildTaskCreateBody`(Task 1), `formDraft`(Task 4)

- [ ] **Step 1: 본문 조립을 `buildTaskCreateBody`로 갈아끼운다**

`TaskPanel.tsx:225-236`의 인라인 객체를 지우고 Task 1의 함수를 부른다. `draftId: newDraft?.id ?? null`을 함께 넘긴다. **여기서 새 규칙을 만들지 말 것** — 함수가 이미 제약(1명 이하·`count` 배타)을 지킨다.

- [ ] **Step 2: 만든 뒤 처리**

- `[만들기]`(`more === false`): 지금처럼 만든 작업의 편집 패널을 연다(`openPanel`). 원고는 이미 붙어 있으므로 패널의 원고 칸이 카드로 뜬다. `formDraft`를 비운다.
- `[만들고 하나 더]`(`more === true`): 폼을 비울 때 **`formDraft`도 비운다**(스펙 §4-5). 유형은 지금처럼 유지한다.

- [ ] **Step 3: 409를 사실대로 말한다**

`createTasksApi`가 409(그 사이 다른 작업이 그 원고를 가져감)를 주면 폼을 닫지 않고 원고 칸이 말한다: `다른 작업에 붙었어요 — 다시 고르기`. 그 상태에서 `formDraft`를 비워 사용자가 다시 고를 수 있게 한다(서버 문구를 그대로 토스트로 흘리지 않는다).

- [ ] **Step 4: 손으로 확인한다 (스펙 §5)**

로컬에서 `npm run build && npx next start -p 3001` 뒤 `http://127.0.0.1:3001`(`next dev`는 쓰지 않는다 — 하이드레이션이 조용히 실패한다):

① 폼에서 AI 생성 → 시안 고르기 → `[만들기]` → 만들어진 작업에 원고가 붙어 있다
② 직접 쓰기도 같다(저장하고 쓰기 → 만들기)
③ 있는 원고 고르기도 같다
④ `[떼기]` 뒤 인플루언서·유형 칸이 다시 열린다
⑤ `[만들고 하나 더]` 뒤 원고 칸이 비어 있다
⑥ 인플루언서를 비워 둔 채 주인이 있는 원고를 고르면 폼이 그 핸들로 채워진다

- [ ] **Step 5: 커밋**

```bash
git add src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/FlowDetail.tsx
git commit -m "feat(task-form-draft): 만들기 한 번이 작업과 원고를 함께 저장한다"
```

---

### Task 6: 배포 안내와 문서

**Files:**
- Modify: `src/content/updates.ts`(맨 위에 한 건)
- Modify: `docs/superpowers/specs/2026-09-21-task-form-draft-entry-design.md`(구현 중 드러난 미결을 §6 아래에 적는다)

- [ ] **Step 1: 업데이트 소식 한 건**

AGENTS.md "업데이트 소식 작성 규칙"을 따른다 — 제목은 사용자 말 한 줄, 내부 용어 금지, `date`는 머지 예정일.

```ts
{
  date: '2026-09-22', type: '개선',   // 머지일이 달라지면 머지 직전에 맞춘다(AGENTS.md)
  title: '새 작업을 만들면서 원고까지 한 번에 할 수 있어요',
  summary: '작업을 만드는 화면에서 바로 원고를 만들거나 골라 둘 수 있어요. [만들기]를 누르면 작업과 원고가 함께 저장돼요.',
  bullets: [
    '쓰던 방식이 바뀐 것: 전에는 작업을 먼저 만든 뒤에야 원고 버튼이 보였어요',
    '원고를 고르면 인플루언서와 유형은 잠겨요 — 원고를 떼면 다시 바꿀 수 있어요',
    "폼을 닫아도 만들어 둔 원고는 사라지지 않아요 — '있는 원고 고르기'에 남아요",
  ],
  link: { label: '캠페인 v2', href: '/campaigns/flow' },
},
```

Run: `node --import tsx --test src/lib/updates.test.ts` → PASS

- [ ] **Step 2: 검증 전체를 한 번 돌리고 커밋**

Run: `npx tsc --noEmit` · `npx eslint src`(기준선 24건) · `npm run build`

```bash
git add src/content/updates.ts docs/superpowers/specs/2026-09-21-task-form-draft-entry-design.md
git commit -m "docs(task-form-draft): 배포 안내와 스펙 갱신"
```

---

## 실행 뒤 컨트롤러가 할 것

- 전체 `npm test`(연습용 DB, 약 4분 — 운영 DB면 testGuard가 막는다)
- 최종 리뷰(`superpowers:requesting-code-review`), koo 화면 확인(OAuth 게이팅이라 배포/로컬에서 koo만 가능한 확인이 있다)
- 머지 전 업데이트 소식 날짜를 실제 머지일로 맞추기
