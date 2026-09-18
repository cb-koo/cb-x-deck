# 캠페인 v2 — A. 기반(데이터·판정·액션 라우트) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업(campaign_task)에 **취소** 상태와 **6단계 파생**을 넣고, 취소·되돌리기·교체를 서버 액션 라우트로 제공하며, 기존 캠페인 화면·집계·정산 후보가 같은 모집단 규칙("집계에서 빼는 것은 취소만")을 쓰게 한다. 이 계획만 배포해도 기존 캠페인 표에 취소 작업이 보이고 API로 취소·되돌리기·교체가 된다. 새 페이지(B)·원고 모드(C)는 별도 계획.

**Architecture:** 스키마는 `campaign_task`에 컬럼 5개 + check 1개 + `influencer_log` 이벤트 1개(마이그레이션 055, 추가만). 판정은 순수 함수 `campaignJudgment.ts` 한 곳(`taskStage`에 `cancelled` 최상위, `isTaskExcluded` = 취소), 집계 SQL(`campaignStore`·`settlementStore`)은 `t.cancelled_at is null`로 같은 모집단. 상태 전이는 PATCH가 아니라 액션 라우트 셋(`POST …/tasks/[taskId]/cancel | restore | replace`)이 `for update` 재검사 + 한 트랜잭션으로 보장한다.

**Tech Stack:** Next.js(App Router, `src/app/api/**/route.ts`) · postgres.js(`sql.begin`, `tx.savepoint`) · TypeScript · `node --test` + tsx(순수 함수는 결정적 테스트, 스토어는 **실 DB** 테스트 — `npm test`는 프로덕션 DB를 쓴다, 접두어 + `after` 정리 관례).

## Global Constraints

- 결정 문서: `docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md` §3-1·§6, R16~R21. ADR 0001~0006. 용어는 `CONTEXT.md`.
- 마이그레이션 번호 **055** — 시작 전 `ls migrations | tail -1`이 `054_…`인지 확인. `scripts/apply-migrations.sh`가 전 파일을 재실행하므로 **모든 문장 멱등**(`if not exists`, `drop constraint if exists` + `add`).
- 날짜는 `date` 컬럼 + `to_char(…, 'YYYY-MM-DD')` 왕복(DateOnly 관례). 시간대 변환 금지.
- 사유 값(DB): `'declined' | 'no_response' | 'other'`. 화면 라벨은 B 계획.
- 상태 제한 문구(400): `CANCELLED_TASK_MESSAGE = '취소된 작업이에요 — 되돌린 뒤 고쳐 주세요'`, `CANCEL_POSTED_MESSAGE = '이미 게시된 작업은 취소할 수 없어요 — 내림으로 처리해 주세요'`, `POST_CANCELLED_MESSAGE = '취소된 작업이에요 — 되돌린 뒤 게시 확인해 주세요'`, `REPLACE_REQUIRED_MESSAGE = '다른 인플루언서로 바꾸려면 교체를 써 주세요'`, `REPLACE_AFTER_VISIT_MESSAGE = '방문한 인플루언서가 게시해야 해요 — 진행이 안 되면 취소해 주세요'`, `TRACKING_LINK_CANCELLED_MESSAGE = '취소된 작업에는 게시물을 연결할 수 없어요 — 되돌린 뒤 연결해 주세요'`.
- 테스트 접두어: 새 스토어 테스트 파일은 `'tcv2' + process.pid`. 정산 요청을 만들지 않으므로 `settlementTestFixture.ts` 목록 추가는 불필요.
- 린트 기준선: `npx eslint`가 **0 errors**(경고 5). 새 error 0 유지.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 스테이징은 경로 명시(`git add <파일>`), `git add -A` 금지(공유 워크트리 관례).
- 업데이트 소식(`src/content/updates.ts`)은 **B 계획 배포 때 한 건**으로 — 이 계획 단독으로는 화면 변화가 "기존 표에 취소 표시"뿐이라 B와 묶는다.

---

## 파일 구조

| 파일 | 책임 | 이 계획에서 |
|---|---|---|
| `migrations/055_campaign_task_cancel.sql` | 취소 컬럼·상호 배제·로그 이벤트 | 생성 |
| `src/lib/campaignJudgment.ts` | 순수 판정(단계·제외·정산 후보·정렬) | `TaskStage`에 `cancelled`, `isTaskExcluded`, `isTaskUnused` 집계에서 제거 |
| `src/lib/campaignTaskStore.ts` | 행 읽기·쓰기 | `TaskRow`에 취소 5필드, `cancelTask`·`restoreTask`·`replaceInfluencer`, `markPosted` 가드 |
| `src/lib/campaignTaskInput.ts` | 라우트 입력 파싱·문구 | 사유 파서, 새 문구 상수 |
| `src/lib/campaignStore.ts` | 캠페인 목록·합계·월 집계 | 모집단 SQL 4곳 교체 |
| `src/lib/settlementStore.ts` | 정산 후보 SQL | `CANDIDATE_BASE`에 취소 제외 |
| `src/lib/trackingStore.ts` | 게시물 연결 | 취소 작업 연결 거절 |
| `src/lib/checkPostedRun.ts` | RT 자동 확인 | 취소 작업 건너뜀 |
| `src/lib/influencerStore.ts` | 타임라인 로그 타입 | `task_declined` 이벤트·payload 타입 |
| `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts` | PATCH·DELETE | 취소 중 편집 제한, 인플 변경 규칙 |
| `src/app/api/campaigns/[id]/tasks/[taskId]/{cancel,restore,replace}/route.ts` | 액션 라우트 | 생성 |
| `src/lib/campaignApi.ts` | 클라이언트 fetch 헬퍼 | `cancelTaskApi`·`restoreTaskApi`·`replaceInfluencerApi` |
| `src/components/DraftStatusChip.tsx` | 단계 칩 색 | `cancelled` 색 |
| `src/app/campaigns/{TaskTable,PostedCell,WeekCalendar}.tsx` | 기존 화면 | 취소 표시·편집 불가·달력 제외 |

---

### Task 1: 마이그레이션 055 — 취소 컬럼·상호 배제·로그 이벤트

**Files:**
- Create: `migrations/055_campaign_task_cancel.sql`

**Interfaces:**
- Produces: `campaign_task.cancelled_at date`, `cancel_reason text`, `cancel_note text not null default ''`, `cancelled_draft_id uuid`, `cancelled_draft_title text`; check `campaign_task_cancel_xor_posted`; `influencer_log.event_type`에 `'task_declined'`.

- [ ] **Step 1: 번호 확인**

Run: `ls migrations | tail -1`
Expected: `054_payment_request_dates.sql`. 다르면 이 계획의 055를 그 다음 번호로 바꾸고 결정 문서 R16도 고친다.

- [ ] **Step 2: 마이그레이션 작성**

```sql
-- 055: 작업 취소 (캠페인 v2 결정 문서 R16, ADR 0002) — 추가만, 전 문장 멱등.
-- 취소 = 삭제가 아니라 상태. 게시 확인과 상호 배제(check). 되돌리기를 위해 떼어낸 원고를 기억한다.
alter table campaign_task
  add column if not exists cancelled_at          date,                                              -- 취소일(서울 DateOnly). null = 취소 아님
  add column if not exists cancel_reason         text check (cancel_reason is null or cancel_reason in ('declined','no_response','other')),
  add column if not exists cancel_note           text not null default '',                          -- 사유 메모 한 줄(선택)
  add column if not exists cancelled_draft_id    uuid references draft(id) on delete set null,      -- 취소 때 떼어낸 원고. 원고가 지워지면 null
  add column if not exists cancelled_draft_title text;                                              -- 그 원고 제목 스냅샷 — 원고가 지워져도 "원고 있었음: 제목"
comment on column campaign_task.cancelled_at is '취소일(055). 게시 확인(posted_at)과 공존 불가 — check campaign_task_cancel_xor_posted';
comment on column campaign_task.cancelled_draft_id is '취소 때 떼어낸 원고(055). 되돌리기가 재부착을 시도한다';

-- 취소 ↔ 게시 확인 상호 배제. 경합(취소 직전에 게시 확인이 들어옴)의 최후 방어 — 진 쪽은 23514.
alter table campaign_task drop constraint if exists campaign_task_cancel_xor_posted;
alter table campaign_task add constraint campaign_task_cancel_xor_posted
  check (cancelled_at is null or posted_at is null);

create index if not exists idx_campaign_task_cancelled on campaign_task (campaign_id) where cancelled_at is not null;

-- 인플루언서 타임라인: 작업 거절·무응답(ADR 0001·0005). not valid = 전 파일 재실행 때 뒤 마이그레이션이 넓힌 값과 충돌하지 않게(040 관례).
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled','payment_paid','payment_revised',
                        'task_declined')) not valid;
```

- [ ] **Step 3: 적용**

스토어 테스트가 실 DB(프로덕션)를 쓰므로 먼저 적용해야 한다(038·040 때와 같은 관례 — 추가만이라 옛 코드와 공존). koo 확인 후:

Run: `scripts/apply-migrations.sh .env 2>&1 | tail -3`
Expected: `== applying migrations/055_campaign_task_cancel.sql` 뒤 오류 없이 `== done`.

- [ ] **Step 4: 컬럼 확인**

Run: `set -a; . ./.env; set +a; psql -c "\d campaign_task" | grep -E "cancel|xor"`
Expected: 5개 컬럼 + `campaign_task_cancel_xor_posted` CHECK 한 줄.

- [ ] **Step 5: 커밋**

```bash
git add migrations/055_campaign_task_cancel.sql
git commit -m "feat(db): 055 작업 취소 컬럼·게시 확인 상호 배제·task_declined 이벤트 (캠페인 v2 R16)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `TaskRow`에 취소 5필드 읽기

**Files:**
- Modify: `src/lib/campaignTaskStore.ts:11-21` (TaskRow), `:53-62` (Row), `:72-86` (toRow), `:88-96` (SELECT)
- Test: `src/lib/campaignTaskCancel.test.ts` (신설 — Task 6·7이 같은 파일에 이어 쓴다)

**Interfaces:**
- Produces: `TaskRow.cancelledAt: string | null`, `cancelReason: CancelReason | null`, `cancelNote: string`, `cancelledDraftId: string | null`, `cancelledDraftTitle: string | null`. `campaignTaskInput.ts`에 `export type CancelReason = 'declined' | 'no_response' | 'other'`, `export const CANCEL_REASONS`, `isCancelReason()` — **값은 input 쪽에**, store는 `import type`만(input이 store의 `TaskPatch` 타입을 이미 import하므로 값 import 방향은 store → input 한쪽만 둔다).

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/lib/campaignTaskCancel.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { insertDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import { createTasks, getTask } from './campaignTaskStore.ts';
import { CANCEL_REASONS } from './campaignTaskInput.ts';

const sql = getSql();
const P = 'tcv2' + process.pid;
const content: DraftContent = { posts: [{ text: '취소 테스트', media: [] }] };

after(async () => {
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

export const mkCampaign = async (suffix: string) => {
  const c = await createClient(sql, P + '클라' + suffix);
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  return { c, camp };
};
export const mkDraft = (clientId: string, clientName: string, title: string | null = null) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, title,
  });
export const baseInput = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 취소 5필드 왕복 — 기본 null/빈 문자열, SQL로 찍은 값이 그대로 읽힌다', async () => {
  const { camp } = await mkCampaign('a');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: P + '_a', cost: null }] });
  assert.equal(t.cancelledAt, null);
  assert.equal(t.cancelReason, null);
  assert.equal(t.cancelNote, '');
  assert.equal(t.cancelledDraftId, null);
  assert.equal(t.cancelledDraftTitle, null);
  await sql`update campaign_task set cancelled_at = '2026-09-16', cancel_reason = 'declined', cancel_note = '일정', cancelled_draft_title = '제목' where id = ${t.id}`;
  const r = await getTask(sql, t.id);
  assert.equal(r?.cancelledAt, '2026-09-16');
  assert.equal(r?.cancelReason, 'declined');
  assert.equal(r?.cancelNote, '일정');
  assert.equal(r?.cancelledDraftTitle, '제목');
  assert.deepEqual([...CANCEL_REASONS], ['declined', 'no_response', 'other']);
});

test('2) 상호 배제 check — 게시된 작업에 cancelled_at을 찍으면 23514', async () => {
  const { camp } = await mkCampaign('b');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_b', cost: null }] });
  await sql`update campaign_task set posted_at = '2026-09-15' where id = ${t.id}`;
  await assert.rejects(
    sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${t.id}`,
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskCancel.test.ts 2>&1 | tail -15`
Expected: 테스트 1 FAIL — `CANCEL_REASONS`가 export되지 않음 / `cancelledAt` undefined.

- [ ] **Step 3: 구현**

`src/lib/campaignTaskStore.ts` — `TaskRow` 인터페이스의 `proof` 줄 아래에 추가:

```ts
  // 취소(055, ADR 0002) — 삭제가 아니라 상태. cancelledDraft*는 되돌리기용 스냅샷(떼어낸 원고 id·제목)
  cancelledAt: string | null; cancelReason: CancelReason | null; cancelNote: string;
  cancelledDraftId: string | null; cancelledDraftTitle: string | null;
```

`src/lib/campaignTaskInput.ts` 문구 상수 블록(`:24-34`) 아래에:

```ts
export const CANCEL_REASONS = ['declined', 'no_response', 'other'] as const;
export type CancelReason = typeof CANCEL_REASONS[number];
export const isCancelReason = (v: unknown): v is CancelReason => typeof v === 'string' && (CANCEL_REASONS as readonly string[]).includes(v);
```

`src/lib/campaignTaskStore.ts` 상단 import에 `import type { CancelReason } from './campaignTaskInput.ts';` 추가(타입만 — 런타임 순환 없음).

`type Row`에 추가:

```ts
  cancelled_at: string | null; cancel_reason: CancelReason | null; cancel_note: string;
  cancelled_draft_id: string | null; cancelled_draft_title: string | null;
```

`toRow`의 `proof: taskProofOf(r.proof),` 아래에:

```ts
  cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, cancelNote: r.cancel_note,
  cancelledDraftId: r.cancelled_draft_id, cancelledDraftTitle: r.cancelled_draft_title,
```

`SELECT`의 `t.cost, t.note, t.proof, t.created_at, t.updated_at,` 줄 뒤에:

```ts
         to_char(t.cancelled_at, 'YYYY-MM-DD') as cancelled_at, t.cancel_reason, t.cancel_note,
         t.cancelled_draft_id, t.cancelled_draft_title,
```

- [ ] **Step 4: 통과 확인 + 타입**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskCancel.test.ts 2>&1 | tail -6 && npx tsc --noEmit 2>&1 | tail -3`
Expected: `# pass 2`, tsc 오류 0. (tsc가 `TaskRow`를 만드는 다른 곳 — `campaignStore.getCampaignDetail`의 스프레드, 테스트 픽스처 — 에서 필드 누락을 잡으면 그 자리에 5필드를 채운다.)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/campaignTaskStore.ts src/lib/campaignTaskInput.ts src/lib/campaignTaskCancel.test.ts
git commit -m "feat(tasks): TaskRow에 취소 5필드 읽기 (055)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 판정 — 6단계 `taskStage`, 제외는 취소만(`isTaskExcluded`), 정산 후보에 취소 제외

**Files:**
- Modify: `src/lib/campaignJudgment.ts:142-230` (TaskStage·taskStage·isTaskUnused·isTaskOverdue·matchesTaskFilter·summarizeTasks·summarizeTaskPerf·subtotalsByType), `:233-260` (sortTasks), `:275-300` (deriveTaskInfluencers), `:319-321` (isSettlementCandidate)
- Modify: `src/lib/campaignTaskJudgment.test.ts:31-36, 47-48, 64, 84, 98`
- Modify: `src/lib/campaignTableView.test.ts:18`

**Interfaces:**
- Produces: `type TaskStage = 'cancelled' | 'planned' | …`(기존 + `cancelled`), `TASK_STAGE_LABEL.cancelled = '취소됨'`, `TaskStageInput.cancelledAt: string | null`, `isTaskExcluded(t): boolean`, `type FlowStage = 'prep' | 'handed' | 'posted' | 'settle' | 'done' | 'canc'`, `FLOW_STAGE_LABEL`, `flowStage(t, settlement): FlowStage`(B 계획의 표 '단계' 열이 쓴다), `isSettlementCandidate`에 `cancelledAt` 입력.
- 기존 화면이 쓰는 `taskStage`(9단계 + 취소)는 유지 — 기존 표·달력은 그대로 읽고, 취소만 최상위로 얹는다.

- [ ] **Step 1: 실패 테스트 작성** — `src/lib/campaignTaskJudgment.test.ts`

파일 상단 `base`에 `cancelledAt: null` 추가:

```ts
const base = (o: Partial<TaskStageInput> = {}): TaskStageInput => ({
  type: 'rt', draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null, cancelledAt: null, ...o,
});
```

import에 `isTaskExcluded, flowStage, FLOW_STAGE_LABEL` 추가. 파일 끝에 테스트 추가:

```ts
test('9) 취소 — 단계 최상위, 집계·밀림·정산 후보에서 빠지는 유일한 조건, 미사용 원고는 이제 빠지지 않는다 (R17·R21)', () => {
  const canc = base({ type: 'post', draftStatus: 'draft', scheduledOn: '2026-08-01', cancelledAt: '2026-08-20' });
  assert.equal(taskStage(canc, T), 'cancelled');
  assert.equal(TASK_STAGE_LABEL.cancelled, '취소됨');
  assert.equal(isTaskExcluded(canc), true);
  assert.equal(isTaskOverdue(canc, T), false);                       // 취소된 작업은 밀림이 아니다
  assert.equal(matchesTaskFilter(canc, 'preparing', T), false);
  assert.equal(matchesTaskFilter(canc, 'all', T), true);
  // 미사용 원고가 붙은 미게시 작업은 더 이상 제외되지 않는다 — 원고 미사용은 원고 상태, 작업은 진행 중(koo 09-15)
  const unusedTask = base({ type: 'post', draftStatus: 'unused', scheduledOn: '2026-08-01' });
  assert.equal(isTaskExcluded(unusedTask), false);
  assert.equal(isTaskOverdue(unusedTask, T), true);
  const s = summarizeTasks([canc, unusedTask, base({ postedAt: '2026-08-20' })], T);
  assert.equal(s.total, 2);                                          // 취소 1건만 빠진다
  assert.equal(s.published, 1);
  assert.equal(s.overdue, 1);
  assert.equal(s.cancelled, 1);
  const sub = subtotalsByType([{ ...canc, cost: { amount: 1000, currency: 'KRW' } }, { ...unusedTask, cost: { amount: 2000, currency: 'KRW' } }]);
  assert.deepEqual(sub, [{ type: 'post', count: 1, published: 0, cost: { KRW: 2000 } }]);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: null, cancelledAt: null }), true);
  assert.equal(isSettlementCandidate({ postedAt: null, cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: null, cancelledAt: '2026-08-20' }), false);
});

test('10) 6단계 파생(flowStage) — 취소 > 완료 > 정산 > 게시 > 준비 > 전달', () => {
  const s = (t: TaskStageInput & { influencerHandle: string | null }, settle: { status: 'requested' | 'cancelled'; externalStatus: string | null } | null) => flowStage(t, settle);
  const h = { influencerHandle: 'a' };
  assert.equal(s({ ...base({ cancelledAt: '2026-08-20' }), ...h }, null), 'canc');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'requested', externalStatus: 'paid' }), 'done');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'requested', externalStatus: null }), 'settle');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'requested', externalStatus: 'on_hold' }), 'settle');
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, { status: 'cancelled', externalStatus: null }), 'posted');   // 요청이 취소되면 다시 게시(정산 대기)
  assert.equal(s({ ...base({ postedAt: '2026-08-20' }), ...h }, null), 'posted');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'draft' }), ...h }, null), 'prep');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'approved' }), ...h }, null), 'prep');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'delivered' }), ...h }, null), 'handed');
  assert.equal(s({ ...base({ type: 'post', draftStatus: 'unused' }), ...h }, null), 'handed');            // 미사용 = 인플이 자기 글로 진행
  assert.equal(s({ ...base(), ...h }, null), 'handed');                                                   // 원고 없는 RT + 인플 있음
  assert.equal(s({ ...base({ type: 'post' }), influencerHandle: null }, null), 'prep');                   // 미배정
  assert.equal(FLOW_STAGE_LABEL.handed, '전달');
});
```

기존 테스트 2·3·5·6·8에서 "미사용은 제외/맨 아래"를 기대하는 줄을 새 규칙으로 바꾼다:

- `:36` `assert.equal(isTaskOverdue(base({ type: 'post', draftStatus: 'unused', scheduledOn: '2026-08-01' }), T), false);` → `true`
- `:48` `assert.equal(matchesTaskFilter(base({ type: 'post', draftStatus: 'unused' }), 'preparing', T), false);` → 그대로(`unused`는 PREPARING_STAGES에 없음)
- `:64` 근처 요약 테스트: 미사용 작업이 `total`에서 빠진다는 기대(`total` 값)를 +1 하고 비용 합에 8000 JPY를 더한다. 실행 결과 메시지(actual/expected)를 보고 숫자를 맞춘다.
- `:84` 정렬 테스트: 미사용이 맨 아래라는 기대 → 만든 순 그대로.
- `:98` 인플 목록 테스트: `rio`의 미사용 작업이 빠진다는 기대 → 포함.
- `src/lib/campaignTableView.test.ts:18` `taskOverdueDays({ ...b, scheduledOn: '2026-08-20', draftStatus: 'unused' }, T), null` → `8`(`T`가 `'2026-08-28'`일 때). `b`에 `cancelledAt: null` 추가.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/campaignTaskJudgment.test.ts src/lib/campaignTableView.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: `not ok` 여러 건(`isTaskExcluded` 미정의, `cancelledAt` 타입 오류 등).

- [ ] **Step 3: 구현** — `src/lib/campaignJudgment.ts`

`TaskStage`·입력·판정 블록(현재 `:142-165`)을 다음으로 교체:

```ts
export type TaskStage = 'cancelled' | 'planned' | 'visitPending' | 'visited' | DraftStatus | 'published' | 'removed';
export const TASK_STAGE_LABEL: Record<TaskStage, string> = {
  cancelled: '취소됨', planned: '예정', visitPending: '방문 전', visited: '방문 완료', ...STATUS_LABEL, published: '게시됨', removed: '내려짐',
};
export interface TaskStageInput {
  type: TaskType; draftStatus: DraftStatus | null;
  postedAt: string | null; removedAt: string | null;
  scheduledOn: string | null; visitOn: string | null;
  cancelledAt: string | null;   // 055 — 취소는 어느 판정보다 먼저
}
// 우선순위: 취소 > 내려짐 > 게시됨 > 원고 상태 > 방문(완료/전) > 예정. 게시 확인은 원고 status와 무관하게 이긴다(status 값은 바꾸지 않는다).
export function taskStage(t: TaskStageInput, today: string): TaskStage {
  if (t.cancelledAt) return 'cancelled';
  if (t.postedAt && t.removedAt) return 'removed';
  if (t.postedAt) return 'published';
  if (t.draftStatus) return t.draftStatus;
  if (t.type === 'visit') return t.visitOn !== null && t.visitOn < today ? 'visited' : 'visitPending';
  return 'planned';
}
// 집계(작업 수·비용 합·밀림·인플 건수)에서 빼는 유일한 조건 = 취소(R17, ADR 0002). 옛 규칙 "미사용 원고가 붙은 미게시 작업 제외"는
// 취소가 없던 시절의 대용이었고 폐지됐다 — 원고 미사용은 원고의 상태이지 작업의 상태가 아니다(koo 09-15).
export function isTaskExcluded(t: Pick<TaskStageInput, 'cancelledAt'>): boolean {
  return t.cancelledAt !== null;
}
// 밀림 = 게시 예정일 < 오늘 · 게시 안 됨 · 취소 아님. 방문일은 쓰지 않는다(방문→게시 사이가 긴 것이 정상).
export function isTaskOverdue(t: TaskStageInput, today: string): boolean {
  return t.scheduledOn !== null && t.scheduledOn < today && t.postedAt === null && !isTaskExcluded(t);
}
```

`isTaskUnused` 함수는 **삭제**한다(소비자는 이 Task와 Task 8에서 전부 갈아탄다). `matchesTaskFilter`의 `'published'` 분기 `&& !isTaskUnused(t)` → `&& !isTaskExcluded(t)`.

`TaskSummary`·`summarizeTasks`를 교체:

```ts
export interface TaskSummary { total: number; published: number; delivered: number; preparing: number; overdue: number; removed: number; cancelled: number }
export function summarizeTasks(items: TaskStageInput[], today: string): TaskSummary {
  const s: TaskSummary = { total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0, removed: 0, cancelled: 0 };
  for (const t of items) {
    if (isTaskExcluded(t)) { s.cancelled += 1; continue; }
    s.total += 1;
    const stage = taskStage(t, today);
    if (t.postedAt) s.published += 1;
    if (stage === 'removed') s.removed += 1;
    else if (stage === 'delivered') s.delivered += 1;
    else if (PREPARING_STAGES.includes(stage)) s.preparing += 1;
    if (isTaskOverdue(t, today)) s.overdue += 1;
  }
  return s;
}
```

`summarizeTaskPerf`·`subtotalsByType`·`deriveTaskInfluencers`의 `if (isTaskUnused(t)) continue;` / `!isTaskUnused(t)` → `isTaskExcluded`. `sortTasks`의 `const u = Number(isTaskUnused(a)) - Number(isTaskUnused(b));` → `Number(isTaskExcluded(a)) - Number(isTaskExcluded(b))`(취소가 맨 아래). `TASK_STAGE_ORDER`에 `cancelled: 7` 추가.

`isSettlementCandidate` 교체:

```ts
// 정산 후보(정산 스펙 §2-4) — settlementStore.CANDIDATE_BASE와 같은 정의, 스토어 테스트가 대조한다. 취소는 게시와 상호 배제라
// 이론상 겹치지 않지만 의도를 코드로 남긴다.
export function isSettlementCandidate(t: { postedAt: string | null; cost: TaskCost | null; influencerHandle: string | null; removedAt: string | null; cancelledAt: string | null }): boolean {
  return t.cancelledAt === null && t.postedAt !== null && t.cost !== null && t.influencerHandle !== null;
}
```

파일 끝에 6단계 파생(B 계획의 표가 쓴다 — 결정 문서 §3-1):

```ts
// ─────────────────────────── 6단계(캠페인 v2 §3-1, R21) ───────────────────────────
// 저장하지 않고 파생. 위에서부터 먼저 맞는 것. 정산 요청 상태(그쪽 external_status)는 settlementByTaskIds 결과를 받는다.
export type FlowStage = 'prep' | 'handed' | 'posted' | 'settle' | 'done' | 'canc';
export const FLOW_STAGES: readonly FlowStage[] = ['prep', 'handed', 'posted', 'settle', 'done', 'canc'];
export const FLOW_STAGE_LABEL: Record<FlowStage, string> = { prep: '준비', handed: '전달', posted: '게시', settle: '정산', done: '완료', canc: '취소' };
export interface FlowSettlementInput { status: 'requested' | 'cancelled'; externalStatus: string | null }
export function flowStage(t: TaskStageInput & { influencerHandle: string | null }, settlement: FlowSettlementInput | null): FlowStage {
  if (t.cancelledAt) return 'canc';
  if (settlement?.status === 'requested') return settlement.externalStatus === 'paid' ? 'done' : 'settle';
  if (t.postedAt) return 'posted';
  if (!t.influencerHandle) return 'prep';
  if (t.draftStatus && t.draftStatus !== 'delivered' && t.draftStatus !== 'unused') return 'prep';
  return 'handed';
}
```

- [ ] **Step 4: 통과 확인 + 소비자 컴파일**

Run: `node --import tsx --test src/lib/campaignTaskJudgment.test.ts src/lib/campaignTableView.test.ts 2>&1 | grep -E "^# (pass|fail)" && npx tsc --noEmit 2>&1 | head -20`
Expected: 두 파일 모두 fail 0. tsc는 `isTaskUnused`를 import하는 `TaskTable.tsx`·`WeekCalendar.tsx`·`campaignStore.ts`에서 오류 — **Task 4·8에서 고친다**. 이 단계에서는 오류 파일 목록이 정확히 그 셋(+`campaignTaskItem` 스프레드가 있으면 `campaignStore.ts`)인지만 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/campaignJudgment.ts src/lib/campaignTaskJudgment.test.ts src/lib/campaignTableView.test.ts
git commit -m "feat(judgment): 취소 최상위 단계·isTaskExcluded(제외는 취소만)·6단계 flowStage·정산 후보 취소 제외 (R17·R21)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 집계 SQL 모집단 교체 — `campaignStore`

**Files:**
- Modify: `src/lib/campaignStore.ts:87-95` (SELECT task_count), `:100-112` (totalsFor), `:123-129` (feeRows), `:334-346` (listInfluencerCampaigns)
- Modify: `src/lib/campaignStore.test.ts:59-60, 181`

**Interfaces:**
- Consumes: `isTaskExcluded`(Task 3) — SQL은 같은 뜻을 `t.cancelled_at is null`로.
- Produces: `spendByMonth`(월 집계)도 `totalsFor`를 통하므로 자동으로 같은 모집단.

- [ ] **Step 1: 실패 테스트** — `src/lib/campaignStore.test.ts`

`:59-60`의 미사용 원고 작업(8000 JPY)이 **합계에 들어가고**, 대신 취소된 작업이 빠지는 것으로 바꾼다. 그 테스트에 취소 작업 1건을 추가:

```ts
  const [cancTask] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: 'mio', cost: { amount: 5000, currency: 'JPY' } }] });
  await sql`update campaign_task set cancelled_at = '2026-08-30', cancel_reason = 'declined' where id = ${cancTask.id}`;
```

그 아래 합계 기대에서 JPY 합에 8000을 **더하고**(미사용 포함) 5000은 더하지 않는다(취소 제외). `task_count`(목록 보조줄) 기대도 미사용 +1, 취소 제외. `:181`의 `skip`(미사용 원고) 주석과 기대를 "포함"으로 바꾸고, 같은 자리에서 취소 작업이 참여 캠페인 건수에서 빠지는지 기대를 추가한다. 실행 후 actual/expected로 숫자를 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: 합계·건수 테스트 `not ok`.

- [ ] **Step 3: 구현** — 네 곳의 `and not (coalesce(d.status, '') = 'unused' and t.posted_at is null)` / `(coalesce(d.status, '') = 'unused' and t.posted_at is null) as unused`를 취소 조건으로.

`SELECT`(task_count):
```ts
         (select count(*) from campaign_task t
           where t.campaign_id = c.id and t.cancelled_at is null) as task_count
```
(`left join draft d`는 이 서브쿼리에서 더 필요 없으니 지운다. 주석을 "task_count는 취소 제외 — 요약 카드 N(summarizeTasks)과 같은 모집단(R17)"으로.)

`totalsFor` 첫 서브쿼리:
```ts
      select t.campaign_id, t.cost->>'currency' as currency, (t.cost->>'amount')::bigint as amount
        from campaign_task t
       where t.campaign_id = any(${ids}::uuid[]) and t.cost is not null and t.cancelled_at is null
```
`feeRows`:
```ts
    select t.campaign_id, t.cost, i.payment_methods
      from campaign_task t
      left join influencer i on lower(i.handle) = lower(t.influencer_handle)
     where t.campaign_id = any(${ids}::uuid[]) and t.cost is not null and t.cancelled_at is null
```
`listInfluencerCampaigns`:
```ts
  const tasks = await sql<Array<{ campaign_id: string; type: TaskType; cost: unknown; cancelled: boolean }>>`
    select t.campaign_id, t.type, t.cost, (t.cancelled_at is not null) as cancelled
      from campaign_task t
     where lower(t.influencer_handle) = ${lower}`;
  …
    const mine = tasks.filter((t) => t.campaign_id === c.id && !t.cancelled);
```
`getCampaignDetail`이 `CampaignTaskItem`을 만드는 스프레드는 `TaskRow` 확장(Task 2)으로 자동. `campaignStore.ts`에 `isTaskUnused` import가 있으면 지운다.

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts src/lib/clientBudget.test.ts 2>&1 | grep -E "^# (pass|fail)"`
Expected: fail 0.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/campaignStore.ts src/lib/campaignStore.test.ts
git commit -m "feat(campaigns): 집계 모집단을 '취소 제외'로 통일 — 미사용 원고 제외 규칙 폐지 (R17, ADR 0003)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 정산 후보·게시 확인 경로·대상 목록에 취소 가드

**Files:**
- Modify: `src/lib/settlementStore.ts:64-76` (CANDIDATE_BASE)
- Modify: `src/lib/campaignTaskStore.ts:241-246` (markPosted)
- Modify: `src/lib/checkPostedRun.ts:16`
- Modify: `src/lib/trackingStore.ts:7-10, 228-233`
- Modify: `src/app/api/tracking/route.ts:63`, `src/app/api/tracking/[id]/route.ts:56`
- Modify: `src/lib/campaignTaskInput.ts` (문구 상수)
- Modify: `src/lib/campaignTaskStore.ts:11-21, 53-62, 72-96` (target에 cancelledAt), `:204-238` (listTargetCandidates·listTargetingHandles 취소 제외)
- Modify: `src/lib/campaignJudgment.ts` (`targetStatus`에 `'cancelled'`)
- Test: `src/lib/campaignTaskCancel.test.ts`(이어서), `src/lib/settlementStore.test.ts`(기존 후보 대조 테스트에 취소 케이스 1건), `src/lib/campaignTaskJudgment.test.ts`(targetStatus 1줄)

**Interfaces:**
- Produces: `TrackingLinkError.code`에 `'cancelled-task'`, `TRACKING_LINK_CANCELLED_MESSAGE`. `campaignTaskInput`에 `CANCELLED_TASK_MESSAGE`, `CANCEL_POSTED_MESSAGE`, `POST_CANCELLED_MESSAGE`, `REPLACE_REQUIRED_MESSAGE`, `REPLACE_AFTER_VISIT_MESSAGE`. `TaskRow.target.cancelledAt: string | null`, `TargetStatus`에 `'cancelled'`(R19 — "대상 작업 취소됨"), `listTargetCandidates`·`listTargetingHandles`는 취소 작업 제외.

- [ ] **Step 1: 실패 테스트** — `campaignTaskCancel.test.ts` 끝에:

```ts
import { markPosted } from './campaignTaskStore.ts';
import { linkTrackedPost, addTrackedPost, TrackingLinkError } from './trackingStore.ts';

test('3) 게시 확인 경로 — markPosted는 취소 작업을 건너뛰고, 트래킹 연결은 취소 작업을 거절한다', async () => {
  const { camp } = await mkCampaign('c');
  const [a, b] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: P + '_c1', cost: null }, { handle: P + '_c2', cost: null }] });
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${b.id}`;
  const n = await markPosted(sql, [a.id, b.id], '2026-09-16', 'auto');
  assert.equal(n, 1);
  assert.equal((await getTask(sql, b.id))?.postedAt, null);
  const [post] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_c3', cost: null }] });
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${post.id}`;
  const { row: tp } = await addTrackedPost(sql, {
    tweetId: P + '001', authorHandle: P + '_c3', text: 'x', postedAt: null, createdBy: null,
    metrics: { views: null, likes: null, retweets: null, replies: null, bookmarks: null, quotes: null }, raw: null,
  });
  await assert.rejects(
    sql.begin((tx) => linkTrackedPost(tx as unknown as typeof sql, tp.id, { taskId: post.id })),
    (e: unknown) => e instanceof TrackingLinkError && e.code === 'cancelled-task',
  );
  assert.equal((await sql`select task_id from tracked_post where id = ${tp.id}`)[0].task_id, null);   // 연결 자체가 롤백
});

test('3b) 대상 — 취소된 작업은 새 대상 후보·"이미 RT하기로 한 사람"에서 빠지고, 이미 가리키던 RT는 target.cancelledAt으로 안다 (R19)', async () => {
  const { c, camp } = await mkCampaign('c2');
  const [post] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_t1', cost: null }] });
  const [rt] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', targetTaskId: post.id, items: [{ handle: P + '_t2', cost: null }] });
  assert.ok((await listTargetCandidates(sql, { clientId: c.id })).some((x) => x.taskId === post.id));
  assert.deepEqual(await listTargetingHandles(sql, { taskId: post.id }), [P + '_t2']);
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${post.id}`;
  assert.ok(!(await listTargetCandidates(sql, { clientId: c.id })).some((x) => x.taskId === post.id));
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${rt.id}`;
  assert.deepEqual(await listTargetingHandles(sql, { taskId: post.id }), []);          // 취소된 RT는 "이미 RT하기로 한 사람"이 아니다
  await sql`update campaign_task set cancelled_at = null where id = ${rt.id}`;
  assert.equal((await getTask(sql, rt.id))?.target?.cancelledAt, '2026-09-16');           // 대상이 취소됨 — 화면이 '대상 작업 취소됨'으로
});
```
(`listTargetCandidates`·`listTargetingHandles`를 import에 추가.) `campaignTaskJudgment.test.ts` 대상 테스트에 한 줄: `assert.equal(targetStatus({ targetTaskId: 'x', targetPostUrl: null, targetTweetUrl: null, targetCancelledAt: '2026-08-20' }), 'cancelled');` — 기존 `targetStatus` 호출들엔 `targetCancelledAt: null`을 추가.
(`PostMetrics`의 필드 이름이 위와 다르면 `src/lib/trackingStore.ts`의 `PostMetrics` 정의대로 키를 맞춘다 — 값은 전부 `null`.)

`settlementStore.test.ts`의 "후보 조건 대조" 테스트에 케이스 1건: 게시·비용·인플이 있어도 `cancelled_at`을 찍은 작업은 `listCandidates` 결과에 없어야 한다(check 제약 때문에 SQL로는 둘을 동시에 못 찍는다 → posted_at을 지우고 cancelled_at을 찍은 뒤, `isSettlementCandidate({...row, cancelledAt:'…'})`가 false인 것과 SQL 결과 부재를 함께 확인).

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskCancel.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: 테스트 3 `not ok`(markPosted가 2를 돌려주거나 연결이 성공).

- [ ] **Step 3: 구현**

`campaignTaskInput.ts` 문구 블록(`:24-34`)에 추가:
```ts
export const CANCELLED_TASK_MESSAGE = '취소된 작업이에요 — 되돌린 뒤 고쳐 주세요';
export const CANCEL_POSTED_MESSAGE = '이미 게시된 작업은 취소할 수 없어요 — 내림으로 처리해 주세요';
export const POST_CANCELLED_MESSAGE = '취소된 작업이에요 — 되돌린 뒤 게시 확인해 주세요';
export const REPLACE_REQUIRED_MESSAGE = '다른 인플루언서로 바꾸려면 교체를 써 주세요';
export const REPLACE_AFTER_VISIT_MESSAGE = '방문한 인플루언서가 게시해야 해요 — 진행이 안 되면 취소해 주세요';
export const CANCEL_REASON_MESSAGE = '취소 사유 값이 올바르지 않아요';
```

`campaignTaskStore.markPosted`:
```ts
export async function markPosted(sql: postgres.Sql, taskIds: string[], postedAt: string, source: 'auto' | 'manual'): Promise<number> {
  if (taskIds.length === 0) return 0;
  // 취소된 작업은 건너뛴다(ADR 0002 상호 배제) — check 제약이 최후 방어지만 자동 조회가 한 건 때문에 통째로 실패하면 안 된다
  const rows = await sql`update campaign_task set posted_at = ${postedAt}::date, posted_source = ${source}, updated_at = now()
    where id = any(${taskIds}::uuid[]) and posted_at is null and cancelled_at is null returning id`;
  return rows.length;
}
```

`campaignTaskStore.ts` — `TaskRow.target`에 `cancelledAt: string | null` 추가, `Row`에 `tg_cancelled_at: string | null`, `SELECT`의 `tg.post_url as tg_post_url` 뒤에 `, to_char(tg.cancelled_at, 'YYYY-MM-DD') as tg_cancelled_at`, `toRow`의 target에 `cancelledAt: r.tg_cancelled_at`. `listTargetCandidates`의 where에 `and t.cancelled_at is null`, `listTargetingHandles` 두 쿼리에 `and cancelled_at is null`.

`campaignJudgment.ts` 대상 블록:
```ts
export type TargetStatus = 'none' | 'pending' | 'ready' | 'cancelled';
export interface TargetInput { targetTaskId: string | null; targetPostUrl: string | null; targetTweetUrl: string | null; targetCancelledAt: string | null }
export function targetStatus(t: TargetInput): TargetStatus {
  if (t.targetTaskId) return t.targetCancelledAt ? 'cancelled' : t.targetPostUrl ? 'ready' : 'pending';   // 대상 작업이 취소됨(R19) — 대상을 바꿔야 한다
  return t.targetTweetUrl ? 'ready' : 'none';
}
```
호출부(`TaskTable.tsx:134`의 `targetStatus({...})`, `campaignTableView.ts`, `checkPosted.ts`)에 `targetCancelledAt: t.target?.cancelledAt ?? null`을 넘긴다. `TaskTable`의 대상 셀은 `tStatus === 'cancelled' && <span className="text-red-600"> · 대상 작업 취소됨</span>`(기존 `' · 게시 전'` 옆).

`checkPostedRun.ts:16`:
```ts
  const tasks = (await listTasksByCampaign(sql, campaignId)).filter((t) => t.type === 'rt' && t.cancelledAt === null).map(taskToCheck);
```

`settlementStore.CANDIDATE_BASE`의 where:
```ts
   where t.cancelled_at is null and t.posted_at is not null and t.cost is not null and t.influencer_handle is not null`;
```

`trackingStore.ts`:
```ts
export class TrackingLinkError extends Error {
  constructor(public code: 'rt-task' | 'cancelled-task') { super(code); this.name = 'TrackingLinkError'; }
}
export const TRACKING_LINK_RT_MESSAGE = 'RT 작업에는 게시물을 연결할 수 없어요 — RT는 새 게시물을 만들지 않아요. 증빙 스크린샷으로 게시 확인해 주세요';
export const TRACKING_LINK_CANCELLED_MESSAGE = '취소된 작업에는 게시물을 연결할 수 없어요 — 되돌린 뒤 연결해 주세요';
export const trackingLinkMessage = (e: TrackingLinkError) => e.code === 'rt-task' ? TRACKING_LINK_RT_MESSAGE : TRACKING_LINK_CANCELLED_MESSAGE;
```
`linkTrackedPost`의 taskId 분기(`select draft_id, type from campaign_task …`)를:
```ts
      const t = await sql<Array<{ draft_id: string | null; type: string; cancelled_at: string | null }>>`select draft_id, type, cancelled_at from campaign_task where id = ${taskId}`;
      if (t.length === 0) throw Object.assign(new Error('task not found'), { code: '23503' });
      if (t[0].type === 'rt') throw new TrackingLinkError('rt-task');
      // 취소 작업엔 연결 자체를 거절한다(ADR 0002) — 보충만 건너뛰면 tracked_post.task_id가 취소 작업에 남는 반쪽 연결이 생기고
      // check 제약도 잡지 못한다. 연결 update보다 먼저 던져 라우트 트랜잭션이 통째로 롤백된다.
      if (t[0].cancelled_at) throw new TrackingLinkError('cancelled-task');
```
두 트래킹 라우트의 `if (e instanceof TrackingLinkError) return NextResponse.json({ error: TRACKING_LINK_RT_MESSAGE }, { status: 400 });` → `{ error: trackingLinkMessage(e) }`(import 교체).

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskCancel.test.ts src/lib/settlementStore.test.ts src/lib/checkPosted*.test.ts 2>&1 | grep -E "^# (pass|fail)" && npx tsc --noEmit 2>&1 | grep -vE "TaskTable|WeekCalendar" | head`
Expected: fail 0. tsc 잔여 오류는 Task 8 대상 두 파일뿐.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts src/lib/campaignTaskStore.ts src/lib/campaignJudgment.ts src/lib/campaignTaskJudgment.test.ts src/lib/campaignTableView.ts src/lib/checkPosted.ts src/lib/checkPostedRun.ts src/lib/trackingStore.ts src/lib/campaignTaskInput.ts src/lib/campaignTaskCancel.test.ts src/app/campaigns/TaskTable.tsx "src/app/api/tracking/route.ts" "src/app/api/tracking/[id]/route.ts"
git commit -m "feat(tasks): 취소 작업은 정산 후보·자동 게시 확인·트래킹 연결·대상 후보에서 제외/거절, 대상 취소 표시 (ADR 0002, R19)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 취소·되돌리기 — 스토어 + 액션 라우트 + 타임라인 로그

**Files:**
- Modify: `src/lib/influencerStore.ts:16-24` (이벤트·payload 타입)
- Modify: `src/lib/campaignTaskStore.ts` (끝에 `cancelTask`·`restoreTask`)
- Modify: `src/lib/campaignTaskInput.ts` (`parseCancelBody`)
- Create: `src/app/api/campaigns/[id]/tasks/[taskId]/cancel/route.ts`, `…/restore/route.ts`
- Modify: `src/lib/campaignApi.ts` (`cancelTaskApi`, `restoreTaskApi`)
- Test: `src/lib/campaignTaskCancel.test.ts`(이어서)

**Interfaces:**
- Produces:
  - `cancelTask(sql, id, input: { reason: CancelReason | null; note: string; actorId: string | null; today: string }): Promise<'ok' | 'not-found' | 'posted' | 'already'>`
  - `restoreTask(sql, id): Promise<{ result: 'ok' | 'not-found' | 'not-cancelled'; draft: 'reattached' | 'taken' | 'gone' | 'none' }>`
  - `InfluencerAutoEvent`에 `'task_declined'`, `TaskDeclinedPayload { taskId, campaignId, campaignName, taskType, reason: 'declined' | 'no_response', action: 'cancel' | 'replace' }`
  - `POST /api/campaigns/[id]/tasks/[taskId]/cancel` body `{ reason?: CancelReason | null; note?: string }` → 200 `TaskRow` / 404 / 409 `CANCEL_POSTED_MESSAGE` / 409 `CANCELLED_TASK_MESSAGE`(이미 취소)
  - `POST …/restore` → 200 `{ task: TaskRow; draft: 'reattached' | 'taken' | 'gone' | 'none' }` / 404 / 409(취소 아님)

- [ ] **Step 1: 실패 테스트**

```ts
import { cancelTask, restoreTask, attachDraft } from './campaignTaskStore.ts';
import { ensureInfluencer } from './influencerStore.ts';

test('4) 취소 — 원고를 떼고 스냅샷을 남기며, 게시된 작업은 거절, 거절 사유는 타임라인에 남는다', async () => {
  const { c, camp } = await mkCampaign('d');
  const handle = P + '_d';
  const infId = await ensureInfluencer(sql, handle, null);
  const draftId = await mkDraft(c.id, c.name, '치아미백 후기');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId, items: [{ handle, cost: { amount: 10000, currency: 'KRW' } }] });
  assert.equal(await cancelTask(sql, t.id, { reason: 'declined', note: '일정 안 맞음', actorId: null, today: '2026-09-16' }), 'ok');
  const r = await getTask(sql, t.id);
  assert.equal(r?.cancelledAt, '2026-09-16');
  assert.equal(r?.cancelReason, 'declined');
  assert.equal(r?.cancelNote, '일정 안 맞음');
  assert.equal(r?.draftId, null);                                  // 떼어졌다
  assert.equal(r?.cancelledDraftId, draftId);
  assert.equal(r?.cancelledDraftTitle, '치아미백 후기');
  const logs = await sql<Array<{ event_type: string; payload: { action: string; reason: string } }>>`
    select event_type, payload from influencer_log where influencer_id = ${infId} and event_type = 'task_declined'`;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].payload.action, 'cancel');
  assert.equal(logs[0].payload.reason, 'declined');
  assert.equal(await cancelTask(sql, t.id, { reason: null, note: '', actorId: null, today: '2026-09-16' }), 'already');
  const [posted] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle, cost: null }] });
  await sql`update campaign_task set posted_at = '2026-09-15' where id = ${posted.id}`;
  assert.equal(await cancelTask(sql, posted.id, { reason: 'other', note: '', actorId: null, today: '2026-09-16' }), 'posted');
  // 사유 없음·미배정 → 로그 없음
  const [noone] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [] });
  assert.equal(await cancelTask(sql, noone.id, { reason: 'no_response', note: '', actorId: null, today: '2026-09-16' }), 'ok');
  assert.equal((await sql`select count(*)::int as n from influencer_log where event_type = 'task_declined' and influencer_id = ${infId}`)[0].n, 1);
});

test('5) 되돌리기 — 재부착 / 다른 작업이 가져갔으면 작업만 복원 / 원고가 지워졌으면 작업만 복원, 취소 컬럼은 전부 비운다', async () => {
  const { c, camp } = await mkCampaign('e');
  const handle = P + '_e';
  // 재부착
  const d1 = await mkDraft(c.id, c.name, 'd1');
  const [t1] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId: d1, items: [{ handle, cost: null }] });
  await cancelTask(sql, t1.id, { reason: null, note: '', actorId: null, today: '2026-09-16' });
  const r1 = await restoreTask(sql, t1.id);
  assert.deepEqual(r1, { result: 'ok', draft: 'reattached' });
  const g1 = await getTask(sql, t1.id);
  assert.equal(g1?.draftId, d1);
  assert.equal(g1?.cancelledAt, null); assert.equal(g1?.cancelReason, null); assert.equal(g1?.cancelNote, '');
  assert.equal(g1?.cancelledDraftId, null); assert.equal(g1?.cancelledDraftTitle, null);
  // 다른 작업이 가져감 → 작업만 복원(세이브포인트: unique 충돌이 복원을 깨지 않는다)
  const d2 = await mkDraft(c.id, c.name, 'd2');
  const [t2] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId: d2, items: [{ handle, cost: null }] });
  await cancelTask(sql, t2.id, { reason: null, note: '', actorId: null, today: '2026-09-16' });
  const [other] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_e2', cost: null }] });
  await attachDraft(sql, other.id, d2);
  assert.deepEqual(await restoreTask(sql, t2.id), { result: 'ok', draft: 'taken' });
  assert.equal((await getTask(sql, t2.id))?.draftId, null);
  assert.equal((await getTask(sql, t2.id))?.cancelledAt, null);
  // 원고 삭제됨
  const d3 = await mkDraft(c.id, c.name, 'd3');
  const [t3] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId: d3, items: [{ handle, cost: null }] });
  await cancelTask(sql, t3.id, { reason: null, note: '', actorId: null, today: '2026-09-16' });
  await sql`delete from draft where id = ${d3}`;
  assert.deepEqual(await restoreTask(sql, t3.id), { result: 'ok', draft: 'gone' });
  // 취소 아님
  assert.equal((await restoreTask(sql, t3.id)).result, 'not-cancelled');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskCancel.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: 4·5 `not ok`(`cancelTask` 미정의).

- [ ] **Step 3: 구현**

`influencerStore.ts`:
```ts
export type InfluencerAutoEvent =
  'draft_assigned' | 'draft_unassigned' | 'draft_delivered' | 'handle_changed' | 'pricing_changed'
  | 'payment_method_changed' | 'payment_requested' | 'payment_cancelled' | 'payment_paid' | 'payment_revised'
  | 'task_declined';   // 작업 취소·교체의 사유가 거절/무응답일 때(캠페인 v2 ADR 0001·0005)

// 작업 거절·무응답 한 줄 — 타임라인은 "작업 거절 · 캠페인명 · 유형"만 보인다. 되돌리기 정정 이벤트는 없다(한계, ADR 0005).
export interface TaskDeclinedPayload {
  taskId: string; campaignId: string; campaignName: string; taskType: TaskType;
  reason: 'declined' | 'no_response'; action: 'cancel' | 'replace';
}
export type LogPayload = { from?: string; to?: string } | PricingChange | PaymentMethodChange | PaymentLogPayload | TaskDeclinedPayload;
```

`campaignTaskStore.ts` 끝에:

```ts
// ─────────────────────────── 취소·되돌리기 (055, ADR 0002) ───────────────────────────
// 취소 = 상태. 게시 전만. 원고는 떼되 무엇이었는지(id·제목) 기억한다. 컬럼·떼기·스냅샷·로그는 한 트랜잭션.
// 조건부 UPDATE(posted_at is null and cancelled_at is null)가 경합을 막고, check 제약이 최후 방어다.
export async function cancelTask(
  sql: postgres.Sql, id: string,
  input: { reason: CancelReason | null; note: string; actorId: string | null; today: string },
): Promise<'ok' | 'not-found' | 'posted' | 'already'> {
  if (!isUuidLike(id)) return 'not-found';
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const cur = await tx<Array<{ posted_at: string | null; cancelled_at: string | null; draft_id: string | null; influencer_handle: string | null; type: TaskType; campaign_id: string }>>`
      select posted_at, cancelled_at, draft_id, influencer_handle, type, campaign_id from campaign_task where id = ${id} for update`;
    if (cur.length === 0) return 'not-found';
    if (cur[0].cancelled_at) return 'already';
    if (cur[0].posted_at) return 'posted';
    const draftId = cur[0].draft_id;
    let title: string | null = null;
    if (draftId) {
      const d = await tx<Array<{ title: string | null; ko_title: string | null; first: string | null }>>`
        select title, ko_title, coalesce(edited, content)->'posts'->0->>'text' as first from draft where id = ${draftId}`;
      const first = (d[0]?.first ?? '').split('\n')[0].trim();
      title = d[0]?.title?.trim() || d[0]?.ko_title || (first ? (first.length > 60 ? first.slice(0, 60) + '…' : first) : null);
    }
    const rows = await tx`update campaign_task set
        cancelled_at = ${input.today}::date, cancel_reason = ${input.reason}, cancel_note = ${input.note},
        draft_id = null, cancelled_draft_id = ${draftId}, cancelled_draft_title = ${title}, updated_at = now()
      where id = ${id} and posted_at is null and cancelled_at is null returning id`;
    if (rows.length === 0) return 'posted';   // 그 사이 게시 확인이 들어왔다
    if ((input.reason === 'declined' || input.reason === 'no_response') && cur[0].influencer_handle) {
      await logTaskDeclined(tx, { handle: cur[0].influencer_handle, taskId: id, campaignId: cur[0].campaign_id, taskType: cur[0].type, reason: input.reason, action: 'cancel', actorId: input.actorId });
    }
    return 'ok';
  });
}

// 거절·무응답을 인플루언서 타임라인에 — 명부에 없는 핸들은 기록하지 않는다(해제·전달과 같은 태도, influencerSync).
export async function logTaskDeclined(tx: postgres.Sql, a: {
  handle: string; taskId: string; campaignId: string; taskType: TaskType; reason: 'declined' | 'no_response'; action: 'cancel' | 'replace'; actorId: string | null;
}): Promise<void> {
  const inf = await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${a.handle})`;
  if (inf.length === 0) return;
  const camp = await tx<Array<{ name: string }>>`select name from campaign where id = ${a.campaignId}`;
  await tx`insert into influencer_log (influencer_id, kind, event_type, draft_id, draft_title, payload, author_id)
    values (${inf[0].id}, 'auto', 'task_declined', null, null,
            ${tx.json({ taskId: a.taskId, campaignId: a.campaignId, campaignName: camp[0]?.name ?? '', taskType: a.taskType, reason: a.reason, action: a.action } as never)}, ${a.actorId})`;
}

// 되돌리기 — 외부 트랜잭션 하나: ① 작업 복원 UPDATE(취소 컬럼·스냅샷 전부 지움) → ② 세이브포인트 안에서 재부착 → ③ 커밋.
// attachDraft의 unique 충돌(23505 → TaskAttachError)이 트랜잭션을 통째로 깨지 않게 세이브포인트로 격리한다.
// "복원은 항상 성공" = 원고 점유·삭제가 작업 복원을 실패시키지 않는다는 뜻.
export async function restoreTask(sql: postgres.Sql, id: string): Promise<{ result: 'ok' | 'not-found' | 'not-cancelled'; draft: 'reattached' | 'taken' | 'gone' | 'none' }> {
  if (!isUuidLike(id)) return { result: 'not-found', draft: 'none' };
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql & { savepoint<T>(cb: (s: postgres.Sql) => Promise<T>): Promise<T> };
    const cur = await tx<Array<{ cancelled_at: string | null; cancelled_draft_id: string | null }>>`
      select cancelled_at, cancelled_draft_id from campaign_task where id = ${id} for update`;
    if (cur.length === 0) return { result: 'not-found', draft: 'none' };
    if (!cur[0].cancelled_at) return { result: 'not-cancelled', draft: 'none' };
    const draftId = cur[0].cancelled_draft_id;
    await tx`update campaign_task set cancelled_at = null, cancel_reason = null, cancel_note = '',
        cancelled_draft_id = null, cancelled_draft_title = null, updated_at = now() where id = ${id}`;
    if (!draftId) return { result: 'ok', draft: 'none' };
    const exists = await tx<Array<{ id: string }>>`select id from draft where id = ${draftId}`;
    if (exists.length === 0) return { result: 'ok', draft: 'gone' };
    try {
      await tx.savepoint(async (sp) => { await attachDraft(sp as unknown as postgres.Sql, id, draftId); });
      return { result: 'ok', draft: 'reattached' };
    } catch (e) {
      if (e instanceof TaskAttachError) return { result: 'ok', draft: 'taken' };   // 세이브포인트만 롤백됨 — 복원은 유지
      throw e;
    }
  });
}
```

`campaignTaskInput.ts`에 파서:
```ts
export function parseCancelBody(body: unknown): Parsed<{ reason: CancelReason | null; note: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  let reason: CancelReason | null = null;
  if (b.reason != null && b.reason !== '') { if (!isCancelReason(b.reason)) return fail(CANCEL_REASON_MESSAGE); reason = b.reason; }
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  return { ok: true, value: { reason, note } };
}
```
(`isCancelReason`·`CancelReason`은 Task 2에서 이 파일에 정의했다.)

라우트 `src/app/api/campaigns/[id]/tasks/[taskId]/cancel/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { getTask, cancelTask } from '@/lib/campaignTaskStore';
import { parseCancelBody, TASK_NOT_FOUND_MESSAGE, CANCEL_POSTED_MESSAGE, CANCELLED_TASK_MESSAGE } from '@/lib/campaignTaskInput';

// 작업 취소(캠페인 v2 ADR 0002) — PATCH가 아니라 액션 라우트: for update 재검사 + 원고 떼기·스냅샷·로그를 한 트랜잭션에.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const parsed = parseCancelBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await cancelTask(sql, taskId, { ...parsed.value, actorId: gate.member.id, today: kstToday() });
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'posted') return NextResponse.json({ error: CANCEL_POSTED_MESSAGE }, { status: 409 });
  if (r === 'already') return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 409 });
  return NextResponse.json(await getTask(sql, taskId));
}
```

`…/restore/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getTask, restoreTask } from '@/lib/campaignTaskStore';
import { TASK_NOT_FOUND_MESSAGE, RESTORE_NOT_CANCELLED_MESSAGE } from '@/lib/campaignTaskInput';

// 되돌리기(ADR 0002) — 복원 UPDATE → 세이브포인트 재부착 → 단일 커밋. draft: reattached | taken | gone | none 을 화면이 문구로 옮긴다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await restoreTask(sql, taskId);
  if (r.result === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r.result === 'not-cancelled') return NextResponse.json({ error: RESTORE_NOT_CANCELLED_MESSAGE }, { status: 409 });
  return NextResponse.json({ task: await getTask(sql, taskId), draft: r.draft });
}
```
`campaignTaskInput.ts` 문구 블록에 `export const RESTORE_NOT_CANCELLED_MESSAGE = '취소된 작업이 아니에요';` 추가(라우트 파일은 HTTP 핸들러 외 export를 허용하지 않는다).

`campaignApi.ts`의 `deleteTaskApi` 아래:
```ts
export const cancelTaskApi = (campaignId: string, taskId: string, body: { reason: CancelReason | null; note: string }) =>
  call<TaskRow>(`/api/campaigns/${campaignId}/tasks/${taskId}/cancel`, json('POST', body));
export const restoreTaskApi = (campaignId: string, taskId: string) =>
  call<{ task: TaskRow; draft: 'reattached' | 'taken' | 'gone' | 'none' }>(`/api/campaigns/${campaignId}/tasks/${taskId}/restore`, { method: 'POST' });
```
(`TaskRow`는 `@/lib/campaignTaskStore`, `CancelReason`은 `@/lib/campaignTaskInput`에서 `import type`.)

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskCancel.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok" && npx tsc --noEmit 2>&1 | grep -vE "TaskTable|WeekCalendar" | head`
Expected: `# pass 5`, tsc 잔여 오류는 Task 8 두 파일뿐.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/influencerStore.ts src/lib/campaignTaskStore.ts src/lib/campaignTaskInput.ts src/lib/campaignApi.ts src/lib/campaignTaskCancel.test.ts "src/app/api/campaigns/[id]/tasks/[taskId]/cancel/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/restore/route.ts"
git commit -m "feat(tasks): 취소·되돌리기 액션 라우트 — 원고 떼기·스냅샷·세이브포인트 재부착·task_declined 로그 (ADR 0002)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 인플루언서 교체 라우트 + PATCH 인플 변경 규칙(배정·해제·재선택·교체 금지·상태 제한)

**Files:**
- Modify: `src/lib/campaignTaskStore.ts` (끝에 `replaceInfluencer`, `influencerChangeGuard`)
- Modify: `src/lib/campaignTaskInput.ts` (`parseReplaceBody`)
- Modify: `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts:26-58` (PATCH)
- Create: `src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts`
- Modify: `src/lib/campaignApi.ts`
- Test: `src/lib/campaignTaskCancel.test.ts`(이어서), `src/lib/campaignTaskInput.test.ts`(가드 순수 함수)

**Interfaces:**
- Produces:
  - `influencerChangeGuard(cur: { postedAt; cancelledAt; type; visitOn; influencerHandle }, next: string | null, today: string): string | null` — 순수, 400 문구 또는 null. 규칙: 취소→`CANCELLED_TASK_MESSAGE`, 게시됨→`CANCELLED_TASK_MESSAGE`가 아닌 `POSTED_TASK_MESSAGE = '이미 게시된 작업이에요 — 인플루언서를 바꿀 수 없어요'`, 방문협찬 `visitOn < today`→`REPLACE_AFTER_VISIT_MESSAGE`, 현재≠null·next≠null·다름→`REPLACE_REQUIRED_MESSAGE`(PATCH 전용; replace 라우트는 이 검사만 건너뜀).
  - `replaceInfluencer(sql, id, input: { handle: string; cost: TaskCost | null; reason: CancelReason | null; note: string; actorId: string | null; today: string }): Promise<'ok' | 'not-found' | string(400 문구)>` — 한 트랜잭션: for update 재검사 → handle·cost 갱신 · proof null · 붙은 원고 delivered→approved + 원고 influencer_handle 갱신 + `syncInfluencerOnDraftUpdate` · 사유 로그(action `'replace'`).
  - `POST …/replace` body `{ handle: string; cost?: TaskCost | null; reason?: CancelReason | null; note?: string }` → 200 `TaskRow` / 400 문구 / 404.
  - PATCH: `influencerHandle`이 오면 `influencerChangeGuard`를 먼저 통과해야 하고, **해제**(→null)는 proof null + delivered→approved 정리를 같은 트랜잭션에서 한다(ADR 0005 표). 취소 작업에 `note` 외 필드 패치 → 400 `CANCELLED_TASK_MESSAGE`.

- [ ] **Step 1: 실패 테스트**

`src/lib/campaignTaskInput.test.ts`(없으면 신설) — 순수 가드:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { influencerChangeGuard, CANCELLED_TASK_MESSAGE, POSTED_TASK_MESSAGE, REPLACE_AFTER_VISIT_MESSAGE, REPLACE_REQUIRED_MESSAGE } from './campaignTaskInput.ts';

const T = '2026-09-16';
const cur = (o: Partial<{ postedAt: string | null; cancelledAt: string | null; type: 'post' | 'rt' | 'quoteRt' | 'visit'; visitOn: string | null; influencerHandle: string | null }> = {}) =>
  ({ postedAt: null, cancelledAt: null, type: 'post' as const, visitOn: null, influencerHandle: null, ...o });

test('인플 변경 가드 — 상태 제한은 배정·해제·교체에 같고, 다른 인플로의 PATCH는 교체로 보낸다 (ADR 0005)', () => {
  assert.equal(influencerChangeGuard(cur(), 'a', T), null);                                            // 배정
  assert.equal(influencerChangeGuard(cur({ influencerHandle: 'a' }), null, T), null);                  // 해제
  assert.equal(influencerChangeGuard(cur({ influencerHandle: 'a' }), 'A', T), null);                   // 같은 인플(대소문자 무시) = 변경 아님
  assert.equal(influencerChangeGuard(cur({ influencerHandle: 'a' }), 'b', T), REPLACE_REQUIRED_MESSAGE);
  assert.equal(influencerChangeGuard(cur({ influencerHandle: 'a' }), 'b', T, { allowReplace: true }), null);
  assert.equal(influencerChangeGuard(cur({ cancelledAt: '2026-09-15' }), 'a', T), CANCELLED_TASK_MESSAGE);
  assert.equal(influencerChangeGuard(cur({ postedAt: '2026-09-15', influencerHandle: 'a' }), null, T), POSTED_TASK_MESSAGE);
  assert.equal(influencerChangeGuard(cur({ type: 'visit', visitOn: '2026-09-15', influencerHandle: 'a' }), 'b', T, { allowReplace: true }), REPLACE_AFTER_VISIT_MESSAGE);
  assert.equal(influencerChangeGuard(cur({ type: 'visit', visitOn: T, influencerHandle: 'a' }), 'b', T, { allowReplace: true }), null);   // 당일은 허용
  assert.equal(influencerChangeGuard(cur({ type: 'visit', visitOn: null, influencerHandle: 'a' }), 'b', T, { allowReplace: true }), null); // 미정은 허용
});
```

`campaignTaskCancel.test.ts` 끝에:
```ts
import { replaceInfluencer } from './campaignTaskStore.ts';
import { getDraft, updateDraft } from './draftStore.ts';

test('6) 교체 — 같은 행에서 인플만 바뀌고, 전달됨 원고는 사용 확정으로, RT 증빙은 지워지고, 사유가 무응답이면 옛 인플 타임라인에 남는다', async () => {
  const { c, camp } = await mkCampaign('f');
  const oldH = P + '_f1', newH = P + '_f2';
  const oldId = await ensureInfluencer(sql, oldH, null);
  const draftId = await mkDraft(c.id, c.name, '전달된 원고');
  await updateDraft(sql, draftId, { status: 'delivered' });
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId, scheduledOn: '2026-09-18', items: [{ handle: oldH, cost: { amount: 30000, currency: 'KRW' } }] });
  const r = await replaceInfluencer(sql, t.id, { handle: newH, cost: { amount: 35000, currency: 'KRW' }, reason: 'no_response', note: '', actorId: null, today: '2026-09-16' });
  assert.equal(r, 'ok');
  const g = await getTask(sql, t.id);
  assert.equal(g?.influencerHandle, newH);
  assert.deepEqual(g?.cost, { amount: 35000, currency: 'KRW' });
  assert.equal(g?.scheduledOn, '2026-09-18');                                  // 그대로
  assert.equal(g?.draftId, draftId);                                           // 원고는 따라간다
  assert.equal((await getDraft(sql, draftId))?.status, 'approved');            // 전달됨 → 사용 확정
  assert.equal((await getDraft(sql, draftId))?.influencerHandle, newH);
  const logs = await sql<Array<{ payload: { action: string } }>>`select payload from influencer_log where influencer_id = ${oldId} and event_type = 'task_declined'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.action, 'replace');
  // RT 증빙 제거
  const [rt] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: oldH, cost: null }] });
  await sql`update campaign_task set proof = ${sql.json({ url: `task/${rt.id}/00000000-0000-4000-8000-000000000000.png`, by: null, byName: '', at: new Date().toISOString() } as never)} where id = ${rt.id}`;
  assert.equal(await replaceInfluencer(sql, rt.id, { handle: newH, cost: null, reason: null, note: '', actorId: null, today: '2026-09-16' }), 'ok');
  assert.equal((await getTask(sql, rt.id))?.proof, null);
  // 게시된 작업은 거절(문구)
  await sql`update campaign_task set posted_at = '2026-09-16' where id = ${rt.id}`;
  assert.equal(typeof await replaceInfluencer(sql, rt.id, { handle: oldH, cost: null, reason: null, note: '', actorId: null, today: '2026-09-17' }), 'string');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskInput.test.ts src/lib/campaignTaskCancel.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: 가드 테스트·6번 `not ok`.

- [ ] **Step 3: 구현**

`campaignTaskInput.ts`:
```ts
export const POSTED_TASK_MESSAGE = '이미 게시된 작업이에요 — 인플루언서를 바꿀 수 없어요';

// 인플루언서 칸을 바꾸는 모든 요청(배정·해제·교체)에 같은 상태 제한(ADR 0005). PATCH는 "다른 인플로"를 막고 교체 라우트로 보낸다.
export function influencerChangeGuard(
  cur: { postedAt: string | null; cancelledAt: string | null; type: TaskType; visitOn: string | null; influencerHandle: string | null },
  next: string | null, today: string, opts: { allowReplace?: boolean } = {},
): string | null {
  if (cur.cancelledAt) return CANCELLED_TASK_MESSAGE;
  if (cur.postedAt) return POSTED_TASK_MESSAGE;
  const same = (cur.influencerHandle ?? '').toLowerCase() === (next ?? '').toLowerCase();
  if (same) return null;
  if (cur.type === 'visit' && cur.visitOn !== null && cur.visitOn < today) return REPLACE_AFTER_VISIT_MESSAGE;   // 방문 완료 판정과 같은 기준(< 오늘)
  if (cur.influencerHandle && next && !opts.allowReplace) return REPLACE_REQUIRED_MESSAGE;
  return null;
}

export function parseReplaceBody(body: unknown): Parsed<{ handle: string; cost: TaskCost | null | undefined; reason: CancelReason | null; note: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const h = parseXHandle(String(b.handle ?? ''));
  if (!h.ok) return fail(handleParseMessage(h.reason));
  let cost: TaskCost | null | undefined = undefined;
  if ('cost' in b) { const c = parseTaskCost(b.cost); if (!c.ok) return c; cost = c.value; }
  const r = parseCancelBody(b);
  if (!r.ok) return r;
  return { ok: true, value: { handle: h.handle, cost, reason: r.value.reason, note: r.value.note } };
}
```

`campaignTaskStore.ts` 끝에:
```ts
// 옛 인플루언서의 흔적 정리(ADR 0005 표) — 해제·교체가 같이 쓴다: RT 증빙 제거, 붙은 원고가 '전달됨'이면 '사용 확정'으로.
// 원고 status 변경은 draftStore.updateDraft를 거쳐야 하므로 여기서는 값만 돌려주고 호출자(라우트/replaceInfluencer)가 처리한다.
export async function clearOldInfluencerTraces(tx: postgres.Sql, id: string): Promise<{ draftId: string | null; draftWasDelivered: boolean }> {
  const cur = await tx<Array<{ draft_id: string | null; status: string | null }>>`
    select t.draft_id, d.status from campaign_task t left join draft d on d.id = t.draft_id where t.id = ${id}`;
  await tx`update campaign_task set proof = null, updated_at = now() where id = ${id} and type = 'rt'`;
  return { draftId: cur[0]?.draft_id ?? null, draftWasDelivered: cur[0]?.status === 'delivered' };
}

// 교체(ADR 0005) — 같은 작업 ID. for update 재검사 → 인플·비용 → 흔적 정리 → 원고 상태·인플 동기화 → 사유 로그. 한 트랜잭션.
export async function replaceInfluencer(
  sql: postgres.Sql, id: string,
  input: { handle: string; cost: TaskCost | null | undefined; reason: CancelReason | null; note: string; actorId: string | null; today: string },
): Promise<'ok' | 'not-found' | string> {
  if (!isUuidLike(id)) return 'not-found';
  return sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const rows = await tx<Array<{ posted_at: string | null; cancelled_at: string | null; type: TaskType; visit_on: string | null; influencer_handle: string | null; campaign_id: string }>>`
      select to_char(posted_at,'YYYY-MM-DD') as posted_at, to_char(cancelled_at,'YYYY-MM-DD') as cancelled_at, type, to_char(visit_on,'YYYY-MM-DD') as visit_on, influencer_handle, campaign_id
        from campaign_task where id = ${id} for update`;
    if (rows.length === 0) return 'not-found';
    const cur = rows[0];
    const guard = influencerChangeGuard(
      { postedAt: cur.posted_at, cancelledAt: cur.cancelled_at, type: cur.type, visitOn: cur.visit_on, influencerHandle: cur.influencer_handle },
      input.handle, input.today, { allowReplace: true },
    );
    if (guard) return guard;
    await tx`update campaign_task set influencer_handle = ${input.handle},
        cost = case when ${input.cost !== undefined} then ${input.cost ? tx.json(input.cost as never) : null}::jsonb else cost end,
        updated_at = now() where id = ${id}`;
    const traces = await clearOldInfluencerTraces(tx, id);
    if (traces.draftId) {
      const before = await getDraft(tx, traces.draftId);
      if (before) {
        await updateDraft(tx, traces.draftId, { influencerHandle: input.handle, ...(traces.draftWasDelivered ? { status: 'approved' as const } : {}) });
        await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle: input.handle, status: traces.draftWasDelivered ? 'approved' : undefined, actorId: input.actorId });
      }
    }
    if ((input.reason === 'declined' || input.reason === 'no_response') && cur.influencer_handle) {
      await logTaskDeclined(tx, { handle: cur.influencer_handle, taskId: id, campaignId: cur.campaign_id, taskType: cur.type, reason: input.reason, action: 'replace', actorId: input.actorId });
    }
    return 'ok';
  });
}
```
(`getDraft`·`updateDraft`는 `./draftStore.ts`, `syncInfluencerOnDraftUpdate`는 `./influencerSync.ts`, `influencerChangeGuard`는 `./campaignTaskInput.ts`에서 import. input → store는 `import type`만이라 런타임 순환 없음. `draftStore.ts`가 `campaignTaskStore.ts`를 import하는지 확인(`grep -n campaignTaskStore src/lib/draftStore.ts`) — 한다면 `getDraft`·`updateDraft` 호출을 `replaceInfluencer`의 인자로 주입(`deps: { getDraft, updateDraft, sync }`)해 순환을 끊는다.)

라우트 `…/replace/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { getTask, replaceInfluencer } from '@/lib/campaignTaskStore';
import { parseReplaceBody, TASK_NOT_FOUND_MESSAGE } from '@/lib/campaignTaskInput';

// 인플루언서 교체(ADR 0005) — 같은 작업 ID. 상태 제한·흔적 정리·사유 로그를 서버가 한 트랜잭션으로 보장한다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const parsed = parseReplaceBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await replaceInfluencer(sql, taskId, { ...parsed.value, actorId: gate.member.id, today: kstToday() });
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r !== 'ok') return NextResponse.json({ error: r }, { status: 400 });
  return NextResponse.json(await getTask(sql, taskId));
}
```
(`replaceInfluencer`의 반환 `'ok' | 'not-found' | string`에서 문자열은 400 문구다.)

PATCH 라우트(`[taskId]/route.ts`) — `const cur = await getTask(sql, taskId);` 다음, `if (patch.visitOn …)` 앞에:
```ts
  // 취소 중 허용되는 편집은 메모만(ADR 0002 "취소 중 허용되는 것"). 나머지는 되돌린 뒤.
  if (cur.cancelledAt && Object.keys(patch).some((k) => k !== 'note')) return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 400 });
  // 인플루언서 칸 변경 — 배정·해제·같은 인플만. 다른 인플로는 교체 라우트(ADR 0005). 상태 제한은 셋에 같다.
  if (patch.influencerHandle !== undefined) {
    const g = influencerChangeGuard(cur, patch.influencerHandle, kstToday());
    if (g) return NextResponse.json({ error: g }, { status: 400 });
  }
```
트랜잭션 안(`await updateTask(tx, taskId, taskPatch);` 뒤, 기존 원고 인플 동기화 블록 앞)에 해제 정리:
```ts
    // 해제(인플 → 없음)도 옛 사람 흔적을 정리한다 — "해제 → 재배정"으로 교체 규칙을 우회할 수 없게(ADR 0005 표)
    if (patch.influencerHandle === null && cur.influencerHandle) {
      const traces = await clearOldInfluencerTraces(tx, taskId);
      if (traces.draftId && traces.draftWasDelivered) await updateDraft(tx, traces.draftId, { status: 'approved' });
    }
```
import에 `influencerChangeGuard, CANCELLED_TASK_MESSAGE`(campaignTaskInput)·`clearOldInfluencerTraces`(campaignTaskStore)·`kstToday`(datetime) 추가.

`campaignApi.ts`:
```ts
export const replaceInfluencerApi = (campaignId: string, taskId: string, body: { handle: string; cost?: TaskCost | null; reason?: CancelReason | null; note?: string }) =>
  call<TaskRow>(`/api/campaigns/${campaignId}/tasks/${taskId}/replace`, json('POST', body));
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTaskInput.test.ts src/lib/campaignTaskCancel.test.ts src/lib/campaignTaskStore.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok" && npx tsc --noEmit 2>&1 | grep -vE "TaskTable|WeekCalendar" | head`
Expected: fail 0. (`campaignTaskStore.test.ts`의 기존 인플 변경 테스트가 PATCH가 아닌 `updateTask`를 직접 부르므로 영향 없음 — 깨지면 그 테스트가 라우트 규칙을 우회하는 것이니 그대로 두고 라우트 규칙만 확인.)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/campaignTaskStore.ts src/lib/campaignTaskInput.ts src/lib/campaignTaskInput.test.ts src/lib/campaignTaskCancel.test.ts src/lib/campaignApi.ts "src/app/api/campaigns/[id]/tasks/[taskId]/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts"
git commit -m "feat(tasks): 인플루언서 교체 라우트 + PATCH 배정·해제·재선택 규칙, 상태 제한은 셋에 같게 (ADR 0005)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 기존 캠페인 화면 — 취소 표시(읽기), 미사용 흐림 제거, 달력 제외

**Files:**
- Modify: `src/components/DraftStatusChip.tsx:34-46`
- Modify: `src/app/campaigns/PostedCell.tsx:27, 74-76` (+ 취소면 팝오버 없이 칩만)
- Modify: `src/app/campaigns/TaskTable.tsx:16-19, 131-136, 220-224`
- Modify: `src/app/campaigns/WeekCalendar.tsx:5-6, 54, 128, 150-158`

**Interfaces:**
- Consumes: `TaskStage.cancelled`, `TASK_STAGE_LABEL.cancelled`, `isTaskExcluded`, `TaskSummary.cancelled`(Task 3).
- 조작(취소·되돌리기·교체 버튼)은 **B 계획의 새 페이지**에만(R20). 여기는 보이기만.

- [ ] **Step 1: 타입 오류 목록 확인(= 실패 상태)**

Run: `npx tsc --noEmit 2>&1 | grep -E "TaskTable|WeekCalendar|PostedCell|DraftStatusChip"`
Expected: `isTaskUnused` 없음 / `Record<TaskStage,…>`에 `cancelled` 누락 오류.

- [ ] **Step 2: 구현**

`DraftStatusChip.tsx`:
```ts
export const TASK_STAGE_STYLE: Record<TaskStage, string> = {
  ...STATUS_STYLE,
  published: PUBLISHED_STYLE,
  planned: 'border-x-border-strong bg-x-surface text-x-secondary',
  visitPending: 'border-amber-300 bg-amber-50 text-amber-800',
  visited: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  removed: 'border-slate-300 bg-slate-100 text-slate-600',
  cancelled: 'border-slate-200 bg-slate-50 text-slate-400 line-through',   // 취소(055) — 흐리게, 취소선
};
export const TASK_STAGE_BAR_HEX: Record<TaskStage, string> = {
  ...STAGE_BAR_HEX, planned: '#94a3ab', visitPending: '#f59e0b', visited: '#1d9bf0', removed: '#64748b', cancelled: '#cbd5e1',
};
```

`PostedCell.tsx` — `const stage = taskStage(task, today);` 아래:
```ts
  // 취소된 작업(055)은 조작이 없다 — 칩만 보이고 팝오버를 열지 않는다. 되돌리기는 v2 화면에서(R20).
  if (stage === 'cancelled') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-ui ${TASK_STAGE_STYLE.cancelled}`}
            title={task.cancelledDraftTitle ? `원고 있었음: ${task.cancelledDraftTitle}` : '취소된 작업'}>
        취소됨 {formatDateKo(task.cancelledAt as string)}
      </span>
    );
  }
```
(이 early return은 훅 호출들(useState/useRef/useCallback/useEffect) **뒤**에 두어야 한다 — 훅 순서 규칙. `openPop` 정의 직전이 적당하다.)

`TaskTable.tsx`:
- import에서 `isTaskUnused` 제거, `isTaskExcluded` 추가. 파일 상단 주석의 "연한 글씨 규칙" 줄을 `// 연한 글씨 규칙(v2 R17): 흐린 행 = 취소된 작업만(합계·게시 n/N에서 빠지는 것). 미사용 원고 작업은 일반 진하기(원고 미사용은 원고의 상태).`로.
- 행 시작(`:131-136`):
```tsx
                const cancelled = isTaskExcluded(t);
                const od = cancelled ? null : taskOverdueDays(t, today);
                …
                  <tr key={t.id} className={`border-b border-x-border ${od !== null ? 'bg-red-50 shadow-[inset_3px_0_0_0_#dc2626]' : 'hover:bg-x-hover'} ${cancelled ? 'opacity-60' : ''}`}>
```
- 취소 행의 편집 부품을 읽기 전용으로: 인플 셀은 `cancelled ? <span>{t.influencerHandle ? '@' + t.influencerHandle : '미배정'}</span> : <InfluencerChip …/>`, 예정일 셀의 `ScheduledOnField`는 `cancelled ? <span className="text-x-muted">{t.scheduledOn ? formatDateKo(t.scheduledOn) : '미정'}</span>`, 비용 `CostPopover`는 `cancelled ? <span className="tabular-nums text-x-muted line-through">{t.cost ? formatMoneyBy({ [t.cost.currency]: t.cost.amount }) : '—'}</span>`, 원고 칸의 "새로 만들기 · 고르기" 링크는 `cancelled ? <span className="text-x-muted">{t.cancelledDraftTitle ? `원고 있었음: ${t.cancelledDraftTitle}` : '—'}</span>`. `RowMenu`의 `onLinkPost`는 `cancelled ? null : …`. (`formatDateKo`는 `@/lib/campaignJudgment`에서 import.)
- 하단 줄(`:222`): `… · 밀림 ${summary.overdue}`}{summary.removed > 0 && ` · 내려짐 ${summary.removed}`}{summary.cancelled > 0 && ` · 취소 ${summary.cancelled}`}`

`WeekCalendar.tsx`:
- import `isTaskUnused` → `isTaskExcluded`. `LEGEND_STAGES`에 `'cancelled'`는 **넣지 않는다**(달력에 안 그림).
- 카드를 그리는 목록 필터 앞에서 취소 작업을 제외: 카드 함수 호출 전 `items.filter((t) => !isTaskExcluded(t))` — 이 컴포넌트가 작업 배열을 받아 날짜별로 나누는 지점(`matchesTaskFilter` 호출부 근처)에 `.filter((t) => !isTaskExcluded(t))`를 붙인다. `:128`의 `const unused = isTaskUnused(t);`와 className의 `${unused ? 'opacity-60' : ''}` 삭제.

- [ ] **Step 3: 타입·린트·표시 확인**

Run: `npx tsc --noEmit 2>&1 | tail -3 && npx eslint 2>&1 | tail -2`
Expected: tsc 오류 0, eslint 0 errors.

화면: `npm run build && npx next start -p 3001` 후 `http://127.0.0.1:3001/campaigns`(로컬은 build+start, `next dev`는 하이드레이션이 조용히 실패 — 메모리). 프로덕션 DB에 취소 작업이 없으면 표시 확인은 Task 6 테스트가 만들었다 지운 것뿐이라 **koo가 배포 후 API로 한 건 취소해 보는 것**으로 대신한다(§9 검증 표).

- [ ] **Step 4: 커밋**

```bash
git add src/components/DraftStatusChip.tsx src/app/campaigns/PostedCell.tsx src/app/campaigns/TaskTable.tsx src/app/campaigns/WeekCalendar.tsx
git commit -m "feat(campaigns): 기존 표·달력이 취소 작업을 안다 — 취소됨 칩·흐림·편집 불가·달력 제외, 미사용 흐림 제거 (R17·R20)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 전체 검증·문서 정리

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md` §8 (구현 시 확인 항목 체크)

- [ ] **Step 1: 전체 테스트**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0`. (약 4분, 실 DB.) 실패가 있으면 이 계획의 변경으로 깨진 것인지(`unused` 기대·`TaskRow` 필드 누락 픽스처) 확인해 그 테스트 파일에서 기대를 새 규칙으로 고친다 — 규칙을 되돌리지 않는다.

- [ ] **Step 2: 타입·린트·빌드**

Run: `npx tsc --noEmit && npx eslint && npm run build 2>&1 | tail -5`
Expected: 오류 0, 빌드 성공. 라우트 파일의 `export const RESTORE_NOT_CANCELLED_MESSAGE`가 빌드를 막으면 `campaignTaskInput.ts`로 이동.

- [ ] **Step 3: 프로덕션 미사용 작업 점검(결정 문서 §8)**

Run: `set -a; . ./.env; set +a; psql -Atc "select count(*) from campaign_task t join draft d on d.id = t.draft_id where d.status = 'unused' and t.posted_at is null and t.cancelled_at is null"`
Expected: 숫자 하나. 0이 아니면 koo에게 목록(캠페인·인플·유형)을 보이고 "취소로 바꿀지 그대로 진행 중으로 둘지" 확인 — 자동 변환하지 않는다.

- [ ] **Step 4: 결정 문서 §8 체크**

`- [ ] 구현 시: 마이그레이션 번호 재확인 … 트래킹↔취소 동시 실행 …` 항목을 `- [x] (A 계획 완료) …`로 바꾸고 결과(055 적용일, 미사용 작업 n건 처리)를 한 줄 덧붙인다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/2026-09-15-campaign-workflow-v2-decisions.md
git commit -m "docs(campaign-v2): A 계획 완료 — §8 구현 확인 항목 체크

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 검증 표 (배포 후 koo)

| 확인 | 방법 | 기대 |
|---|---|---|
| 취소 | `curl -X POST …/api/campaigns/{id}/tasks/{taskId}/cancel -d '{"reason":"declined","note":"테스트"}'`(브라우저 세션 쿠키) | 200, 기존 캠페인 표에 그 행이 흐리게 + `취소됨 9/18` 칩, 합계·게시 n/N에서 빠짐, 하단 `취소 1` |
| 게시된 작업 취소 | 게시 확인된 작업에 같은 요청 | 409 `이미 게시된 작업은 취소할 수 없어요 — 내림으로 처리해 주세요` |
| 되돌리기 | `POST …/restore` | 200 `{draft:'reattached'}`, 행이 원래대로 |
| 교체 | `POST …/replace -d '{"handle":"…","cost":{"amount":30000,"currency":"KRW"},"reason":"no_response"}'` | 200, 인플만 바뀜, 옛 인플 프로필 타임라인에 "작업 거절" 없음(무응답이라도 `task_declined` 1건 — 문구는 B 계획에서) |
| PATCH로 다른 인플 | `PATCH … -d '{"influencerHandle":"다른사람"}'` | 400 `다른 인플루언서로 바꾸려면 교체를 써 주세요` |
| 정산 후보 | 정산 페이지 검토 대기 | 취소 작업 없음(게시 확인 자체가 불가하니 자연히) |
| 클라이언트 월 예산 표 | 클라이언트 상세 | 미사용 원고 작업 비용이 **포함**되고 취소 작업이 빠짐 — 숫자가 바뀌었으면 R17 때문(koo에게 예고) |

## 다음 계획
- **B. 새 페이지 `/campaigns/flow`** — 표(6단계 `flowStage`·필터·검색·정렬)·요약 카드 3장·패널(작업 모드·비용 확인·대상)·게시 확인 다이얼로그·정산 딥링크·성과 업데이트·사이드바. 이 계획의 `cancelTaskApi`·`restoreTaskApi`·`replaceInfluencerApi`·`flowStage`를 소비.
- **C. 원고 모드** — 생성 미부착→선택 부착 API·X 컴포저·고르기 두 묶음·DraftCard 패널 안.
