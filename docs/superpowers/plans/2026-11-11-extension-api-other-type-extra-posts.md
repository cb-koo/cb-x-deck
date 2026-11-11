# 익스텐션 API — 기타 협찬 유형·방문협찬 게시물 여러 개(ISSUE-016) 구현 계획서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

작성일: 2026-11-11 · 담당: 태정

**Goal:** 익스텐션용 API(`/api/extension/v1`, 웹 쿠키 경로 `/api/extension-product`)가 ① 기타 협찬 작업을 유형·한 일·확인 메모와 함께 내려 주고 ② 방문협찬의 추가 게시물을 원래 작업 안의 `posts`로 묶어 내려 주며 ③ 익스텐션에서 게시물 칸 추가와 추가 게시물 게시 확인을 받을 수 있게 한다.

**Architecture:** 판정은 지금처럼 순수 함수(`extensionTasks.ts`)에, DB 읽기는 `extensionReadStore.ts`에 둔다. 추가 게시물 줄(`same_visit_of`가 있는 방문 작업)은 `loadTaskFacts`가 원래 작업의 `posts`로 접어 넣고 목록·배지·예약 후보에서는 뺀다. 쓰기(게시물 추가·추가 게시물 게시 확인)는 koo가 만든 웹용 도메인 함수를 그대로 부르고, 익스텐션 경로에는 버전 확인·멱등 처리(`productOperation`)만 얹는다.

**Tech Stack:** Next.js(이 저장소 버전 — 작성 전 `node_modules/next/dist/docs/` 확인) · postgres.js · node:test(`node --import tsx --test`)

**Spec:** 별도 스펙 없음. 계약은 아래 "공용 계약", 근거는 "확인한 사실".

**짝 계획서(익스텐션):** `../../../../cb_x_extension/docs/superpowers/plans/2026-11-11-other-task-type-extension.md`, `…/2026-11-11-visit-extra-posts-extension.md`. **이 저장소가 먼저 배포된다.** 익스텐션 0.1.12(옛 버전)가 새 응답을 받아도 깨지지 않아야 한다.

## 시작 전 조건 (필수)

**koo의 기타 협찬·ISSUE-016 코드가 `main`에 들어온 뒤에 시작한다.** 2026-11-11 기준 `origin/main`(`9e5c9800`)에는 없다: `TaskType`은 4개(`campaignJudgment.ts:142`), 마이그레이션은 087이 마지막, 스테이징 사이트도 옛 코드다. 스테이징 **DB에만** 새 칸이 있다(아래). 이 계획을 koo 코드 없이 진행하면 같은 칸의 마이그레이션·`TaskType`·도메인 함수를 두 번 만들게 된다.

시작할 때 먼저 확인할 것(이 값으로 아래 `<…>` 자리를 채운다):
- `TaskType`에 `'other'`가 있고 `TASK_TYPE_LABEL.other`의 문구
- 작업 줄 타입에서 `other_kind`·`done_note`·`same_visit_of`·`cancelled_with`를 읽는 필드 이름
- 웹에서 게시물을 추가하는 도메인 함수 `<addSameVisitPost>`와 그 거절 조건(정산 요청 후·취소 후 등)
- 추가 게시물의 게시 확인을 웹이 어떻게 하는지(예약 없이 `updateTask`만 하는지)

## 확인한 사실 (2026-11-11, 스테이징)

- `campaign_task` 새 칸: `other_kind text`, `done_note text`, `same_visit_of uuid`, `cancelled_with uuid`. 제약 `campaign_task_type_check`에 `'other'`, `campaign_task_same_visit_shape` = `same_visit_of is null or (same_visit_of <> id and type='visit' and no_cost and cost is null)`.
- `GET /api/extension-product/tasks/{기타 작업}` → `kind` 없음, `title: "[QA] 기타 협찬 11월 · undefined"` (`extensionTasks.ts:18` `WIRE_KIND`, `:125` `TASK_TYPE_LABEL[t.type]`에 `other`가 없어서).
- `GET …/tasks/{추가 게시물}` → 일반 방문 작업과 같음: `visitPhase:"unregistered"`, `allowedActions:["add_reservation","cancel"]`.
- `GET …/campaigns/{id}/visit-task-candidates` → 추가 게시물 줄이 "예약 없는 방문 작업"으로 나옴(`extensionProductApi.ts:155-160`).
- QA 자료: 캠페인 "[QA] 같은 방문"(@skysky_ca, 원래 작업 `b208ca5d…` + 추가 2줄), "[QA] 기타 협찬 11월"(@qa_other_test).

## 공용 계약 (익스텐션 계획서와 같은 내용)

```ts
// TaskDto (GET people/{id}/tasks, GET tasks/{id}, ReservationDto.task) 와 배지 tasks[]
kind: 'visit' | 'post' | 'rt' | 'quote_rt' | 'other';
title: string;                 // `${캠페인명} · ${TASK_TYPE_LABEL[type]}` — other는 '기타 협찬'
otherKind: string | null;      // other_kind. type이 other가 아니면 null
doneNote: string | null;       // done_note
posts: VisitPost[];            // 원래 방문 작업의 추가 게시물(만든 순서, 취소된 줄 제외). 없으면 []
sameVisitOf: string | null;    // 추가 게시물 줄일 때 원래 작업 id
type VisitPost = { taskId: string; version: number; postedAt: string | null; postUrl: string | null; scheduledOn: string | null };
// allowedActions: 'add_post' 추가 — 원래 방문 작업이 취소·노쇼·완료가 아니고 활성 정산 요청이 없을 때.
//   추가 게시물 줄 자체의 allowedActions 는 [] (예약·취소는 원래 작업에서만)

// 목록에서 제외: people/{id}/tasks, people/badges(tasks·activeCount·activeVisitCount),
//   campaigns/{id}/visit-task-candidates  → same_visit_of 가 있는 줄은 넣지 않는다

// POST tasks/{원래 작업 id}/posts   body {}   If-Match=원래 작업 version, Idempotency-Key
//   → TaskDetail(원래 작업, posts 에 새 줄)   오류: STATE_CHANGED 409, SETTLEMENT_REQUESTED 409, VERSION_CONFLICT
// POST tasks/{추가 게시물 id}/confirm-post  body { postUrl }  If-Match=그 줄의 version
//   → ReservationDto(원래 작업의 예약; task.posts 갱신)
//   원래 작업에 예약이 없으면 409 RESERVATION_COMMAND_REQUIRED
```

## Global Constraints

- 옛 익스텐션(0.1.12)은 모르는 필드를 무시한다. **기존 필드의 뜻·값은 바꾸지 않는다**(추가만).
- 게시물이 하나뿐인 방문 작업의 응답은 `posts: []`, `sameVisitOf: null`, `otherKind: null`, `doneNote: null`이 늘어나는 것 외에 지금과 같아야 한다.
- 쓰기는 모두 `productOperation`(멱등 키·감사) + `expectVersion`을 거친다. 새 쓰기 경로에 `If-Match` 없는 요청은 `VERSION_REQUIRED`.
- 마이그레이션은 이 계획에서 만들지 않는다(칸은 koo의 마이그레이션에 있다). 필요해지면 `AGENTS.md`의 "추가만·멱등" 규칙을 따른다.
- 익스텐션 API 문서 원본은 `cb_x_extension/docs/api/extension-v1/openapi.yaml`. 이 저장소의 `docs/api/extension-product-local-handoff.md`에도 새 경로를 한 줄씩 적는다.
- 사용자에게 보이는 변화이므로 머지 직전에 `src/content/updates.ts`에 항목을 넣는다(koo의 ISSUE-016·기타 협찬 항목이 이미 있으면 그 불릿에 "익스텐션에서도…" 한 줄로 흡수).
- 테스트: `node --import tsx --test src/lib/extensionApi.test.ts` (기존 관례).

## Review Focus

1. 원래 작업은 게시됐고 추가 게시물은 아직 → 원래 작업이 `completed` 버킷으로 가지 않고 `active`에 남는다(비용 없는 작업의 "게시 = 완료" 규칙이 묶음에는 적용되지 않게). Task 2 테스트.
2. 추가 게시물만 취소됨(`cancelled_at` 또는 `cancelled_with`) → `posts`에서 빠지고 진행 수에 세지 않는다. Task 2 테스트.
3. 사람이 가진 작업이 추가 게시물뿐인 페이지 경계(20건 단위) → 접어 넣은 뒤에 페이지를 자른다(`total`·`nextCursor`가 접은 뒤 기준). Task 2 테스트.
4. 같은 `Idempotency-Key`로 게시물 추가를 두 번 → 줄은 하나만 생기고 같은 응답. Task 3 테스트.
5. 추가 게시물의 링크가 다른 사람 글 → 원래 작업과 같은 작성자 거절 문구(422). Task 4 테스트.

---

### Task 1: 기타 협찬 유형을 응답에 싣기

**Files:**
- Modify: `src/lib/extensionTasks.ts:17-18` (`WireTaskKind`, `WIRE_KIND`), `:20-37` (`TaskFacts`에 `otherKind`, `doneNote`), `:41-58` (`TaskDto`), `:115-147` (`toTaskDto`)
- Modify: `src/lib/extensionReadStore.ts:70-93` (`loadTaskFacts` select에 `other_kind`, `done_note`)
- Modify: `src/app/api/extension/v1/people/badges/route.ts:43-46` (배지 task에 `kind`는 이미 실림 — 확인만)
- Test: `src/lib/extensionApi.test.ts`

**Interfaces (Produces):**
```ts
export type WireTaskKind = 'visit' | 'post' | 'rt' | 'quote_rt' | 'other';
// TaskFacts += { otherKind?: string | null; doneNote?: string | null }
// TaskDto   += { otherKind: string | null; doneNote: string | null }
```

- [ ] **Step 1: 실패하는 테스트** — 기존 `quote` 케이스(`extensionApi.test.ts:116`) 옆에:
```ts
const other = toTaskDto({ ...base, type: 'other', otherKind: '구글맵 리뷰', doneNote: '현장 확인', postedAt: '2026-11-06', postUrl: null }, classifyTask(...), personId, today, origin);
assert.deepEqual([other.kind, other.otherKind, other.doneNote, other.allowedActions], ['other', '구글맵 리뷰', '현장 확인', []]);
assert.ok(other.title.endsWith('· 기타 협찬'));
assert.equal(toTaskDto({ ...base, type: 'post' }, …).otherKind, null);
```
그리고 `classifyTask`: 기타 작업은 콘텐츠 작업 규칙을 그대로 따른다(취소=ended, 지급 완료 또는 비용 없음+완료=completed, 그 밖=active).
- [ ] **Step 2:** 테스트 실행 → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 테스트 PASS, `npx tsc --noEmit` 오류 없음
- [ ] **Step 5:** 커밋 `feat(extension-api): 기타 협찬 유형·한 일·확인 메모를 작업 응답에`

### Task 2: 추가 게시물을 원래 작업의 `posts`로 접기

**Files:**
- Modify: `src/lib/extensionTasks.ts` (`TaskFacts`에 `sameVisitOf`, `posts`; `TaskDto`; `classifyTask`; `toTaskDto`; 새 순수 함수 `foldSameVisit`)
- Modify: `src/lib/extensionReadStore.ts:70-93` (`same_visit_of`, `cancelled_with` 읽기)
- Modify: `src/app/api/extension/v1/people/[personId]/tasks/route.ts`, `…/people/badges/route.ts` (접은 뒤 분류·정렬·자르기)
- Modify: `src/lib/extensionProductApi.ts:155-160` (`visit-task-candidates`에 `and t.same_visit_of is null`), `:91-97` (`GET tasks/{id}` — 추가 게시물 id면 `sameVisitOf`를 싣고 `allowedActions: []`)
- Modify: `src/lib/reservationPolicy.ts:50-61` (`VisitAction`에 `'add_post'`), `:102` (`allowedVisitActions`)
- Test: `src/lib/extensionApi.test.ts`, 필요하면 `src/lib/reservationPolicy.test.ts`

**Interfaces (Produces):**
```ts
export interface VisitPost { taskId: string; version: number; postedAt: string | null; postUrl: string | null; scheduledOn: string | null }
// TaskFacts += { sameVisitOf?: string | null; posts?: VisitPost[] }
/** same_visit_of 가 있는 줄을 원래 작업의 posts 로 옮기고 목록에서 뺀다. 취소된 줄은 버린다.
 *  원래 작업이 목록에 없으면(다른 사람·삭제) 그 줄은 버린다. posts 는 created_at, id 순. */
export function foldSameVisit(facts: Array<TaskFacts & { createdAt?: string | null }>): TaskFacts[];
```

판정 규칙(이 Task가 정하는 것):
- 방문 단계(`visitPhase`)는 원래 작업 기준 그대로. 단 **`posts` 중 미게시가 있으면 `completed`가 되지 않는다** — 그때는 `uploaded`에 머문다(버킷 `active`).
- `add_post`: `phase`가 `cancelled`·`visit_no_show`·`upload_no_show`·`completed`가 아니고 활성 정산 요청(`settlement`)이 없을 때.
- `nextSchedule`: 원래 작업이 게시됐고 미게시 `posts`가 있으면 `{ kind: 'upload', on: 가장 이른 미게시 scheduledOn }`(날짜가 없으면 null).

- [ ] **Step 1: 실패하는 테스트**
  - `foldSameVisit([원래, 추가A(미게시), 추가B(게시), 추가C(취소)])` → 길이 1, `posts.map(p => p.taskId)` = [A, B] (만든 순서)
  - 원래 `postedAt` 있음·`noCost` true·`posts` 1개 미게시 → `classifyTask(...).bucket === 'active'`, `visitPhase === 'uploaded'`
  - 같은 조건에서 `posts` 전부 게시 → 기존 규칙대로(`completed`)
  - `allowedVisitActions`: `uploaded`·정산 요청 없음 → `add_post` 포함 / 정산 요청 있음 → 없음 / `cancelled` → 없음
  - 원래 1줄 + 추가 25줄인 사람 → 목록 `total === 1`, `nextCursor === null`
- [ ] **Step 2:** 테스트 실행 → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 테스트 PASS, `npx tsc --noEmit` 오류 없음
- [ ] **Step 5:** 스테이징 DB를 보는 로컬 서버(`npm run dev`)에서 조회로 확인 — `GET /api/extension-product/tasks/b208ca5d-cbff-41e0-9cf1-708dbb6a4433`에 `posts` 2줄, `…/campaigns/43d915d2-35ef-4dfb-b905-d9e9c3a48533/visit-task-candidates?personId=81ddfa31-bbee-48f7-97c4-f83f455b77b6`가 빈 목록
- [ ] **Step 6:** 커밋 `feat(extension-api): 방문협찬 추가 게시물을 원래 작업의 posts로 묶고 목록·배지·예약 후보에서 제외`

### Task 3: 게시물 추가 — `POST tasks/{id}/posts`

**Files:**
- Modify: `src/lib/extensionProductApi.ts:91-117` (새 분기), 필요하면 `src/lib/reservationCommands.ts`에 `addVisitPost`
- Test: `src/lib/extensionApi.test.ts` 또는 기존 명령 테스트 파일(DB 테스트 관례를 따른다)

**Interfaces:**
- Consumes: koo의 `<addSameVisitPost>(tx, originalTaskId, { actor })`, Task 2의 `add_post`
- Produces:
```ts
export async function addVisitPost(sql: postgres.Sql, req: Request, actor: Member, taskId: string, raw: unknown): Promise<TaskDto & { reservationId: string | null }>;
// productOperation 안에서: 원래 작업 for update → expectVersion → allowedVisitActions 에 add_post 없으면
//   정산 요청 중이면 SETTLEMENT_REQUESTED(409), 아니면 STATE_CHANGED(409) → <addSameVisitPost> → 원래 작업 version+1 → 접은 TaskDto
```

- [ ] **Step 1: 실패하는 테스트** — 성공 시 `posts.length`가 1 늘고 원래 작업 `version`이 1 오른다 / 취소된 작업 409 `STATE_CHANGED` / 정산 요청 중 409 `SETTLEMENT_REQUESTED` / 추가 게시물 id에 호출하면 409 `STATE_CHANGED` / 같은 멱등 키 두 번 → 줄 1개
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현 (`root === 'tasks'` 분기에 `method === 'POST' && action === 'posts'`)
- [ ] **Step 4:** 테스트 PASS
- [ ] **Step 5:** 커밋 `feat(extension-api): 방문협찬 게시물 추가`

### Task 4: 추가 게시물의 게시 확인 — 기존 `confirm-post` 확장

**Files:**
- Modify: `src/lib/reservationCommands.ts:211-239` (`confirmVisitPost`)
- Test: 같은 파일의 기존 테스트 옆

동작: `taskId`가 추가 게시물 줄이면 — 그 줄을 잠그고 `expectVersion`(그 줄의 version) → 원래 작업의 예약을 찾는다(없으면 409 `RESERVATION_COMMAND_REQUIRED`) → 원래 작업이 방문 완료 이후 단계가 아니면 409 `STATE_CHANGED`(기존 문구) → 그 줄에 `postUrl`·`postedAt`·`postedSource:'manual'` 저장, 작성자 확인(`attachFetchedPostToTask`) → 원래 작업의 예약 `version + 1` → `reservationDetail(원래 예약)`. 원래 작업 줄 자체의 흐름은 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트** — 추가 게시물 id로 확인하면 응답 `task.id`가 원래 작업이고 `task.posts[0].postedAt`이 채워짐 / 다른 사람 글이면 422(기존 작성자 문구) / 원래 작업이 방문 전이면 409 / 마지막 게시물이 올라오면 응답 `task`가 정산 단계 규칙(koo 구현)을 따른다
- [ ] **Step 2:** 실행 → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** 테스트 PASS, 전체 테스트(`npm test` 또는 저장소 관례) PASS
- [ ] **Step 5:** 커밋 `feat(extension-api): 추가 게시물 게시 확인`

### Task 5: 문서·업데이트 소식·배포

- [ ] `cb_x_extension/docs/api/extension-v1/openapi.yaml`과 이 저장소 `docs/api/extension-product-local-handoff.md`에 새 필드·경로 반영(익스텐션 계획서 Task와 중복되면 한 번만)
- [ ] `src/content/updates.ts` 항목(또는 koo 항목의 불릿) — 사용자 말로: "익스텐션에서도 방문협찬 게시물을 하나 더 추가하고, 기타 협찬을 볼 수 있어요"
- [ ] `docs/PRODUCT_SPEC.md`·Dev note 기획서 갱신(devnote 스킬)
- [ ] 스테이징 배포 → 옛 익스텐션(0.1.12)로 기존 방문협찬 1건이 전과 같이 보이는지 확인 → 운영 배포(**사용자 승인 후**) → 그다음 익스텐션 배포

## 정할 것

1. **추가 게시물 삭제를 익스텐션 API로 받을지.** 권장: 받지 않는다(웹에서만). 받기로 하면 기존 `DELETE tasks/{id}`가 추가 게시물 id에 대해 koo의 삭제 규칙을 따르는지만 확인한다.
2. **예약 등록과 동시에 게시물 수 지정**(`POST reservations`에 `postCount`). 권장: 넣지 않는다(익스텐션이 등록 뒤 `POST tasks/{id}/posts`를 부른다).

## 범위 밖

- 웹 화면의 [게시물 하나 더]·기타 협찬 화면·정산·성과 계산(koo)
- 정산 외부 API·마케팅 비용 API의 `other`(정산데스크·LINE 대시보드 카드)
