# 캠페인 작업(campaign_task) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캠페인의 단위를 원고(draft)에서 작업(`campaign_task`: 투고·인용RT·RT·방문협찬)으로 바꾸고, RT 게시 확인을 대상 게시글 리포스터 조회로 채워, 작업 1행이 정산 후보 1건이 되게 한다.

**Architecture:** 새 표 `campaign_task`(038, 추가만)가 캠페인·인플·유형·원고(≤1)·대상(다른 작업 또는 URL)·게시 확인/내림·예정일/방문일·비용을 갖는다. 파생값(단계·밀림·대상 상태·요약·유형별 소계·인플 목록)은 `campaignJudgment.ts` 순수 함수(서버·클라 공용). `draft`는 3컬럼(campaign_id/scheduled_on/cost)을 잃고 `campaign_task.draft_id`에서 소속을 읽는다(컬럼 drop은 039, 배포 후). `tracked_post.task_id`로 게시물이 작업에 붙고, 원고 연결과 양방향으로 맞춰진다. 게시 확인 자동화는 기존 `getTweetRetweeters`를 캠페인 툴바 버튼(opt-in)에서 트윗당 1회 호출.

**Tech Stack:** Next.js(App Router, `node_modules/next/dist/docs/` 참조) · TypeScript · postgres.js(`sql` 태그) · node:test(`node --import tsx --env-file=.env --test <file>`) · Tailwind(x-* 토큰) · getxapi 클라이언트(`src/lib/getxapi.ts`).

**Spec:** `docs/superpowers/specs/2026-08-28-campaign-task-design.md` — 각 Task의 § 참조는 이 문서.

## Global Constraints

- 마이그레이션 번호 **038**(추가만: `campaign_task`·`tracked_post.task_id`) / **039**(draft 3컬럼 drop — 배포 후에만 적용, 이 계획에서는 파일만 만든다). 모든 문장 멱등(`if not exists`) — `scripts/apply-migrations.sh`가 전 파일을 재실행한다.
- 테스트는 **실 DB(.env = 프로덕션 풀)** — 테스트 데이터는 반드시 `P = 'xxxx' + process.pid` 접두어로 만들고 `after()`에서 지운다. 038은 Task 1에서 실 DB에 적용한다(옛 코드와 공존 가능).
- 유형 리터럴 `'post' | 'quoteRt' | 'rt' | 'visit'`과 라벨(`투고·인용RT·RT·방문협찬`)은 `src/lib/influencerPricing.ts`의 `PriceType`/`PRICE_TYPE_LABEL` **재사용**(지역 정의 금지).
- 날짜 컬럼은 `date`, 읽을 때 `to_char(x, 'YYYY-MM-DD')`, 쓸 때 `${v}::date`. '오늘' = `kstToday()`(서버) — 클라는 서버가 준 `today`를 쓴다.
- 핸들은 표기 보존, 비교는 `lower()`.
- UI 가독성: 행 ≥ 52px(`py-3.5`), 본문 15px(`text-content`), 보조 13px(`text-ui`), 12px는 태그만. 내부 용어(컬럼명·유형 키) 화면 노출 금지 — 라벨은 `TASK_TYPE_LABEL`·`TASK_STAGE_LABEL`.
- 연한 글씨 규칙(§4-1): 흐린 행 = **미사용 원고 작업만**. 내려짐 행은 일반 진하기. 값 없는 칸만 "—" 연하게.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 단일 파일 테스트: `node --import tsx --env-file=.env --test src/lib/<file>.test.ts`. 전체: `npm test`(≈4분). 린트: `npm run lint`(기준선 경고 24개 — 새 경고 0). 타입: `npx tsc --noEmit`.
- 화면 확인은 koo가 `npm run build && npx next start -p 3001` + `http://127.0.0.1:3001`로(라우트/컴포넌트 하네스 없음).

---

## File Structure

**신설**
| 파일 | 책임 |
|---|---|
| `migrations/038_campaign_task.sql` | `campaign_task` 표·인덱스, `tracked_post.task_id` (추가만) |
| `migrations/039_campaign_task_cutover.sql` | `draft` 3컬럼 drop (배포 후 적용) |
| `scripts/cutover-campaign-task.ts` | `cutoverDraftsToTasks` 실행 스크립트 |
| `src/lib/campaignTaskStore.ts` (+`.test.ts`) | `campaign_task` CRUD·대상 후보·원고 붙이기/떼기·게시 확인 표시·이관 |
| `src/lib/campaignTaskInput.ts` (+`.test.ts`) | 작업 API 입력 검증(순수) |
| `src/lib/checkPosted.ts` (+`.test.ts`) | 리포스터 판정 순수 함수 |
| `src/lib/checkPostedRun.ts` (+`.test.ts`) | 판정 실행(조회 → 저장) |
| `src/app/api/campaigns/[id]/tasks/route.ts` | POST 작업 생성 |
| `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts` | PATCH·DELETE |
| `src/app/api/campaigns/[id]/check-posted/route.ts` | POST 게시 확인 |
| `src/app/api/campaigns/tasks/targets/route.ts` | GET 대상 후보 |
| `src/app/api/campaigns/tasks/targeting/route.ts` | GET "이미 RT하기로 한 사람" |
| `src/app/campaigns/TaskTable.tsx` | 작업 표(ContentTable 대체) |
| `src/app/campaigns/PostedCell.tsx` | 단계 셀 + 게시 확인/내림 팝오버 |
| `src/app/campaigns/TaskAddModal.tsx` | [+ 작업 추가] |
| `src/app/campaigns/TargetPicker.tsx` | 대상 입력 한 칸 + 목록 + 빠른 선택 칩 |
| `src/app/campaigns/CostRows.tsx` | 사람별 금액 줄 |
| `src/app/campaigns/AttachDraftModal.tsx` | 있는 원고 고르기(하나) |
| `src/app/campaigns/CheckPostedModal.tsx` | 게시 확인 결과 |
| `src/app/campaigns/useCampaignTaskActions.ts` | 작업 낙관적 갱신·롤백 훅(useCampaignDraftActions 대체) |
| `src/components/DraftTaskField.tsx` | 원고 카드의 "작업" 칸(DraftCampaignField 대체) |

**수정**: `campaignCost.ts`(TaskCost) · `campaignJudgment.ts`(작업 파생) · `campaignTableView.ts` · `campaignStore.ts` · `campaignApi.ts` · `campaignView.ts` · `draftStore.ts` · `draftFieldPatch.ts`→삭제 · `api/drafts/{route,[id],manual}` · `generate.ts` · `trackingStore.ts` · `api/tracking/{route,[id]}` · `influencerStore.ts` · `components/DraftStatusChip.tsx`(작업 단계 색) · `CostPopover.tsx` · `DraftCard.tsx` · `DraftWriteModal.tsx` · `generate/page.tsx` · `campaigns/{CampaignDetail,CampaignHeader,CampaignList,WeekCalendar,InfluencerCostTable,LinkPostModal,SummaryCards}.tsx` · `influencers/CampaignSection.tsx` · `src/content/updates.ts`.

**삭제(Task 17)**: `ContentTable.tsx` · `AddDraftsModal.tsx` · `useCampaignDraftActions.ts` · `DraftCampaignField.tsx` · `draftCampaignOptions.ts(+test)` · `draftFieldPatch.ts(+test)` · `api/campaigns/[id]/drafts/route.ts` · `draftStore.campaign.test.ts`.

**Task 순서와 컴파일 원칙**: 새 함수/타입은 옛 것과 **병존**시키며 추가하고(Task 2~9), UI를 갈아탄 뒤(Task 10~16) 옛 것을 한 번에 지운다(Task 17). 각 Task 끝에 `npx tsc --noEmit`이 통과해야 한다.

---

### Task 1: 마이그레이션 038 (추가만) + 실 DB 적용

**Files:**
- Create: `migrations/038_campaign_task.sql`
- Create: `migrations/039_campaign_task_cutover.sql`

**Interfaces:**
- Produces: 표 `campaign_task`(컬럼은 스펙 §2-1 그대로), `tracked_post.task_id uuid null`.

- [ ] **Step 1: 038 작성**

```sql
-- 038: 캠페인 작업(campaign_task) — 캠페인의 단위가 원고 → 작업으로 (스펙 docs/superpowers/specs/2026-08-28-campaign-task-design.md §2)
-- 추가만 한다. draft.campaign_id/scheduled_on/cost 삭제는 039(배포 후) — 이 파일은 main의 옛 코드와 공존해야 한다.
-- scripts/apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 재실행 안전.

create table if not exists campaign_task (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaign(id) on delete cascade,   -- 소속 = 비용을 지는 캠페인
  influencer_handle text,                                                       -- null = 미배정(원고만 먼저 준비). 표기 보존, 비교는 lower()
  type              text not null check (type in ('post', 'quoteRt', 'rt', 'visit')),  -- = influencerPricing.PriceType
  draft_id          uuid references draft(id) on delete set null,             -- 붙은 원고(작업 1개 = 원고 최대 1개, 아래 unique)
  target_task_id    uuid references campaign_task(id) on delete set null,     -- RT/인용RT 대상이 우리 작업일 때(캠페인 제한 없음)
  target_tweet_url  text,                                                      -- 대상이 우리 작업 밖 게시물일 때(tweetPermalink 정규형)
  post_url          text,                                                      -- 인플이 올린 게시물(투고·인용RT·방문협찬의 증거)
  posted_at         date,                                                      -- 게시 확인일(서울). 한 번 찍히면 자동으로 되돌리지 않는다
  posted_source     text check (posted_source in ('auto', 'manual')),
  removed_at        date,                                                      -- 게시 내림일 — 정산 조건이 아니라 판단 참고 정보(§2-1)
  removed_reason    text not null default '',
  scheduled_on      date,                                                      -- 게시 예정일 — 밀림 판정 기준
  visit_on          date,                                                      -- 방문일(type='visit'만) — 밀림 판정에 쓰지 않는다
  cost              jsonb,                                                     -- {amount int ≥0, currency 'KRW'|'JPY'} — type 없음(작업 유형이 대신)
  note              text not null default '',
  created_by        uuid references member(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),                       -- 트리거 없음 — 스토어가 now() 수동 갱신
  constraint campaign_task_not_self check (target_task_id is null or target_task_id <> id)
);
create index if not exists idx_campaign_task_campaign_created on campaign_task (campaign_id, created_at);
create index if not exists idx_campaign_task_handle_lower on campaign_task (lower(influencer_handle));
create index if not exists idx_campaign_task_target on campaign_task (target_task_id);
-- 원고 1개는 작업 1개에만 — 원고의 캠페인 소속이 이 한 행에서 파생된다(값은 하나)
create unique index if not exists idx_campaign_task_draft_unique on campaign_task (draft_id) where draft_id is not null;

-- 게시물은 작업에 붙는다(§2-4). draft_id는 남긴다 — 트래킹·성과 화면이 원고 기준으로 읽는다.
alter table tracked_post add column if not exists task_id uuid references campaign_task(id) on delete set null;
create index if not exists idx_tracked_post_task on tracked_post (task_id);
```

- [ ] **Step 2: 039 작성 (적용은 배포 후 — 이 계획에서 실행하지 않는다)**

```sql
-- 039: 캠페인 작업 전환 마무리 — draft의 캠페인 3컬럼 drop (스펙 §2-2 ④)
-- 반드시 (1) 038 적용 → (2) scripts/cutover-campaign-task.ts 실행 → (3) 새 코드 배포 → 뒤에 적용한다.
-- 새 코드는 이 컬럼들을 읽지 않으므로 늦게 적용해도 무해하고, 일찍 적용하면 옛 코드가 500이 난다.
drop index if exists idx_draft_campaign;
alter table draft drop column if exists campaign_id;
alter table draft drop column if exists scheduled_on;
alter table draft drop column if exists cost;
```

- [ ] **Step 3: 038만 실 DB에 적용**

Run: `set -a; source .env; set +a; psql -v ON_ERROR_STOP=1 -f migrations/038_campaign_task.sql`
Expected: `CREATE TABLE` … `ALTER TABLE` `CREATE INDEX` — 오류 없음. (`apply-migrations.sh`는 039까지 돌리므로 **쓰지 않는다**.)

- [ ] **Step 4: 적용 확인**

Run: `set -a; source .env; set +a; psql -c "\d campaign_task" | head -30 && psql -c "select column_name from information_schema.columns where table_name='tracked_post' and column_name='task_id'"`
Expected: 컬럼 20개 표시, `task_id` 1행.

- [ ] **Step 5: Commit**

```bash
git add migrations/038_campaign_task.sql migrations/039_campaign_task_cutover.sql
git commit -m "feat(campaign-task): 038 campaign_task 표·tracked_post.task_id(추가만) + 039 draft 3컬럼 drop(배포 후 적용)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 순수 로직 — 작업 비용·단계·밀림·대상 상태·요약·정렬·인플 목록

**Files:**
- Modify: `src/lib/campaignCost.ts` (TaskCost·parseTaskCost 추가 — 옛 DraftCost는 유지)
- Modify: `src/lib/campaignJudgment.ts` (작업 파생 블록 추가 — 옛 콘텐츠 블록 유지, Task 17에서 제거)
- Test: `src/lib/campaignCost.test.ts` (append), `src/lib/campaignTaskJudgment.test.ts` (new)

**Interfaces:**
- Produces (campaignCost.ts): `interface TaskCost { amount: number; currency: Currency }`, `parseTaskCost(v: unknown): Parsed<TaskCost | null>`, `suggestTaskCost(pricing: Pricing | null | undefined, type: PriceType): TaskCost | null`.
- Produces (campaignJudgment.ts):
  - `type TaskType = PriceType`, `TASK_TYPES`, `TASK_TYPE_LABEL`, `isTaskType(v)`, `TARGETABLE_TYPES: readonly TaskType[] = ['post','quoteRt','visit']`, `TARGETING_TYPES: readonly TaskType[] = ['rt','quoteRt']`
  - `type TaskStage = 'planned' | 'visitPending' | 'visited' | DraftStatus | 'published' | 'removed'`, `TASK_STAGE_LABEL`
  - `interface TaskStageInput { type: TaskType; draftStatus: DraftStatus | null; postedAt: string | null; removedAt: string | null; scheduledOn: string | null; visitOn: string | null }`
  - `taskStage(t, today)`, `isTaskUnused(t)`, `isTaskOverdue(t, today)`, `isTaskPreparing(t, today)`, `matchesTaskFilter(t, f: StageFilter, today)`
  - `type TargetStatus = 'none' | 'pending' | 'ready'`, `interface TargetInput { targetTaskId: string | null; targetPostUrl: string | null; targetTweetUrl: string | null }`, `targetStatus(t)`, `targetUrlOf(t): string | null`
  - `interface TaskSummary { total; published; delivered; preparing; overdue; removed }`, `summarizeTasks(items, today)`
  - `interface TaskPerfInput extends TaskStageInput { perf: { views; likes } | null; linkClicks: number | null }`, `summarizeTaskPerf(items): PerfSummary`
  - `interface TypeSubtotal { type: TaskType; count: number; published: number; cost: MoneyByCurrency }`, `subtotalsByType(items: Array<TaskStageInput & { cost: TaskCost | null }>)`
  - `type TaskSortKey = 'created' | 'scheduled' | 'stage' | 'influencer'`, `TASK_SORT_LABEL`, `sortTasks(items, key, today)` (items need `influencerHandle`, `createdAt`)
  - `interface TaskCostInput extends TaskStageInput { influencerHandle: string | null; cost: TaskCost | null }`, `interface TaskInfluencerLine { handle: string | null; taskCount: number; countsByType: Partial<Record<TaskType, number>>; taskCost: MoneyByCurrency; extraCosts: ExtraCost[]; extraCost: MoneyByCurrency; subtotal: MoneyByCurrency; note: string; hasCostRow: boolean }`, `deriveTaskInfluencers(tasks, costRows: CostRowInput[])`, `taskCampaignTotal(lines)`
  - `countsByTypeLabel(counts): string` → `'투고 1 · RT 3'`
  - `isSettlementCandidate(t: { postedAt; cost; influencerHandle })`

- [ ] **Step 1: 실패 테스트 — campaignCost.test.ts 끝에 추가**

```ts
import { parseTaskCost, suggestTaskCost } from './campaignCost.ts';

test('parseTaskCost — type 없이 amount·currency만, null=지움, 문자열 금액 허용', () => {
  assert.deepEqual(parseTaskCost(null), { ok: true, value: null });
  assert.deepEqual(parseTaskCost({ amount: '3,000', currency: 'JPY' }), { ok: true, value: { amount: 3000, currency: 'JPY' } });
  assert.equal(parseTaskCost({ amount: -1, currency: 'KRW' }).ok, false);
  assert.equal(parseTaskCost({ amount: 1, currency: 'USD' }).ok, false);
  assert.equal(parseTaskCost({ type: 'rt', amount: 1, currency: 'KRW' }).ok, true); // 옛 모양이 와도 type은 무시
  assert.equal(parseTaskCost('x').ok, false);
});
test('suggestTaskCost — 단가[type]과 pricing 통화, 없으면 null', () => {
  assert.deepEqual(suggestTaskCost({ rt: 3000, currency: 'JPY' }, 'rt'), { amount: 3000, currency: 'JPY' });
  assert.deepEqual(suggestTaskCost({ post: 20000 }, 'post'), { amount: 20000, currency: 'KRW' });
  assert.equal(suggestTaskCost({ post: 20000 }, 'rt'), null);
  assert.equal(suggestTaskCost(null, 'rt'), null);
});
```

- [ ] **Step 2: 실패 테스트 — `src/lib/campaignTaskJudgment.test.ts` 신규**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskStage, isTaskUnused, isTaskOverdue, isTaskPreparing, matchesTaskFilter, targetStatus, targetUrlOf,
  summarizeTasks, summarizeTaskPerf, subtotalsByType, sortTasks, deriveTaskInfluencers, taskCampaignTotal,
  countsByTypeLabel, isSettlementCandidate, TASK_STAGE_LABEL, TARGETABLE_TYPES, TARGETING_TYPES,
  type TaskStageInput, type TaskCostInput,
} from './campaignJudgment.ts';

const T = '2026-08-28';
const base = (o: Partial<TaskStageInput> = {}): TaskStageInput => ({
  type: 'rt', draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null, ...o,
});

test('1) 단계 우선순위 — 내려짐 > 게시됨 > 원고 상태 > 방문 > 예정', () => {
  assert.equal(taskStage(base({ postedAt: '2026-08-27', removedAt: '2026-08-28' }), T), 'removed');
  assert.equal(taskStage(base({ postedAt: '2026-08-27', draftStatus: 'draft' }), T), 'published');
  assert.equal(taskStage(base({ type: 'post', draftStatus: 'review' }), T), 'review');
  assert.equal(taskStage(base({ type: 'visit', visitOn: '2026-09-10' }), T), 'visitPending');
  assert.equal(taskStage(base({ type: 'visit', visitOn: '2026-08-27' }), T), 'visited');
  assert.equal(taskStage(base({ type: 'visit' }), T), 'visitPending');       // 방문일 미정도 '방문 전'
  assert.equal(taskStage(base(), T), 'planned');
  assert.equal(TASK_STAGE_LABEL.planned, '예정');
  assert.equal(TASK_STAGE_LABEL.visited, '방문 완료');
  assert.equal(TASK_STAGE_LABEL.removed, '내려짐');
  assert.deepEqual(TARGETABLE_TYPES, ['post', 'quoteRt', 'visit']);
  assert.deepEqual(TARGETING_TYPES, ['rt', 'quoteRt']);
});

test('2) 미사용·밀림 — 방문일은 밀림에 쓰지 않는다, 게시됨·미사용은 밀림 아님', () => {
  assert.equal(isTaskUnused(base({ type: 'post', draftStatus: 'unused' })), true);
  assert.equal(isTaskUnused(base({ type: 'post', draftStatus: 'unused', postedAt: '2026-08-20' })), false); // 게시했으면 미사용이 아니다
  assert.equal(isTaskOverdue(base({ scheduledOn: '2026-08-27' }), T), true);
  assert.equal(isTaskOverdue(base({ scheduledOn: T }), T), false);
  assert.equal(isTaskOverdue(base({ scheduledOn: '2026-08-27', postedAt: '2026-08-27' }), T), false);
  assert.equal(isTaskOverdue(base({ type: 'post', draftStatus: 'unused', scheduledOn: '2026-08-01' }), T), false);
  assert.equal(isTaskOverdue(base({ type: 'visit', visitOn: '2026-08-01' }), T), false);           // 방문일만 지남 → 밀림 아님
});

test('3) 준비 중·필터 — 준비 중 = 원고 초안·검수·확정 + 예정·방문 전·방문 완료', () => {
  assert.equal(isTaskPreparing(base(), T), true);
  assert.equal(isTaskPreparing(base({ type: 'visit', visitOn: '2026-08-01' }), T), true);
  assert.equal(isTaskPreparing(base({ type: 'post', draftStatus: 'delivered' }), T), false);
  assert.equal(matchesTaskFilter(base({ type: 'post', draftStatus: 'delivered' }), 'delivered', T), true);
  assert.equal(matchesTaskFilter(base({ postedAt: '2026-08-20' }), 'published', T), true);
  assert.equal(matchesTaskFilter(base({ postedAt: '2026-08-20', removedAt: '2026-08-21' }), 'published', T), true); // 내려짐도 게시는 했다
  assert.equal(matchesTaskFilter(base({ type: 'post', draftStatus: 'unused' }), 'all', T), true);
  assert.equal(matchesTaskFilter(base({ type: 'post', draftStatus: 'unused' }), 'preparing', T), false);
});

test('4) 대상 상태 — 없음/게시 대기/확정, URL은 작업의 post_url 우선', () => {
  assert.equal(targetStatus({ targetTaskId: null, targetPostUrl: null, targetTweetUrl: null }), 'none');
  assert.equal(targetStatus({ targetTaskId: 't1', targetPostUrl: null, targetTweetUrl: null }), 'pending');
  assert.equal(targetStatus({ targetTaskId: 't1', targetPostUrl: 'https://x.com/a/status/1', targetTweetUrl: null }), 'ready');
  assert.equal(targetStatus({ targetTaskId: null, targetPostUrl: null, targetTweetUrl: 'https://x.com/i/status/2' }), 'ready');
  assert.equal(targetUrlOf({ targetTaskId: 't1', targetPostUrl: 'https://x.com/a/status/1', targetTweetUrl: 'https://x.com/i/status/2' }), 'https://x.com/a/status/1');
  assert.equal(targetUrlOf({ targetTaskId: 't1', targetPostUrl: null, targetTweetUrl: null }), null);
});

test('5) 요약 — N은 미사용 제외, 게시됨은 내려짐 포함, 유형별 소계는 있는 유형만·TASK_TYPES 순', () => {
  const items = [
    { ...base({ type: 'post', draftStatus: 'delivered', postedAt: '2026-08-20' }), cost: { amount: 20000, currency: 'JPY' as const } },
    { ...base({ type: 'quoteRt', draftStatus: 'review' }), cost: { amount: 8000, currency: 'JPY' as const } },
    { ...base({ type: 'quoteRt', draftStatus: 'unused' }), cost: { amount: 8000, currency: 'JPY' as const } },
    { ...base({ scheduledOn: '2026-08-26' }), cost: { amount: 3000, currency: 'JPY' as const } },
    { ...base({ postedAt: '2026-08-20', removedAt: '2026-08-25' }), cost: { amount: 3000, currency: 'JPY' as const } },
    { ...base({ type: 'visit' }), cost: { amount: 300000, currency: 'KRW' as const } },
  ];
  assert.deepEqual(summarizeTasks(items, T), { total: 5, published: 2, delivered: 0, preparing: 3, overdue: 1, removed: 1 });
  const sub = subtotalsByType(items);
  assert.deepEqual(sub.map((s) => s.type), ['rt', 'quoteRt', 'post', 'visit']);
  assert.deepEqual(sub.find((s) => s.type === 'rt'), { type: 'rt', count: 2, published: 2, cost: { JPY: 6000 } });
  assert.deepEqual(sub.find((s) => s.type === 'quoteRt'), { type: 'quoteRt', count: 1, published: 0, cost: { JPY: 8000 } }); // 미사용 제외
  assert.deepEqual(summarizeTaskPerf(items.map((t) => ({ ...t, perf: t.postedAt ? { views: 100, likes: 1 } : null, linkClicks: null }))),
    { publishedCount: 2, views: 200, likes: 2, linkClicks: null });
});

test('6) 정렬 — 기본 만든 순(밀림도 자리 유지), 미사용은 어느 키든 맨 아래', () => {
  const mk = (id: string, createdAt: string, o: Partial<TaskStageInput> = {}, handle: string | null = null) =>
    ({ id, ...base(o), createdAt, influencerHandle: handle });
  const items = [
    mk('c', '2026-08-03', { type: 'post', draftStatus: 'unused' }),
    mk('a', '2026-08-01', { scheduledOn: '2026-08-20' }, 'zed'),
    mk('b', '2026-08-02', { scheduledOn: '2026-08-10' }, 'amy'),
  ];
  assert.deepEqual(sortTasks(items, 'created', T).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(sortTasks(items, 'scheduled', T).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(sortTasks(items, 'influencer', T).map((x) => x.id), ['b', 'a', 'c']);
});

test('7) 인플 목록 — 작업 핸들 ∪ 비용 행, 유형별 건수, 미배정 묶음 맨 아래, 내려짐도 합계 포함', () => {
  const tasks: TaskCostInput[] = [
    { ...base({ type: 'post', draftStatus: 'delivered' }), influencerHandle: 'Mika', cost: { amount: 20000, currency: 'JPY' } },
    { ...base(), influencerHandle: 'rio', cost: { amount: 3000, currency: 'JPY' } },
    { ...base({ postedAt: '2026-08-20', removedAt: '2026-08-21' }), influencerHandle: 'RIO', cost: { amount: 3000, currency: 'JPY' } },
    { ...base({ type: 'quoteRt', draftStatus: 'unused' }), influencerHandle: 'rio', cost: { amount: 8000, currency: 'JPY' } },
    { ...base(), influencerHandle: null, cost: { amount: 1000, currency: 'KRW' } },
  ];
  const lines = deriveTaskInfluencers(tasks, [{ influencerHandle: 'hana', extraCosts: [{ label: '교통비', amount: 5000, currency: 'KRW' }], note: '' }]);
  assert.deepEqual(lines.map((l) => l.handle), ['rio', 'Mika', 'hana', null]);
  const rio = lines[0];
  assert.equal(rio.taskCount, 2);                                  // 미사용 제외
  assert.deepEqual(rio.countsByType, { rt: 2 });
  assert.deepEqual(rio.taskCost, { JPY: 6000 });                    // 내려짐 포함
  assert.equal(countsByTypeLabel(rio.countsByType), 'RT 2');
  assert.equal(countsByTypeLabel({ post: 1, rt: 3 }), 'RT 3 · 투고 1');   // TASK_TYPES 순(rt·quoteRt·post·visit)
  assert.equal(lines[2].hasCostRow, true);
  assert.equal(lines[2].taskCount, 0);
  assert.deepEqual(lines[3].subtotal, { KRW: 1000 });
  assert.deepEqual(taskCampaignTotal(lines), { JPY: 26000, KRW: 6000 });
});

test('8) 정산 후보 — 게시 확인 + 비용 + 인플. 내려짐은 조건이 아니다', () => {
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: '2026-08-21' }), true);
  assert.equal(isSettlementCandidate({ postedAt: null, cost: { amount: 1, currency: 'KRW' }, influencerHandle: 'a', removedAt: null }), false);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: null, influencerHandle: 'a', removedAt: null }), false);
  assert.equal(isSettlementCandidate({ postedAt: '2026-08-20', cost: { amount: 1, currency: 'KRW' }, influencerHandle: null, removedAt: null }), false);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --env-file=.env --test src/lib/campaignTaskJudgment.test.ts src/lib/campaignCost.test.ts`
Expected: FAIL — `does not provide an export named 'parseTaskCost'` 등.

- [ ] **Step 4: campaignCost.ts에 추가** (`parseDraftCost` 아래)

```ts
// 작업 비용(스펙 §2-1) — 유형은 작업 컬럼에 있으므로 금액·통화만. 옛 draft.cost 모양({type,...})이 와도 type은 무시한다(이관 SQL이 잘라낸다).
export interface TaskCost { amount: number; currency: Currency }
export function parseTaskCost(v: unknown): Parsed<TaskCost | null> {
  if (v === null) return { ok: true, value: null };
  if (!v || typeof v !== 'object') return { ok: false, message: '비용 형식이 올바르지 않아요' };
  const o = v as { amount?: unknown; currency?: unknown };
  const amount = parseAmount(o.amount);
  if (amount === null) return { ok: false, message: AMOUNT_MESSAGE };
  if (!isCurrency(o.currency)) return { ok: false, message: CURRENCY_MESSAGE };
  return { ok: true, value: { amount, currency: o.currency } };
}
// 작업 추가·인플 변경 시 제안 — 금액 = pricing[type], 통화 = pricing 레벨(normalizeCurrency). 없으면 null(빈 칸, §4-2).
export function suggestTaskCost(pricing: Pricing | null | undefined, type: PriceType): TaskCost | null {
  if (!pricing) return null;
  const amount = parseAmount(pricing[type]);
  if (amount === null) return null;
  return { amount, currency: normalizeCurrency(pricing) };
}
```

- [ ] **Step 5: campaignJudgment.ts에 작업 파생 블록 추가** (파일 끝에 append; import 줄에 `PRICE_TYPES, PRICE_TYPE_LABEL, type PriceType`를 `./influencerPricing.ts`에서, `type TaskCost`를 `./campaignCost.ts`에서 추가)

```ts
// ─────────────────────────── 작업(campaign_task) 파생 — 스펙 2026-08-28 §2-5 ───────────────────────────
// 작업이 캠페인의 단위다. 아래 함수들은 서버(campaignStore)·클라(TaskTable·달력·요약)가 같이 쓴다.
export type TaskType = PriceType;
export const TASK_TYPES: readonly TaskType[] = PRICE_TYPES;
export const TASK_TYPE_LABEL: Record<TaskType, string> = PRICE_TYPE_LABEL;
export function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v);
}
// 게시물이 생기는 유형만 RT/인용RT의 대상이 될 수 있다. RT는 별도 게시물이 없다.
export const TARGETABLE_TYPES: readonly TaskType[] = ['post', 'quoteRt', 'visit'];
export const TARGETING_TYPES: readonly TaskType[] = ['rt', 'quoteRt'];

export type TaskStage = 'planned' | 'visitPending' | 'visited' | DraftStatus | 'published' | 'removed';
export const TASK_STAGE_LABEL: Record<TaskStage, string> = {
  planned: '예정', visitPending: '방문 전', visited: '방문 완료', ...STATUS_LABEL, published: '게시됨', removed: '내려짐',
};
export interface TaskStageInput {
  type: TaskType; draftStatus: DraftStatus | null;
  postedAt: string | null; removedAt: string | null;
  scheduledOn: string | null; visitOn: string | null;
}
// 우선순위: 내려짐 > 게시됨 > 원고 상태 > 방문(완료/전) > 예정. 게시 확인은 원고 status와 무관하게 이긴다(status 값은 바꾸지 않는다).
export function taskStage(t: TaskStageInput, today: string): TaskStage {
  if (t.postedAt && t.removedAt) return 'removed';
  if (t.postedAt) return 'published';
  if (t.draftStatus) return t.draftStatus;
  if (t.type === 'visit') return t.visitOn !== null && t.visitOn < today ? 'visited' : 'visitPending';
  return 'planned';
}
// 미사용 = 붙은 원고가 미사용이고 아직 게시하지 않은 작업 — 요약 N·합계·인플 건수에서 빠진다(흐린 행의 유일한 조건, §4-1)
export function isTaskUnused(t: TaskStageInput): boolean {
  return t.draftStatus === 'unused' && t.postedAt === null;
}
// 밀림 = 게시 예정일 < 오늘 · 게시 안 됨 · 미사용 아님. 방문일은 쓰지 않는다(방문→게시 사이가 긴 것이 정상).
export function isTaskOverdue(t: TaskStageInput, today: string): boolean {
  return t.scheduledOn !== null && t.scheduledOn < today && t.postedAt === null && !isTaskUnused(t);
}
const PREPARING_STAGES: readonly TaskStage[] = ['draft', 'review', 'approved', 'planned', 'visitPending', 'visited'];
export function isTaskPreparing(t: TaskStageInput, today: string): boolean {
  return PREPARING_STAGES.includes(taskStage(t, today));
}
export function matchesTaskFilter(t: TaskStageInput, f: StageFilter, today: string): boolean {
  if (f === 'all') return true;
  if (f === 'preparing') return isTaskPreparing(t, today);
  if (f === 'published') return t.postedAt !== null && !isTaskUnused(t);   // 내려짐도 게시는 했다 — 게시 n과 같은 모집단
  return taskStage(t, today) === 'delivered';
}

// 대상(RT/인용RT) — 가리킨 작업의 post_url이 있거나 링크가 직접 있으면 확정.
export type TargetStatus = 'none' | 'pending' | 'ready';
export interface TargetInput { targetTaskId: string | null; targetPostUrl: string | null; targetTweetUrl: string | null }
export function targetUrlOf(t: TargetInput): string | null {
  if (t.targetTaskId) return t.targetPostUrl;
  return t.targetTweetUrl;
}
export function targetStatus(t: TargetInput): TargetStatus {
  if (t.targetTaskId) return t.targetPostUrl ? 'ready' : 'pending';
  return t.targetTweetUrl ? 'ready' : 'none';
}

export interface TaskSummary { total: number; published: number; delivered: number; preparing: number; overdue: number; removed: number }
export function summarizeTasks(items: TaskStageInput[], today: string): TaskSummary {
  const s: TaskSummary = { total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0, removed: 0 };
  for (const t of items) {
    if (isTaskUnused(t)) continue;
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
export interface TaskPerfInput extends TaskStageInput { perf: { views: number | null; likes: number | null } | null; linkClicks: number | null }
export function summarizeTaskPerf(items: TaskPerfInput[]): PerfSummary {
  const out: PerfSummary = { publishedCount: 0, views: null, likes: null, linkClicks: null };
  const add = (k: 'views' | 'likes' | 'linkClicks', v: number | null) => { if (v !== null) out[k] = (out[k] ?? 0) + v; };
  for (const it of items) {
    if (isTaskUnused(it)) continue;
    if (it.postedAt) out.publishedCount += 1;
    add('views', it.perf?.views ?? null);
    add('likes', it.perf?.likes ?? null);
    add('linkClicks', it.linkClicks);
  }
  return out;
}
// 표 하단 한 줄·정산 검토용 — 있는 유형만, TASK_TYPES 순. 미사용 제외, 내려짐 포함(합계와 같은 모집단).
export interface TypeSubtotal { type: TaskType; count: number; published: number; cost: MoneyByCurrency }
export function subtotalsByType(items: Array<TaskStageInput & { cost: TaskCost | null }>): TypeSubtotal[] {
  const out: TypeSubtotal[] = [];
  for (const type of TASK_TYPES) {
    const mine = items.filter((t) => t.type === type && !isTaskUnused(t));
    if (mine.length === 0) continue;
    out.push({
      type, count: mine.length, published: mine.filter((t) => t.postedAt !== null).length,
      cost: sumMoney(mine.flatMap((t) => (t.cost ? [t.cost] : []))),
    });
  }
  return out;
}

export type TaskSortKey = 'created' | 'scheduled' | 'stage' | 'influencer';
export const TASK_SORT_LABEL: Record<TaskSortKey, string> = { created: '만든 순', scheduled: '예정일', stage: '단계', influencer: '인플루언서' };
export interface TaskSortInput extends TaskStageInput { influencerHandle: string | null; createdAt: string }
const TASK_STAGE_ORDER: Record<TaskStage, number> = {
  planned: 0, visitPending: 0, visited: 1, draft: 0, review: 1, approved: 2, delivered: 3, published: 4, removed: 5, unused: 6,
};
// 기본은 만든 순(koo 08-28) — 밀림도 자리를 바꾸지 않고 표시만 강조한다. 미사용은 어느 키든 맨 아래(흐린 행이 중간에 끼지 않게).
export function sortTasks<T extends TaskSortInput>(items: T[], key: TaskSortKey, today: string): T[] {
  const byCreated = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  const bySchedule = (a: T, b: T): number => {
    if (a.scheduledOn === b.scheduledOn) return byCreated(a, b);
    if (a.scheduledOn === null) return 1;
    if (b.scheduledOn === null) return -1;
    return a.scheduledOn.localeCompare(b.scheduledOn);
  };
  return [...items].sort((a, b) => {
    const u = Number(isTaskUnused(a)) - Number(isTaskUnused(b));
    if (u !== 0) return u;
    if (key === 'created') return byCreated(a, b);
    if (key === 'scheduled') return bySchedule(a, b);
    if (key === 'stage') return (TASK_STAGE_ORDER[taskStage(a, today)] - TASK_STAGE_ORDER[taskStage(b, today)]) || byCreated(a, b);
    const ha = (a.influencerHandle ?? '').toLowerCase();
    const hb = (b.influencerHandle ?? '').toLowerCase();
    if (ha === hb) return byCreated(a, b);
    if (!ha) return 1;
    if (!hb) return -1;
    return ha.localeCompare(hb);
  });
}

export interface TaskCostInput extends TaskStageInput { influencerHandle: string | null; cost: TaskCost | null }
export interface TaskInfluencerLine {
  handle: string | null;                               // null = 미배정 작업 묶음(작업이 있을 때만 한 줄)
  taskCount: number;                                   // 미사용 제외
  countsByType: Partial<Record<TaskType, number>>;    // '투고 1 · RT 3'의 재료
  taskCost: MoneyByCurrency;
  extraCosts: ExtraCost[];
  extraCost: MoneyByCurrency;
  subtotal: MoneyByCurrency;
  note: string;
  hasCostRow: boolean;                                 // 비용 행만 있고 작업 0 → "배정 작업 없음"
}
export function deriveTaskInfluencers(tasks: TaskCostInput[], costRows: CostRowInput[]): TaskInfluencerLine[] {
  type Bucket = { handle: string | null; tasks: TaskCostInput[]; row: CostRowInput | null };
  const byKey = new Map<string, Bucket>();
  const keyOf = (h: string | null) => (h ? h.toLowerCase() : '');
  for (const t of tasks) {
    if (isTaskUnused(t)) continue;
    const k = keyOf(t.influencerHandle);
    const b = byKey.get(k) ?? { handle: t.influencerHandle, tasks: [], row: null };
    b.tasks.push(t);
    byKey.set(k, b);
  }
  for (const r of costRows) {
    const k = keyOf(r.influencerHandle);
    const b = byKey.get(k) ?? { handle: r.influencerHandle, tasks: [], row: null };
    b.row = r;
    byKey.set(k, b);
  }
  const lines: TaskInfluencerLine[] = [];
  for (const [k, b] of byKey) {
    if (k === '' && b.tasks.length === 0) continue;
    const countsByType: Partial<Record<TaskType, number>> = {};
    for (const t of b.tasks) countsByType[t.type] = (countsByType[t.type] ?? 0) + 1;
    const taskCost = sumMoney(b.tasks.flatMap((t) => (t.cost ? [t.cost] : [])));
    const extraCosts = b.row?.extraCosts ?? [];
    const extraCost = sumMoney(extraCosts);
    lines.push({
      handle: b.handle, taskCount: b.tasks.length, countsByType, taskCost, extraCosts, extraCost,
      subtotal: mergeMoney(taskCost, extraCost), note: b.row?.note ?? '', hasCostRow: b.row !== null,
    });
  }
  return lines.sort((a, b) => {
    if (a.handle === null) return 1;
    if (b.handle === null) return -1;
    return (b.taskCount - a.taskCount) || a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());
  });
}
export function taskCampaignTotal(lines: TaskInfluencerLine[]): MoneyByCurrency {
  return mergeMoney(...lines.map((l) => l.subtotal));
}
/** '투고 1 · RT 3' — TASK_TYPES 순, 0은 생략. 전부 0이면 '' */
export function countsByTypeLabel(counts: Partial<Record<TaskType, number>>): string {
  return TASK_TYPES.filter((t) => (counts[t] ?? 0) > 0).map((t) => `${TASK_TYPE_LABEL[t]} ${counts[t]}`).join(' · ');
}
// 정산 후보(§7) — 게시 확인 + 비용 + 인플. 내려짐(removed_at)은 판단 참고 정보라 조건에 넣지 않는다(koo 08-27).
export function isSettlementCandidate(t: { postedAt: string | null; cost: TaskCost | null; influencerHandle: string | null; removedAt: string | null }): boolean {
  return t.postedAt !== null && t.cost !== null && t.influencerHandle !== null;
}
```

- [ ] **Step 6: 통과 확인**

Run: `node --import tsx --env-file=.env --test src/lib/campaignTaskJudgment.test.ts src/lib/campaignCost.test.ts && npx tsc --noEmit`
Expected: 모두 PASS, tsc 오류 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/campaignCost.ts src/lib/campaignCost.test.ts src/lib/campaignJudgment.ts src/lib/campaignTaskJudgment.test.ts
git commit -m "feat(campaign-task): 작업 파생 순수 함수 — 단계·밀림·대상 상태·요약·유형별 소계·정렬·인플 목록·정산 후보 + TaskCost

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `campaignTaskStore.ts` — 작업 CRUD·대상 후보·원고 붙이기·게시 확인 표시·이관

**Files:**
- Create: `src/lib/campaignTaskStore.ts`
- Test: `src/lib/campaignTaskStore.test.ts`

**Interfaces:**
- Consumes: Task 2의 타입(`TaskType`, `TaskCost`, `parseTaskCost`).
- Produces:
```ts
export interface TaskRow {
  id: string; campaignId: string; influencerHandle: string | null; type: TaskType;
  draftId: string | null; targetTaskId: string | null; targetTweetUrl: string | null;
  postUrl: string | null; postedAt: string | null; postedSource: 'auto' | 'manual' | null;
  removedAt: string | null; removedReason: string;
  scheduledOn: string | null; visitOn: string | null; cost: TaskCost | null; note: string;
  createdAt: string; updatedAt: string;
  draftStatus: DraftStatus | null; draftLabel: string | null;              // 붙은 원고 요약
  target: { taskId: string; type: TaskType; influencerHandle: string | null; campaignId: string; campaignName: string; postUrl: string | null } | null;
}
export interface TaskCreateInput { type: TaskType; targetTaskId: string | null; targetTweetUrl: string | null; draftId: string | null; scheduledOn: string | null; visitOn: string | null; note: string; createdBy: string | null; items: Array<{ handle: string | null; cost: TaskCost | null }> }  // items 비면 미배정 1행
export interface TaskPatch { influencerHandle?: string | null; targetTaskId?: string | null; targetTweetUrl?: string | null; postUrl?: string | null; postedAt?: string; postedSource?: 'auto' | 'manual'; removedAt?: string | null; removedReason?: string; scheduledOn?: string | null; visitOn?: string | null; cost?: TaskCost | null; note?: string }
export interface TargetCandidate { taskId: string; type: TaskType; influencerHandle: string | null; campaignId: string; campaignName: string; clientId: string | null; postUrl: string | null; postedAt: string | null; draftLabel: string | null; createdAt: string }
export class TaskAttachError extends Error { code: 'no-task' | 'task-has-draft' | 'draft-attached' }
export async function createTasks(sql, campaignId: string, input: TaskCreateInput): Promise<TaskRow[]>
export async function listTasksByCampaign(sql, campaignId: string): Promise<TaskRow[]>      // created_at asc
export async function getTask(sql, id: string): Promise<TaskRow | null>
export async function findTaskByDraft(sql, draftId: string): Promise<TaskRow | null>
export async function updateTask(sql, id: string, patch: TaskPatch): Promise<boolean>
export async function deleteTask(sql, id: string): Promise<boolean>
export async function attachDraft(sql, taskId: string, draftId: string): Promise<void>       // throws TaskAttachError
export async function detachDraft(sql, draftId: string): Promise<boolean>
export async function listTargetCandidates(sql, opts: { clientId?: string | null; q?: string; limit?: number }): Promise<TargetCandidate[]>
export async function listTargetingHandles(sql, target: { taskId: string } | { tweetUrl: string }): Promise<string[]>
export async function markPosted(sql, taskIds: string[], postedAt: string, source: 'auto' | 'manual'): Promise<number>  // posted_at is null인 행만
export async function countTasksForCampaignDelete(sql, campaignId: string): Promise<{ taskCount: number; detachedTargets: number }>
export async function cutoverDraftsToTasks(sql): Promise<{ tasks: number; trackedPosts: number }>
```

- [ ] **Step 1: 실패 테스트 작성** `src/lib/campaignTaskStore.test.ts`

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { insertDraft, updateDraft, getDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  createTasks, listTasksByCampaign, getTask, findTaskByDraft, updateTask, deleteTask, attachDraft, detachDraft,
  listTargetCandidates, listTargetingHandles, markPosted, countTasksForCampaignDelete, cutoverDraftsToTasks, TaskAttachError,
} from './campaignTaskStore.ts';

const sql = getSql();
const P = 'ttsk' + process.pid;
const content: DraftContent = { posts: [{ text: '작업 스토어', media: [] }] };

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

const mkCampaign = async (clientId: string, clientName: string, suffix: string) => createCampaign(sql, {
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
  startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null,
});
const mkDraft = (clientId: string | null, clientName: string | null, extra: Record<string, unknown> = {}) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, ...extra,
  });
const baseInput = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 여러 명 한 번에 → 사람 수만큼, 빈 목록 → 미배정 1행, 날짜 왕복·기본값', async () => {
  const c = await createClient(sql, P + '클라1');
  const camp = await mkCampaign(c.id, c.name, 'a');
  const rows = await createTasks(sql, camp.id, {
    ...baseInput, type: 'rt', scheduledOn: '2026-09-03', note: '메모',
    items: [{ handle: 'Rio', cost: { amount: 3000, currency: 'JPY' } }, { handle: 'sora', cost: null }],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.influencerHandle), ['Rio', 'sora']);
  assert.equal(rows[0].scheduledOn, '2026-09-03');
  assert.deepEqual(rows[0].cost, { amount: 3000, currency: 'JPY' });
  assert.equal(rows[1].cost, null);
  assert.equal(rows[0].postedAt, null);
  assert.equal(rows[0].removedReason, '');
  assert.equal(rows[0].draftStatus, null);
  const solo = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [] });
  assert.equal(solo.length, 1);
  assert.equal(solo[0].influencerHandle, null);
  const listed = await listTasksByCampaign(sql, camp.id);
  assert.deepEqual(listed.map((r) => r.id), [...rows.map((r) => r.id), solo[0].id]);   // created_at asc
  assert.equal(await getTask(sql, 'not-a-uuid'), null);
});

test('2) 원고 붙이기 — 요약 파생, 원고 1개 = 작업 1개(unique), 떼기, 인플 동기화(작업 → 원고)', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await mkCampaign(c.id, c.name, 'b');
  const draftId = await mkDraft(c.id, c.name);
  await updateDraft(sql, draftId, { status: 'review', title: P + '제목' });
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: 'mika', cost: null }] });
  await attachDraft(sql, t.id, draftId);
  const got = await getTask(sql, t.id);
  assert.equal(got!.draftId, draftId);
  assert.equal(got!.draftStatus, 'review');
  assert.equal(got!.draftLabel, P + '제목');
  assert.equal((await getDraft(sql, draftId))!.influencerHandle, 'mika');   // 작업 인플이 원고에 채워진다
  assert.equal((await findTaskByDraft(sql, draftId))!.id, t.id);
  const [t2] = await createTasks(sql, camp.id, { ...baseInput, type: 'quoteRt', items: [] });
  await assert.rejects(attachDraft(sql, t2.id, draftId), (e: unknown) => e instanceof TaskAttachError && e.code === 'draft-attached');
  const other = await mkDraft(c.id, c.name);
  await assert.rejects(attachDraft(sql, t.id, other), (e: unknown) => e instanceof TaskAttachError && e.code === 'task-has-draft');
  await assert.rejects(attachDraft(sql, '00000000-0000-0000-0000-000000000000', other), (e: unknown) => e instanceof TaskAttachError && e.code === 'no-task');
  assert.equal(await detachDraft(sql, draftId), true);
  assert.equal((await getTask(sql, t.id))!.draftId, null);
  // 원고 인플이 있고 작업이 비어 있으면 붙일 때 작업 쪽으로 채운다
  await updateDraft(sql, other, { influencerHandle: 'hana' });
  await attachDraft(sql, t2.id, other);
  assert.equal((await getTask(sql, t2.id))!.influencerHandle, 'hana');
  // createTasks에 draftId를 주면 생성과 동시에 붙는다
  const third = await mkDraft(c.id, c.name);
  const [t3] = await createTasks(sql, camp.id, { ...baseInput, type: 'visit', draftId: third, items: [{ handle: 'kei', cost: null }] });
  assert.equal(t3.draftId, third);
});

test('3) 대상 — 참조는 캠페인 경계 없음, 대상 요약(post_url·캠페인명), 삭제 시 set null, 후보 목록·이미 RT하기로 한 사람', async () => {
  const c = await createClient(sql, P + '클라3');
  const camp1 = await mkCampaign(c.id, c.name, 'c1');
  const camp2 = await mkCampaign(c.id, c.name, 'c2');
  const [post] = await createTasks(sql, camp1.id, { ...baseInput, type: 'post', items: [{ handle: 'mika', cost: null }] });
  const [rt] = await createTasks(sql, camp2.id, { ...baseInput, type: 'rt', targetTaskId: post.id, items: [{ handle: 'rio', cost: null }] });
  assert.equal(rt.target!.taskId, post.id);
  assert.equal(rt.target!.campaignName, P + 'c1');
  assert.equal(rt.target!.postUrl, null);
  await updateTask(sql, post.id, { postUrl: 'https://x.com/mika/status/1' });
  assert.equal((await getTask(sql, rt.id))!.target!.postUrl, 'https://x.com/mika/status/1');
  const [rtUrl] = await createTasks(sql, camp2.id, { ...baseInput, type: 'rt', targetTweetUrl: 'https://x.com/i/status/99', items: [{ handle: 'sora', cost: null }] });
  assert.equal(rtUrl.target, null);
  assert.equal(rtUrl.targetTweetUrl, 'https://x.com/i/status/99');

  const cands = await listTargetCandidates(sql, { clientId: c.id });
  assert.ok(cands.some((x) => x.taskId === post.id && x.campaignName === P + 'c1' && x.postUrl === 'https://x.com/mika/status/1'));
  assert.ok(!cands.some((x) => x.taskId === rt.id));                         // RT는 대상이 될 수 없다
  assert.ok((await listTargetCandidates(sql, { clientId: c.id, q: 'mika' })).some((x) => x.taskId === post.id));
  assert.equal((await listTargetCandidates(sql, { clientId: c.id, q: 'zzzz-없음' })).length, 0);
  assert.deepEqual(await listTargetingHandles(sql, { taskId: post.id }), ['rio']);
  assert.deepEqual(await listTargetingHandles(sql, { tweetUrl: 'https://x.com/i/status/99' }), ['sora']);

  assert.deepEqual(await countTasksForCampaignDelete(sql, camp1.id), { taskCount: 1, detachedTargets: 1 });
  assert.equal(await deleteTask(sql, post.id), true);
  assert.equal((await getTask(sql, rt.id))!.targetTaskId, null);            // 대상 미정으로
  assert.equal(await deleteTask(sql, post.id), false);
});

test('4) 패치 3값 규칙(undefined=유지·null=지움·값=설정), 게시 확인·내림, markPosted는 비어 있을 때만', async () => {
  const c = await createClient(sql, P + '클라4');
  const camp = await mkCampaign(c.id, c.name, 'd');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'visit', scheduledOn: '2026-09-05', items: [{ handle: 'hana', cost: { amount: 1, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { visitOn: '2026-09-01', note: '방문' });
  let g = (await getTask(sql, t.id))!;
  assert.equal(g.visitOn, '2026-09-01'); assert.equal(g.scheduledOn, '2026-09-05'); assert.equal(g.note, '방문');
  await updateTask(sql, t.id, { scheduledOn: null, cost: null, influencerHandle: null });
  g = (await getTask(sql, t.id))!;
  assert.equal(g.scheduledOn, null); assert.equal(g.cost, null); assert.equal(g.influencerHandle, null); assert.equal(g.visitOn, '2026-09-01');
  await updateTask(sql, t.id, { postedAt: '2026-09-08', postedSource: 'manual', postUrl: 'https://x.com/hana/status/5' });
  g = (await getTask(sql, t.id))!;
  assert.equal(g.postedAt, '2026-09-08'); assert.equal(g.postedSource, 'manual');
  await updateTask(sql, t.id, { removedAt: '2026-09-09', removedReason: '본인 요청' });
  g = (await getTask(sql, t.id))!;
  assert.equal(g.removedAt, '2026-09-09'); assert.equal(g.removedReason, '본인 요청');
  await updateTask(sql, t.id, { removedAt: null, removedReason: '' });
  assert.equal((await getTask(sql, t.id))!.removedAt, null);
  assert.equal(await markPosted(sql, [t.id], '2026-09-10', 'auto'), 0);      // 이미 확인된 건 덮지 않는다
  const [t2] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: 'rio', cost: null }] });
  assert.equal(await markPosted(sql, [t2.id, t.id], '2026-09-10', 'auto'), 1);
  assert.equal((await getTask(sql, t2.id))!.postedSource, 'auto');
  assert.equal(await updateTask(sql, '00000000-0000-0000-0000-000000000000', { note: 'x' }), false);
});

test('5) 이관 — draft 3컬럼 → 작업 1행(유형=비용 유형), tracked_post 연결 이전, 재실행 안전', async () => {
  // 038은 컬럼을 남겨두므로(039 전) 여기서 옛 컬럼에 직접 값을 넣어 이관을 검증한다
  const c = await createClient(sql, P + '클라5');
  const camp = await mkCampaign(c.id, c.name, 'e');
  const draftId = await mkDraft(c.id, c.name);
  await sql`update draft set campaign_id = ${camp.id}, scheduled_on = '2026-09-09'::date, influencer_handle = 'minchan',
              cost = '{"type":"quoteRt","amount":30000,"currency":"KRW"}'::jsonb where id = ${draftId}`;
  const tp = await sql<Array<{ id: string }>>`
    insert into tracked_post (tweet_id, author_handle, text, posted_at, draft_id)
    values (${P + 'tw1'}, 'minchan', '', '2026-09-09T03:00:00Z'::timestamptz, ${draftId}) returning id`;
  const r1 = await cutoverDraftsToTasks(sql);
  assert.ok(r1.tasks >= 1);
  const t = (await findTaskByDraft(sql, draftId))!;
  assert.equal(t.type, 'quoteRt'); assert.equal(t.campaignId, camp.id); assert.equal(t.influencerHandle, 'minchan');
  assert.equal(t.scheduledOn, '2026-09-09'); assert.deepEqual(t.cost, { amount: 30000, currency: 'KRW' });
  assert.equal(t.postedAt, '2026-09-09'); assert.equal(t.postedSource, 'manual');
  assert.equal(t.postUrl, 'https://x.com/minchan/status/' + P + 'tw1');
  assert.equal((await sql`select task_id from tracked_post where id = ${tp[0].id}`)[0].task_id, t.id);
  const r2 = await cutoverDraftsToTasks(sql);                                // 재실행 → 새 작업 0
  assert.equal((await listTasksByCampaign(sql, camp.id)).length, 1);
  assert.equal(r2.tasks, 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file=.env --test src/lib/campaignTaskStore.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** `src/lib/campaignTaskStore.ts`

```ts
import type postgres from 'postgres';
import type { DraftStatus } from './draftStatus.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';
import { TARGETABLE_TYPES, type TaskType } from './campaignJudgment.ts';
import { tweetPermalink } from './tweetLink.ts';
import { isUuidLike } from './uuid.ts';

// 작업(campaign_task) 저장소 — 스펙 2026-08-28 §2-1. 판정(단계·밀림·요약)은 campaignJudgment가, 여기는 행의 읽기·쓰기만.
// 핸들은 표기 보존·비교는 lower(). 날짜는 date 컬럼 + to_char 왕복(시간대 시프트 방지, DateOnly 관례).
export interface TaskRow {
  id: string; campaignId: string; influencerHandle: string | null; type: TaskType;
  draftId: string | null; targetTaskId: string | null; targetTweetUrl: string | null;
  postUrl: string | null; postedAt: string | null; postedSource: 'auto' | 'manual' | null;
  removedAt: string | null; removedReason: string;
  scheduledOn: string | null; visitOn: string | null; cost: TaskCost | null; note: string;
  createdAt: string; updatedAt: string;
  draftStatus: DraftStatus | null; draftLabel: string | null;   // 붙은 원고 요약 — 표의 '원고' 열
  // 대상 작업 요약(§4-1 'RT/인용RT 대상' 열) — 다른 캠페인이면 campaignName으로 구분해 보인다
  target: { taskId: string; type: TaskType; influencerHandle: string | null; campaignId: string; campaignName: string; postUrl: string | null } | null;
}
export interface TaskCreateInput {
  type: TaskType; targetTaskId: string | null; targetTweetUrl: string | null; draftId: string | null;
  scheduledOn: string | null; visitOn: string | null; note: string; createdBy: string | null;
  items: Array<{ handle: string | null; cost: TaskCost | null }>;   // 비면 미배정 1행
}
export interface TaskPatch {
  influencerHandle?: string | null; targetTaskId?: string | null; targetTweetUrl?: string | null;
  postUrl?: string | null; postedAt?: string; postedSource?: 'auto' | 'manual';
  removedAt?: string | null; removedReason?: string;
  scheduledOn?: string | null; visitOn?: string | null; cost?: TaskCost | null; note?: string;
}
export interface TargetCandidate {
  taskId: string; type: TaskType; influencerHandle: string | null; campaignId: string; campaignName: string;
  clientId: string | null; postUrl: string | null; postedAt: string | null; draftLabel: string | null; createdAt: string;
}
export class TaskAttachError extends Error {
  constructor(public code: 'no-task' | 'task-has-draft' | 'draft-attached') {
    super(code);
    this.name = 'TaskAttachError';
  }
}

type Row = {
  id: string; campaign_id: string; influencer_handle: string | null; type: TaskType;
  draft_id: string | null; target_task_id: string | null; target_tweet_url: string | null;
  post_url: string | null; posted_at: string | null; posted_source: 'auto' | 'manual' | null;
  removed_at: string | null; removed_reason: string;
  scheduled_on: string | null; visit_on: string | null; cost: unknown; note: string;
  created_at: Date; updated_at: Date;
  draft_status: DraftStatus | null; draft_title: string | null; draft_ko_title: string | null; draft_first_line: string | null;
  tg_id: string | null; tg_type: TaskType | null; tg_handle: string | null; tg_campaign_id: string | null; tg_campaign_name: string | null; tg_post_url: string | null;
};

function costOf(v: unknown): TaskCost | null {
  const p = parseTaskCost(v ?? null);
  return p.ok ? p.value : null;   // jsonb 모양은 보증되지 않는다 — 검증 통과분만(draftStore.costOf 태도)
}
// 원고 표시 라벨 — draftViews.draftLabel의 SQL판(title → ko_title → 첫 줄). 한 줄로 자른다.
function labelOf(r: Row): string | null {
  const first = (r.draft_first_line ?? '').split('\n')[0].trim();
  return r.draft_title?.trim() || r.draft_ko_title || (first ? (first.length > 60 ? first.slice(0, 60) + '…' : first) : null);
}
const toRow = (r: Row): TaskRow => ({
  id: r.id, campaignId: r.campaign_id, influencerHandle: r.influencer_handle, type: r.type,
  draftId: r.draft_id, targetTaskId: r.target_task_id, targetTweetUrl: r.target_tweet_url,
  postUrl: r.post_url, postedAt: r.posted_at, postedSource: r.posted_source,
  removedAt: r.removed_at, removedReason: r.removed_reason,
  scheduledOn: r.scheduled_on, visitOn: r.visit_on, cost: costOf(r.cost), note: r.note,
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  draftStatus: r.draft_id ? r.draft_status : null, draftLabel: r.draft_id ? labelOf(r) : null,
  target: r.tg_id ? {
    taskId: r.tg_id, type: r.tg_type as TaskType, influencerHandle: r.tg_handle,
    campaignId: r.tg_campaign_id as string, campaignName: r.tg_campaign_name as string, postUrl: r.tg_post_url,
  } : null,
});

// 목록·단건이 같은 정의(드리프트 방지). 원고 요약과 대상 요약을 left join 두 번으로 한 번에 받는다.
const SELECT = (sql: postgres.Sql) => sql`
  select t.id, t.campaign_id, t.influencer_handle, t.type, t.draft_id, t.target_task_id, t.target_tweet_url,
         t.post_url, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, t.posted_source,
         to_char(t.removed_at, 'YYYY-MM-DD') as removed_at, t.removed_reason,
         to_char(t.scheduled_on, 'YYYY-MM-DD') as scheduled_on, to_char(t.visit_on, 'YYYY-MM-DD') as visit_on,
         t.cost, t.note, t.created_at, t.updated_at,
         d.status as draft_status, d.title as draft_title, d.ko_title as draft_ko_title,
         coalesce(d.edited, d.content)->'posts'->0->>'text' as draft_first_line,
         tg.id as tg_id, tg.type as tg_type, tg.influencer_handle as tg_handle, tg.campaign_id as tg_campaign_id,
         tgc.name as tg_campaign_name, tg.post_url as tg_post_url
    from campaign_task t
    left join draft d on d.id = t.draft_id
    left join campaign_task tg on tg.id = t.target_task_id
    left join campaign tgc on tgc.id = tg.campaign_id`;

export async function getTask(sql: postgres.Sql, id: string): Promise<TaskRow | null> {
  if (!isUuidLike(id)) return null;   // 22P02 방지 — 라우트가 404로
  const rows = await sql<Row[]>`${SELECT(sql)} where t.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}
export async function listTasksByCampaign(sql: postgres.Sql, campaignId: string): Promise<TaskRow[]> {
  const rows = await sql<Row[]>`${SELECT(sql)} where t.campaign_id = ${campaignId} order by t.created_at asc, t.id asc`;
  return rows.map(toRow);
}
export async function findTaskByDraft(sql: postgres.Sql, draftId: string): Promise<TaskRow | null> {
  if (!isUuidLike(draftId)) return null;
  const rows = await sql<Row[]>`${SELECT(sql)} where t.draft_id = ${draftId}`;
  return rows.length ? toRow(rows[0]) : null;
}

// 여러 명 한 번에 = 한 트랜잭션에 N행(§6). 비면 미배정 1행. draftId는 items ≤ 1일 때만 온다(라우트가 검증) — 첫 행에 붙인다.
export async function createTasks(sql: postgres.Sql, campaignId: string, input: TaskCreateInput): Promise<TaskRow[]> {
  const items = input.items.length ? input.items : [{ handle: null, cost: null }];
  const ids: string[] = [];
  await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    for (const it of items) {
      const rows = await tx<Array<{ id: string }>>`
        insert into campaign_task (campaign_id, influencer_handle, type, target_task_id, target_tweet_url,
                                   scheduled_on, visit_on, cost, note, created_by)
        values (${campaignId}, ${it.handle}, ${input.type}, ${input.targetTaskId}, ${input.targetTweetUrl},
                ${input.scheduledOn}::date, ${input.visitOn}::date,
                ${it.cost ? tx.json(it.cost as never) : null}, ${input.note}, ${input.createdBy})
        returning id`;
      ids.push(rows[0].id);
    }
    if (input.draftId) await attachDraft(tx, ids[0], input.draftId);
  });
  const rows = await sql<Row[]>`${SELECT(sql)} where t.id = any(${ids}::uuid[]) order by t.created_at asc, t.id asc`;
  // insert 순서 = ids 순서 — created_at이 같은 트랜잭션 안에서 동일할 수 있어 ids 순으로 다시 맞춘다
  const byId = new Map(rows.map((r) => [r.id, toRow(r)]));
  return ids.map((id) => byId.get(id) as TaskRow);
}

// 3값 규칙: undefined = 건드리지 않음 · null = 지움 · 값 = 설정(draftStore.updateDraft와 같은 case when 패턴).
// postedAt은 null을 받지 않는다(게시 확인은 되돌리지 않는다, §3-4) — 타입이 막는다.
export async function updateTask(sql: postgres.Sql, id: string, patch: TaskPatch): Promise<boolean> {
  if (!isUuidLike(id)) return false;
  const rows = await sql`update campaign_task set
      influencer_handle = case when ${patch.influencerHandle !== undefined} then ${patch.influencerHandle ?? null}::text else influencer_handle end,
      target_task_id    = case when ${patch.targetTaskId !== undefined} then ${patch.targetTaskId ?? null}::uuid else target_task_id end,
      target_tweet_url  = case when ${patch.targetTweetUrl !== undefined} then ${patch.targetTweetUrl ?? null}::text else target_tweet_url end,
      post_url          = case when ${patch.postUrl !== undefined} then ${patch.postUrl ?? null}::text else post_url end,
      posted_at         = coalesce(${patch.postedAt ?? null}::date, posted_at),
      posted_source     = coalesce(${patch.postedSource ?? null}::text, posted_source),
      removed_at        = case when ${patch.removedAt !== undefined} then ${patch.removedAt ?? null}::date else removed_at end,
      removed_reason    = coalesce(${patch.removedReason ?? null}::text, removed_reason),
      scheduled_on      = case when ${patch.scheduledOn !== undefined} then ${patch.scheduledOn ?? null}::date else scheduled_on end,
      visit_on          = case when ${patch.visitOn !== undefined} then ${patch.visitOn ?? null}::date else visit_on end,
      cost              = case when ${patch.cost !== undefined} then ${patch.cost ? sql.json(patch.cost as never) : null}::jsonb else cost end,
      note              = coalesce(${patch.note ?? null}::text, note),
      updated_at = now()
    where id = ${id} returning id`;
  return rows.length > 0;
}

// 삭제 — 원고 set null·참조 작업 target set null·tracked_post.task_id set null은 전부 FK가 한다
export async function deleteTask(sql: postgres.Sql, id: string): Promise<boolean> {
  if (!isUuidLike(id)) return false;
  const rows = await sql`delete from campaign_task where id = ${id} returning id`;
  return rows.length > 0;
}

// 원고 붙이기 — 원고 1개 = 작업 1개(unique partial index가 최후 방어, 여기서는 문구 있는 오류로 먼저 끊는다).
// 인플 동기화(값은 하나, §4-3): 작업에 인플이 있으면 원고에 채우고, 작업이 비어 있고 원고에 있으면 작업에 채운다.
export async function attachDraft(sql: postgres.Sql, taskId: string, draftId: string): Promise<void> {
  if (!isUuidLike(taskId) || !isUuidLike(draftId)) throw new TaskAttachError('no-task');
  const t = await sql<Array<{ id: string; draft_id: string | null; influencer_handle: string | null }>>`
    select id, draft_id, influencer_handle from campaign_task where id = ${taskId} for update`;
  if (t.length === 0) throw new TaskAttachError('no-task');
  if (t[0].draft_id && t[0].draft_id !== draftId) throw new TaskAttachError('task-has-draft');
  const taken = await sql<Array<{ id: string }>>`select id from campaign_task where draft_id = ${draftId} and id <> ${taskId}`;
  if (taken.length) throw new TaskAttachError('draft-attached');
  const d = await sql<Array<{ influencer_handle: string | null }>>`select influencer_handle from draft where id = ${draftId}`;
  if (d.length === 0) throw new TaskAttachError('no-task');
  const taskHandle = t[0].influencer_handle;
  const draftHandle = d[0].influencer_handle;
  await sql`update campaign_task set draft_id = ${draftId},
      influencer_handle = coalesce(influencer_handle, ${draftHandle}), updated_at = now() where id = ${taskId}`;
  if (taskHandle && (draftHandle ?? '').toLowerCase() !== taskHandle.toLowerCase()) {
    await sql`update draft set influencer_handle = ${taskHandle} where id = ${draftId}`;
  }
}
export async function detachDraft(sql: postgres.Sql, draftId: string): Promise<boolean> {
  if (!isUuidLike(draftId)) return false;
  const rows = await sql`update campaign_task set draft_id = null, updated_at = now() where draft_id = ${draftId} returning id`;
  return rows.length > 0;
}

// 대상 고르기 목록(§4-2) — post·quoteRt·visit 작업. 기본 같은 클라이언트(clientId 주면), q는 핸들·원고 제목·캠페인명. 최근 만든 순.
export async function listTargetCandidates(
  sql: postgres.Sql, opts: { clientId?: string | null; q?: string; limit?: number },
): Promise<TargetCandidate[]> {
  const byClient = opts.clientId ? sql`and c.client_id = ${opts.clientId}` : sql``;
  const q = (opts.q ?? '').trim().replace(/^@/, '');
  const like = `%${q}%`;
  const byQ = q ? sql`and (t.influencer_handle ilike ${like} or c.name ilike ${like} or d.title ilike ${like} or d.ko_title ilike ${like})` : sql``;
  const rows = await sql<Array<{
    task_id: string; type: TaskType; influencer_handle: string | null; campaign_id: string; campaign_name: string; client_id: string | null;
    post_url: string | null; posted_at: string | null; draft_title: string | null; draft_ko_title: string | null; created_at: Date;
  }>>`
    select t.id as task_id, t.type, t.influencer_handle, t.campaign_id, c.name as campaign_name, c.client_id,
           t.post_url, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, d.title as draft_title, d.ko_title as draft_ko_title, t.created_at
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join draft d on d.id = t.draft_id
     where t.type = any(${[...TARGETABLE_TYPES]}::text[]) ${byClient} ${byQ}
     order by t.created_at desc
     limit ${opts.limit ?? 50}`;
  return rows.map((r) => ({
    taskId: r.task_id, type: r.type, influencerHandle: r.influencer_handle, campaignId: r.campaign_id, campaignName: r.campaign_name,
    clientId: r.client_id, postUrl: r.post_url, postedAt: r.posted_at, draftLabel: r.draft_title?.trim() || r.draft_ko_title || null,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
// "이 게시물을 이미 RT하기로 한 사람"(§4-2) — 같은 대상을 가리키는 작업들의 핸들(lower 중복 제거, 첫 표기 보존)
export async function listTargetingHandles(sql: postgres.Sql, target: { taskId: string } | { tweetUrl: string }): Promise<string[]> {
  const rows = 'taskId' in target
    ? await sql<Array<{ h: string }>>`select influencer_handle as h from campaign_task where target_task_id = ${target.taskId} and influencer_handle is not null order by created_at`
    : await sql<Array<{ h: string }>>`select influencer_handle as h from campaign_task where target_tweet_url = ${target.tweetUrl} and influencer_handle is not null order by created_at`;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) { const k = r.h.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(r.h); } }
  return out;
}

// 게시 확인 채우기 — posted_at이 비어 있는 행만(이미 확인된 건 덮지 않는다). 갱신 수를 돌려준다.
export async function markPosted(sql: postgres.Sql, taskIds: string[], postedAt: string, source: 'auto' | 'manual'): Promise<number> {
  if (taskIds.length === 0) return 0;
  const rows = await sql`update campaign_task set posted_at = ${postedAt}::date, posted_source = ${source}, updated_at = now()
    where id = any(${taskIds}::uuid[]) and posted_at is null returning id`;
  return rows.length;
}

// 캠페인 삭제 확인 문구(§4-4)의 숫자 — 함께 지워질 작업 수, 다른 캠페인에서 이 캠페인 작업을 대상으로 참조하는 작업 수
export async function countTasksForCampaignDelete(sql: postgres.Sql, campaignId: string): Promise<{ taskCount: number; detachedTargets: number }> {
  const [r] = await sql<Array<{ task_count: string | number; detached: string | number }>>`
    select (select count(*) from campaign_task where campaign_id = ${campaignId}) as task_count,
           (select count(*) from campaign_task x join campaign_task y on y.id = x.target_task_id
             where y.campaign_id = ${campaignId} and x.campaign_id <> ${campaignId}) as detached`;
  return { taskCount: Number(r.task_count), detachedTargets: Number(r.detached) };
}

// 이관(§2-2 ②) — draft.campaign_id가 있는 원고 → 작업 1행(유형 = 비용 유형, 없으면 투고), 연결된 tracked_post는 작업으로.
// 재실행 안전: 이미 작업이 붙은 원고는 건너뛴다. 039(컬럼 drop) 전에만 의미가 있다 — 컬럼이 없으면 0건으로 끝난다.
export async function cutoverDraftsToTasks(sql: postgres.Sql): Promise<{ tasks: number; trackedPosts: number }> {
  const has = await sql<Array<{ n: string | number }>>`
    select count(*) as n from information_schema.columns where table_name = 'draft' and column_name = 'campaign_id'`;
  if (Number(has[0].n) === 0) return { tasks: 0, trackedPosts: 0 };
  const ins = await sql<Array<{ id: string }>>`
    insert into campaign_task (campaign_id, influencer_handle, type, draft_id, scheduled_on, cost, created_by, created_at)
    select d.campaign_id, d.influencer_handle,
           case when d.cost->>'type' in ('post','quoteRt','rt','visit') then d.cost->>'type' else 'post' end,
           d.id, d.scheduled_on,
           case when d.cost is null then null
                else jsonb_build_object('amount', d.cost->'amount', 'currency', d.cost->'currency') end,
           d.created_by, d.created_at
      from draft d
     where d.campaign_id is not null
       and not exists (select 1 from campaign_task t where t.draft_id = d.id)
    returning id`;
  // 게시물 → 작업. posted_at은 서울 날짜로, 없으면 오늘. post_url은 permalink 정규형.
  const tp = await sql<Array<{ id: string }>>`
    update tracked_post tp set task_id = t.id
      from campaign_task t
     where t.draft_id = tp.draft_id and tp.task_id is null
    returning tp.id`;
  await sql`
    update campaign_task t set
      posted_at = coalesce(t.posted_at, coalesce((tp.posted_at at time zone 'Asia/Seoul')::date, (now() at time zone 'Asia/Seoul')::date)),
      posted_source = coalesce(t.posted_source, 'manual'),
      post_url = coalesce(t.post_url, 'https://x.com/' || coalesce(tp.author_handle, 'i') || '/status/' || tp.tweet_id),
      updated_at = now()
      from tracked_post tp
     where tp.task_id = t.id and t.posted_at is null`;
  return { tasks: ins.length, trackedPosts: tp.length };
}
// tweetPermalink는 위 SQL과 같은 모양을 TS 쪽에서 만들 때 쓴다(라우트·UI) — SQL과 규칙이 갈리지 않도록 여기서 재수출
export { tweetPermalink };
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file=.env --test src/lib/campaignTaskStore.test.ts && npx tsc --noEmit`
Expected: 5 tests PASS. (테스트 5의 `postUrl` 기대값은 `author_handle='minchan'`이라 `https://x.com/minchan/status/<tweet_id>`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaignTaskStore.ts src/lib/campaignTaskStore.test.ts
git commit -m "feat(campaign-task): campaignTaskStore — 생성(N명)·조회·패치 3값·삭제·원고 붙이기/떼기·대상 후보·게시 확인 표시·이관

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: draftStore·원고 라우트 — 캠페인 소속을 작업에서 읽기, `taskId` 붙이기/떼기, 3필드 패치 제거

**Files:**
- Modify: `src/lib/draftStore.ts` (DraftRow·SELECT·insertDraft·updateDraft·updateDraftsBulk·listDrafts·listDraftsByCampaign/listUnassignedDrafts 제거)
- Modify: `src/lib/campaignTaskInput.ts` (create — `parseTaskIdPatch`만 이 Task에서; 나머지는 Task 8)
- Modify: `src/app/api/drafts/[id]/route.ts`, `src/app/api/drafts/route.ts`, `src/app/api/drafts/manual/route.ts`, `src/lib/generate.ts`
- Modify: `src/lib/campaignApi.ts` (`DraftPatchBody`에서 3필드 제거, `taskId` 추가; `fetchCandidateDrafts`·`bulkCampaignApi`는 Task 10에서 정리)
- Delete later(Task 17): `src/lib/draftFieldPatch.ts`(+test), `src/lib/draftStore.campaign.test.ts`
- Test: `src/lib/draftStore.task.test.ts` (new)

**Interfaces:**
- Produces (draftStore.ts): `DraftRow` 필드 `taskId: string | null; taskType: TaskType | null; campaignId/campaignName/campaignCode/scheduledOn: string | null; cost: TaskCost | null`(전부 붙은 작업에서 파생). `insertDraft(sql, { ..., taskId?: string | null })` — taskId면 같은 sql(트랜잭션) 안에서 `attachDraft`. `updateDraft` patch에서 `campaignId/scheduledOn/cost` **삭제**. `updateDraftsBulk` patch에서 `campaignId` **삭제**. `listDrafts(sql, { clientId?, status?, limit?, unattached?: boolean })`. `listUnattachedDrafts(sql, clientId: string | null, limit = 200)`. `listDraftsByCampaign`·`listUnassignedDrafts` **삭제**(campaignStore가 Task 5에서 작업 기반으로 바뀌기 전까지 컴파일이 깨지므로, 이 Task에서 `campaignStore.getCampaignDetail`의 `listDraftsByCampaign` 호출을 임시로 `[]`로 두지 말고 — **Task 5를 이 Task 직후 같은 세션에서 이어서 하고, 커밋은 Task 4 끝에 tsc 실패를 허용하지 않기 위해 `listDraftsByCampaign`만 이 Task에서 남겨둔다**. 즉 이 Task에서 삭제하는 건 `listUnassignedDrafts`만; `listDraftsByCampaign`은 Task 5에서 삭제).
- Produces (campaignTaskInput.ts): `parseTaskIdPatch(v: unknown): Parsed<string | null | undefined>` — undefined=키 없음, null=떼기, uuid=붙이기; 형식 오류 → `{ ok:false, message: TASK_ID_MESSAGE }`.
- Produces (routes): `PATCH /api/drafts/[id] { taskId?: string | null }`(3필드 제거) · `POST /api/drafts { taskId? }` · `POST /api/drafts/manual { taskId? }` · `GET /api/drafts?unattached=1&clientId=`. 원고가 이미 다른 작업에 붙어 있으면 409 `DRAFT_ATTACHED_MESSAGE`, 작업에 이미 원고가 있으면 409 `TASK_HAS_DRAFT_MESSAGE`.

- [ ] **Step 1: 실패 테스트** `src/lib/draftStore.task.test.ts`

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, getDraft, listDrafts, listUnattachedDrafts, updateDraft } from './draftStore.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, TaskAttachError } from './campaignTaskStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'tdtk' + process.pid;
const content: DraftContent = { posts: [{ text: '작업 원고', media: [] }] };
after(async () => {
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});
const mkDraft = (clientId: string | null, clientName: string | null, extra: { taskId?: string | null } = {}) =>
  insertDraft(sql, { clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [], content, model: null, memberId: null, ...extra });
const base = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 캠페인 파생 필드 — 작업이 없으면 전부 null, 붙으면 작업의 캠페인·예정일·비용·유형이 조인으로 온다', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'a', nameEn: `${P.toLowerCase()}-a`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const plain = (await getDraft(sql, await mkDraft(c.id, c.name)))!;
  assert.equal(plain.taskId, null); assert.equal(plain.taskType, null); assert.equal(plain.campaignId, null);
  assert.equal(plain.campaignName, null); assert.equal(plain.scheduledOn, null); assert.equal(plain.cost, null);
  const [t] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', scheduledOn: '2026-09-03', items: [{ handle: 'yuna', cost: { amount: 8000, currency: 'JPY' } }] });
  const id = await mkDraft(c.id, c.name, { taskId: t.id });
  const d = (await getDraft(sql, id))!;
  assert.equal(d.taskId, t.id); assert.equal(d.taskType, 'quoteRt'); assert.equal(d.campaignId, camp.id);
  assert.equal(d.campaignName, P + 'a'); assert.equal(d.campaignCode, `${P.toLowerCase()}-a`);
  assert.equal(d.scheduledOn, '2026-09-03'); assert.deepEqual(d.cost, { amount: 8000, currency: 'JPY' });
  assert.equal(d.influencerHandle, 'yuna');   // 작업 인플이 원고에 채워졌다(attachDraft)
  // 이미 원고가 붙은 작업에 또 붙이면 실패 — insert도 함께 롤백된다
  const before = (await listDrafts(sql, { clientId: c.id })).length;
  await assert.rejects(mkDraft(c.id, c.name, { taskId: t.id }), (e: unknown) => e instanceof TaskAttachError && e.code === 'task-has-draft');
  assert.equal((await listDrafts(sql, { clientId: c.id })).length, before);
});

test('2) 미부착 원고 목록 — 작업에 붙은 원고는 빠진다, listDrafts unattached 옵션도 같은 뜻', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'b', nameEn: `${P.toLowerCase()}-b`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const free = await mkDraft(c.id, c.name);
  const [t] = await createTasks(sql, camp.id, { ...base, type: 'post', items: [] });
  const attached = await mkDraft(c.id, c.name, { taskId: t.id });
  const ids = (await listUnattachedDrafts(sql, c.id)).map((d) => d.id);
  assert.ok(ids.includes(free)); assert.ok(!ids.includes(attached));
  const ids2 = (await listDrafts(sql, { clientId: c.id, unattached: true })).map((d) => d.id);
  assert.ok(ids2.includes(free)); assert.ok(!ids2.includes(attached));
  assert.equal((await listUnattachedDrafts(sql, null)).every((d) => d.clientId === null), true);
});

test('3) updateDraft — 캠페인 3필드는 더 받지 않는다(타입 수준) · status/influencer는 그대로', async () => {
  const c = await createClient(sql, P + '클라3');
  const id = await mkDraft(c.id, c.name);
  await updateDraft(sql, id, { status: 'review', influencerHandle: 'kei' });
  const d = (await getDraft(sql, id))!;
  assert.equal(d.status, 'review'); assert.equal(d.influencerHandle, 'kei');
  // campaignId/scheduledOn/cost는 updateDraft patch 타입에서 제거됐다(스펙 §5) — 컴파일이 막는다(tsc가 검증)
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file=.env --test src/lib/draftStore.task.test.ts`
Expected: FAIL — `listUnattachedDrafts` 없음 / `taskId` 옵션 없음.

- [ ] **Step 3: draftStore.ts 수정**

(a) import: `import { parseDraftCost, type DraftCost } from './campaignCost.ts';` → `import { parseTaskCost, type TaskCost } from './campaignCost.ts'; import { attachDraft } from './campaignTaskStore.ts'; import type { TaskType } from './campaignJudgment.ts';`

(b) `DraftRow`의 캠페인 블록을 교체:
```ts
  // 캠페인 소속은 붙은 작업(campaign_task.draft_id)에서 파생한다(스펙 2026-08-28 §5) — 원고는 캠페인에 직접 속하지 않는다.
  // 이름은 옛 그대로 두어(campaignId·campaignName·campaignCode·scheduledOn·cost) 표·필터·트래킹 링크 prefill이 그대로 읽는다.
  taskId: string | null;
  taskType: TaskType | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignCode: string | null;   // campaign.name_en
  scheduledOn: string | null;    // 작업의 게시 예정일 'YYYY-MM-DD'
  cost: TaskCost | null;         // 작업 비용 {amount, currency} — 유형은 taskType
```
(c) `Row` 타입: `campaign_id ... cost: unknown;` 줄을 `task_id: string | null; task_type: TaskType | null; campaign_id: string | null; campaign_name: string | null; campaign_code: string | null; scheduled_on: string | null; cost: unknown;`로.
(d) `costOf`: `parseDraftCost` → `parseTaskCost`, 반환 `TaskCost | null`.
(e) `toRow`: `campaignId: r.campaign_id, campaignName: ..., campaignCode: ..., scheduledOn: r.scheduled_on, cost: costOf(r.cost),` 앞에 `taskId: r.task_id, taskType: r.task_type,` 추가.
(f) `SELECT`:
```ts
const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.history, d.translation,
         d.title, d.ko_title, d.ko_title_hash,
         d.dismissed_flags, d.status, d.influencer_handle, d.batch_id, d.variant_index, d.model, d.created_at,
         t.id as task_id, t.type as task_type, t.campaign_id, c.name as campaign_name, c.name_en as campaign_code,
         to_char(t.scheduled_on, 'YYYY-MM-DD') as scheduled_on, t.cost,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by
    left join campaign_task t on t.draft_id = d.id
    left join campaign c on c.id = t.campaign_id`;
```
(unique partial index(draft_id)라 조인으로 행이 불어나지 않는다 — 주석으로 남긴다.)
(g) `insertDraft`: `campaignId?: string | null;` → `taskId?: string | null; // 작업에 붙여 만들기(/generate?task= · 원고 카드 '새 작업 만들기') — 같은 sql(트랜잭션) 안에서 attachDraft. 실패(TaskAttachError)는 호출자에게 던진다`. insert 문의 `campaign_id` 컬럼·값 제거. `returning id` 뒤:
```ts
  const id = rows[0].id;
  if (input.taskId) await attachDraft(sql, input.taskId, id);
  return id;
```
(h) `listDrafts` opts에 `unattached?: boolean` 추가, `const byAttach = opts.unattached ? sql\`and not exists (select 1 from campaign_task t2 where t2.draft_id = d.id)\` : sql\`\`;` where절에 포함.
(i) `updateDraft`: patch 타입의 `campaignId/scheduledOn/cost` 3줄과 update 문의 `campaign_id = …`, `scheduled_on = …`, `cost = …` 세 절 삭제(앞 절 `influencer_handle` 끝의 `,`를 제거해 문법 맞춤).
(j) `updateDraftsBulk`: patch에서 `campaignId` 제거, `campaign_id = case …` 절 삭제.
(k) `listUnassignedDrafts` → 이름·where 교체:
```ts
// '있는 원고 고르기'(스펙 §4-2) — 그 클라이언트의 작업에 안 붙은 원고만. 클라이언트 없는 캠페인은 클라 없는 원고를 후보로.
export async function listUnattachedDrafts(sql: postgres.Sql, clientId: string | null, limit = 200): Promise<DraftRow[]> {
  const byClient = clientId === null ? sql`and d.client_id is null` : sql`and d.client_id = ${clientId}`;
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where not exists (select 1 from campaign_task t2 where t2.draft_id = d.id) ${byClient}
    order by d.created_at desc, d.variant_index asc nulls first
    limit ${limit}`;
  return rows.map(toRow);
}
```
(l) `listDraftsByCampaign`: where를 `t.campaign_id = ${campaignId}`, order를 `t.scheduled_on asc nulls last, d.created_at asc`로 바꿔 **임시 유지**(Task 5에서 삭제).

- [ ] **Step 4: `src/lib/campaignTaskInput.ts` 생성(부분 — Task 8이 확장)**

```ts
// 작업 API 입력 검증 — 순수(DB 없음). 라우트 4곳(작업 생성·패치, 원고 PATCH·POST의 taskId)이 같은 규칙을 쓴다.
import type { Parsed } from './campaignCost.ts';
import { isUuidLike } from './uuid.ts';

export const TASK_ID_MESSAGE = '작업 값이 올바르지 않아요';
export const TASK_NOT_FOUND_MESSAGE = '작업을 찾을 수 없어요 — 삭제됐을 수 있어요. 화면을 새로고침해 주세요';
export const DRAFT_ATTACHED_MESSAGE = '이 원고는 이미 다른 작업에 붙어 있어요 — 먼저 그 작업에서 떼어 주세요';
export const TASK_HAS_DRAFT_MESSAGE = '이 작업엔 이미 원고가 있어요 — 작업 하나에 원고는 하나만 붙어요';

// undefined = 키 없음(건드리지 않음) · null = 떼기 · uuid = 붙이기
export function parseTaskIdPatch(v: unknown): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v === 'string' && isUuidLike(v)) return { ok: true, value: v };
  return { ok: false, message: TASK_ID_MESSAGE };
}
```

- [ ] **Step 5: `src/app/api/drafts/[id]/route.ts` 수정**

- import 교체: `parseDraftFieldPatch, CAMPAIGN_NOT_FOUND_MESSAGE`·`getCampaign` 줄 삭제 → `import { parseTaskIdPatch, TASK_NOT_FOUND_MESSAGE, DRAFT_ATTACHED_MESSAGE, TASK_HAS_DRAFT_MESSAGE } from '@/lib/campaignTaskInput'; import { attachDraft, detachDraft, TaskAttachError } from '@/lib/campaignTaskStore';`
- body 타입에서 `campaignId?: unknown; scheduledOn?: unknown; cost?: unknown` → `taskId?: unknown`.
- `const fields = parseDraftFieldPatch(body); if (!fields.ok) …` → `const taskId = parseTaskIdPatch(body.taskId); if (!taskId.ok) return NextResponse.json({ error: taskId.message }, { status: 400 });`
- 트랜잭션 반환 타입 `'ok' | 'no-draft' | 'no-campaign'` → `'ok' | 'no-draft' | 'no-task' | 'draft-attached' | 'task-has-draft'`. `no-campaign` 검사 줄 삭제. `updateDraft` 호출에서 `...fields.value` 제거. 그 뒤:
```ts
    if (taskId.value === null) await detachDraft(tx, id);
    else if (taskId.value !== undefined) {
      try { await attachDraft(tx, taskId.value, id); }
      catch (e) { if (e instanceof TaskAttachError) return e.code; throw e; }
    }
```
- 응답 매핑: `no-task` → 400 `TASK_NOT_FOUND_MESSAGE`, `draft-attached` → 409 `DRAFT_ATTACHED_MESSAGE`, `task-has-draft` → 409 `TASK_HAS_DRAFT_MESSAGE`. (트랜잭션 콜백에서 문자열을 return하면 postgres.js는 커밋한다 — attachDraft가 던진 시점에 UPDATE는 실행되지 않았으므로 커밋해도 부작용 없음. 단 그 앞의 updateDraft는 커밋된다 → **taskId 처리를 updateDraft보다 먼저** 두어 실패 시 아무것도 바뀌지 않게 한다.)

- [ ] **Step 6: `src/app/api/drafts/route.ts` 수정**

- GET: `const unattached = params.get('unattached') === '1';` → `listDrafts(getSql(), { clientId, status: status ?? undefined, limit, unattached })`.
- POST(생성): `parseDraftFieldPatch({ campaignId … })`·`getCampaign` 검사 블록 → `const taskId = parseTaskIdPatch((body as { taskId?: unknown }).taskId); if (!taskId.ok) return 400;` 이어서 `taskId.value`가 문자열이면 `getTask(sql, taskId.value)` 없으면 400 `TASK_NOT_FOUND_MESSAGE`, 이미 `draftId`가 있으면 409 `TASK_HAS_DRAFT_MESSAGE`. `generateDraft(…, { campaignId })` → `{ taskId: taskId.value ?? null }`.
- bulk PATCH: `campaignId` 관련 4곳 삭제(타입·parse·400 가드 조건을 `body.status === undefined && inf.value === undefined`로·`getCampaign` 검사·`updateDraftsBulk` 인자).
- import 정리: `getCampaign`, `parseDraftFieldPatch`, `CAMPAIGN_NOT_FOUND_MESSAGE` 제거, `parseTaskIdPatch, TASK_NOT_FOUND_MESSAGE, TASK_HAS_DRAFT_MESSAGE`·`getTask` 추가.

- [ ] **Step 7: `src/app/api/drafts/manual/route.ts`·`src/lib/generate.ts` 수정**

- manual: body `campaignId?: unknown` → `taskId?: unknown`; 검사 블록을 Step 6 POST와 동일하게; `insertDraft(..., { campaignId })` → `{ taskId: taskId.value ?? null }`. insert가 `sql.begin` 안이 아니면 `sql.begin(async (tx0) => insertDraft(tx0 as unknown as postgres.Sql, …))`로 감싼다(attach 실패 시 원고가 남지 않게). `TaskAttachError`는 `try/catch`로 409.
- generate.ts: 31행 `campaignId?: string | null;` → `taskId?: string | null; // 작업에 붙여 만들기(스펙 §5 /generate?task=) — 라우트가 존재·미부착까지 검증한 값. 다중 시안(count>1)이면 첫 시안에만 붙인다(원고 1개 = 작업 1개)`. 126행 `campaignId: req.campaignId ?? null,` → `taskId: i === 0 ? (req.taskId ?? null) : null,`(해당 insert 루프의 인덱스 변수 이름에 맞춘다 — 없으면 `variantIndex === 0` 조건으로).
- `campaignApi.ts`의 `DraftPatchBody`: `campaignId?: string | null; scheduledOn?: string | null; cost?: DraftCost | null;` → `taskId?: string | null;`. (`bulkCampaignApi`·`fetchCandidateDrafts`는 아직 AddDraftsModal이 쓰므로 남긴다 — Task 10·17.)

- [ ] **Step 8: 옛 테스트 무력화 + 통과 확인**

`src/lib/draftStore.campaign.test.ts`는 삭제된 API를 부르므로 이 Task에서 삭제(`git rm`). `src/lib/draftFieldPatch.test.ts`도 `git rm`, `src/lib/draftFieldPatch.ts` 삭제(참조 없음 확인: `grep -rn draftFieldPatch src` → 0건).
Run: `node --import tsx --env-file=.env --test src/lib/draftStore.task.test.ts src/lib/campaignTaskStore.test.ts && npx tsc --noEmit`
Expected: PASS · tsc 0. (`tsc`가 `AddDraftsModal`/`useCampaignDraftActions`의 `campaignId` 사용으로 실패하면 — `DraftPatchBody`에서 `campaignId`를 뺐기 때문 — 그 두 파일의 `patchDraftApi(d.id, { campaignId… })` 호출을 임시로 `patchDraftApi(d.id, { taskId: null })`로 바꿔 두고 주석 `// Task 11에서 작업 삭제로 대체`를 남긴다.)

- [ ] **Step 9: Commit**

```bash
git add -A src/lib/draftStore.ts src/lib/draftStore.task.test.ts src/lib/campaignTaskInput.ts src/lib/campaignApi.ts src/lib/generate.ts src/app/api/drafts src/lib/draftFieldPatch.ts src/lib/draftFieldPatch.test.ts src/lib/draftStore.campaign.test.ts src/app/campaigns
git commit -m "feat(campaign-task): 원고의 캠페인 소속을 붙은 작업에서 파생 — DraftRow.taskId/taskType, PATCH/POST taskId, 3필드 패치 제거, 미부착 원고 목록

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: campaignStore — 상세를 작업 목록으로, 목록 집계·인플 프로필 롤업·삭제 응답

**Files:**
- Modify: `src/lib/campaignStore.ts`
- Modify: `src/lib/draftStore.ts` (`listDraftsByCampaign` 삭제)
- Test: `src/lib/campaignStore.test.ts` (전면 재작성)

**Interfaces:**
- Produces:
```ts
export interface CampaignRow { …기존…; taskCount: number /* 미사용 제외 */; total: MoneyByCurrency }   // draftCount 제거
export interface CampaignTaskItem extends TaskRow { published: boolean /* = postedAt !== null */; perf: CampaignPerf | null; linkClicks: number | null }
export interface CampaignDetail {
  campaign: CampaignRow; tasks: CampaignTaskItem[]; costRows: InfluencerCostRow[];
  summary: TaskSummary; influencers: TaskInfluencerLine[]; byType: TypeSubtotal[];
  deleteInfo: { taskCount: number; detachedTargets: number };   // 삭제 확인 문구
  today: string;
}
export interface InfluencerCampaignItem { id; name; startsOn; endsOn; taskCount: number; countsByType: Partial<Record<TaskType, number>>; subtotal: MoneyByCurrency }
export async function deleteCampaign(sql, id): Promise<{ deleted: boolean; taskCount: number; detachedTargets: number }>
```
- `getCampaignDetail`: tasks = `listTasksByCampaign`; perf는 `tracked_post.task_id` 기준(lateral 최신 스냅샷 합), linkClicks는 `tracking_link.draft_id = t.draft_id`.
- `SELECT`의 `draft_count` → `task_count`: `(select count(*) from campaign_task t left join draft d on d.id = t.draft_id where t.campaign_id = c.id and not (d.status = 'unused' and t.posted_at is null))`.
- `totalsFor`: draft 합 → `campaign_task` 합(같은 미사용 제외 조건) ∪ extra_costs.
- `listInfluencerCampaigns`: `campaign_task` 기준(lower(handle)), unused 제외, countsByType.

- [ ] **Step 1: 테스트 재작성** `src/lib/campaignStore.test.ts` — 기존 파일을 아래로 교체

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  createCampaign, listCampaigns, getCampaign, updateCampaign, deleteCampaign, getCampaignDetail, upsertInfluencerCost, listInfluencerCampaigns,
} from './campaignStore.ts';
import { createTasks, updateTask } from './campaignTaskStore.ts';
import { taskCampaignTotal } from './campaignJudgment.ts';

const sql = getSql();
const P = 'tcmp' + process.pid;
const content: DraftContent = { posts: [{ text: '캠페인 스토어', media: [] }] };
const T = '2026-09-02';
after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});
const mkDraft = (clientId: string | null, clientName: string | null, taskId: string | null = null) =>
  insertDraft(sql, { clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [], content, model: null, memberId: null, taskId });
const base = (clientId: string, clientName: string, suffix: string) => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null,
});
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 생성 → 조회 — 기본값·목록 포함·taskCount 0·합계 {}', async () => {
  const c = await createClient(sql, P + '클라1');
  const row = await createCampaign(sql, { ...base(c.id, c.name, 'a'), note: '메모' });
  assert.equal(row.startsOn, '2026-08-31'); assert.equal(row.note, '메모'); assert.equal(row.taskCount, 0); assert.deepEqual(row.total, {});
  assert.ok((await listCampaigns(sql)).some((x) => x.id === row.id));
  assert.equal(await getCampaign(sql, 'not-a-uuid'), null);
  await updateCampaign(sql, row.id, { name: P + 'a2' });
  assert.equal((await getCampaign(sql, row.id))!.name, P + 'a2');
});

test('2) 상세 — 작업 목록·게시됨(posted_at)·성과(task_id)·링크 클릭(draft)·요약·인플 목록·유형별 소계·삭제 정보', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await createCampaign(sql, base(c.id, c.name, 'b'));
  const other = await createCampaign(sql, base(c.id, c.name, 'b2'));
  const [post] = await createTasks(sql, camp.id, { ...tin, type: 'post', scheduledOn: '2026-09-01', items: [{ handle: 'mika', cost: { amount: 20000, currency: 'JPY' } }] });
  const draftId = await mkDraft(c.id, c.name, post.id);
  await updateDraft(sql, draftId, { status: 'delivered' });
  const [rt1, rt2] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTaskId: post.id, scheduledOn: '2026-09-01', items: [{ handle: 'rio', cost: { amount: 3000, currency: 'JPY' } }, { handle: 'sora', cost: { amount: 3000, currency: 'JPY' } }] });
  const [unusedTask] = await createTasks(sql, camp.id, { ...tin, type: 'quoteRt', items: [{ handle: 'kei', cost: { amount: 8000, currency: 'JPY' } }] });
  await updateDraft(sql, await mkDraft(c.id, c.name, unusedTask.id), { status: 'unused' });
  await createTasks(sql, other.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'ten', cost: null }] });   // 다른 캠페인의 참조
  await upsertInfluencerCost(sql, camp.id, 'hana', { extraCosts: [{ label: '교통비', amount: 5000, currency: 'KRW' }] });
  // 게시물 → 작업(rt1 게시 확인 + 성과), 링크 클릭 → 원고
  await updateTask(sql, rt1.id, { postedAt: '2026-09-01', postedSource: 'auto' });
  const tp = await sql<Array<{ id: string }>>`insert into tracked_post (tweet_id, author_handle, text, task_id) values (${P + 'x1'}, 'rio', '', ${rt1.id}) returning id`;
  await sql`insert into post_metric_snapshot (tracked_post_id, views, likes) values (${tp[0].id}, 1000, 10), (${tp[0].id}, 1200, 12)`;
  const link = await sql<Array<{ id: string }>>`insert into tracking_link (code, landing_url, long_url, short_url, shortio_link_id, utm_campaign, influencer_handle, draft_id)
    values (${P.toLowerCase().slice(-6)}, 'https://example.com', 'https://example.com/?x', 'https://s.io/x', ${P + 'sid'}, ${P + 'utm'}, 'mika', ${draftId}) returning id`;
  await sql`insert into link_click_snapshot (tracking_link_id, total_clicks) values (${link[0].id}, 96)`;

  const d = (await getCampaignDetail(sql, camp.id, T))!;
  assert.equal(d.tasks.length, 4);
  const p = d.tasks.find((t) => t.id === post.id)!;
  assert.equal(p.draftStatus, 'delivered'); assert.equal(p.published, false); assert.equal(p.linkClicks, 96);
  const r = d.tasks.find((t) => t.id === rt1.id)!;
  assert.equal(r.published, true); assert.deepEqual(r.perf, { postCount: 1, views: 1200, likes: 12 });   // 최신 스냅샷만
  assert.equal(r.target!.taskId, post.id);
  assert.equal(d.tasks.find((t) => t.id === rt2.id)!.published, false);
  assert.deepEqual(d.summary, { total: 3, published: 1, delivered: 1, preparing: 1, overdue: 2, removed: 0 });   // 미사용 제외, post·rt2 밀림(9/1 < 9/2), rt1은 게시됨
  assert.deepEqual(d.byType.map((x) => [x.type, x.count]), [['rt', 2], ['post', 1]]);
  assert.deepEqual(d.influencers.map((l) => l.handle), ['mika', 'rio', 'sora', 'hana']);
  assert.deepEqual(d.influencers.find((l) => l.handle === 'hana')!.extraCost, { KRW: 5000 });
  assert.deepEqual(taskCampaignTotal(d.influencers), { JPY: 26000, KRW: 5000 });
  assert.deepEqual(d.deleteInfo, { taskCount: 4, detachedTargets: 1 });
  assert.equal(d.today, T);
  const listed = (await listCampaigns(sql)).find((x) => x.id === camp.id)!;
  assert.equal(listed.taskCount, 3);
  assert.deepEqual(listed.total, { JPY: 26000, KRW: 5000 });
});

test('3) 인플 프로필 참여 캠페인 — 작업 기준(lower), 유형별 건수, 비용 행만 있는 캠페인도', async () => {
  const c = await createClient(sql, P + '클라3');
  const camp = await createCampaign(sql, base(c.id, c.name, 'c'));
  await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: 'Yuna', cost: { amount: 3000, currency: 'JPY' } }, { handle: 'yuna', cost: { amount: 3000, currency: 'JPY' } }] });
  await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: 'YUNA', cost: { amount: 20000, currency: 'JPY' } }] });
  const camp2 = await createCampaign(sql, base(c.id, c.name, 'c2'));
  await upsertInfluencerCost(sql, camp2.id, 'yuna', { extraCosts: [{ label: '선물', amount: 10000, currency: 'KRW' }] });
  const items = await listInfluencerCampaigns(sql, 'yuna');
  const a = items.find((x) => x.id === camp.id)!;
  assert.equal(a.taskCount, 3); assert.deepEqual(a.countsByType, { rt: 2, post: 1 }); assert.deepEqual(a.subtotal, { JPY: 26000 });
  const b = items.find((x) => x.id === camp2.id)!;
  assert.equal(b.taskCount, 0); assert.deepEqual(b.subtotal, { KRW: 10000 });
});

test('4) 삭제 — 작업은 cascade, 원고는 남고, 다른 캠페인의 참조는 대상 미정으로, 응답에 숫자', async () => {
  const c = await createClient(sql, P + '클라4');
  const camp = await createCampaign(sql, base(c.id, c.name, 'd'));
  const other = await createCampaign(sql, base(c.id, c.name, 'd2'));
  const [post] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: null }] });
  const draftId = await mkDraft(c.id, c.name, post.id);
  const [rt] = await createTasks(sql, other.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'rio', cost: null }] });
  assert.deepEqual(await deleteCampaign(sql, camp.id), { deleted: true, taskCount: 1, detachedTargets: 1 });
  assert.equal((await sql`select id from draft where id = ${draftId}`).length, 1);
  assert.equal((await sql`select target_task_id from campaign_task where id = ${rt.id}`)[0].target_task_id, null);
  assert.deepEqual(await deleteCampaign(sql, camp.id), { deleted: false, taskCount: 0, detachedTargets: 0 });
  await deleteClient(sql, c.id);
  assert.equal((await getCampaign(sql, other.id))!.clientName, c.name);   // 스냅샷 유지
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file=.env --test src/lib/campaignStore.test.ts` → FAIL(`taskCount` 없음 등).

- [ ] **Step 3: campaignStore.ts 수정**

- import: `listDraftsByCampaign`·`DraftRow`·`parseDraftCost`·`summarizeStages, deriveInfluencers, CampaignSummary, InfluencerLine` 제거 → `import { listTasksByCampaign, countTasksForCampaignDelete, type TaskRow } from './campaignTaskStore.ts'; import { summarizeTasks, deriveTaskInfluencers, subtotalsByType, type TaskSummary, type TaskInfluencerLine, type TypeSubtotal, type TaskType } from './campaignJudgment.ts'; import { parseTaskCost } from './campaignCost.ts';`
- `CampaignRow.draftCount` → `taskCount: number; // 파생: 미사용 원고 작업 제외 작업 수(요약 N과 같은 모집단)`.
- `CampaignDraftItem` → 
```ts
export interface CampaignTaskItem extends TaskRow {
  published: boolean;              // = postedAt !== null (게시 확인이 판정, tracked_post 유무가 아니다 — §2-5)
  perf: CampaignPerf | null;       // tracked_post.task_id 최신 스냅샷 합
  linkClicks: number | null;       // 붙은 원고의 tracking_link 최신 스냅샷 합
}
```
- `CampaignDetail` → 위 Interfaces대로(`tasks`, `summary: TaskSummary`, `influencers: TaskInfluencerLine[]`, `byType`, `deleteInfo`, `today`).
- `InfluencerCampaignItem` → `{ id; name; startsOn; endsOn; taskCount: number; countsByType: Partial<Record<TaskType, number>>; subtotal: MoneyByCurrency }`.
- `CRow.draft_count` → `task_count`. `SELECT`의 서브쿼리:
```sql
(select count(*) from campaign_task t left join draft d on d.id = t.draft_id
  where t.campaign_id = c.id and not (coalesce(d.status, '') = 'unused' and t.posted_at is null)) as task_count
```
- `totalsFor`의 첫 union 절:
```sql
select t.campaign_id, t.cost->>'currency' as currency, (t.cost->>'amount')::bigint as amount
  from campaign_task t left join draft d on d.id = t.draft_id
 where t.campaign_id = any(${ids}::uuid[]) and t.cost is not null
   and not (coalesce(d.status, '') = 'unused' and t.posted_at is null)
```
- `toRows`: `draftCount: Number(r.draft_count)` → `taskCount: Number(r.task_count)`.
- `deleteCampaign`:
```ts
export async function deleteCampaign(sql: postgres.Sql, id: string): Promise<{ deleted: boolean; taskCount: number; detachedTargets: number }> {
  if (!isUuidLike(id)) return { deleted: false, taskCount: 0, detachedTargets: 0 };
  const info = await countTasksForCampaignDelete(sql, id);   // 삭제 전에 세야 한다(cascade 뒤엔 0)
  const del = await sql`delete from campaign where id = ${id} returning id`;
  return del.length > 0 ? { deleted: true, ...info } : { deleted: false, taskCount: 0, detachedTargets: 0 };
}
```
- `getCampaignDetail`: `drafts` → `const tasks = await listTasksByCampaign(sql, id);`. perfRows 쿼리는 `tp.task_id`로(`select tp.task_id, count(tp.id)::int as post_count, sum(s.views) as views, sum(s.likes) as likes from tracked_post tp left join lateral (…) s on true where tp.task_id in (select t.id from campaign_task t where t.campaign_id = ${id}) group by tp.task_id`). clickRows는 `l.draft_id in (select t.draft_id from campaign_task t where t.campaign_id = ${id} and t.draft_id is not null)`. items:
```ts
  const items: CampaignTaskItem[] = tasks.map((t) => {
    const p = perfMap.get(t.id);
    const c = t.draftId ? clickMap.get(t.draftId) : undefined;
    return { ...t, published: t.postedAt !== null, perf: p ? { postCount: p.post_count, views: num(p.views), likes: num(p.likes) } : null, linkClicks: c ? num(c.clicks) : null };
  });
```
  반환: `{ campaign, tasks: items, costRows, summary: summarizeTasks(items, today), influencers: deriveTaskInfluencers(items, costRows), byType: subtotalsByType(items), deleteInfo: await countTasksForCampaignDelete(sql, id), today }`.
- `listInfluencerCampaigns`:
```ts
export async function listInfluencerCampaigns(sql: postgres.Sql, handle: string): Promise<InfluencerCampaignItem[]> {
  const lower = handle.toLowerCase();
  const tasks = await sql<Array<{ campaign_id: string; type: TaskType; cost: unknown; unused: boolean }>>`
    select t.campaign_id, t.type, t.cost, (coalesce(d.status, '') = 'unused' and t.posted_at is null) as unused
      from campaign_task t left join draft d on d.id = t.draft_id
     where lower(t.influencer_handle) = ${lower}`;
  const cic = await sql<Array<{ campaign_id: string; extra_costs: unknown }>>`
    select campaign_id, extra_costs from campaign_influencer_cost where lower(influencer_handle) = ${lower}`;
  const ids = [...new Set([...tasks.map((t) => t.campaign_id), ...cic.map((c) => c.campaign_id)])];
  if (ids.length === 0) return [];
  const camps = await sql<Array<{ id: string; name: string; starts_on: string; ends_on: string }>>`
    select id, name, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from campaign where id = any(${ids}::uuid[]) order by starts_on desc, created_at desc`;
  return camps.map((c) => {
    const mine = tasks.filter((t) => t.campaign_id === c.id && !t.unused);
    const countsByType: Partial<Record<TaskType, number>> = {};
    for (const t of mine) countsByType[t.type] = (countsByType[t.type] ?? 0) + 1;
    const costs = mine.flatMap((t) => { const p = parseTaskCost(t.cost ?? null); return p.ok && p.value ? [p.value] : []; });
    const extra = cic.filter((x) => x.campaign_id === c.id).flatMap((x) => extraCostsOf(x.extra_costs));
    return { id: c.id, name: c.name, startsOn: c.starts_on, endsOn: c.ends_on, taskCount: mine.length, countsByType, subtotal: mergeMoney(sumMoney(costs), sumMoney(extra)) };
  });
}
```
- `draftStore.ts`에서 `listDraftsByCampaign` 삭제.
- `src/app/api/campaigns/[id]/route.ts` DELETE: `return NextResponse.json({ ok: true, ...(await deleteCampaign(getSql(), id)) });`. `src/app/api/campaigns/[id]/drafts/route.ts`는 `listUnassignedDrafts`가 없어 컴파일이 깨진다 → **이 Task에서 `git rm`**(대체는 `GET /api/drafts?unattached=1`).

- [ ] **Step 4: 통과 확인** — `node --import tsx --env-file=.env --test src/lib/campaignStore.test.ts && npx tsc --noEmit`. tsc가 `CampaignDetail.tsx`·`ContentTable.tsx`·`campaignView.ts`(draftCount)·`CampaignSection.tsx`(contentCount)·`AddDraftsModal`(fetchCandidateDrafts 라우트는 남았으나 함수는 존재) 등에서 실패한다 — **이 Task에서 최소 수정으로 컴파일만 맞춘다**: `campaignView.listSubline`은 `taskCount`로(`작업 ${c.taskCount}건`), `CampaignSection`은 `c.taskCount`·`countsByTypeLabel(c.countsByType)`(문구 `작업 n건 (투고 1 · RT 3)`), `CampaignDetail.tsx`는 `r.data`의 `drafts` → `tasks`를 받되 표엔 아직 `ContentTable`을 넘길 수 없으므로 **표·달력 영역을 `<p>작업 표로 바꾸는 중…</p>`로 잠시 비운다**(Task 11에서 TaskTable로 교체). `useCampaignDraftActions`·`ContentTable`·`WeekCalendar`·`AddDraftsModal`·`LinkPostModal`은 import를 끊고 파일은 남긴다(Task 17 삭제). 이 임시 상태는 커밋 메시지에 명시한다.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/campaignStore.ts src/lib/campaignStore.test.ts src/lib/draftStore.ts src/lib/campaignView.ts src/lib/campaignView.test.ts src/app/api/campaigns src/app/campaigns/CampaignDetail.tsx src/app/influencers/CampaignSection.tsx
git commit -m "feat(campaign-task): 캠페인 상세·목록·인플 롤업을 작업 기준으로 — tasks/summary/byType/deleteInfo, 삭제 응답 숫자 (표 영역은 Task 11까지 임시 비움)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 트래킹 연결 양방향 — `tracked_post.task_id`·`linkTrackedPost`·라우트

**Files:**
- Modify: `src/lib/trackingStore.ts`, `src/app/api/tracking/route.ts`, `src/app/api/tracking/[id]/route.ts`
- Test: `src/lib/trackingStore.test.ts` (setDraftLink 테스트를 linkTrackedPost로 교체 + 신규 케이스)

**Interfaces:**
- Produces: `TrackedPostRow.taskId: string | null`. `linkTrackedPost(sql, trackedPostId: string, link: { taskId: string | null } | { draftId: string | null }): Promise<boolean>`(행 없으면 false; FK 위반은 던진다). `setDraftLink` **삭제**. `POST /api/tracking { url, taskId? }`, `PATCH /api/tracking/[id] { taskId | draftId | role }`.
- 규칙(§2-4): 작업으로 연결 → `task_id=작업`, `draft_id=작업.draft_id`, 작업 `post_url`(비어 있을 때만) = `tweetPermalink(author_handle, tweet_id)`, `posted_at`(비어 있을 때만) = `(tp.posted_at at time zone 'Asia/Seoul')::date` 없으면 오늘, `posted_source='manual'`. 원고로 연결 → `draft_id=원고`, 그 원고가 붙은 작업이 있으면 `task_id`도 + 위 보충. `null` → 두 칸 모두 null. 작업의 posted_at은 되돌리지 않는다.

- [ ] **Step 1: 테스트 추가** — trackingStore.test.ts의 `setDraftLink` import·사용을 `linkTrackedPost`로 바꾸고 아래 테스트 추가(캠페인·작업 fixture를 위해 `createClient`·`createCampaign`·`createTasks`·`getTask` import, `after`에 `campaign_task`·`campaign`·`client` 정리 추가)

```ts
test('N) 작업으로 연결 — task_id·draft_id 함께, 작업의 post_url/posted_at 보충(비어 있을 때만), 해제는 둘 다 null', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'c', nameEn: `${P.toLowerCase()}-c`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const [task] = await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'post', items: [{ handle: 'mika', cost: null }] });
  const draftId = await insertDraft(sql, { clientId: c.id, clientName: c.name, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [], content: { posts: [{ text: 'x', media: [] }] }, model: null, memberId: null, taskId: task.id });
  const { row } = await addTrackedPost(sql, { tweetId: P + 'L1', authorHandle: 'mika', text: '', postedAt: '2026-09-01T20:00:00Z', createdBy: null, metrics: M, raw: null });
  assert.equal(await linkTrackedPost(sql, row.id, { taskId: task.id }), true);
  const linked = (await findTrackedPostById(sql, row.id))!;
  assert.equal(linked.taskId, task.id); assert.equal(linked.draftId, draftId);
  let t = (await getTask(sql, task.id))!;
  assert.equal(t.postUrl, `https://x.com/mika/status/${P}L1`); assert.equal(t.postedAt, '2026-09-02'); assert.equal(t.postedSource, 'manual');   // 20:00Z = 서울 다음날 05:00
  // 원고로 연결(트래킹 페이지 경로)도 작업까지 채운다
  const { row: row2 } = await addTrackedPost(sql, { tweetId: P + 'L2', authorHandle: 'mika', text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.equal(await linkTrackedPost(sql, row2.id, { draftId }), true);
  assert.equal((await findTrackedPostById(sql, row2.id))!.taskId, task.id);
  t = (await getTask(sql, task.id))!;
  assert.equal(t.postUrl, `https://x.com/mika/status/${P}L1`);   // 이미 있으니 덮지 않는다
  assert.equal(await linkTrackedPost(sql, row2.id, { taskId: null }), true);
  const cleared = (await findTrackedPostById(sql, row2.id))!;
  assert.equal(cleared.taskId, null); assert.equal(cleared.draftId, null);
  assert.equal((await getTask(sql, task.id))!.postedAt, '2026-09-02');       // 되돌리지 않는다
  assert.equal(await linkTrackedPost(sql, '00000000-0000-0000-0000-000000000000', { draftId: null }), false);
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file=.env --test src/lib/trackingStore.test.ts` → FAIL.

- [ ] **Step 3: trackingStore.ts 수정**

- `TrackedPostRow`에 `taskId: string | null;`(draftId 옆), `Row`에 `task_id: string | null`, `SELECT`에 `tp.task_id`, `toRow`에 `taskId: r.task_id`, `stripInternal`에 `taskId` 포함.
- `setDraftLink` 삭제 → 아래 추가(import `tweetPermalink` from './tweetLink.ts'):
```ts
// 게시물 연결 — 작업·원고 어느 쪽으로 연결하든 두 칸을 함께 맞춘다(캠페인 작업 스펙 §2-4 양방향 규칙).
// 작업 쪽 보충(post_url·posted_at)은 비어 있을 때만 — 게시 확인은 되돌리지 않는다(§3-4). 트랜잭션은 호출자 몫(라우트가 sql.begin).
export async function linkTrackedPost(
  sql: postgres.Sql, trackedPostId: string, link: { taskId: string | null } | { draftId: string | null },
): Promise<boolean> {
  const cur = await sql<Array<{ tweet_id: string; author_handle: string | null; posted_at: Date | null }>>`
    select tweet_id, author_handle, posted_at from tracked_post where id = ${trackedPostId} for update`;
  if (cur.length === 0) return false;
  let taskId: string | null = null;
  let draftId: string | null = null;
  if ('taskId' in link) {
    taskId = link.taskId;
    if (taskId) {
      const t = await sql<Array<{ draft_id: string | null }>>`select draft_id from campaign_task where id = ${taskId}`;
      if (t.length === 0) throw Object.assign(new Error('task not found'), { code: '23503' });   // FK 위반과 같은 처리(라우트 400)
      draftId = t[0].draft_id;
    }
  } else {
    draftId = link.draftId;
    if (draftId) {
      const t = await sql<Array<{ id: string }>>`select id from campaign_task where draft_id = ${draftId}`;
      taskId = t[0]?.id ?? null;
    }
  }
  await sql`update tracked_post set task_id = ${taskId}, draft_id = ${draftId} where id = ${trackedPostId}`;
  if (taskId) {
    const permalink = tweetPermalink(cur[0].author_handle, cur[0].tweet_id);
    await sql`update campaign_task set
        post_url = coalesce(post_url, ${permalink}),
        posted_at = coalesce(posted_at, coalesce((${cur[0].posted_at}::timestamptz at time zone 'Asia/Seoul')::date, (now() at time zone 'Asia/Seoul')::date)),
        posted_source = coalesce(posted_source, 'manual'),
        updated_at = now()
      where id = ${taskId}`;
  }
  return true;
}
```
- `src/app/api/tracking/[id]/route.ts`: body 타입에 `taskId?: unknown` 추가. `role` 갈래 뒤: `const link = 'taskId' in body ? { key: 'taskId' as const, v: body.taskId } : { key: 'draftId' as const, v: body.draftId };` — v가 null/uuid 문자열이 아니면 400(기존 문구), 존재 확인 후 `await sql.begin(async (tx0) => linkTrackedPost(tx0 as unknown as postgres.Sql, id, link.key === 'taskId' ? { taskId: link.v as string | null } : { draftId: link.v as string | null }))`. catch의 23503 문구를 `'연결하려는 원고나 작업을 찾을 수 없어요'`로.
- `src/app/api/tracking/route.ts` POST: body에 `taskId?: unknown`; `isUuidLike` 검증(400 `TASK_ID_MESSAGE`); 등록/기존행 확보 뒤 `if (taskId) await sql.begin(async (tx0) => linkTrackedPost(tx0 as unknown as postgres.Sql, row.id, { taskId }))` 후 `row`를 `findTrackedPostById`로 다시 읽어 응답. (기존 행이 다른 작업에 붙어 있으면 그대로 덮는다 — 게시물 1개는 작업 1개에만.)

- [ ] **Step 4: 통과 확인** — `node --import tsx --env-file=.env --test src/lib/trackingStore.test.ts && npx tsc --noEmit`. (`LinkPostModal.tsx`가 `linkTrackedPostDraftApi`를 쓰는 건 그대로 컴파일된다 — Task 14에서 교체.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/trackingStore.ts src/lib/trackingStore.test.ts src/app/api/tracking
git commit -m "feat(campaign-task): 게시물 연결을 작업 기준으로 — tracked_post.task_id, linkTrackedPost 양방향(작업↔원고), 작업 post_url/posted_at 보충

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 인플 핸들 변경 전파 — `campaign_task.influencer_handle`

**Files:**
- Modify: `src/lib/influencerStore.ts` (`renameInfluencer`)
- Test: `src/lib/influencerStore.test.ts` (핸들 변경 테스트에 작업 검증 추가)

- [ ] **Step 1: 테스트 추가** — 기존 핸들 변경 테스트(약 355~370행 근처, `renameInfluencer` 호출 뒤)에:
```ts
  // 캠페인 작업의 핸들도 같은 트랜잭션에서 따라간다(작업 스펙 §2-3) — 빠지면 인플 목록에 옛 핸들 유령 줄
  const [tk] = await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'rt', items: [{ handle: from, cost: null }] });
  await sql.begin(async (tx0) => renameInfluencer(tx0 as unknown as postgres.Sql, { influencerId: row.id, from, to: to + '2', actorId: null }));
  assert.equal((await getTask(sql, tk.id))!.influencerHandle, to + '2');
```
(`createTasks`·`getTask` import 추가, `after`에 `delete from campaign_task where campaign_id in (select id from campaign where name like ${P+'%'})` 추가 — campaign 삭제 전에.)

- [ ] **Step 2: 실패 확인** — 해당 테스트 파일 실행 → FAIL(핸들 그대로).

- [ ] **Step 3: 구현** — `renameInfluencer`의 `update draft …` 다음 줄에:
```ts
  // 작업(campaign_task)은 unique 제약이 없어 병합 없이 표기만 바꾼다
  await sql`update campaign_task set influencer_handle = ${to}, updated_at = now() where lower(influencer_handle) = ${from.toLowerCase()}`;
```

- [ ] **Step 4: 통과 확인** — `node --import tsx --env-file=.env --test src/lib/influencerStore.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/influencerStore.ts src/lib/influencerStore.test.ts
git commit -m "feat(campaign-task): 핸들 변경 시 campaign_task.influencer_handle도 같은 트랜잭션에서 갱신

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 작업 API — 입력 검증(순수) + 생성·패치·삭제·대상 후보·이미 RT하기로 한 사람

**Files:**
- Modify: `src/lib/campaignTaskInput.ts` (확장)
- Create: `src/app/api/campaigns/[id]/tasks/route.ts`, `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`, `src/app/api/campaigns/tasks/targets/route.ts`, `src/app/api/campaigns/tasks/targeting/route.ts`
- Test: `src/lib/campaignTaskInput.test.ts`

**Interfaces:**
- Produces (campaignTaskInput.ts):
```ts
export interface TaskCreateBody { type: TaskType; targetTaskId: string | null; targetTweetUrl: string | null; draftId: string | null; scheduledOn: string | null; visitOn: string | null; note: string; cost: TaskCost | null; influencers: Array<{ handle: string; cost: TaskCost | null }> }
export function parseTaskCreate(body: unknown): Parsed<TaskCreateBody>
export interface TaskPatchBody extends TaskPatch {}   // campaignTaskStore.TaskPatch와 같은 모양(검증 통과분만 키 존재)
export function parseTaskPatch(body: unknown): Parsed<TaskPatch>
export function normalizeTargetTweetUrl(v: string): string | null   // parseTweetLink → tweetPermalink(핸들 있으면 유지, 없으면 /i/status/)
export const TASK_TYPE_MESSAGE = '작업 유형 값이 올바르지 않아요';
export const TARGET_MESSAGE = 'RT 대상 링크가 X 게시물 주소가 아니에요';
export const TARGET_TYPE_MESSAGE = 'RT 작업은 대상이 될 수 없어요 — 투고·인용RT·방문협찬 작업을 골라 주세요';
export const TARGET_SELF_MESSAGE = '작업이 자기 자신을 대상으로 가질 수 없어요';
export const VISIT_ON_MESSAGE = '방문일은 방문협찬 작업에만 있어요';
export const DRAFT_MULTI_MESSAGE = '원고는 한 사람에게만 붙일 수 있어요 — 인플루언서를 한 명만 고르거나 원고를 빼 주세요';
export const POSTED_AT_NULL_MESSAGE = '게시 확인은 지울 수 없어요 — 잘못 찍었으면 작업을 삭제하고 다시 만들어 주세요';
export const REMOVED_WITHOUT_POSTED_MESSAGE = '게시 확인이 없는 작업이에요 — 게시 내림은 게시된 작업에만 표시할 수 있어요';
export const DATE_MESSAGE = '날짜는 YYYY-MM-DD 형식이어야 해요';
```
- 라우트 응답: POST tasks → `{ tasks: TaskRow[] }` · PATCH → `TaskRow` · DELETE → `{ ok: true, deleted: boolean }` · GET targets → `TargetCandidate[]` · GET targeting → `{ handles: string[] }`.

- [ ] **Step 1: 실패 테스트** `src/lib/campaignTaskInput.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskCreate, parseTaskPatch, normalizeTargetTweetUrl, parseTaskIdPatch, TASK_TYPE_MESSAGE, TARGET_MESSAGE, VISIT_ON_MESSAGE, DRAFT_MULTI_MESSAGE, POSTED_AT_NULL_MESSAGE, DATE_MESSAGE } from './campaignTaskInput.ts';

const U = '11111111-1111-1111-1111-111111111111';

test('생성 — 정규화된 핸들·비용, 대상 링크 permalink 정규화, 빈 인플 허용, 오류 문구', () => {
  const ok = parseTaskCreate({ type: 'rt', targetTweetUrl: 'twitter.com/Mika/status/123?s=20', influencers: [{ handle: '@Rio', cost: { amount: '3,000', currency: 'JPY' } }, { handle: 'sora' }], scheduledOn: '2026-09-03', note: ' 메모 ' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.targetTweetUrl, 'https://x.com/Mika/status/123');
    assert.deepEqual(ok.value.influencers, [{ handle: 'Rio', cost: { amount: 3000, currency: 'JPY' } }, { handle: 'sora', cost: null }]);
    assert.equal(ok.value.note, '메모'); assert.equal(ok.value.draftId, null); assert.equal(ok.value.visitOn, null); assert.equal(ok.value.cost, null);
  }
  assert.ok(parseTaskCreate({ type: 'post', influencers: [] }).ok);
  assert.ok(parseTaskCreate({ type: 'post' }).ok);   // influencers 생략 = []
  assert.deepEqual(parseTaskCreate({ type: 'x' }), { ok: false, message: TASK_TYPE_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'rt', targetTweetUrl: 'https://example.com' }), { ok: false, message: TARGET_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'rt', visitOn: '2026-09-01' }), { ok: false, message: VISIT_ON_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'post', draftId: U, influencers: [{ handle: 'a' }, { handle: 'b' }] }), { ok: false, message: DRAFT_MULTI_MESSAGE });
  assert.deepEqual(parseTaskCreate({ type: 'post', scheduledOn: '2026-9-1' }), { ok: false, message: DATE_MESSAGE });
  assert.equal(parseTaskCreate({ type: 'post', influencers: [{ handle: 'bad handle!' }] }).ok, false);
  assert.equal(parseTaskCreate({ type: 'rt', targetTaskId: 'nope' }).ok, false);
  assert.equal(parseTaskCreate({ type: 'visit', visitOn: '2026-09-10', influencers: [{ handle: 'h' }] }).ok, true);
});

test('패치 — 온 키만, null=지움, postedAt null 거절, removedReason trim', () => {
  const p = parseTaskPatch({ scheduledOn: null, cost: { amount: 1, currency: 'KRW' }, removedAt: '2026-09-05', removedReason: ' 본인 요청 ', postUrl: 'x.com/a/status/9' });
  assert.ok(p.ok);
  if (p.ok) {
    assert.deepEqual(p.value, { scheduledOn: null, cost: { amount: 1, currency: 'KRW' }, removedAt: '2026-09-05', removedReason: '본인 요청', postUrl: 'https://x.com/a/status/9' });
    assert.equal('note' in p.value, false);
  }
  assert.deepEqual(parseTaskPatch({ postedAt: null }), { ok: false, message: POSTED_AT_NULL_MESSAGE });
  assert.ok(parseTaskPatch({ postedAt: '2026-09-01' }).ok);
  assert.ok(parseTaskPatch({ influencerHandle: null }).ok);
  assert.equal(parseTaskPatch({ influencerHandle: 'bad handle' }).ok, false);
  assert.equal(parseTaskPatch({}).ok, true);
  assert.equal(normalizeTargetTweetUrl('https://x.com/i/web/status/55'), 'https://x.com/i/status/55');
  assert.equal(normalizeTargetTweetUrl('nope'), null);
  assert.deepEqual(parseTaskIdPatch(undefined), { ok: true, value: undefined });
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file=.env --test src/lib/campaignTaskInput.test.ts`.

- [ ] **Step 3: campaignTaskInput.ts 확장**

```ts
import type { Parsed, TaskCost } from './campaignCost.ts';
import { parseTaskCost } from './campaignCost.ts';
import { isTaskType, isDateOnlyString, type TaskType } from './campaignJudgment.ts';
import type { TaskPatch } from './campaignTaskStore.ts';
import { parseTweetLink, tweetPermalink } from './tweetLink.ts';
import { parseXHandle, handleParseMessage } from './xHandle.ts';
import { isUuidLike } from './uuid.ts';

export const TASK_TYPE_MESSAGE = '작업 유형 값이 올바르지 않아요';
export const TARGET_MESSAGE = 'RT 대상 링크가 X 게시물 주소가 아니에요';
export const TARGET_TYPE_MESSAGE = 'RT 작업은 대상이 될 수 없어요 — 투고·인용RT·방문협찬 작업을 골라 주세요';
export const TARGET_SELF_MESSAGE = '작업이 자기 자신을 대상으로 가질 수 없어요';
export const VISIT_ON_MESSAGE = '방문일은 방문협찬 작업에만 있어요';
export const DRAFT_MULTI_MESSAGE = '원고는 한 사람에게만 붙일 수 있어요 — 인플루언서를 한 명만 고르거나 원고를 빼 주세요';
export const POSTED_AT_NULL_MESSAGE = '게시 확인은 지울 수 없어요 — 잘못 찍었으면 작업을 삭제하고 다시 만들어 주세요';
export const REMOVED_WITHOUT_POSTED_MESSAGE = '게시 확인이 없는 작업이에요 — 게시 내림은 게시된 작업에만 표시할 수 있어요';
export const DATE_MESSAGE = '날짜는 YYYY-MM-DD 형식이어야 해요';
const fail = <T,>(message: string): Parsed<T> => ({ ok: false, message });

// 사용자가 붙인 X 링크 → 정규형 permalink(x.com/twitter.com·꼬리 무관). 핸들이 있으면 보존, 없으면 /i/status/.
export function normalizeTargetTweetUrl(v: string): string | null {
  const p = parseTweetLink(v);
  if (!p.ok) return null;
  const m = /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\//i.exec(v);
  const handle = m && m[1].toLowerCase() !== 'i' ? m[1] : null;
  return tweetPermalink(handle, p.tweetId);
}
const dateOrNull = (v: unknown): Parsed<string | null> => {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  return isDateOnlyString(v) ? { ok: true, value: v } : fail(DATE_MESSAGE);
};
const uuidOrNull = (v: unknown, message: string): Parsed<string | null> => {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  return typeof v === 'string' && isUuidLike(v) ? { ok: true, value: v } : fail(message);
};

export interface TaskCreateBody {
  type: TaskType; targetTaskId: string | null; targetTweetUrl: string | null; draftId: string | null;
  scheduledOn: string | null; visitOn: string | null; note: string; cost: TaskCost | null;
  influencers: Array<{ handle: string; cost: TaskCost | null }>;
}
export function parseTaskCreate(body: unknown): Parsed<TaskCreateBody> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isTaskType(b.type)) return fail(TASK_TYPE_MESSAGE);
  const targetTaskId = uuidOrNull(b.targetTaskId, TASK_ID_MESSAGE); if (!targetTaskId.ok) return targetTaskId;
  let targetTweetUrl: string | null = null;
  if (typeof b.targetTweetUrl === 'string' && b.targetTweetUrl.trim()) {
    targetTweetUrl = normalizeTargetTweetUrl(b.targetTweetUrl);
    if (!targetTweetUrl) return fail(TARGET_MESSAGE);
  }
  const draftId = uuidOrNull(b.draftId, TASK_ID_MESSAGE); if (!draftId.ok) return draftId;
  const scheduledOn = dateOrNull(b.scheduledOn); if (!scheduledOn.ok) return scheduledOn;
  const visitOn = dateOrNull(b.visitOn); if (!visitOn.ok) return visitOn;
  if (visitOn.value && b.type !== 'visit') return fail(VISIT_ON_MESSAGE);
  const cost = b.cost === undefined ? { ok: true as const, value: null } : parseTaskCost(b.cost); if (!cost.ok) return cost;
  const raw = Array.isArray(b.influencers) ? b.influencers : [];
  const influencers: TaskCreateBody['influencers'] = [];
  for (const it of raw) {
    const o = (it ?? {}) as { handle?: unknown; cost?: unknown };
    const h = parseXHandle(String(o.handle ?? ''));
    if (!h.ok) return fail(handleParseMessage(h.reason));
    const c = o.cost === undefined ? { ok: true as const, value: null } : parseTaskCost(o.cost); if (!c.ok) return c;
    influencers.push({ handle: h.handle, cost: c.value });
  }
  if (draftId.value && influencers.length > 1) return fail(DRAFT_MULTI_MESSAGE);
  return { ok: true, value: {
    type: b.type, targetTaskId: targetTaskId.value, targetTweetUrl, draftId: draftId.value,
    scheduledOn: scheduledOn.value, visitOn: visitOn.value, note: typeof b.note === 'string' ? b.note.trim() : '', cost: cost.value, influencers,
  } };
}

// 온 키만 결과에 실린다(undefined=건드리지 않음) — 스토어 updateTask의 3값 규칙과 맞물린다
export function parseTaskPatch(body: unknown): Parsed<TaskPatch> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: TaskPatch = {};
  if ('influencerHandle' in b) {
    if (b.influencerHandle === null) out.influencerHandle = null;
    else { const h = parseXHandle(String(b.influencerHandle ?? '')); if (!h.ok) return fail(handleParseMessage(h.reason)); out.influencerHandle = h.handle; }
  }
  if ('targetTaskId' in b) { const r = uuidOrNull(b.targetTaskId, TASK_ID_MESSAGE); if (!r.ok) return r; out.targetTaskId = r.value; }
  if ('targetTweetUrl' in b) {
    if (b.targetTweetUrl === null || b.targetTweetUrl === '') out.targetTweetUrl = null;
    else { const u = normalizeTargetTweetUrl(String(b.targetTweetUrl)); if (!u) return fail(TARGET_MESSAGE); out.targetTweetUrl = u; }
  }
  if ('postUrl' in b) {
    if (b.postUrl === null || b.postUrl === '') out.postUrl = null;
    else { const u = normalizeTargetTweetUrl(String(b.postUrl)); if (!u) return fail(TARGET_MESSAGE); out.postUrl = u; }
  }
  if ('postedAt' in b) {
    if (b.postedAt === null) return fail(POSTED_AT_NULL_MESSAGE);
    if (!isDateOnlyString(b.postedAt)) return fail(DATE_MESSAGE);
    out.postedAt = b.postedAt; out.postedSource = 'manual';   // 사람이 찍는 경로는 항상 manual — 클라가 source를 정하지 못한다
  }
  if ('removedAt' in b) { const r = dateOrNull(b.removedAt); if (!r.ok) return r; out.removedAt = r.value; }
  if ('removedReason' in b) out.removedReason = typeof b.removedReason === 'string' ? b.removedReason.trim() : '';
  if ('scheduledOn' in b) { const r = dateOrNull(b.scheduledOn); if (!r.ok) return r; out.scheduledOn = r.value; }
  if ('visitOn' in b) { const r = dateOrNull(b.visitOn); if (!r.ok) return r; out.visitOn = r.value; }
  if ('cost' in b) { const c = parseTaskCost(b.cost); if (!c.ok) return c; out.cost = c.value; }
  if ('note' in b) out.note = typeof b.note === 'string' ? b.note.trim() : '';
  return { ok: true, value: out };
}
```
(`parseTaskIdPatch`·기존 상수는 그대로 둔다. `tweetLink.ts`에 `parseTweetLink`가 핸들을 돌려주지 않으므로 위 정규식으로 핸들만 보존한다.)

- [ ] **Step 4: 라우트 4개 작성**

`src/app/api/campaigns/[id]/tasks/route.ts`:
```ts
import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { createTasks, getTask, findTaskByDraft, TaskAttachError } from '@/lib/campaignTaskStore';
import { TARGETABLE_TYPES } from '@/lib/campaignJudgment';
import { parseTaskCreate, TASK_NOT_FOUND_MESSAGE, TARGET_TYPE_MESSAGE, DRAFT_ATTACHED_MESSAGE, TASK_HAS_DRAFT_MESSAGE } from '@/lib/campaignTaskInput';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { getDraft } from '@/lib/draftStore';
import { syncInfluencerOnDraftUpdate } from '@/lib/influencerSync';

const notFound = () => NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });

// 작업 생성(스펙 §6) — 인플 N명이면 N행을 한 트랜잭션에. 대상 작업은 존재·유형(post/quoteRt/visit)까지 확인한다(DB check로는 표현 불가).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const parsed = parseTaskCreate(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const v = parsed.value;
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return notFound();
  if (v.targetTaskId) {
    const target = await getTask(sql, v.targetTaskId);
    if (!target) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 400 });
    if (!TARGETABLE_TYPES.includes(target.type)) return NextResponse.json({ error: TARGET_TYPE_MESSAGE }, { status: 400 });
  }
  let before = null as Awaited<ReturnType<typeof getDraft>>;
  if (v.draftId) {
    before = await getDraft(sql, v.draftId);
    if (!before) return NextResponse.json({ error: '원고를 찾을 수 없어요 — 다른 사람이 삭제했을 수 있어요' }, { status: 400 });
    if (await findTaskByDraft(sql, v.draftId)) return NextResponse.json({ error: DRAFT_ATTACHED_MESSAGE }, { status: 409 });
  }
  try {
    const tasks = await createTasks(sql, id, {
      type: v.type, targetTaskId: v.targetTaskId, targetTweetUrl: v.targetTweetUrl, draftId: v.draftId,
      scheduledOn: v.scheduledOn, visitOn: v.visitOn, note: v.note, createdBy: gate.member.id,
      items: v.influencers.length ? v.influencers : (v.cost ? [{ handle: null, cost: v.cost }] : []),
    });
    // 원고를 붙이며 인플이 바뀌었으면(작업 인플 → 원고) 배정 자동 로그도 남긴다(§5 syncInfluencerOnDraftUpdate)
    if (before && tasks[0].influencerHandle && (before.influencerHandle ?? '').toLowerCase() !== tasks[0].influencerHandle.toLowerCase()) {
      await sql.begin(async (tx0) => syncInfluencerOnDraftUpdate(tx0 as unknown as postgres.Sql, { before: before!, influencerHandle: tasks[0].influencerHandle, status: undefined, actorId: gate.member.id }));
    }
    return NextResponse.json({ tasks });
  } catch (e) {
    if (e instanceof TaskAttachError) {
      const msg = e.code === 'draft-attached' ? DRAFT_ATTACHED_MESSAGE : e.code === 'task-has-draft' ? TASK_HAS_DRAFT_MESSAGE : TASK_NOT_FOUND_MESSAGE;
      return NextResponse.json({ error: msg }, { status: e.code === 'no-task' ? 400 : 409 });
    }
    throw e;
  }
}
```

`src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`:
```ts
import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getTask, updateTask, deleteTask } from '@/lib/campaignTaskStore';
import { TARGETABLE_TYPES } from '@/lib/campaignJudgment';
import { parseTaskPatch, TASK_NOT_FOUND_MESSAGE, TARGET_TYPE_MESSAGE, TARGET_SELF_MESSAGE, VISIT_ON_MESSAGE, REMOVED_WITHOUT_POSTED_MESSAGE } from '@/lib/campaignTaskInput';
import { getDraft, updateDraft } from '@/lib/draftStore';
import { syncInfluencerOnDraftUpdate } from '@/lib/influencerSync';

const notFound = () => NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });

// 작업 패치(스펙 §6) — 3값 규칙. 인플 변경은 붙은 원고에도 전파(값은 하나) + 배정 자동 로그.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return notFound();
  const parsed = parseTaskPatch(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const patch = parsed.value;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return notFound();
  if (patch.visitOn && cur.type !== 'visit') return NextResponse.json({ error: VISIT_ON_MESSAGE }, { status: 400 });
  if (patch.removedAt && !cur.postedAt && !patch.postedAt) return NextResponse.json({ error: REMOVED_WITHOUT_POSTED_MESSAGE }, { status: 400 });
  if (patch.targetTaskId) {
    if (patch.targetTaskId === taskId) return NextResponse.json({ error: TARGET_SELF_MESSAGE }, { status: 400 });
    const target = await getTask(sql, patch.targetTaskId);
    if (!target) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 400 });
    if (!TARGETABLE_TYPES.includes(target.type)) return NextResponse.json({ error: TARGET_TYPE_MESSAGE }, { status: 400 });
    patch.targetTweetUrl = null;   // 작업 참조와 링크는 둘 중 하나
  } else if (patch.targetTweetUrl) {
    patch.targetTaskId = null;
  }
  await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    await updateTask(tx, taskId, patch);
    if (patch.influencerHandle !== undefined && cur.draftId) {
      const before = await getDraft(tx, cur.draftId);
      if (before && (before.influencerHandle ?? '').toLowerCase() !== (patch.influencerHandle ?? '').toLowerCase()) {
        await updateDraft(tx, cur.draftId, { influencerHandle: patch.influencerHandle });
        await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle: patch.influencerHandle, status: undefined, actorId: gate.member.id });
      }
    }
  });
  const updated = await getTask(sql, taskId);
  if (!updated) return notFound();
  return NextResponse.json(updated);
}

// 삭제 — 원고 set null·참조 set null·tracked_post.task_id set null은 FK. 멱등(이미 없으면 deleted:false).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return notFound();
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (cur && cur.campaignId !== id) return notFound();
  return NextResponse.json({ ok: true, deleted: await deleteTask(sql, taskId) });
}
```

`src/app/api/campaigns/tasks/targets/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listTargetCandidates } from '@/lib/campaignTaskStore';

// 대상 고르기 목록(스펙 §4-2) — ?clientId= 기본 필터, ?all=1이면 전체, ?q= 검색. 최근 만든 순 50건.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const clientId = p.get('clientId');
  if (clientId && !isUuidLike(clientId)) return NextResponse.json({ error: '클라이언트 값이 올바르지 않아요' }, { status: 400 });
  const all = p.get('all') === '1';
  return NextResponse.json(await listTargetCandidates(getSql(), { clientId: all ? null : clientId, q: p.get('q') ?? '' }));
}
```

`src/app/api/campaigns/tasks/targeting/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listTargetingHandles } from '@/lib/campaignTaskStore';
import { normalizeTargetTweetUrl } from '@/lib/campaignTaskInput';

// "이 게시물을 이미 RT하기로 한 사람"(스펙 §4-2) — ?taskId= 또는 ?url=
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const taskId = p.get('taskId');
  const url = p.get('url');
  if (taskId && isUuidLike(taskId)) return NextResponse.json({ handles: await listTargetingHandles(getSql(), { taskId }) });
  const norm = url ? normalizeTargetTweetUrl(url) : null;
  if (norm) return NextResponse.json({ handles: await listTargetingHandles(getSql(), { tweetUrl: norm }) });
  return NextResponse.json({ handles: [] });
}
```

- [ ] **Step 5: 통과 확인** — `node --import tsx --env-file=.env --test src/lib/campaignTaskInput.test.ts && npx tsc --noEmit && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/campaignTaskInput.ts src/lib/campaignTaskInput.test.ts src/app/api/campaigns
git commit -m "feat(campaign-task): 작업 API — 입력 검증, POST 생성(N명·원고 붙이기), PATCH 3값(인플 전파·로그), DELETE, 대상 후보·이미 RT하기로 한 사람

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 게시 확인 — 리포스터 판정(순수) + 실행 + 라우트

**Files:**
- Create: `src/lib/checkPosted.ts`, `src/lib/checkPostedRun.ts`, `src/app/api/campaigns/[id]/check-posted/route.ts`
- Test: `src/lib/checkPosted.test.ts`, `src/lib/checkPostedRun.test.ts`

**Interfaces:**
```ts
// checkPosted.ts (순수)
export interface CheckTask { id: string; influencerHandle: string | null; postedAt: string | null; targetTweetId: string | null; targetPending: boolean }
export interface Hit { taskId: string; handle: string }
export type SkipReason = 'no_target' | 'target_not_posted' | 'no_handle';
export interface CheckPostedResult {
  confirmed: Hit[]; pending: Hit[]; skipped: Array<Hit & { reason: SkipReason }>; missing: Hit[];
  unreadable: Array<{ tweetId: string; reason: string }>; partial: string[];
}
export function planChecks(tasks: CheckTask[]): { byTweet: Map<string, CheckTask[]>; skipped: CheckPostedResult['skipped'] }
export function judgeRetweeters(tasks: CheckTask[], retweeterHandles: Iterable<string>): { confirmed: Hit[]; pending: Hit[]; missing: Hit[] }
export function emptyResult(): CheckPostedResult
export function taskToCheck(t: { id; influencerHandle; postedAt; targetTaskId; targetTweetUrl; target: { postUrl } | null }): CheckTask   // targetUrlOf → parseTweetLink
// checkPostedRun.ts
export interface RetweeterSource { getTweetRetweeters(tweetId: string, cursor?: string): Promise<UsersPage> }
export async function runCheckPosted(sql, campaignId: string, deps: { source: RetweeterSource; today: string; maxPages?: number }): Promise<CheckPostedResult>
```
- 라우트 `POST /api/campaigns/[id]/check-posted` → `CheckPostedResult`. 401(`GetxapiAuthError`) 문구 `'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요'`.

- [ ] **Step 1: 순수 테스트** `src/lib/checkPosted.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChecks, judgeRetweeters, taskToCheck, type CheckTask } from './checkPosted.ts';

const t = (o: Partial<CheckTask> & { id: string }): CheckTask => ({ influencerHandle: 'a', postedAt: null, targetTweetId: '1', targetPending: false, ...o });

test('plan — 트윗별 묶음(같은 트윗 두 작업 = 한 그룹), 대상 미정·게시 대기·인플 없음은 건너뜀, 이미 확인된 것도 그룹에 든다(사라짐 감지)', () => {
  const { byTweet, skipped } = planChecks([
    t({ id: 'a', influencerHandle: 'rio' }), t({ id: 'b', influencerHandle: 'sora' }),
    t({ id: 'c', influencerHandle: 'kei', targetTweetId: '2' }),
    t({ id: 'd', influencerHandle: 'x', targetTweetId: null }),
    t({ id: 'e', influencerHandle: 'y', targetTweetId: null, targetPending: true }),
    t({ id: 'f', influencerHandle: null }),
    t({ id: 'g', influencerHandle: 'hana', postedAt: '2026-09-01' }),
  ]);
  assert.deepEqual([...byTweet.keys()], ['1', '2']);
  assert.deepEqual(byTweet.get('1')!.map((x) => x.id), ['a', 'b', 'g']);
  assert.deepEqual(skipped, [
    { taskId: 'd', handle: 'x', reason: 'no_target' }, { taskId: 'e', handle: 'y', reason: 'target_not_posted' }, { taskId: 'f', handle: '', reason: 'no_handle' },
  ]);
});

test('judge — lower 비교, 미확인+있음=confirmed, 미확인+없음=pending, 확인됨+없음=missing, 확인됨+있음=아무 것도 아님', () => {
  const r = judgeRetweeters([
    t({ id: 'a', influencerHandle: 'Rio' }), t({ id: 'b', influencerHandle: 'sora' }),
    t({ id: 'g', influencerHandle: 'hana', postedAt: '2026-09-01' }), t({ id: 'h', influencerHandle: 'ten', postedAt: '2026-09-01' }),
  ], ['rio', 'TEN', 'other']);
  assert.deepEqual(r.confirmed, [{ taskId: 'a', handle: 'Rio' }]);
  assert.deepEqual(r.pending, [{ taskId: 'b', handle: 'sora' }]);
  assert.deepEqual(r.missing, [{ taskId: 'g', handle: 'hana' }]);
});

test('taskToCheck — 대상 URL은 작업 참조의 post_url 우선, 게시 대기 표시', () => {
  assert.deepEqual(taskToCheck({ id: 'a', influencerHandle: 'rio', postedAt: null, targetTaskId: 't', targetTweetUrl: null, target: { postUrl: 'https://x.com/m/status/77' } }),
    { id: 'a', influencerHandle: 'rio', postedAt: null, targetTweetId: '77', targetPending: false });
  assert.deepEqual(taskToCheck({ id: 'b', influencerHandle: 'rio', postedAt: null, targetTaskId: 't', targetTweetUrl: null, target: { postUrl: null } }),
    { id: 'b', influencerHandle: 'rio', postedAt: null, targetTweetId: null, targetPending: true });
  assert.equal(taskToCheck({ id: 'c', influencerHandle: 'rio', postedAt: null, targetTaskId: null, targetTweetUrl: 'https://x.com/i/status/5', target: null }).targetTweetId, '5');
});
```

- [ ] **Step 2: 순수 구현** `src/lib/checkPosted.ts`

```ts
// RT 게시 확인의 판정(스펙 §3) — DB·API 없음. 대상 트윗의 리포스터 목록에 작업 인플이 있으면 확인.
// 인용RT는 별개 게시물이라 리포스터 목록에 안 잡힌다 → 이 판정은 type='rt'에만 쓴다(호출부 checkPostedRun이 고른다).
import { parseTweetLink } from './tweetLink.ts';
import { targetUrlOf, targetStatus } from './campaignJudgment.ts';

export interface CheckTask { id: string; influencerHandle: string | null; postedAt: string | null; targetTweetId: string | null; targetPending: boolean }
export interface Hit { taskId: string; handle: string }
export type SkipReason = 'no_target' | 'target_not_posted' | 'no_handle';
export interface CheckPostedResult {
  confirmed: Hit[]; pending: Hit[]; skipped: Array<Hit & { reason: SkipReason }>; missing: Hit[];
  unreadable: Array<{ tweetId: string; reason: string }>; partial: string[];   // partial = 페이지 상한에 걸려 일부만 본 트윗
}
export const emptyResult = (): CheckPostedResult => ({ confirmed: [], pending: [], skipped: [], missing: [], unreadable: [], partial: [] });

export function taskToCheck(t: {
  id: string; influencerHandle: string | null; postedAt: string | null;
  targetTaskId: string | null; targetTweetUrl: string | null; target: { postUrl: string | null } | null;
}): CheckTask {
  const input = { targetTaskId: t.targetTaskId, targetPostUrl: t.target?.postUrl ?? null, targetTweetUrl: t.targetTweetUrl };
  const url = targetUrlOf(input);
  const parsed = url ? parseTweetLink(url) : null;
  return {
    id: t.id, influencerHandle: t.influencerHandle, postedAt: t.postedAt,
    targetTweetId: parsed && parsed.ok ? parsed.tweetId : null,
    targetPending: targetStatus(input) === 'pending',
  };
}

// 트윗당 1회 호출을 위해 묶는다. 이미 확인된 작업도 그룹에 넣는다 — 목록에서 사라졌는지(내려짐 가능성) 보고하기 위해.
export function planChecks(tasks: CheckTask[]): { byTweet: Map<string, CheckTask[]>; skipped: CheckPostedResult['skipped'] } {
  const byTweet = new Map<string, CheckTask[]>();
  const skipped: CheckPostedResult['skipped'] = [];
  for (const t of tasks) {
    if (!t.influencerHandle) { skipped.push({ taskId: t.id, handle: '', reason: 'no_handle' }); continue; }
    if (!t.targetTweetId) { skipped.push({ taskId: t.id, handle: t.influencerHandle, reason: t.targetPending ? 'target_not_posted' : 'no_target' }); continue; }
    const g = byTweet.get(t.targetTweetId) ?? [];
    g.push(t);
    byTweet.set(t.targetTweetId, g);
  }
  return { byTweet, skipped };
}

export function judgeRetweeters(tasks: CheckTask[], retweeterHandles: Iterable<string>): { confirmed: Hit[]; pending: Hit[]; missing: Hit[] } {
  const set = new Set<string>();
  for (const h of retweeterHandles) set.add(h.replace(/^@/, '').toLowerCase());
  const out = { confirmed: [] as Hit[], pending: [] as Hit[], missing: [] as Hit[] };
  for (const t of tasks) {
    if (!t.influencerHandle) continue;
    const has = set.has(t.influencerHandle.toLowerCase());
    const hit = { taskId: t.id, handle: t.influencerHandle };
    if (t.postedAt === null) (has ? out.confirmed : out.pending).push(hit);
    else if (!has) out.missing.push(hit);
  }
  return out;
}
```

- [ ] **Step 3: 실행 테스트** `src/lib/checkPostedRun.test.ts` (실 DB + 가짜 소스)

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, getTask, updateTask } from './campaignTaskStore.ts';
import { runCheckPosted } from './checkPostedRun.ts';

const sql = getSql();
const P = 'tchk' + process.pid;
after(async () => {
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('run — 트윗당 1회(+페이지), 확인은 저장(auto), 사라짐은 보고만, 대상 미정 건너뜀, 읽기 실패는 그 트윗만', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'a', nameEn: `${P.toLowerCase()}-a`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const [post] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: null }] });
  await updateTask(sql, post.id, { postUrl: 'https://x.com/mika/status/1001' });
  const [rtA, rtB] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'Rio', cost: null }, { handle: 'sora', cost: null }] });
  const [rtDone] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'hana', cost: null }] });
  await updateTask(sql, rtDone.id, { postedAt: '2026-09-01', postedSource: 'manual' });
  const [rtNone] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: 'ten', cost: null }] });
  const [rtBad] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTweetUrl: 'https://x.com/i/status/4040', items: [{ handle: 'kei', cost: null }] });
  await createTasks(sql, camp.id, { ...tin, type: 'quoteRt', targetTaskId: post.id, items: [{ handle: 'yuna', cost: null }] });   // 인용RT는 대상 아님

  const calls: string[] = [];
  const source = {
    async getTweetRetweeters(tweetId: string, cursor?: string) {
      calls.push(`${tweetId}:${cursor ?? ''}`);
      if (tweetId === '4040') throw Object.assign(new Error('not found'), { status: 404 });
      if (!cursor) return { has_more: true, next_cursor: 'c2', users: [{ userName: 'someone' }] };
      return { has_more: false, next_cursor: null, users: [{ userName: 'RIO' }, { screen_name: 'other' }] };
    },
  };
  const r = await runCheckPosted(sql, camp.id, { source, today: '2026-09-03' });
  assert.deepEqual(calls, ['1001:', '1001:c2', '4040:']);   // 트윗당 묶음, 페이지 넘김, 실패 트윗은 1회
  assert.deepEqual(r.confirmed, [{ taskId: rtA.id, handle: 'Rio' }]);
  assert.deepEqual(r.pending, [{ taskId: rtB.id, handle: 'sora' }]);
  assert.deepEqual(r.missing, [{ taskId: rtDone.id, handle: 'hana' }]);
  assert.deepEqual(r.skipped, [{ taskId: rtNone.id, handle: 'ten', reason: 'no_target' }]);
  assert.equal(r.unreadable.length, 1); assert.equal(r.unreadable[0].tweetId, '4040');
  assert.equal(r.partial.length, 0);
  const a = (await getTask(sql, rtA.id))!;
  assert.equal(a.postedAt, '2026-09-03'); assert.equal(a.postedSource, 'auto');
  assert.equal((await getTask(sql, rtB.id))!.postedAt, null);
  assert.equal((await getTask(sql, rtDone.id))!.postedAt, '2026-09-01');   // 사라졌다고 되돌리지 않는다
  assert.equal((await getTask(sql, rtBad.id))!.postedAt, null);
  // 페이지 상한 — maxPages 1이면 partial에 트윗이 든다
  const r2 = await runCheckPosted(sql, camp.id, { source, today: '2026-09-03', maxPages: 1 });
  assert.deepEqual(r2.partial, ['1001']);
});
```

- [ ] **Step 4: 실행 구현** `src/lib/checkPostedRun.ts`

```ts
import type postgres from 'postgres';
import type { UsersPage } from './getxapi.ts';
import { mapRawUser } from './mappers.ts';
import { listTasksByCampaign, markPosted } from './campaignTaskStore.ts';
import { planChecks, judgeRetweeters, taskToCheck, emptyResult, type CheckPostedResult } from './checkPosted.ts';

// [게시 확인하기](스펙 §3-2) — 이 캠페인의 RT 작업을 대상 트윗별로 묶어 트윗당 1회(+페이지, 상한 maxPages) 조회하고
// 확인된 것만 posted_at을 채운다(auto). 사라진 것은 보고만 한다. 트윗 하나가 실패해도 나머지는 계속.
export interface RetweeterSource { getTweetRetweeters(tweetId: string, cursor?: string): Promise<UsersPage> }

export async function runCheckPosted(
  sql: postgres.Sql, campaignId: string, deps: { source: RetweeterSource; today: string; maxPages?: number },
): Promise<CheckPostedResult> {
  const maxPages = deps.maxPages ?? 5;
  const tasks = (await listTasksByCampaign(sql, campaignId)).filter((t) => t.type === 'rt').map(taskToCheck);
  const result = emptyResult();
  const { byTweet, skipped } = planChecks(tasks);
  result.skipped = skipped;
  for (const [tweetId, group] of byTweet) {
    const handles: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    try {
      do {
        const page = await deps.source.getTweetRetweeters(tweetId, cursor);
        pages += 1;
        for (const u of page.users) { const m = mapRawUser(u); if (m) handles.push(m.handle); }
        cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
        if (cursor && pages >= maxPages) { result.partial.push(tweetId); break; }
      } while (cursor);
    } catch (e) {
      // 인증·잔액 오류는 전체 중단이 맞다(다음 트윗도 똑같이 실패) — 라우트가 401로. 그 외(삭제·비공개·일시 오류)는 이 트윗만 건너뛴다.
      if (e instanceof Error && e.name === 'GetxapiAuthError') throw e;
      result.unreadable.push({ tweetId, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const j = judgeRetweeters(group, handles);
    result.confirmed.push(...j.confirmed);
    result.pending.push(...j.pending);
    result.missing.push(...j.missing);
  }
  if (result.confirmed.length) await markPosted(sql, result.confirmed.map((h) => h.taskId), deps.today, 'auto');
  return result;
}
```

`src/app/api/campaigns/[id]/check-posted/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { runCheckPosted } from '@/lib/checkPostedRun';
import { kstToday } from '@/lib/datetime';

// 비용 유발(트윗당 $0.001) — 버튼 opt-in(UX 원칙 6). 사용량은 getxapi 클라이언트가 'getxapi.retweeters'로 기록한다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  try {
    return NextResponse.json(await runCheckPosted(sql, id, { source: makeClient(), today: kstToday() }));
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 5: 통과 확인** — `node --import tsx --env-file=.env --test src/lib/checkPosted.test.ts src/lib/checkPostedRun.test.ts && npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/checkPosted.ts src/lib/checkPosted.test.ts src/lib/checkPostedRun.ts src/lib/checkPostedRun.test.ts "src/app/api/campaigns/[id]/check-posted"
git commit -m "feat(campaign-task): RT 게시 확인 — 대상 트윗별 리포스터 조회(트윗당 1회·5쪽) → 확인만 저장(auto), 사라짐·건너뜀·읽기 실패 보고

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 브라우저 API 헬퍼(`campaignApi.ts`) 작업 함수

**Files:**
- Modify: `src/lib/campaignApi.ts`

**Interfaces (Produces):**
```ts
export const fetchTasksTargets = (q: { clientId?: string | null; q?: string; all?: boolean }) => call<TargetCandidate[]>(...)
export const fetchTargeting = (t: { taskId: string } | { url: string }) => call<{ handles: string[] }>(...)
export const createTasksApi = (campaignId: string, body: TaskCreateRequest) => call<{ tasks: TaskRow[] }>(...)
export const patchTaskApi = (campaignId: string, taskId: string, body: TaskPatchRequest) => call<TaskRow>(...)
export const deleteTaskApi = (campaignId: string, taskId: string) => call<{ ok: true; deleted: boolean }>(...)
export const checkPostedApi = (campaignId: string) => call<CheckPostedResult>(...)
export const fetchUnattachedDrafts = (clientId: string | null) => call<DraftRow[]>(`/api/drafts?unattached=1${clientId ? `&clientId=${clientId}` : ''}&limit=200`)
export const registerTrackedPostApi = (url: string, taskId?: string) => call<{ created: boolean; row: TrackedPostRow }>('/api/tracking', json('POST', { url, ...(taskId ? { taskId } : {}) }))
export interface TaskCreateRequest { type: TaskType; targetTaskId?: string | null; targetTweetUrl?: string | null; draftId?: string | null; scheduledOn?: string | null; visitOn?: string | null; note?: string; cost?: TaskCost | null; influencers: Array<{ handle: string; cost?: TaskCost | null }> }
export type TaskPatchRequest = { influencerHandle?: string | null; targetTaskId?: string | null; targetTweetUrl?: string | null; postUrl?: string | null; postedAt?: string; removedAt?: string | null; removedReason?: string; scheduledOn?: string | null; visitOn?: string | null; cost?: TaskCost | null; note?: string }
export const deleteCampaignApi = (id) => call<{ ok: true; deleted: boolean; taskCount: number; detachedTargets: number }>(...)
```
- 제거: `fetchCandidateDrafts`, `bulkCampaignApi`, `linkTrackedPostDraftApi`(→ `linkTrackedPostApi(trackedPostId, link: { taskId: string | null } | { draftId: string | null })`). `DraftPatchBody`에 `taskId?: string | null`(Task 4에서 이미).

- [ ] **Step 1: 구현** — 위 함수를 추가하고 제거 대상 3개를 지운다. import에 `TaskRow, TargetCandidate`(campaignTaskStore), `TaskType`(campaignJudgment), `TaskCost`(campaignCost), `CheckPostedResult`(checkPosted) 추가. `AddDraftsModal`·`LinkPostModal`이 지운 함수를 쓰므로 컴파일이 깨진다 → `AddDraftsModal.tsx`는 이 Task에서 `git rm`(Task 5에서 이미 import가 끊겼다), `LinkPostModal.tsx`는 `registerTrackedPostApi(url.trim(), task.id)` 한 번으로 바꾸고 prop을 `task: CampaignTaskItem`으로 — 본문은 Task 14에서 마무리하되 컴파일은 여기서 맞춘다.

- [ ] **Step 2: 확인** — `npx tsc --noEmit && npm run lint`.

- [ ] **Step 3: Commit**

```bash
git add -A src/lib/campaignApi.ts src/app/campaigns/AddDraftsModal.tsx src/app/campaigns/LinkPostModal.tsx
git commit -m "feat(campaign-task): campaignApi 작업 함수(생성·패치·삭제·대상 후보·게시 확인·미부착 원고) + 게시물 등록에 taskId

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 작업 표 — `TaskTable` · `PostedCell` · `useCampaignTaskActions` · 표시 문구

**Files:**
- Modify: `src/lib/campaignTableView.ts` (+test append), `src/components/DraftStatusChip.tsx` (작업 단계 색·스타일)
- Create: `src/app/campaigns/useCampaignTaskActions.ts`, `src/app/campaigns/PostedCell.tsx`, `src/app/campaigns/TaskTable.tsx`
- Modify: `src/app/campaigns/CampaignDetail.tsx` (표 영역 복구)

**Interfaces:**
- Produces (campaignTableView.ts): `taskOverdueDays(t: TaskStageInput, today): number | null` · `taskScheduleLabel(t, today): string` — 예정일 셀 한 줄(`'9/3 수'` · `'8/26 수 · 1일 지남'` · visit: `'방문 9/10 · 게시 미정'`/`'방문 9/10 · 게시 9/12'` · `'미정'`) · `targetLabel(t: TaskRow, campaignId: string): { text: string; sub: string | null; muted: boolean }` — `{text:'@mika_skin 투고', sub: null}` / 다른 캠페인 `{sub:'마인드스킨 8월 4주'}` / URL `{text:'x.com/…/status/123'}` / `{text:'대상 미정', muted:true}` / `{text:'대상 게시 대기', muted:true}` · `typeFooterLabel(byType: TypeSubtotal[]): string` → `'투고 1 · 인용RT 3 · RT 3 · 방문협찬 1'` · `stageTag(t: TaskRow): string | null` — `'자동'`(postedSource auto & stage published) / removedReason(내려짐) / null.
- Produces (DraftStatusChip.tsx): `TASK_STAGE_STYLE: Record<TaskStage, string>`(칩 클래스), `TASK_STAGE_BAR_HEX: Record<TaskStage, string>`(달력 바 색 — 기존 STAGE_BAR_HEX 위에 planned '#94a3ab', visitPending '#f59e0b', visited '#1d9bf0', removed '#64748b').
- Produces (useCampaignTaskActions): `{ patch(t, patch: TaskPatchRequest, optimistic: Partial<CampaignTaskItem>): Promise<boolean>; assignInfluencer(t, handle | null); changeTarget(t, { taskId } | { url } | null); changeScheduledOn(t, next); changeVisitOn(t, next); changeCost(t, next: TaskCost | null); setNote(t, note); markPosted(t, date: string, postUrl?: string); markRemoved(t, date, reason); unmarkRemoved(t); remove(t): Promise<boolean> }` — 낙관적 갱신 + "내가 세팅한 값이 아직 표시 중일 때만 롤백"(useCampaignDraftActions 골격 그대로).
- Produces (TaskTable props): `{ rows: CampaignTaskItem[]; campaign: CampaignRow; today: string; influencerOptions: InfluencerOption[]; sort: TaskSortKey; onSortChange; filter: StageFilter; byType: TypeSubtotal[]; total: MoneyByCurrency; summary: TaskSummary; actions: ReturnType<typeof useCampaignTaskActions>; onOpenDraft(draftId); onAttachDraft(t); onLinkPost(t); onDelete(t); onPickTarget(t) }`.

- [ ] **Step 1: 표시 문구 테스트 append** (`src/lib/campaignTableView.test.ts`)

```ts
import { taskScheduleLabel, targetLabel, typeFooterLabel, stageTag } from './campaignTableView.ts';
test('작업 예정일 셀 — 한 줄, 밀림 접미, 방문협찬은 방문·게시 두 날짜', () => {
  const b = { type: 'rt' as const, draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null };
  assert.equal(taskScheduleLabel({ ...b, scheduledOn: '2026-09-03' }, '2026-09-02'), '9/3 목');
  assert.equal(taskScheduleLabel({ ...b, scheduledOn: '2026-08-26' }, '2026-08-27'), '8/26 수 · 1일 지남');
  assert.equal(taskScheduleLabel(b, '2026-08-27'), '미정');
  assert.equal(taskScheduleLabel({ ...b, type: 'visit', visitOn: '2026-09-10' }, '2026-08-27'), '방문 9/10 목 · 게시 미정');
  assert.equal(taskScheduleLabel({ ...b, type: 'visit', visitOn: '2026-09-10', scheduledOn: '2026-09-12' }, '2026-08-27'), '방문 9/10 목 · 게시 9/12 토');
  assert.equal(taskScheduleLabel({ ...b, type: 'visit' }, '2026-08-27'), '방문 미정 · 게시 미정');
});
test('대상 셀·하단 유형 줄·단계 태그', () => {
  const t = (o: object) => ({ targetTaskId: null, targetTweetUrl: null, target: null, postedSource: null, removedAt: null, removedReason: '', postedAt: null, ...o }) as never;
  assert.deepEqual(targetLabel(t({ targetTaskId: 'x', target: { taskId: 'x', type: 'post', influencerHandle: 'mika', campaignId: 'c1', campaignName: 'A 9월 1주', postUrl: null } }), 'c1'), { text: '@mika 투고', sub: null, muted: false });
  assert.deepEqual(targetLabel(t({ targetTaskId: 'x', target: { taskId: 'x', type: 'quoteRt', influencerHandle: 'yuna', campaignId: 'c0', campaignName: 'A 8월 4주', postUrl: null } }), 'c1'), { text: '@yuna 인용RT', sub: 'A 8월 4주', muted: false });
  assert.deepEqual(targetLabel(t({ targetTweetUrl: 'https://x.com/clinic/status/12345' }), 'c1'), { text: 'x.com/clinic/status/12345', sub: null, muted: false });
  assert.deepEqual(targetLabel(t({}), 'c1'), { text: '대상 미정', sub: null, muted: true });
  assert.equal(typeFooterLabel([{ type: 'rt', count: 3, published: 1, cost: {} }, { type: 'post', count: 1, published: 1, cost: {} }]), 'RT 3 · 투고 1');
  assert.equal(stageTag(t({ postedAt: '2026-09-03', postedSource: 'auto' })), '자동');
  assert.equal(stageTag(t({ postedAt: '2026-09-03', postedSource: 'manual' })), null);
  assert.equal(stageTag(t({ postedAt: '2026-09-03', removedAt: '2026-09-05', removedReason: '본인 요청' })), '본인 요청');
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --env-file=.env --test src/lib/campaignTableView.test.ts`.

- [ ] **Step 3: campaignTableView.ts에 추가**

```ts
import { isTaskOverdue, type TaskStageInput, type TypeSubtotal, TASK_TYPE_LABEL } from './campaignJudgment.ts';
import type { TaskRow } from './campaignTaskStore.ts';

export function taskOverdueDays(t: TaskStageInput, today: string): number | null {
  return isTaskOverdue(t, today) ? daysBetweenDates(t.scheduledOn as string, today) : null;
}
/** 예정일 셀 한 줄(스펙 §4-1). 방문협찬은 '방문 M/D 요일 · 게시 M/D 요일'(둘 다 미정이면 '미정' 표기) */
export function taskScheduleLabel(t: TaskStageInput, today: string): string {
  const od = taskOverdueDays(t, today);
  const sched = t.scheduledOn ? (od !== null ? `${formatDateKo(t.scheduledOn)} · ${overdueSuffix(od)}` : formatDateKo(t.scheduledOn)) : null;
  if (t.type !== 'visit') return sched ?? '미정';
  return `방문 ${t.visitOn ? formatDateKo(t.visitOn) : '미정'} · 게시 ${sched ?? '미정'}`;
}
/** 'RT/인용RT 대상' 셀 — 작업 참조는 '@핸들 유형'(다른 캠페인이면 sub에 캠페인명), 링크는 호스트+경로 축약 */
export function targetLabel(t: Pick<TaskRow, 'targetTaskId' | 'targetTweetUrl' | 'target'>, campaignId: string): { text: string; sub: string | null; muted: boolean } {
  if (t.target) {
    const who = t.target.influencerHandle ? `@${t.target.influencerHandle}` : '미배정';
    return { text: `${who} ${TASK_TYPE_LABEL[t.target.type]}`, sub: t.target.campaignId === campaignId ? null : t.target.campaignName, muted: false };
  }
  if (t.targetTaskId) return { text: '대상 게시 대기', sub: null, muted: true };   // 참조는 있는데 그 작업이 아직 조인되지 않은(삭제 직후) 경우 방어
  if (t.targetTweetUrl) return { text: t.targetTweetUrl.replace(/^https?:\/\//, '').replace(/^www\./, ''), sub: null, muted: false };
  return { text: '대상 미정', sub: null, muted: true };
}
/** 표 하단 유형 줄 — 있는 유형만, TASK_TYPES 순('RT 3 · 투고 1') */
export function typeFooterLabel(byType: TypeSubtotal[]): string {
  return byType.map((s) => `${TASK_TYPE_LABEL[s.type]} ${s.count}`).join(' · ');
}
/** 단계 칩 옆 회색 작은 태그 — 자동 확인 / 내림 사유. 없으면 null */
export function stageTag(t: Pick<TaskRow, 'postedAt' | 'postedSource' | 'removedAt' | 'removedReason'>): string | null {
  if (t.postedAt && t.removedAt) return t.removedReason || null;
  if (t.postedAt && t.postedSource === 'auto') return '자동';
  return null;
}
```
(주의: `targetLabel`에서 참조가 있는데 `target`이 없으면 '대상 게시 대기'로 두되, 정상 경로에서는 `target`이 항상 온다. `targetStatus`의 pending 판정은 `target.postUrl === null`이므로 표에서는 `targetStatus`로 muted를 결정한다 — 컴포넌트에서 `targetStatus({targetTaskId, targetPostUrl: target?.postUrl ?? null, targetTweetUrl}) === 'pending'`이면 text 옆에 `· 게시 전` 회색 표시.)

- [ ] **Step 4: DraftStatusChip.tsx에 작업 단계 스타일 추가**

```ts
import type { TaskStage } from '@/lib/campaignJudgment';
// 작업 단계 칩(작업 스펙 §4-1) — 원고 상태 5종은 STATUS_STYLE 그대로, 작업 고유 단계 4종만 여기서 정한다. 색의 단일 소스.
export const TASK_STAGE_STYLE: Record<TaskStage, string> = {
  ...STATUS_STYLE,
  published: PUBLISHED_STYLE,
  planned: 'border-x-border-strong bg-x-surface text-x-secondary',
  visitPending: 'border-amber-300 bg-amber-50 text-amber-800',
  visited: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  removed: 'border-slate-300 bg-slate-100 text-slate-600',
};
export const TASK_STAGE_BAR_HEX: Record<TaskStage, string> = {
  ...STAGE_BAR_HEX, planned: '#94a3ab', visitPending: '#f59e0b', visited: '#1d9bf0', removed: '#64748b',
};
```

- [ ] **Step 5: `useCampaignTaskActions.ts` 작성**

```ts
'use client';
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import { suggestTaskCost, type TaskCost } from '@/lib/campaignCost';
import { patchTaskApi, deleteTaskApi, type TaskPatchRequest } from '@/lib/campaignApi';

// 작업 편집은 전부 PATCH /api/campaigns/[id]/tasks/[taskId] 하나(스펙 §6). 낙관적 갱신 + "이 요청이 세팅한 값이 아직 표시 중일 때만"
// 롤백/덮어쓰기(useCampaignDraftActions 골격 — 응답은 보낸 순서대로 오지 않는다).
type Item = CampaignTaskItem;
type Optimistic = Partial<Item>;

export function useCampaignTaskActions({ campaignId, setTasks, influencerOptions, show, onChanged }: {
  campaignId: string;
  setTasks: Dispatch<SetStateAction<Item[]>>;
  influencerOptions: InfluencerOption[];   // pricing 포함 — 배정 시 비용 제안
  show: (message: string) => void;
  onChanged: () => void;                   // 목록(왼쪽)의 작업 수·합계가 바뀌는 변경 뒤
}) {
  const patch = useCallback(async (t: Item, body: TaskPatchRequest, optimistic: Optimistic): Promise<boolean> => {
    const keys = Object.keys(optimistic) as Array<keyof Item>;
    const stillMine = (x: Item) => keys.every((k) => JSON.stringify(x[k]) === JSON.stringify(optimistic[k]));
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, ...optimistic } : x)));
    const r = await patchTaskApi(campaignId, t.id, body);
    if (r.ok) {
      // 응답은 TaskRow — published/perf/linkClicks는 이 PATCH로 바뀌지 않으니 기존 값을 유지한 채 덮는다(published만 postedAt에서 다시)
      setTasks((cur) => cur.map((x) => (x.id === t.id && stillMine(x) ? { ...x, ...r.data, published: r.data.postedAt !== null } : x)));
      return true;
    }
    setTasks((cur) => cur.map((x) => {
      if (x.id !== t.id || !stillMine(x)) return x;
      const back: Item = { ...x };
      for (const k of keys) Object.assign(back, { [k]: t[k] });
      return back;
    }));
    show(r.error);
    return false;
  }, [campaignId, setTasks, show]);

  return useMemo(() => ({
    patch,
    // 배정·변경 시 비용 제안 — 비어 있을 때만 자동(사람이 적은 값은 덮지 않는다). 금액 = pricing[작업 유형].
    assignInfluencer: async (t: Item, handle: string | null) => {
      const opt = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
      const suggested = !t.cost && opt ? suggestTaskCost(opt.pricing, t.type) : null;
      const body: TaskPatchRequest = { influencerHandle: handle, ...(suggested ? { cost: suggested } : {}) };
      const ok = await patch(t, body, { influencerHandle: handle, ...(suggested ? { cost: suggested } : {}) });
      if (ok) onChanged();
      return ok;
    },
    changeTarget: (t: Item, next: { taskId: string } | { url: string } | null) => {
      if (next === null) return patch(t, { targetTaskId: null, targetTweetUrl: null }, { targetTaskId: null, targetTweetUrl: null, target: null });
      if ('taskId' in next) return patch(t, { targetTaskId: next.taskId }, { targetTaskId: next.taskId, targetTweetUrl: null });
      return patch(t, { targetTweetUrl: next.url }, { targetTweetUrl: next.url, targetTaskId: null, target: null });
    },
    changeScheduledOn: (t: Item, next: string | null) => patch(t, { scheduledOn: next }, { scheduledOn: next }),
    changeVisitOn: (t: Item, next: string | null) => patch(t, { visitOn: next }, { visitOn: next }),
    changeCost: async (t: Item, next: TaskCost | null) => { const ok = await patch(t, { cost: next }, { cost: next }); if (ok) onChanged(); return ok; },
    setNote: (t: Item, note: string) => patch(t, { note }, { note }),
    markPosted: async (t: Item, date: string, postUrl?: string) => {
      const ok = await patch(t, { postedAt: date, ...(postUrl ? { postUrl } : {}) }, { postedAt: date, postedSource: 'manual', published: true, ...(postUrl ? { postUrl } : {}) });
      if (ok) onChanged();
      return ok;
    },
    markRemoved: (t: Item, date: string, reason: string) => patch(t, { removedAt: date, removedReason: reason }, { removedAt: date, removedReason: reason }),
    unmarkRemoved: (t: Item) => patch(t, { removedAt: null, removedReason: '' }, { removedAt: null, removedReason: '' }),
    // 삭제 — 행이 사라지는 변경이라 목록 복원으로 되돌린다
    remove: async (t: Item) => {
      setTasks((cur) => cur.filter((x) => x.id !== t.id));
      const r = await deleteTaskApi(campaignId, t.id);
      if (r.ok) { show('작업을 지웠어요 — 원고는 남아 있어요'); onChanged(); return true; }
      setTasks((cur) => (cur.some((x) => x.id === t.id) ? cur : [...cur, t]));
      show(r.error);
      return false;
    },
  }), [patch, campaignId, influencerOptions, onChanged, setTasks, show]);
}
```

- [ ] **Step 6: `PostedCell.tsx` 작성** — 단계 칩 + 팝오버(게시 전: 오늘 게시됨/날짜/링크 · 게시 후: 게시 내림 · 내림 후: 내림 취소). CostPopover와 같은 body 포털 골격.

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import { taskStage, TASK_STAGE_LABEL, isDateOnlyString, formatDateKo } from '@/lib/campaignJudgment';
import { TASK_STAGE_STYLE } from '@/components/DraftStatusChip';
import { stageTag } from '@/lib/campaignTableView';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { DATE_MESSAGE } from '@/lib/campaignTaskInput';

// 단계 셀(스펙 §3-4·§4-1) — 칩은 값만('게시됨 9/3'), 부가 정보는 회색 태그. 클릭하면 상태에 맞는 동작만 보이는 팝오버.
// 게시 확인은 되돌리지 않는다 — 잘못 찍었으면 작업을 삭제하고 다시(안내 문구로 말한다).
const POP_W = 320;
const POP_H = 260;

export function PostedCell({ task, today, onMarkPosted, onMarkRemoved, onUnmarkRemoved }: {
  task: CampaignTaskItem; today: string;
  onMarkPosted: (date: string, postUrl?: string) => void;
  onMarkRemoved: (date: string, reason: string) => void;
  onUnmarkRemoved: () => void;
}) {
  const stage = taskStage(task, today);
  const tag = stageTag(task);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [date, setDate] = useState(today);
  const [url, setUrl] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const flip = below + POP_H > window.innerHeight && r.top - POP_H - 4 > 0;
    setPos({ top: flip ? r.top - POP_H - 4 : below, left });
  }, []);
  const close = useCallback(() => { if (popRef.current?.contains(document.activeElement)) btnRef.current?.focus(); setOpen(false); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { const t = e.target as Node | null; if (!t || popRef.current?.contains(t) || btnRef.current?.contains(t)) return; close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.isComposing) return; e.stopPropagation(); close(); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown); document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [open, close, place]);

  function openPop() { setDate(today); setUrl(''); setReason(task.removedReason); setErr(''); place(); setOpen(true); }
  const label = stage === 'published' ? `게시됨 ${formatDateKo(task.postedAt as string)}` : stage === 'removed' ? `내려짐 ${formatDateKo(task.removedAt as string)}` : TASK_STAGE_LABEL[stage];
  const input = 'mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';

  function submitPosted() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    const u = url.trim();
    if (u) { const p = parseTweetLink(u); if (!p.ok) { setErr(tweetLinkParseMessage(p.reason)); return; } }
    onMarkPosted(date, u || undefined); close();
  }
  function submitRemoved() {
    if (!isDateOnlyString(date)) { setErr(DATE_MESSAGE); return; }
    onMarkRemoved(date, reason.trim()); close();
  }

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <button ref={btnRef} type="button" onClick={() => (open ? close() : openPop())} aria-haspopup="dialog" aria-expanded={open}
                title={task.postedAt ? '게시 확인됨 — 눌러서 게시 내림 표시' : '눌러서 게시 확인'}
                className={`rounded-md border px-2.5 py-1 text-ui font-medium hover:brightness-95 ${TASK_STAGE_STYLE[stage]}`}>{label}</button>
        {tag && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">{tag}</span>}
      </span>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="게시 확인" style={{ top: pos.top, left: pos.left, width: POP_W }} onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          {!task.postedAt ? (
            <>
              <p className="text-ui font-bold">게시 확인</p>
              <p className="mt-0.5 text-ui text-x-muted">게시된 날을 적으면 이 작업이 게시됨으로 바뀌고 정산 후보가 돼요</p>
              <label className="mt-2 block text-ui text-x-secondary">게시된 날<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} className={input} /></label>
              {task.type !== 'rt' && (
                <label className="mt-2 block text-ui text-x-secondary">게시물 링크 <span className="text-x-muted">선택</span>
                  <input value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="https://x.com/계정/status/…" className={input} />
                </label>
              )}
              {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">취소</button>
                <button type="button" onClick={submitPosted} className="rounded-full bg-x-blue px-3 py-1 text-ui font-bold text-white hover:bg-x-blue-hover">게시됨으로 표시</button>
              </div>
            </>
          ) : !task.removedAt ? (
            <>
              <p className="text-ui font-bold">게시 내림 표시</p>
              <p className="mt-0.5 text-ui text-x-muted">게시 확인은 그대로 남고 "내려짐"이 붙어요 — 정산할지는 정산 화면에서 판단해요</p>
              <label className="mt-2 block text-ui text-x-secondary">내려진 날<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setErr(''); }} className={input} /></label>
              <label className="mt-2 block text-ui text-x-secondary">사유 <span className="text-x-muted">선택</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="본인 요청" className={input} /></label>
              {task.postUrl && <a href={task.postUrl} target="_blank" rel="noreferrer" className="mt-2 block text-ui text-x-blue-text hover:underline">게시물 보기 ↗</a>}
              {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">취소</button>
                <button type="button" onClick={submitRemoved} className="rounded-full bg-x-text px-3 py-1 text-ui font-bold text-white hover:opacity-90">내려짐으로 표시</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-ui font-bold">내려짐 {formatDateKo(task.removedAt)}</p>
              {task.removedReason && <p className="mt-0.5 text-ui text-x-secondary">{task.removedReason}</p>}
              <p className="mt-1 text-ui text-x-muted">잘못 표시했으면 취소할 수 있어요</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">닫기</button>
                <button type="button" onClick={() => { onUnmarkRemoved(); close(); }} className="rounded-full border border-x-border-strong px-3 py-1 text-ui font-bold hover:bg-x-hover">내림 취소</button>
              </div>
            </>
          )}
        </div>, document.body)}
    </>
  );
}
```

- [ ] **Step 7: `TaskTable.tsx` 작성** — 시안 `task-table-v4.html` 그대로. 열 7: 유형 110 · 인플 180 · 원고 나머지 · RT/인용RT 대상 250 · 예정일 170 · 단계 170 · 비용 180(우측).

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignTaskItem, CampaignRow } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { MoneyByCurrency } from '@/lib/campaignCost';
import { InfluencerChip } from '@/components/InfluencerChip';
import { CostPopover } from '@/components/CostPopover';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { PostedCell } from './PostedCell';
import { suggestTaskCost, formatAmount, formatMoneyBy, type TaskCost } from '@/lib/campaignCost';
import {
  sortTasks, matchesTaskFilter, isTaskUnused, isOutOfRange, targetStatus, TARGETING_TYPES,
  TASK_TYPE_LABEL, TASK_SORT_LABEL, STAGE_FILTER_LABEL, type TaskSortKey, type StageFilter, type TypeSubtotal, type TaskSummary,
} from '@/lib/campaignJudgment';
import { taskOverdueDays, targetLabel, typeFooterLabel, handleInitial } from '@/lib/campaignTableView';
import type { useCampaignTaskActions } from './useCampaignTaskActions';

// 작업 표(스펙 §4-1, 시안 task-table-v4) — 표 하나·열 7개 고정·행은 만든 순(밀림은 자리 그대로 강조만).
// 판정은 campaignJudgment, 문구는 campaignTableView, 여기는 그리기만. 저장은 actions(PATCH tasks/[taskId]).
// 연한 글씨 규칙(koo 08-28): 흐린 행 = 미사용 원고 작업만 · 내려짐 행은 일반 진하기 · 값 없는 칸만 '—' 연하게.
const SORT_KEYS: TaskSortKey[] = ['created', 'scheduled', 'stage', 'influencer'];
const TH = 'px-3.5 py-2 font-normal';
const TD = 'px-3.5 py-3.5 align-middle';
const MIN_TABLE_WIDTH = 1200;
const TYPE_CHIP: Record<string, string> = {
  post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', rt: 'bg-[#e6f6ee] text-[#15803d]', visit: 'bg-[#fff4e5] text-[#b45309]',
};
const MENU_W = 176; const MENU_H = 96;

function RowMenu({ onOpenDraft, onDelete }: { onOpenDraft: (() => void) | null; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect(); if (!r) return;
    const left = Math.min(Math.max(8, r.right - MENU_W), Math.max(8, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 4; const flip = below + MENU_H > window.innerHeight && r.top - MENU_H - 4 > 0;
    setPos({ top: flip ? r.top - MENU_H - 4 : below, left });
  }, []);
  const close = useCallback(() => { if (menuRef.current?.contains(document.activeElement)) btnRef.current?.focus(); setOpen(false); }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { const t = e.target as Node | null; if (!t || menuRef.current?.contains(t) || btnRef.current?.contains(t)) return; close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.isComposing) return; e.stopPropagation(); close(); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown); document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  }, [open, close, place]);
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => { if (open) { close(); return; } place(); setOpen(true); }} aria-haspopup="menu" aria-expanded={open} aria-label="행 메뉴"
              className="cursor-pointer rounded px-1.5 text-x-muted hover:bg-x-border hover:text-x-text">···</button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ top: pos.top, left: pos.left, width: MENU_W }} onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
          {onOpenDraft && <button type="button" role="menuitem" onClick={() => { close(); onOpenDraft(); }} className="block w-full rounded px-2.5 py-1.5 text-left text-ui hover:bg-x-hover">원고 열기</button>}
          <button type="button" role="menuitem" onClick={() => { close(); onDelete(); }} className="block w-full rounded px-2.5 py-1.5 text-left text-ui text-red-700 hover:bg-red-50">작업 삭제</button>
        </div>, document.body)}
    </>
  );
}

export function TaskTable({ rows, campaign, today, influencerOptions, sort, onSortChange, filter, byType, total, summary, actions, onOpenDraft, onAttachDraft, onPickTarget, onDelete }: {
  rows: CampaignTaskItem[]; campaign: CampaignRow; today: string; influencerOptions: InfluencerOption[];
  sort: TaskSortKey; onSortChange: (k: TaskSortKey) => void; filter: StageFilter;
  byType: TypeSubtotal[]; total: MoneyByCurrency; summary: TaskSummary;
  actions: ReturnType<typeof useCampaignTaskActions>;
  onOpenDraft: (draftId: string) => void; onAttachDraft: (t: CampaignTaskItem) => void;
  onPickTarget: (t: CampaignTaskItem) => void; onDelete: (t: CampaignTaskItem) => void;
}) {
  const shown = sortTasks(rows.filter((t) => matchesTaskFilter(t, filter, today)), sort, today);
  const optionFor = (handle: string | null) => (handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined);
  const empty = (text: string) => <p className="mt-4 rounded-xl bg-x-surface px-4 py-6 text-center text-content text-x-secondary">{text}</p>;

  return (
    <section className="mt-3">
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
        <label className="flex shrink-0 items-center gap-1.5 text-ui text-x-secondary">정렬
          <select value={sort} onChange={(e) => onSortChange(e.target.value as TaskSortKey)} aria-label="작업 정렬"
                  className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue">
            {SORT_KEYS.map((k) => <option key={k} value={k}>{TASK_SORT_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      {rows.length === 0 ? empty('아직 이 캠페인에 작업이 없어요 — 위의 [+ 작업 추가]로 투고·인용RT·RT·방문협찬을 올려요.')
       : shown.length === 0 ? empty(`'${STAGE_FILTER_LABEL[filter]}'에 해당하는 작업이 없어요.`)
       : (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="table-fixed text-content" style={{ width: `max(${MIN_TABLE_WIDTH}px, 100%)` }}>
            <colgroup>
              <col style={{ width: 110 }} /><col style={{ width: 180 }} /><col /><col style={{ width: 250 }} />
              <col style={{ width: 170 }} /><col style={{ width: 190 }} /><col style={{ width: 190 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-x-border text-left text-ui text-x-muted">
                <th className={TH}>유형</th><th className={TH}>인플루언서</th><th className={TH}>원고</th><th className={TH}>RT/인용RT 대상</th>
                <th className={TH}>예정일</th><th className={TH}>단계</th><th className={`${TH} text-right`}>비용</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const unused = isTaskUnused(t);
                const od = taskOverdueDays(t, today);
                const tgt = targetLabel(t, campaign.id);
                const tStatus = targetStatus({ targetTaskId: t.targetTaskId, targetPostUrl: t.target?.postUrl ?? null, targetTweetUrl: t.targetTweetUrl });
                const suggestion = suggestTaskCost(optionFor(t.influencerHandle)?.pricing, t.type);
                return (
                  <tr key={t.id} className={`border-b border-x-border ${od !== null ? 'bg-red-50 shadow-[inset_3px_0_0_0_#dc2626]' : 'hover:bg-x-hover'} ${unused ? 'opacity-60' : ''}`}>
                    <td className={TD}><span className={`inline-block min-w-[64px] rounded-full px-2.5 py-1 text-center text-ui ${TYPE_CHIP[t.type]}`}>{TASK_TYPE_LABEL[t.type]}</span></td>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        {t.influencerHandle && <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-x-border-strong text-ui font-bold text-white">{handleInitial(t.influencerHandle)}</span>}
                        <InfluencerChip handle={t.influencerHandle} options={influencerOptions} onChange={(next) => void actions.assignInfluencer(t, next)} />
                      </span>
                    </td>
                    <td className={`${TD} min-w-0`}>
                      {t.type === 'rt' ? <span className="text-x-muted">—</span>
                        : t.draftId ? <button type="button" onClick={() => onOpenDraft(t.draftId as string)} className="block max-w-full truncate text-left font-medium hover:underline" title={t.draftLabel ?? ''}>{t.draftLabel ?? '(제목 없음)'}</button>
                        : <button type="button" onClick={() => onAttachDraft(t)} className="text-x-muted hover:text-x-secondary hover:underline">원고 없음 · 붙이기</button>}
                    </td>
                    <td className={TD}>
                      {TARGETING_TYPES.includes(t.type) ? (
                        <button type="button" onClick={() => onPickTarget(t)} className={`block max-w-full truncate text-left hover:underline ${tgt.muted ? 'text-x-muted' : ''}`} title={t.targetTweetUrl ?? t.target?.postUrl ?? ''}>
                          {tgt.text}{tgt.sub && <span className="text-x-muted"> · {tgt.sub}</span>}{tStatus === 'pending' && <span className="text-x-muted"> · 게시 전</span>}
                        </button>
                      ) : <span className="text-x-muted">—</span>}
                    </td>
                    <td className={TD}>
                      {t.type === 'visit' ? (
                        <span className="flex flex-wrap items-center gap-1 whitespace-nowrap">
                          <span className="text-x-secondary">방문</span>
                          <ScheduledOnField value={t.visitOn} overdueDays={null} outOfRange={false} onChange={(next) => void actions.changeVisitOn(t, next)} compact />
                          <span className="text-x-muted">·</span><span className="text-x-secondary">게시</span>
                          <ScheduledOnField value={t.scheduledOn} overdueDays={od} outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)} onChange={(next) => void actions.changeScheduledOn(t, next)} compact />
                        </span>
                      ) : (
                        <ScheduledOnField value={t.scheduledOn} overdueDays={od} outOfRange={isOutOfRange(t.scheduledOn, campaign.startsOn, campaign.endsOn)} onChange={(next) => void actions.changeScheduledOn(t, next)} compact />
                      )}
                    </td>
                    <td className={TD}>
                      <PostedCell task={t} today={today}
                                  onMarkPosted={(date, url) => void actions.markPosted(t, date, url)}
                                  onMarkRemoved={(date, reason) => void actions.markRemoved(t, date, reason)}
                                  onUnmarkRemoved={() => void actions.unmarkRemoved(t)} />
                    </td>
                    <td className={`${TD} text-right`}>
                      <span className="flex items-center justify-end gap-2 tabular-nums">
                        <CostPopover value={t.cost} suggestion={suggestion} onChange={(next: TaskCost | null) => void actions.changeCost(t, next)} compact />
                        {/* 정산 배지 자리(§4-1) — payment_request가 생기면 여기 상태 문구. 이번 릴리스는 빈 자리 */}
                        <RowMenu onOpenDraft={t.draftId ? () => onOpenDraft(t.draftId as string) : null} onDelete={() => onDelete(t)} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-ui text-x-secondary">
                <td className="px-3.5 py-3" colSpan={3}>{typeFooterLabel(byType)}</td>
                <td className="px-3.5 py-3" colSpan={2}>게시됨 {summary.published} / {summary.total}{summary.overdue > 0 && ` · 밀림 ${summary.overdue}`}{summary.removed > 0 && ` · 내려짐 ${summary.removed}`}</td>
                <td className="px-3.5 py-3 text-right tabular-nums" colSpan={2}>비용 {formatMoneyBy(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
```
(`formatAmount`를 쓰지 않으면 import에서 뺀다. `ScheduledOnField(compact)`의 미정 문구는 `NO_SCHEDULE_LABEL='예정일 미정'`이라 방문협찬 행에선 '방문 예정일 미정 · 게시 예정일 미정'으로 읽힌다 — `ScheduledOnField`에 `emptyLabel?: string` prop을 추가해 이 표에서 `'미정'`을 넘긴다.)

- [ ] **Step 8: CostPopover 정리** — `defaultType` prop·유형 select 제거, `DraftCost`→`TaskCost`, 트리거 라벨 `formatAmount(value.amount, value.currency)`만, 제목 '작업 비용', 설명 '이 작업 하나에 드는 비용이에요 — 인플루언서별 소계와 캠페인 합계에 바로 반영돼요'. `DraftCard.tsx`의 `CostPopover` 호출은 Task 15에서 바뀌므로, 여기서는 `defaultType` prop만 제거해도 DraftCard가 넘기는 `defaultType`이 컴파일 오류가 된다 → DraftCard 481행의 `defaultType={…}`를 이 Task에서 함께 지운다(`defaultCostType` import는 Task 15에서 정리).

- [ ] **Step 9: CampaignDetail.tsx 표 영역 복구**

- 상태: `interface DetailState { campaign: CampaignRow; tasks: CampaignTaskItem[]; costRows: InfluencerCostRow[]; byType: TypeSubtotal[]; deleteInfo: {taskCount; detachedTargets}; today: string }`, `load`에서 `r.data`의 해당 필드 저장.
- `setTasks` = `setDrafts` 골격. `const actions = useCampaignTaskActions({ campaignId: id, setTasks, influencerOptions, show, onChanged });`
- 파생: `summary = summarizeTasks(data.tasks, data.today)`, `perf = summarizeTaskPerf(data.tasks)`, `influencers = deriveTaskInfluencers(data.tasks, data.costRows)`, `byType = subtotalsByType(data.tasks)`(서버 값 대신 클라에서 다시 — 표에서 고친 즉시 따라가게), `total = taskCampaignTotal(influencers)`, `stageCounts`는 `matchesTaskFilter(t, f, data.today)`.
- `sort` 상태 타입 `TaskSortKey`, 기본 `'created'`.
- 표: `<TaskTable rows={data.tasks} campaign={data.campaign} today={data.today} influencerOptions={influencerOptions} sort={sort} onSortChange={setSort} filter={filter} byType={byType} total={total} summary={summary} actions={actions} onOpenDraft={setPeekId} onAttachDraft={(t) => setAttachFor(t)} onPickTarget={(t) => setTargetFor(t)} onDelete={(t) => { if (window.confirm(`이 작업을 지울까요?${t.draftId ? '\n\n원고는 남아요.' : ''}`)) void actions.remove(t); }} />` — `attachFor`·`targetFor` 상태는 Task 12에서 모달을 붙인다(여기선 `useState<CampaignTaskItem | null>(null)`만 두고 아직 렌더 없음).
- 제목 `작업 진행 현황 <span>{data.tasks.length}건</span>`.
- `peeked`: `peekId`는 draftId → `data.tasks.find((t) => t.draftId === peekId)`로 작업을 찾고, 원고 자체는 `fetch('/api/drafts/'+peekId)`가 아니라 **DraftRow가 필요**하다. 작업 목록엔 DraftRow가 없으므로 `peekDraft` 상태를 두고 열 때 `apiFetch(\`/api/drafts/${draftId}\`)`로 받아 `DraftCard`에 넘긴다(캐시: 같은 id면 재요청 안 함). `DraftCard`의 `campaign` prop은 Task 15에서 `task` prop으로 바뀌므로 여기서는 넘기지 않는다(카드에 캠페인 칸이 잠시 안 보임 — Task 15에서 복구).
- 달력 분기(`view === 'calendar'`)는 Task 14까지 `<p className="mt-3 text-ui text-x-muted">달력을 작업 기준으로 바꾸는 중…</p>`.
- 헤더의 `draftCount` prop은 `data.deleteInfo.taskCount`로(문구는 Task 14에서 바꾼다).

- [ ] **Step 10: 확인** — `node --import tsx --env-file=.env --test src/lib/campaignTableView.test.ts && npx tsc --noEmit && npm run lint`. koo 화면 확인은 Task 14 뒤에 몰아서.

- [ ] **Step 11: Commit**

```bash
git add src/lib/campaignTableView.ts src/lib/campaignTableView.test.ts src/components/DraftStatusChip.tsx src/components/CostPopover.tsx src/components/ScheduledOnField.tsx src/components/DraftCard.tsx src/app/campaigns/useCampaignTaskActions.ts src/app/campaigns/PostedCell.tsx src/app/campaigns/TaskTable.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(campaign-task): 작업 표 — 유형 1열·만든 순·RT/인용RT 대상·방문일·게시 확인/내림 팝오버·하단 유형 줄, 작업 편집 훅

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: [+ 작업 추가] — `TargetPicker` · `CostRows` · `TaskAddModal` · `AttachDraftModal`

**Files:**
- Create: `src/app/campaigns/TargetPicker.tsx`, `src/app/campaigns/CostRows.tsx`, `src/app/campaigns/TaskAddModal.tsx`, `src/app/campaigns/AttachDraftModal.tsx`
- Modify: `src/app/campaigns/CampaignDetail.tsx` (모달 배선: addOpen → TaskAddModal, attachFor → AttachDraftModal, targetFor → TargetPicker 팝오버)

**Interfaces:**
- `TargetPicker` props: `{ value: { taskId: string; label: string; sub: string | null; posted: boolean } | { url: string } | null; clientId: string | null; campaignId: string; excludeTaskId?: string; onChange: (next: { taskId: string } | { url: string } | null) => void; onTargetingLoaded?: (handles: string[]) => void; autoFocus?: boolean }` — 입력 한 칸(검색·링크 자동 인식) + 드롭다운(같은 클라이언트 · 전체 보기) + 빠른 선택 칩(이 캠페인의 후보 최근 5). 선택되면 회색 카드 + "바꾸기"/"비우기".
- `CostRows` props: `{ type: TaskType; handles: string[]; influencerOptions: InfluencerOption[]; values: Record<string, TaskCost | null>; onChange: (handle: string, next: TaskCost | null) => void }` — 사람별 줄(금액 input·통화·근거 "단가 RT ¥3,000"/주황 "명부에 RT 단가 없음"), 하단 "모두 같은 금액으로"·"통화 바꾸기". handles가 비면 한 줄(미배정)로 `values['']`.
- `TaskAddModal` props: `{ campaign: CampaignRow; influencerOptions: InfluencerOption[]; onClose(); onCreated(count: number) }` — 유형 세그먼트 → 유형별 칸 순서(§4-2). 제출 = `createTasksApi`. 원고 칸: 없음 / 있는 원고 고르기(AttachDraftModal 재사용, 선택만) / 새로 만들기(작업 먼저 만들고 `/generate?task=<id>&campaign=<campaignId>`로 이동 — Task 16이 두 파라미터를 읽는다).
- `AttachDraftModal` props: `{ clientId: string | null; onClose(); onPick: (draft: DraftRow) => void; title?: string }` — `fetchUnattachedDrafts(clientId)`, 검색(`searchDrafts`), 형제 시안 A/B/C 라벨, **하나만** 고른다(클릭 = 선택).

- [ ] **Step 1: `TargetPicker.tsx`**

```tsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TargetCandidate } from '@/lib/campaignTaskStore';
import { fetchTasksTargets, fetchTargeting } from '@/lib/campaignApi';
import { normalizeTargetTweetUrl } from '@/lib/campaignTaskInput';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { formatDateKo } from '@/lib/campaignJudgment';

// RT/인용RT 대상 한 칸(스펙 §4-2, 시안 task-add-v3) — 탭·팝오버 없이 입력 하나: @핸들/제목/캠페인명을 치면 작업 목록,
// X 링크를 붙이면 그대로 대상(자동 인식). 아래 빠른 선택 칩 = 이 캠페인의 후보 최근 5개. 선택되면 회색 카드로 접힌다.
export type TargetValue = { taskId: string; label: string; sub: string | null; posted: boolean } | { url: string } | null;
const TYPE_CHIP: Record<string, string> = { post: 'bg-[#e8f0fe] text-[#1d4ed8]', quoteRt: 'bg-[#f3e8ff] text-[#7e22ce]', visit: 'bg-[#fff4e5] text-[#b45309]' };

export function candidateLabel(c: TargetCandidate): string {
  return `${c.influencerHandle ? `@${c.influencerHandle}` : '미배정'} · ${c.draftLabel ?? '(원고 없음)'}`;
}

export function TargetPicker({ value, clientId, campaignId, excludeTaskId, onChange, onTargetingLoaded, autoFocus }: {
  value: TargetValue; clientId: string | null; campaignId: string; excludeTaskId?: string;
  onChange: (next: { taskId: string } | { url: string } | null) => void;
  onTargetingLoaded?: (handles: string[]) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [cands, setCands] = useState<TargetCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);

  // 후보 로드 — 클라이언트 기본, '전체 클라이언트 보기'로 넓힘. q는 서버 검색(50건 상한)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchTasksTargets({ clientId, q, all }).then((r) => { if (!alive) return; setCands(r.ok ? r.data.filter((c) => c.taskId !== excludeTaskId) : []); setLoading(false); });
    return () => { alive = false; };
  }, [clientId, q, all, excludeTaskId]);
  // "이미 RT하기로 한 사람" — 값이 정해질 때마다
  useEffect(() => {
    if (!value || !onTargetingLoaded) return;
    fetchTargeting('taskId' in value ? { taskId: value.taskId } : { url: value.url }).then((r) => onTargetingLoaded(r.ok ? r.data.handles : []));
  }, [value, onTargetingLoaded]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const quick = useMemo(() => cands.filter((c) => c.campaignId === campaignId).slice(0, 5), [cands, campaignId]);
  const isLink = /(?:x\.com|twitter\.com)\//i.test(q);

  function pickLink() {
    const u = normalizeTargetTweetUrl(q);
    if (!u) { setErr('X 게시물 주소가 아니에요 — x.com/계정/status/숫자 형식이어야 해요'); return; }
    setErr(''); setQ(''); setOpen(false); onChange({ url: u });
  }
  const input = 'h-11 w-full rounded-[10px] border border-x-border-strong bg-white px-3 text-content outline-none focus:border-x-blue';

  if (value) {
    return (
      <div className="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-x-border-strong bg-x-surface px-3">
        {'taskId' in value ? (
          <>
            <span className="min-w-0 flex-1 truncate">{value.label}{value.sub && <span className="text-x-muted"> · {value.sub}</span>}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[12px] ${value.posted ? 'bg-green-100 text-green-800' : 'bg-x-border/60 text-x-secondary'}`}>{value.posted ? '게시됨' : '게시 전'}</span>
          </>
        ) : <span className="min-w-0 flex-1 truncate">{value.url.replace(/^https?:\/\//, '')}</span>}
        <button type="button" onClick={() => onChange(null)} className="shrink-0 text-ui text-x-secondary hover:underline">바꾸기</button>
      </div>
    );
  }
  return (
    <div ref={boxRef} className="relative">
      <input value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setErr(''); setOpen(true); }} onFocus={() => setOpen(true)}
             onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (isLink) pickLink(); } if (e.key === 'Escape') setOpen(false); }}
             placeholder="@핸들이나 원고 제목으로 찾기 — 또는 X 링크 붙이기" aria-label="RT 대상" className={input} />
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      {quick.length > 0 && !q && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-ui text-x-muted">이 캠페인 →</span>
          {quick.map((c) => (
            <button key={c.taskId} type="button" onClick={() => onChange({ taskId: c.taskId })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-x-border px-3 py-1.5 text-ui hover:bg-x-hover">
              <span className={`rounded-full px-1.5 text-[12px] ${TYPE_CHIP[c.type]}`}>{TASK_TYPE_LABEL[c.type]}</span>
              <span className="max-w-[220px] truncate">{candidateLabel(c)}</span>
              {!c.postedAt && <span className="text-x-muted">· 게시 전</span>}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-[320px] overflow-y-auto rounded-[10px] border border-x-border bg-white shadow-lg">
          <div className="flex items-center gap-3 px-3.5 py-2 text-[12px] text-x-muted">
            <span>{all ? '전체 클라이언트' : '같은 클라이언트'} · 최근 만든 순</span>
            <button type="button" onClick={() => setAll((v) => !v)} className="underline hover:text-x-secondary">{all ? '같은 클라이언트만' : '전체 클라이언트 보기'}</button>
            {loading && <span className="ml-auto">불러오는 중…</span>}
          </div>
          {isLink && (
            <button type="button" onClick={pickLink} className="flex w-full items-center gap-2 border-t border-x-border px-3.5 py-3 text-left text-ui hover:bg-x-hover">
              <span className="rounded bg-x-surface px-1.5 text-[12px] text-x-secondary">링크</span>이 주소를 대상으로 <span className="truncate text-x-muted">{q}</span>
            </button>
          )}
          {cands.length === 0 && !loading && <p className="border-t border-x-border px-3.5 py-3 text-ui text-x-muted">맞는 작업이 없어요 — 링크를 붙이거나 나중에 정해도 돼요</p>}
          {cands.map((c) => (
            <button key={c.taskId} type="button" onClick={() => { setOpen(false); setQ(''); onChange({ taskId: c.taskId }); }}
                    className="flex h-[46px] w-full items-center gap-2.5 border-t border-x-border px-3.5 text-left hover:bg-x-hover">
              <span className={`shrink-0 rounded-full px-2 text-[12px] ${TYPE_CHIP[c.type]}`}>{TASK_TYPE_LABEL[c.type]}</span>
              <span className="min-w-0 flex-1 truncate text-content">{candidateLabel(c)}</span>
              <span className="shrink-0 text-ui text-x-muted">{c.campaignName} · {c.postedAt ? <span className="text-green-700">게시됨 {formatDateKo(c.postedAt)}</span> : '게시 전'}</span>
            </button>
          ))}
          <p className="border-t border-x-border px-3.5 py-2 text-[12px] text-x-muted">링크를 붙이면 바로 대상으로 들어가요 (x.com/…/status/…)</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `CostRows.tsx`**

```tsx
'use client';
import { useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import { CURRENCIES, CURRENCY_LABEL, parseAmount, suggestTaskCost, formatAmount, type TaskCost, type Currency } from '@/lib/campaignCost';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';

// 비용 — 사람별 금액 줄(스펙 §4-2). 인플을 고르는 순간 명부 단가(작업 유형)로 채워진 금액 칸이 사람마다 한 줄, 옆에 근거.
// 단가 없으면 빈 칸(점선) + 주황 안내. 사람이 적은 값은 덮지 않는다. handles가 비면 미배정 한 줄(key '').
export function CostRows({ type, handles, influencerOptions, values, onChange }: {
  type: TaskType; handles: string[]; influencerOptions: InfluencerOption[];
  values: Record<string, TaskCost | null>;
  onChange: (handle: string, next: TaskCost | null) => void;
}) {
  const rows = handles.length ? handles : [''];
  const [currency, setCurrency] = useState<Currency>(() => {
    const first = rows.map((h) => values[h]).find(Boolean);
    return first?.currency ?? 'JPY';
  });
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((h) => [h, values[h] ? String(values[h]!.amount) : ''])));
  const optionFor = (h: string) => influencerOptions.find((o) => o.handle.toLowerCase() === h.toLowerCase());

  function commit(h: string, raw: string) {
    setText((cur) => ({ ...cur, [h]: raw }));
    const n = raw.trim() === '' ? null : parseAmount(raw);
    if (n === null && raw.trim() !== '') return;   // 잘못된 값은 저장하지 않고 입력만 남긴다(제출 시 검증)
    onChange(h, n === null ? null : { amount: n, currency });
  }
  function setAllSame() {
    const first = rows.map((h) => text[h]).find((v) => v && parseAmount(v) !== null);
    if (!first) return;
    for (const h of rows) commit(h, first);
  }
  function changeCurrency(c: Currency) {
    setCurrency(c);
    for (const h of rows) { const n = parseAmount(text[h] ?? ''); if (n !== null) onChange(h, { amount: n, currency: c }); }
  }
  return (
    <div className="overflow-hidden rounded-[10px] border border-x-border">
      {rows.map((h) => {
        const sug = h ? suggestTaskCost(optionFor(h)?.pricing, type) : null;
        const invalid = (text[h] ?? '').trim() !== '' && parseAmount(text[h]) === null;
        return (
          <div key={h || '__none'} className="grid h-12 grid-cols-[1fr_150px_1fr] items-center gap-3 border-t border-x-border px-3.5 first:border-t-0">
            <span className="flex items-center gap-2 truncate">
              {h ? <><span aria-hidden className="inline-block h-6 w-6 shrink-0 rounded-full bg-x-border" />@{h}</> : <span className="text-x-secondary">미배정</span>}
            </span>
            <label className={`flex h-9 items-center gap-1.5 rounded-lg border bg-white px-2.5 tabular-nums ${(text[h] ?? '') === '' ? 'border-dashed border-x-border-strong text-x-muted' : 'border-x-border-strong'} ${invalid ? 'border-red-400' : ''}`}>
              {CURRENCY_LABEL[currency] === '엔' ? '¥' : '₩'}
              <input inputMode="numeric" value={text[h] ?? ''} onChange={(e) => commit(h, e.target.value)} placeholder="금액" aria-label={`${h || '미배정'} 비용`}
                     className="w-full bg-transparent text-content outline-none placeholder:text-x-muted" />
            </label>
            <span className={`truncate text-ui ${sug ? 'text-x-muted' : 'text-amber-700'}`}>
              {sug ? `단가 ${TASK_TYPE_LABEL[type]} ${formatAmount(sug.amount, sug.currency)}` : h ? `명부에 ${TASK_TYPE_LABEL[type]} 단가 없음 — 비워두면 비용 없이 만들어요` : '비워두면 비용 없이 만들어요'}
            </span>
          </div>
        );
      })}
      <div className="flex gap-4 border-t border-x-border bg-x-surface px-3.5 py-2.5 text-ui text-x-secondary">
        {rows.length > 1 && <button type="button" onClick={setAllSame} className="underline underline-offset-2 hover:text-x-text">모두 같은 금액으로</button>}
        <label className="flex items-center gap-1.5">통화
          <select value={currency} onChange={(e) => changeCurrency(e.target.value as Currency)} className="h-7 rounded border border-x-border-strong bg-white px-1.5 text-ui">
            {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]} ({c})</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
```
(`CostRows`는 부모가 `values`를 쥔다. 인플이 추가되면 부모가 `suggestTaskCost(pricing, type)`로 초기값을 채워 넘긴다 — "비어 있을 때만 자동" 규칙은 부모(TaskAddModal)가 지킨다.)

- [ ] **Step 3: `AttachDraftModal.tsx`** — `AddDraftsModal`의 검색·목록 골격을 단일 선택으로

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import { fetchUnattachedDrafts } from '@/lib/campaignApi';
import { draftLabel, searchDrafts } from '@/lib/draftViews';
import { variantLabel } from '@/lib/draftUi';
import { kstShort } from '@/lib/datetime';
import { Button } from '@/components/ui';

// 있는 원고 고르기(스펙 §4-2) — 그 클라이언트의 작업에 안 붙은 원고만. 하나만 고른다(원고 1개 = 작업 1개).
// 형제 시안(A/B/C)은 라벨로 보여주되 하나만 붙이는 게 자연스럽다 — 도움말로 말한다.
export function AttachDraftModal({ clientId, onClose, onPick, title = '있는 원고 고르기' }: {
  clientId: string | null; onClose: () => void; onPick: (draft: DraftRow) => void; title?: string;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    fetchUnattachedDrafts(clientId).then((r) => { if (!alive) return; if (r.ok) { setRows(r.data); setState('ready'); } else { setErr(r.error); setState('error'); } });
    return () => { alive = false; };
  }, [clientId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shown = useMemo(() => searchDrafts(rows, query), [rows, query]);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[640px] rounded-2xl bg-white p-5" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-bold">{title}</h2>
        <p className="mt-0.5 text-ui text-x-muted">작업에 아직 안 붙은 원고만 보여요. 시안이 여러 개(A/B/C)면 쓸 하나만 골라요.</p>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·본문으로 찾기" aria-label="원고 검색"
               className="mt-3 h-10 w-full rounded-lg border border-x-border-strong px-3 text-content outline-none focus:border-x-blue" />
        <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-lg border border-x-border">
          {state === 'loading' && <p className="px-4 py-6 text-center text-ui text-x-muted">불러오는 중…</p>}
          {state === 'error' && <p role="alert" className="px-4 py-6 text-center text-ui text-red-600">{err}</p>}
          {state === 'ready' && shown.length === 0 && <p className="px-4 py-6 text-center text-ui text-x-muted">붙일 수 있는 원고가 없어요 — "새로 만들기"로 바로 써도 돼요</p>}
          {state === 'ready' && shown.map((d) => (
            <button key={d.id} type="button" onClick={() => onPick(d)} className="flex w-full items-center gap-3 border-b border-x-border px-4 py-3 text-left last:border-b-0 hover:bg-x-hover">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-content font-medium">{draftLabel(d).text}</span>
                <span className="block text-ui text-x-muted">{kstShort(d.createdAt)}{d.batchId !== null && ` · 시안 ${variantLabel(d.variantIndex ?? 0)}`}{d.influencerHandle && ` · @${d.influencerHandle}`}</span>
              </span>
              <span className="shrink-0 text-ui text-x-blue-text">고르기</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end"><Button onClick={onClose} className="h-10 px-4 text-content">닫기</Button></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `TaskAddModal.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { DraftRow } from '@/lib/draftStore';
import { createTasksApi, type TaskCreateRequest } from '@/lib/campaignApi';
import { suggestTaskCost, parseAmount, type TaskCost } from '@/lib/campaignCost';
import { TASK_TYPES, TASK_TYPE_LABEL, TARGETING_TYPES, isDateOnlyString, type TaskType } from '@/lib/campaignJudgment';
import { InfluencerField } from '@/components/InfluencerField';
import { parseXHandle } from '@/lib/xHandle';
import { draftLabel } from '@/lib/draftViews';
import { Button } from '@/components/ui';
import { TargetPicker, type TargetValue, candidateLabel } from './TargetPicker';
import { CostRows } from './CostRows';
import { AttachDraftModal } from './AttachDraftModal';
import { fetchTasksTargets } from '@/lib/campaignApi';

// [+ 작업 추가](스펙 §4-2, 시안 task-add-v3) — 한 창에서 유형을 바꾸면 칸이 바뀐다(입력한 인플·예정일은 유지).
// RT·인용RT: 유형 → 대상 → 인플(여러 명) → (인용RT: 원고) → 비용(사람별) → 예정일·메모 / 투고·방문협찬: 유형 → 인플 → 원고 → 비용 → (방문일)·예정일 → 메모.
// 여러 명 = 사람 수만큼 작업. 0명 = 미배정 1개. 원고는 0~1명일 때만.
type DraftChoice = { kind: 'none' } | { kind: 'existing'; draft: DraftRow } | { kind: 'new' };

export function TaskAddModal({ campaign, influencerOptions, onClose, onCreated }: {
  campaign: CampaignRow; influencerOptions: InfluencerOption[]; onClose: () => void;
  onCreated: (created: { count: number; firstTaskId: string; goToGenerate: boolean }) => void;
}) {
  const [type, setType] = useState<TaskType>('post');
  const [target, setTarget] = useState<TargetValue>(null);
  const [targeting, setTargeting] = useState<string[]>([]);
  const [handles, setHandles] = useState<string[]>([]);
  const [handleInput, setHandleInput] = useState('');
  const [handleErr, setHandleErr] = useState<string | null>(null);
  const [costs, setCosts] = useState<Record<string, TaskCost | null>>({});
  const [draft, setDraft] = useState<DraftChoice>({ kind: 'none' });
  const [attachOpen, setAttachOpen] = useState(false);
  const [scheduledOn, setScheduledOn] = useState('');
  const [visitOn, setVisitOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasTarget = TARGETING_TYPES.includes(type);
  const hasDraft = type !== 'rt';
  const optionFor = useCallback((h: string) => influencerOptions.find((o) => o.handle.toLowerCase() === h.toLowerCase()), [influencerOptions]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy && !attachOpen) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy, attachOpen]);

  // 유형이 바뀌면 비용 제안도 그 유형 단가로 — 사람이 적은 값(제안과 다른 값)은 덮지 않는다
  useEffect(() => {
    setCosts((cur) => {
      const next = { ...cur };
      for (const h of handles) {
        const prevSug = cur[h];
        const sug = suggestTaskCost(optionFor(h)?.pricing, type);
        if (prevSug === undefined || prevSug === null || JSON.stringify(prevSug) === JSON.stringify(suggestTaskCost(optionFor(h)?.pricing, prevType.current))) next[h] = sug;
      }
      return next;
    });
    prevType.current = type;
  }, [type, handles, optionFor]);
  const prevType = useRefType(type);

  function addHandle(raw: string) {
    const p = parseXHandle(raw);
    if (!p.ok) { setHandleErr('핸들 형식이 아니에요 — 영문·숫자·_ 1~15자'); return; }
    if (handles.some((h) => h.toLowerCase() === p.handle.toLowerCase())) { setHandleInput(''); return; }
    setHandles((cur) => [...cur, p.handle]);
    setCosts((cur) => ({ ...cur, [p.handle]: cur[p.handle] ?? suggestTaskCost(optionFor(p.handle)?.pricing, type) }));
    setHandleInput(''); setHandleErr(null);
  }
  const removeHandle = (h: string) => setHandles((cur) => cur.filter((x) => x !== h));
  const dup = useMemo(() => new Set(targeting.map((h) => h.toLowerCase())), [targeting]);
  const canAttachDraft = hasDraft && handles.length <= 1;

  async function submit(goToGenerate: boolean) {
    if (busy) return;
    if (scheduledOn && !isDateOnlyString(scheduledOn)) { setErr('게시 예정일 형식이 올바르지 않아요'); return; }
    if (visitOn && !isDateOnlyString(visitOn)) { setErr('방문일 형식이 올바르지 않아요'); return; }
    if (!canAttachDraft && draft.kind !== 'none') { setErr('원고는 한 사람에게만 붙일 수 있어요 — 인플루언서를 한 명만 고르거나 원고를 빼 주세요'); return; }
    const body: TaskCreateRequest = {
      type,
      ...(hasTarget && target ? ('taskId' in target ? { targetTaskId: target.taskId } : { targetTweetUrl: target.url }) : {}),
      ...(draft.kind === 'existing' ? { draftId: draft.draft.id } : {}),
      scheduledOn: scheduledOn || null, visitOn: type === 'visit' && visitOn ? visitOn : null, note,
      influencers: handles.map((h) => ({ handle: h, cost: costs[h] ?? null })),
      ...(handles.length === 0 ? { cost: costs[''] ?? null } : {}),
    };
    setBusy(true); setErr('');
    const r = await createTasksApi(campaign.id, body);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCreated({ count: r.data.tasks.length, firstTaskId: r.data.tasks[0].id, goToGenerate });
  }

  const label = 'text-ui text-x-secondary';
  const input = 'mt-1.5 h-11 w-full rounded-[10px] border border-x-border-strong bg-white px-3 text-content outline-none focus:border-x-blue';
  const field = 'mt-4';
  const draftField = (
    <div className={field}>
      <p className={label}>원고 <span className="text-x-muted">우리가 써서 전달할 때</span></p>
      <div className="mt-1.5 flex flex-wrap items-center gap-4 text-content">
        {(['none', 'existing', 'new'] as const).map((k) => (
          <label key={k} className={`flex items-center gap-1.5 ${!canAttachDraft && k !== 'none' ? 'text-x-muted' : ''}`}>
            <input type="radio" name="draft" checked={draft.kind === k} disabled={!canAttachDraft && k !== 'none'}
                   onChange={() => { if (k === 'existing') setAttachOpen(true); else setDraft({ kind: k }); }} />
            {k === 'none' ? '없음 (인플이 직접 씀)' : k === 'existing' ? '있는 원고 고르기' : '새로 만들기'}
          </label>
        ))}
      </div>
      {draft.kind === 'existing' && (
        <p className="mt-1.5 flex items-center gap-2 rounded-[10px] bg-x-surface px-3 py-2 text-content">
          <span className="min-w-0 flex-1 truncate">{draftLabel(draft.draft).text}</span>
          <button type="button" onClick={() => setAttachOpen(true)} className="text-ui text-x-secondary hover:underline">바꾸기</button>
        </p>
      )}
      <p className="mt-1 text-ui text-x-muted">{draft.kind === 'new' ? '만들기를 누르면 작업이 먼저 생기고 원고 생성 화면으로 가요 — 거기서 만든 원고가 이 작업에 붙어요' : !canAttachDraft ? '인플루언서가 여러 명이면 원고를 붙일 수 없어요' : ' '}</p>
    </div>
  );
  const influencerField = (
    <div className={field}>
      <p className={label}>인플루언서 <span className="text-x-muted">여러 명이면 사람 수만큼 작업이 생겨요</span></p>
      <div className="mt-1.5 flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border border-x-border-strong bg-white px-3 py-1.5">
        {handles.map((h) => (
          <span key={h} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-ui ${dup.has(h.toLowerCase()) ? 'bg-amber-100 text-amber-800' : 'bg-x-surface'}`}>
            <span aria-hidden className="inline-block h-5 w-5 rounded-full bg-x-border" />@{h}{dup.has(h.toLowerCase()) && ' · 이미 있음'}
            <button type="button" onClick={() => removeHandle(h)} aria-label={`@${h} 빼기`} className="text-x-muted hover:text-x-text">✕</button>
          </span>
        ))}
        <span className="min-w-[180px] flex-1">
          <InfluencerField value={handleInput} options={influencerOptions} onChange={(v) => { setHandleInput(v); setHandleErr(null); }} error={handleErr} onEnter={(v) => { if (v.trim()) addHandle(v); }} />
        </span>
      </div>
      {targeting.length > 0 && hasTarget && <p className="mt-1.5 text-ui text-x-secondary">이 게시물을 이미 RT하기로 한 사람: {targeting.map((h) => `@${h}`).join(' · ')}</p>}
      {dup.size > 0 && handles.some((h) => dup.has(h.toLowerCase())) && <p className="mt-1 text-ui text-x-muted">주황 표시는 같은 대상으로 이미 작업이 있는 사람 — 그대로 두면 두 번째 작업이 만들어져요</p>}
    </div>
  );
  const costField = (
    <div className={field}>
      <p className={label}>비용 <span className="text-x-muted">명부 단가로 채웠어요 — 금액을 눌러 고치세요</span></p>
      <div className="mt-1.5"><CostRows type={type} handles={handles} influencerOptions={influencerOptions} values={costs} onChange={(h, next) => setCosts((cur) => ({ ...cur, [h]: next }))} /></div>
    </div>
  );
  const dateFields = (
    <div className={`${field} grid grid-cols-2 gap-3.5`}>
      {type === 'visit' && <label className={label}>방문일 <span className="text-x-muted">선택</span><input type="date" value={visitOn} onChange={(e) => setVisitOn(e.target.value)} className={input} /></label>}
      <label className={label}>게시 예정일 <span className="text-x-muted">선택</span><input type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} className={input} /></label>
      {type !== 'visit' && <label className={label}>메모 <span className="text-x-muted">선택</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄" className={input} /></label>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[680px] rounded-[14px] bg-white" role="dialog" aria-modal="true" aria-label="작업 추가" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5.5 pt-4.5 pb-1.5 px-6 pt-5">
          <h2 className="text-[17px] font-bold">작업 추가 — {campaign.name}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <div className="px-6 pb-2">
          <div className={field}>
            <p className={label}>유형</p>
            <div role="radiogroup" className="mt-1.5 inline-flex overflow-hidden rounded-[10px] border border-x-border-strong">
              {TASK_TYPES.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)}
                        className={`border-r border-x-border-strong px-[18px] py-2.5 text-content last:border-r-0 ${type === k ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>{TASK_TYPE_LABEL[k]}</button>
              ))}
            </div>
          </div>
          {hasTarget && (
            <div className={field}>
              <p className={label}>{TASK_TYPE_LABEL[type]} 대상 <span className="text-x-muted">나중에 정해도 돼요</span></p>
              <div className="mt-1.5"><TargetPicker value={target} clientId={campaign.clientId} campaignId={campaign.id} onChange={(next) => void resolveTarget(next)} onTargetingLoaded={setTargeting} /></div>
            </div>
          )}
          {influencerField}
          {hasDraft && draftField}
          {costField}
          {dateFields}
          {type === 'visit' && <label className={`${field} block ${label}`}>메모 <span className="text-x-muted">선택</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄" className={input} /></label>}
          {err && <p role="alert" className="mt-3 text-ui text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-x-border px-6 py-4">
          <Button onClick={onClose} disabled={busy} className="h-10 px-4 text-content">취소</Button>
          <Button variant="primary" onClick={() => void submit(draft.kind === 'new')} disabled={busy} className="h-10 px-4 text-content">
            {busy ? '만드는 중…' : draft.kind === 'new' ? '작업 만들고 원고 쓰기' : handles.length > 1 ? `작업 ${handles.length}개 만들기` : '작업 만들기'}
          </Button>
        </div>
      </div>
      {attachOpen && (
        <AttachDraftModal clientId={campaign.clientId} onClose={() => { setAttachOpen(false); if (draft.kind !== 'existing') setDraft({ kind: 'none' }); }}
                          onPick={(d) => { setDraft({ kind: 'existing', draft: d }); setAttachOpen(false); if (d.influencerHandle && handles.length === 0) addHandle(d.influencerHandle); }} />
      )}
    </div>
  );

  // TargetPicker는 id만 돌려준다 — 접힌 카드에 보여줄 라벨·게시 여부는 후보 목록에서 다시 찾는다(한 번 더 조회, 50건 안에 있다)
  async function resolveTarget(next: { taskId: string } | { url: string } | null) {
    if (next === null) { setTarget(null); setTargeting([]); return; }
    if ('url' in next) { setTarget(next); return; }
    const r = await fetchTasksTargets({ clientId: campaign.clientId, all: true });
    const c = r.ok ? r.data.find((x) => x.taskId === next.taskId) : undefined;
    setTarget({ taskId: next.taskId, label: c ? candidateLabel(c) : '선택한 작업', sub: c && c.campaignId !== campaign.id ? c.campaignName : null, posted: !!c?.postedAt });
  }
}
// 유형 변경 전의 유형을 기억해 "제안값이었던 비용만 새 제안으로 바꾼다" — 사람이 고친 값은 유지
function useRefType(type: TaskType) {
  const ref = useRef(type);
  return ref;
}
```
(`useRef` import 추가. `prevType`은 `useRefType`으로 만든 ref — `useEffect` 안에서 `prevType.current`를 읽고 마지막에 갱신한다. 선언 순서: `const prevType = useRefType(type);`를 **useEffect보다 위**로 올린다. 스타일 클래스 오타(`px-5.5 pt-4.5` 등 없는 클래스)는 지운다 — 위 헤더 div는 `className="flex items-center justify-between px-6 pt-5 pb-1.5"`.)

- [ ] **Step 5: CampaignDetail 배선**

- `addOpen` → `<TaskAddModal campaign={data.campaign} influencerOptions={influencerOptions} onClose={() => setAddOpen(false)} onCreated={({ count, firstTaskId, goToGenerate }) => { setAddOpen(false); if (goToGenerate) { window.location.assign(`/generate?task=${firstTaskId}&campaign=${data.campaign.id}`); return; } show(count > 1 ? `작업 ${count}개를 만들었어요` : '작업을 만들었어요'); void load(); onChanged(); }} />`
- `attachFor` → `<AttachDraftModal clientId={data.campaign.clientId} onClose={() => setAttachFor(null)} onPick={async (d) => { const r = await patchDraftApi(d.id, { taskId: attachFor.id }); if (!r.ok) { show(r.error); return; } setAttachFor(null); show('원고를 붙였어요'); void load(); }} />` (`patchDraftApi` import).
- `targetFor` → 작은 다이얼로그(중앙, 520px)에 `<TargetPicker value={…현재 값…} clientId campaignId excludeTaskId={targetFor.id} autoFocus onChange={(next) => { void actions.changeTarget(targetFor, next); if (next !== null) setTargetFor(null); }} />` + "대상 비우기" 버튼(`changeTarget(t, null)`). 현재 값은 `targetFor.target ? { taskId, label: \`@${handle} ${TASK_TYPE_LABEL[type]}\`, sub, posted: !!postUrl } : targetFor.targetTweetUrl ? { url } : null`.

- [ ] **Step 6: 확인** — `npx tsc --noEmit && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/app/campaigns/TargetPicker.tsx src/app/campaigns/CostRows.tsx src/app/campaigns/TaskAddModal.tsx src/app/campaigns/AttachDraftModal.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(campaign-task): [+ 작업 추가] — 유형별 칸 순서(RT는 대상 먼저)·대상 입력 한 칸+빠른 선택·인플 여러 명·사람별 비용 줄·원고 붙이기/새로 만들기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: `[게시 확인하기]` 버튼 + 결과 모달

**Files:**
- Create: `src/app/campaigns/CheckPostedModal.tsx`
- Modify: `src/app/campaigns/CampaignDetail.tsx` (툴바 버튼·도움말·모달)

- [ ] **Step 1: `CheckPostedModal.tsx`**

```tsx
'use client';
import { useEffect } from 'react';
import type { CheckPostedResult } from '@/lib/checkPosted';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import { Button } from '@/components/ui';

// 게시 확인 결과(스펙 §3-3) — 숫자만 던지지 않고 판단까지: 확인됨/아직/건너뜀/사라짐을 이유와 함께.
const at = (h: string) => `@${h}`;
export function CheckPostedModal({ result, tasks, onClose, onMarkRemoved }: {
  result: CheckPostedResult; tasks: CampaignTaskItem[]; onClose: () => void;
  onMarkRemoved: (taskId: string) => void;   // "게시 내림으로 표시" — 오늘 날짜, 사유 '리포스트 목록에서 사라짐'
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const targetOf = (taskId: string) => { const t = tasks.find((x) => x.id === taskId); return t?.target ? `${t.target.influencerHandle ? at(t.target.influencerHandle) : '미배정'} ${t.target.type === 'post' ? '투고' : t.target.type === 'quoteRt' ? '인용RT' : '방문협찬'}` : '대상'; };
  const reasonOf = (s: CheckPostedResult['skipped'][number]) => s.reason === 'no_target' ? '대상 미정' : s.reason === 'no_handle' ? '인플루언서 미배정' : `대상 게시글(${targetOf(s.taskId)})이 아직 게시 전`;
  const nothing = result.confirmed.length + result.pending.length + result.skipped.length + result.missing.length + result.unreadable.length === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[560px] rounded-2xl bg-white p-5" role="dialog" aria-modal="true" aria-label="게시 확인 결과" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-bold">게시 확인 결과</h2>
        {nothing && <p className="mt-3 text-content text-x-secondary">확인할 RT 작업이 없어요.</p>}
        <ul className="mt-3 space-y-3 text-content">
          {result.confirmed.length > 0 && <li><span className="font-bold text-green-700">확인됨 {result.confirmed.length}건</span> — {result.confirmed.map((h) => at(h.handle)).join(' ')} → 게시 확인을 채웠어요</li>}
          {result.pending.length > 0 && <li><span className="font-bold">아직 {result.pending.length}건</span> — {result.pending.map((h) => at(h.handle)).join(' ')} <span className="text-ui text-x-muted">(목록에 없음 · 비공개 계정이거나 아직 안 했을 수 있어요)</span></li>}
          {result.skipped.length > 0 && (
            <li><span className="font-bold text-x-secondary">건너뜀 {result.skipped.length}건</span>
              <ul className="mt-1 space-y-0.5 text-ui text-x-secondary">{result.skipped.map((s) => <li key={s.taskId}>{s.handle ? at(s.handle) : '(미배정)'}: {reasonOf(s)}</li>)}</ul>
            </li>
          )}
          {result.missing.map((h) => (
            <li key={h.taskId} className="rounded-lg bg-amber-50 px-3 py-2">
              <span className="font-bold text-amber-800">{at(h.handle)}의 RT가 목록에 없어요</span> — 내려졌을 수 있어요
              <button type="button" onClick={() => onMarkRemoved(h.taskId)} className="ml-2 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 text-ui hover:bg-amber-100">게시 내림으로 표시</button>
            </li>
          ))}
          {result.unreadable.map((u) => <li key={u.tweetId} className="text-ui text-x-secondary">대상 게시글({u.tweetId})을 읽을 수 없어요 — 삭제·비공개일 수 있어요</li>)}
          {result.partial.length > 0 && <li className="text-ui text-x-muted">리포스트 목록이 길어 일부만 확인한 게시글이 {result.partial.length}개 있어요</li>}
        </ul>
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={onClose} className="h-10 px-4 text-content">닫기</Button></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: CampaignDetail 툴바** — 제목 줄 아래 툴바 첫 줄에 `[+ 작업 추가]`(헤더에서 여기로 이동 — Task 14에서 헤더 버튼 제거)와 `[게시 확인하기]`:
```tsx
<Button variant="primary" onClick={() => setAddOpen(true)} className="h-9 px-3.5 text-ui">+ 작업 추가</Button>
<Button onClick={() => void checkPosted()} disabled={checking || rtPendingCount === 0} title={rtPendingCount === 0 ? '확인할 RT 작업이 없어요' : undefined} className="h-9 px-3.5 text-ui">{checking ? '확인하는 중…' : '게시 확인하기'}</Button>
<span className="ml-auto text-ui text-x-muted">게시 확인하기 — RT 대상 게시글의 리포스트 계정을 찾아 게시 확인을 채워요 · 게시글 1개당 $0.001</span>
```
`rtPendingCount = data.tasks.filter((t) => t.type === 'rt' && t.postedAt === null && t.influencerHandle).length`. `checkPosted()`: `setChecking(true); const r = await checkPostedApi(id); setChecking(false); if (!r.ok) { show(r.error); return; } setCheckResult(r.data); void load();`. 모달: `<CheckPostedModal result={checkResult} tasks={data.tasks} onClose={() => setCheckResult(null)} onMarkRemoved={(taskId) => { const t = data.tasks.find((x) => x.id === taskId); if (t) void actions.markRemoved(t, data.today, '리포스트 목록에서 사라짐'); }} />`.

- [ ] **Step 3: 확인·Commit** — `npx tsc --noEmit && npm run lint`

```bash
git add src/app/campaigns/CheckPostedModal.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(campaign-task): [게시 확인하기] 버튼(opt-in·비용 안내) + 결과 모달(확인됨/아직/건너뜀/사라짐→내림 표시)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: 나머지 캠페인 화면 — 달력·인플별 비용 표·헤더·게시물 연결 모달·요약

**Files:**
- Modify: `src/app/campaigns/WeekCalendar.tsx`, `src/app/campaigns/InfluencerCostTable.tsx`, `src/app/campaigns/CampaignHeader.tsx`, `src/app/campaigns/LinkPostModal.tsx`, `src/app/campaigns/SummaryCards.tsx`, `src/app/campaigns/CampaignDetail.tsx`, `src/lib/campaignCalendar.ts`(+test), `src/lib/campaignTableView.ts`(`publishedSub` 문구), `src/app/influencers/CampaignSection.tsx`

- [ ] **Step 1: `campaignCalendar.ts`를 작업 기반으로**

- `calendarGrid<T extends TaskSortInput & { visitOn: string | null; type: TaskType }>(items, weeks, today)` — 정렬은 `sortTasks(items, 'scheduled', today)`; 각 칸의 `items`는 `{ task: T; kind: 'post' | 'visit' }[]` — 게시 예정일이 그 날인 작업은 `kind:'post'`, `type==='visit'`이고 방문일이 그 날인 작업은 `kind:'visit'`(방문협찬은 두 카드가 될 수 있다). `unscheduled` = 게시 예정일 없는 작업(방문일만 있어도 여기 든다 — "게시일 미정"). `weekBounds`의 scheduled 인자에 방문일도 넣는다.
- 테스트(`campaignCalendar.test.ts`) 갱신: 방문협찬 작업(visitOn 9/10, scheduledOn null) → 9/10 칸에 `kind:'visit'` 1개, `unscheduled`에 1개.

- [ ] **Step 2: `WeekCalendar.tsx`** — props `rows: CampaignTaskItem[]`, 카드 = `{ task, kind }`. 카드 내용: 첫 줄 `유형 칩(12px) + 원고 제목(있으면) 또는 @핸들`, 둘째 줄 `@핸들 · (kind==='visit' ? '방문' : '') · 밀림 접미 · 기간 밖`. 바 색 `TASK_STAGE_BAR_HEX[taskStage(task, today)]`(밀림이면 OVERDUE). 드래그: `kind==='post'`면 `onChangeScheduledOn`, `kind==='visit'`면 `onChangeVisitOn`(미정 섹션에 놓으면 각각 null). 범례에 `예정·방문 전·방문 완료·내려짐` 추가. 빈 상태 문구 `'아직 이 캠페인에 작업이 없어요 — 위의 [+ 작업 추가]로 올려요.'`. 필터는 `matchesTaskFilter(t, filter, today)`. 미사용은 `isTaskUnused`.

- [ ] **Step 3: `InfluencerCostTable.tsx`** — `lines: TaskInfluencerLine[]`. 열: 인플루언서 · 작업(`taskCount>0 ? \`${taskCount}건 · ${countsByTypeLabel(countsByType)}\` : '배정 작업 없음' 배지`) · 작업 비용(`taskCost`) · 추가 비용 · 소계. 도움말 `'작업 비용 + 추가 비용을 사람별로 모았어요. 통화가 다르면 따로 보여요.'`. 미배정 행 문구 `'미배정 작업'`(title: '인플루언서가 아직 배정되지 않은 작업들의 비용 — 배정하면 그 사람 줄로 옮겨가요'). 빈 상태 `'작업에 인플루언서를 배정하면 사람별 비용이 여기 모여요.'`.

- [ ] **Step 4: `CampaignHeader.tsx`** — `onAddDrafts` prop·`[+ 원고 추가]` 버튼 **제거**(툴바로 이동, Task 13). `draftCount` → `deleteInfo: { taskCount: number; detachedTargets: number }`. 삭제 확인 문구:
```ts
`'${campaign.name}' 캠페인을 삭제할까요?\n\n작업 ${deleteInfo.taskCount}개가 함께 지워져요. 원고는 남아요.${deleteInfo.detachedTargets > 0 ? `\n다른 캠페인 작업 ${deleteInfo.detachedTargets}건의 대상이 '대상 미정'으로 바뀌어요.` : ''}\n실행 취소는 없어요.`
```
CampaignDetail의 `removeCampaign` 토스트: `r.data.deleted ? \`캠페인을 삭제했어요 — 작업 ${r.data.taskCount}개도 지워졌고 원고는 남아 있어요\` : '이미 삭제된 캠페인이에요'`.

- [ ] **Step 5: `LinkPostModal.tsx`** — prop `task: CampaignTaskItem`. 제목 줄 `@핸들 · 유형 · 원고 제목(있으면)`. 문구 `'인플루언서가 올린 게시물 링크를 붙이면 이 작업이 게시됨으로 표시되고, 조회·좋아요가 트래킹에서 넘어와요.'`. submit: `registerTrackedPostApi(url.trim(), task.id)` 한 번 → `row.taskId !== task.id`면(경합) 오류 문구. 이미 다른 작업에 붙은 게시물이면 서버가 덮으므로 사전 확인은 `reg.data.created === false && reg.data.row.taskId && reg.data.row.taskId !== task.id`일 때 `confirm` — 등록 전에 알 수 없으니 순서를 바꾼다: 먼저 `registerTrackedPostApi(url)`(taskId 없이) → row.taskId가 다른 작업이면 confirm → `linkTrackedPostApi(row.id, { taskId: task.id })`. 진입점: 단계 셀 팝오버의 "게시물 링크 입력"과 별개로 **행 메뉴에 '게시물 연결(트래킹)'** 항목을 넣어 이 모달을 연다(RT 제외).

- [ ] **Step 6: `SummaryCards.tsx`·`campaignTableView.publishedSub`** — `summary: TaskSummary`(구조 호환). `publishedSub`: `s.total === 0 ? '작업 없음' : …`, 전부 게시 `'모두 게시됨'` + `removed>0`이면 ` · 내려짐 n` 덧붙임. `perfSub`의 `'게시된 콘텐츠 없음'` → `'게시된 작업 없음'`. 카드 ⓘ: 비용 합계 tip에 `'내려진 작업 비용도 포함돼요 — 정산 여부는 정산 화면에서 판단해요'` 한 줄 추가.

- [ ] **Step 7: `CampaignSection.tsx`(인플 프로필)** — 보조줄 `{formatDateKo(startsOn)} ~ {formatDateKo(endsOn)} · 작업 {c.taskCount}건{c.taskCount > 0 && ` (${countsByTypeLabel(c.countsByType)})`}`; 0건이면 `' · 배정 작업 없음 — 추가 비용만'`(비용 있을 때) / `' · 배정 작업 없음(미사용만)'`. InfoTip 문구의 '원고' → '작업'. 빈 상태 `'아직 참여한 캠페인이 없어요 — 캠페인 화면에서 작업에 이 계정을 배정하면 여기 모여요.'`

- [ ] **Step 8: CampaignDetail** — 달력 분기 복구(`<WeekCalendar rows={data.tasks} … onChangeScheduledOn={(t, next) => void actions.changeScheduledOn(t, next)} onChangeVisitOn={(t, next) => void actions.changeVisitOn(t, next)} />`), `linkFor` 상태를 `CampaignTaskItem`으로, TaskTable RowMenu에 `onLinkPost`(RT 제외) 추가. 빈 캠페인 목록 문구(`CampaignList`)는 `'클라이언트 한 곳의 한 기간 동안 나가는 작업(투고·인용RT·RT·방문협찬)을 묶어요 — 진행·성과·비용을 한 화면에서 봐요.'`.

- [ ] **Step 9: 확인** — `node --import tsx --env-file=.env --test src/lib/campaignCalendar.test.ts src/lib/campaignTableView.test.ts && npx tsc --noEmit && npm run lint`. 그리고 **koo 화면 확인 1차**: `npm run build && npx next start -p 3001` → `http://127.0.0.1:3001/campaigns` — 작업 표·추가 모달(RT 3명·투고+원고·방문협찬)·게시 확인·달력. 피드백은 이 Task 안에서 반영.

- [ ] **Step 10: Commit**

```bash
git add -A src/app/campaigns src/lib/campaignCalendar.ts src/lib/campaignCalendar.test.ts src/lib/campaignTableView.ts src/lib/campaignTableView.test.ts src/app/influencers/CampaignSection.tsx
git commit -m "feat(campaign-task): 달력(방문일 카드)·인플별 비용 표(유형별 건수)·헤더 삭제 문구·게시물 연결(작업)·요약 문구·인플 프로필 참여 캠페인 작업 기준

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: 원고 카드 — "작업" 칸(`DraftTaskField`), 예정일·비용은 읽기만

**Files:**
- Create: `src/components/DraftTaskField.tsx`
- Modify: `src/components/DraftCard.tsx`, `src/app/campaigns/CampaignDetail.tsx`(peek 카드 배선), `src/lib/campaignApi.ts`(필요 시)

**Interfaces:**
- `DraftCard` prop `campaign?: {...}` → **`task?: { campaigns: CampaignRow[]; today: string; influencerOptions: InfluencerOption[]; onAttach: (taskId: string) => void; onDetach: () => void; onCreateTask: (campaignId: string, type: TaskType) => Promise<string | null> /* 새 작업 id */ }`**. 값은 전부 `draft.taskId/taskType/campaignId/campaignName/scheduledOn/cost`에서 읽는다.
- `DraftTaskField` props: `{ draft: DraftRow; campaigns: CampaignRow[]; today: string; onAttach: (taskId: string) => void; onDetach: () => void; onCreateTask: (campaignId: string, type: TaskType) => Promise<string | null> }` — 붙어 있으면 칩 `작업: {campaignName} · {TASK_TYPE_LABEL[taskType]}{influencerHandle ? ' @'+handle : ''}` + 링크(`/campaigns?id=`) + "떼기". 안 붙어 있으면 `[작업에 붙이기]` → 팝오버: 캠페인 select(`campaignOptionsFor` 규칙: 그 클라의 진행 중·예정, 종료 펼침) → 그 캠페인의 **원고 없는 post·quoteRt·visit 작업** 목록(`fetchTasksTargets`가 아니라 새 조회가 필요: `GET /api/campaigns/[id]` 상세의 `tasks`에서 `draftId === null && type !== 'rt'` 필터 — 상세 API 재사용, 추가 라우트 없음) / "새 작업 만들기"(유형 3개 버튼 → `onCreateTask` → 받은 id로 `onAttach`).

- [ ] **Step 1: `DraftTaskField.tsx` 작성** — 위 동작. 팝오버는 CostPopover 골격(body 포털). 목록 행: `유형 칩 · @핸들 또는 미배정 · 예정일`. 빈 목록: `'원고 없는 작업이 없어요 — 아래에서 새 작업을 만들어요'`.

- [ ] **Step 2: `DraftCard.tsx`** — import에서 `suggestDraftCost, defaultCostType, isOverdue, isOutOfRange, daysBetweenDates, DraftCampaignField, CostPopover, ScheduledOnField` 제거 → `DraftTaskField`, `isTaskOverdue`, `formatDateKo`, `formatAmount`, `TASK_TYPE_LABEL`. prop 블록 교체(위 `task?`). 카드 도구층: `{task && <DraftTaskField draft={draft} campaigns={task.campaigns} today={task.today} onAttach={task.onAttach} onDetach={task.onDetach} onCreateTask={task.onCreateTask} />}`. 예정일·비용 줄(기존 `campaign && draft.campaignId` 블록) →
```tsx
{task && draft.taskId && (
  <div className="flex flex-wrap items-center gap-3 border-b border-x-border bg-x-surface px-4 pb-2 text-ui text-x-secondary">
    <span>예정일 {draft.scheduledOn ? formatDateKo(draft.scheduledOn) : '미정'}{overdue !== null && <span className="font-bold text-red-700"> · {overdue}일 지남</span>}</span>
    <span>비용 {draft.cost ? formatAmount(draft.cost.amount, draft.cost.currency) : '없음'}</span>
    <a href={`/campaigns?id=${draft.campaignId}`} className="text-x-blue-text hover:underline">작업에서 고치기 ↗</a>
  </div>
)}
```
`overdue = task && draft.taskId ? (isTaskOverdue({ type: draft.taskType as TaskType, draftStatus: draft.status, postedAt: null, removedAt: null, scheduledOn: draft.scheduledOn, visitOn: null }, task.today) ? daysBetweenDates(draft.scheduledOn as string, task.today) : null) : null` — 카드는 게시 확인을 모르므로 postedAt null로 본다(주석: 정확한 판정은 캠페인 표).
`TrackingLinkSection campaignCode={draft.campaignCode}`는 그대로.

- [ ] **Step 3: CampaignDetail peek 카드 배선** — `task={{ campaigns, today: data.today, influencerOptions, onAttach: (taskId) => void attachPeek(taskId), onDetach: () => void detachPeek(), onCreateTask: async (campaignId, type) => { const r = await createTasksApi(campaignId, { type, influencers: peekDraft.influencerHandle ? [{ handle: peekDraft.influencerHandle }] : [] }); if (!r.ok) { show(r.error); return null; } return r.data.tasks[0].id; } }}` — `attachPeek` = `patchDraftApi(draftId, { taskId })` 후 `load()` + peekDraft 갱신; `detachPeek` = `patchDraftApi(draftId, { taskId: null })`.

- [ ] **Step 4: 확인·Commit** — `npx tsc --noEmit && npm run lint`

```bash
git add src/components/DraftTaskField.tsx src/components/DraftCard.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(campaign-task): 원고 카드 '작업' 칸 — 작업에 붙이기/떼기/새 작업 만들기, 예정일·비용은 읽기 + '작업에서 고치기'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: `/generate?task=` 진입·배너·직접 쓰기, 카드 배선

**Files:**
- Modify: `src/app/generate/page.tsx`, `src/components/DraftWriteModal.tsx`, `src/components/DraftFilterBar.tsx`(문구만), `src/lib/draftUi.ts`(변경 없음 — campaignId 필터는 파생값으로 그대로 동작)

- [ ] **Step 1: page.tsx** — `?campaign=` 진입점 D를 `?task=`로:
  - 상태 `campaignCtx: CampaignRow | null` → `taskCtx: { taskId: string; campaign: CampaignRow; type: TaskType; influencerHandle: string | null } | null`. 진입 시 `apiFetch(\`/api/campaigns/${?}\`)`가 필요 없도록 **작업 조회 라우트**를 하나 더 두지 않고, `GET /api/campaigns/[id]` 상세를 부르려면 캠페인 id가 필요하다 → 진입 파라미터를 `?task=<taskId>&campaign=<campaignId>`로 한다(TaskAddModal의 이동 URL도 `/generate?task=${id}&campaign=${campaign.id}`, DraftTaskField의 "새로 만들기"도 동일). 상세 응답의 `tasks.find(id)`로 ctx 구성. 없으면 토스트 `'링크가 가리키는 작업을 찾을 수 없어요 — 삭제됐을 수 있어요'` + 주소에서 두 파라미터 제거.
  - 클라 자동 선택은 `ctx.campaign.clientId`로(기존 로직 그대로). 필터 `campaignId`는 `ctx.campaign.id`.
  - 배너: `<b>{ctx.campaign.name} · {TASK_TYPE_LABEL[ctx.type]}{ctx.influencerHandle ? ` @${ctx.influencerHandle}` : ''}</b> 작업에 붙이는 원고를 만들고 있어요 — 지금 만드는 원고(생성·직접 쓰기)가 이 작업에 붙어요` + [해제]. **작업에 원고가 이미 붙었으면**(생성 성공 뒤) 배너를 `'이 작업에 원고가 붙었어요 — 더 만들면 작업 없이 저장돼요'`로 바꾸고 이후 요청엔 taskId를 싣지 않는다(원고 1개 = 작업 1개). 다중 시안(count>1)이면 첫 시안만 붙는다는 안내 한 줄.
  - 생성 body: `...(taskCtx && !taskCtx.attached ? { taskId: taskCtx.taskId } : {})`. 성공 응답의 첫 원고 `taskId`가 있으면 `attached: true`.
  - `changeCampaign/changeScheduledOn/changeCost`·`cardCampaign` 제거 → `cardTask = (d) => ({ campaigns, today, influencerOptions, onAttach: (taskId) => attachDraft(d, taskId), onDetach: () => attachDraft(d, null), onCreateTask: async (campaignId, type) => {…createTasksApi…} })`. `attachDraft(d, taskId)` = 낙관적 없이 `patchDraft(d.id, { taskId })` 응답으로 행 교체(파생 필드가 서버에서 온다).
  - DraftCard 호출 두 곳 `campaign={cardCampaign(d)}` → `task={cardTask(d)}`.
- [ ] **Step 2: DraftWriteModal** — props `campaignId/campaignName` → `taskId: string | null; taskLabel: string | null`(표시용 `'마인드스킨 9월 1주 · 투고 @mika'`). body `...(taskId ? { taskId } : {})`. 승계 조건 줄 `taskLabel ? \`${taskLabel} 작업\` : null`.
- [ ] **Step 3: 확인** — `npx tsc --noEmit && npm run lint`, 그리고 koo 화면 확인 2차(`/generate?task=…&campaign=…` 배너·붙임, 원고 카드 작업 칸, 인플 프로필).
- [ ] **Step 4: Commit**

```bash
git add src/app/generate/page.tsx src/components/DraftWriteModal.tsx src/components/DraftFilterBar.tsx src/app/campaigns
git commit -m "feat(campaign-task): /generate?task= — 작업에 붙이는 원고 만들기 배너·자동 부착(첫 시안만)·직접 쓰기, 카드 작업 칸 배선

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: 정리 — 옛 코드 삭제·전체 테스트·린트·업데이트 소식

**Files:**
- Delete: `src/app/campaigns/ContentTable.tsx`, `src/app/campaigns/useCampaignDraftActions.ts`, `src/components/DraftCampaignField.tsx`, `src/lib/draftCampaignOptions.ts`, `src/lib/draftCampaignOptions.test.ts`
- Modify: `src/lib/campaignJudgment.ts`(옛 콘텐츠 블록 제거), `src/lib/campaignCost.ts`(`DraftCost`·`parseDraftCost`·`suggestDraftCost` 제거), `src/lib/campaignJudgment.test.ts`(옛 함수 테스트 제거), `src/lib/campaignTableView.ts`(`contentTypeLabel`·`scheduledOnLabel`·`overdueDays` 등 원고용 제거 — 남아 있는 소비자 없음 확인), `src/content/updates.ts`, 스펙 상태 줄

- [ ] **Step 1: 삭제·정리**

`git rm` 위 5개. `campaignJudgment.ts`에서 `defaultCostType`·`ContentStage`·`STAGE_LABEL`·`StageInput`·`contentStage`·`isOverdue`·`isPreparing`·`PREPARING_STATUSES`·`matchesStageFilter`·`summarizeStages`·`summarizePerf`(→ `summarizeTaskPerf`만)·`sortContent`·`ContentSortKey`·`CostInput`·`InfluencerLine`·`deriveInfluencers`·`campaignTotal` 제거. **단** `StageFilter`·`STAGE_FILTERS`·`STAGE_FILTER_LABEL`·`PREPARING_LABEL`·`PerfSummary`·`isOutOfRange`·`CostRowInput`·날짜 헬퍼·캠페인 상태·이름 제안은 남긴다. `grep -rn "contentStage\|summarizeStages\|deriveInfluencers\b\|sortContent\|defaultCostType\|DraftCost\|parseDraftCost\|suggestDraftCost\|StageInput\|CampaignDraftItem\|listDraftsByCampaign\|fetchCandidateDrafts\|bulkCampaignApi\|draftCount\|contentCount" src` → 0건이어야 한다(테스트 파일 포함).

- [ ] **Step 2: 전체 검증**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc 0 · 린트 경고 ≤ 24(기준선, 새 경고 0) · 테스트 전부 PASS(≈4분). 실패가 있으면 여기서 고친다.

- [ ] **Step 3: 업데이트 소식** — `src/content/updates.ts` 맨 위에 추가(AGENTS.md 규칙: 사용자 말, 내부 용어 금지, 바뀐 방식 반드시):

```ts
  {
    date: '2026-08-29',
    type: '새 기능',
    title: '캠페인에 RT·인용RT·방문협찬도 작업으로 올릴 수 있어요 — "원고 추가"가 "작업 추가"로 바뀌었어요',
    summary: '캠페인 화면의 단위가 원고에서 작업으로 바뀌었어요. 투고·인용RT·RT·방문협찬 네 가지를 각각 한 건으로 올리고, 원고는 그중 우리가 써서 전달하는 작업에 붙여요. RT처럼 원고가 없는 일도 이제 비용과 예정일을 갖고, 게시가 확인되면 정산 후보가 돼요.',
    bullets: [
      '[+ 작업 추가]에서 유형을 먼저 고르고, RT·인용RT는 대상 게시글을 먼저 정해요. 인플루언서를 여러 명 고르면 사람 수만큼 작업이 생기고, 비용은 명부 단가로 사람별로 채워져요(고칠 수 있어요)',
      '[게시 확인하기]를 누르면 RT 대상 게시글의 리포스트 계정을 찾아 게시 확인을 자동으로 채워요(게시글 1개당 $0.001). 투고·인용RT·방문협찬은 단계 칸을 눌러 직접 게시됨으로 표시해요',
      '게시했다가 내려간 글은 "내려짐"으로 표시하고 사유를 남겨요 — 정산할지는 정산 화면에서 판단해요(자동으로 빠지지 않아요)',
      '원고를 캠페인에 넣는 대신 작업에 붙여요 — 원고 카드의 "캠페인" 칸이 "작업" 칸이 됐고, 예정일·비용은 캠페인 화면에서 고쳐요(원고 카드에선 보기만)',
      '방문협찬은 방문일과 게시 예정일을 따로 적고, 달력에 두 날 모두 보여요',
      '기존에 캠페인에 넣어둔 원고는 같은 유형·비용의 작업으로 자동 옮겨졌어요',
    ],
    link: { label: '캠페인', href: '/campaigns' },
  },
```
`node --import tsx --test src/lib/updates.test.ts` 통과 확인.

- [ ] **Step 4: 스펙 상태 갱신** — 스펙 문서 첫 줄 `상태:`를 `구현 완료(08-29, Task 1~17) — koo QA·이관·머지 대기`로.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib src/app src/components src/content/updates.ts docs/superpowers/specs/2026-08-28-campaign-task-design.md
git commit -m "chore(campaign-task): 원고 기반 캠페인 코드 제거·전체 테스트/린트 통과·업데이트 소식

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 18: 이관 스크립트 + 배포 절차 메모

**Files:**
- Create: `scripts/cutover-campaign-task.ts`
- Modify: `README.md`(배포 절차 한 단락) 또는 `docs/superpowers/plans/2026-08-28-campaign-task.md` 끝의 "배포 절차" 절(아래)

- [x] **Step 1: 스크립트** — `scripts/cutover-campaign-task.ts`. `smoke-expansion.ts`·`backfill-quoted.ts` 관례를 따라 async IIFE로 감쌌다(top-level await 아님). 확인용 `console.table`은 `campaign_task`를 `campaign`과 join해 `campaign_name, type, influencer_handle, cost, posted_at`을 보여준다(테스트 캠페인을 이름 패턴으로 거르는 대신, 사람이 캠페인명을 보고 눈으로 판단).

```ts
// 캠페인 작업 전환 이관(스펙 2026-08-28 §2-2 ②) — draft.campaign_id가 있는 원고를 작업 1행으로, 연결된 게시물을 작업으로.
// 사용: npx tsx --env-file=.env scripts/cutover-campaign-task.ts [--dry-run]
// 순서: 038 적용 → (새 코드 배포 직전) 이 스크립트 → 새 코드 배포 → 039 적용(draft 3컬럼 drop). 재실행 안전.
import { getSql } from '../src/lib/db.ts';
import { cutoverDraftsToTasks } from '../src/lib/campaignTaskStore.ts';

(async () => {
  const dry = process.argv.includes('--dry-run');
  const sql = getSql();
  try {
    const pending = await sql<Array<{ n: string | number }>>`
      select count(*) as n from draft d where d.campaign_id is not null and not exists (select 1 from campaign_task t where t.draft_id = d.id)`;
    console.log(`이관 대상 원고: ${pending[0].n}건`);
    if (dry) {
      console.log('(dry-run — 변경 없음)');
    } else {
      const r = await cutoverDraftsToTasks(sql);
      console.log(`작업 생성 ${r.tasks}건 · 게시물 연결 이전 ${r.trackedPosts}건`);
      const check = await sql<Array<{
        campaign_name: string; type: string; influencer_handle: string | null; cost: unknown; posted_at: string | null;
      }>>`
        select c.name as campaign_name, t.type, t.influencer_handle, t.cost, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at
          from campaign_task t
          join campaign c on c.id = t.campaign_id
         order by t.created_at`;
      console.table(check);
    }
  } finally {
    await sql.end();
  }
})();
```

- [x] **Step 2: dry-run** — `npx tsx --env-file=.env scripts/cutover-campaign-task.ts --dry-run` → `이관 대상 원고: 0건`. **0건인 이유(예상됨, 오류 아님):** `npm test`가 실서버 DB에 대고 `cutoverDraftsToTasks`를 이미 실행해 프로덕션 원고(마인드스킨클리닉 9월 1주, draft `864183b7-…`)가 이미 작업(`ebebc575-…`, 인용RT ₩30,000, @my_lyun)으로 이관돼 있다 — 위 select는 "아직 안 옮겨진" 원고만 센다. 실행(--dry-run 없이)은 배포 직전에 koo 확인 후.

- [x] **Step 3: 배포 절차(이 계획 문서 끝에 그대로 둔다)**

1. `git checkout main && git merge --no-ff cb-koo/campaign-task`(스쿼시 여부는 기존 관례) — 머지 전 `src/content/updates.ts` 항목 확인.
2. `psql -f migrations/038_campaign_task.sql`(이미 적용됨 — 재실행 안전). **`scripts/apply-migrations.sh`(= `npm run migrate`)는 이 시점에 실행하지 않는다** — 그 스크립트는 `migrations/` 전 파일을 순서대로 재실행하므로 039(draft 3컬럼 drop)까지 배포 전에 적용돼 버려, 아직 떠 있는 옛 코드가 깨진다. 038만 `psql -f`로 개별 적용.
3. `npx tsx --env-file=.env scripts/cutover-campaign-task.ts --dry-run`으로 이관 대상 건수 확인. **`npm test`가 실서버 DB에 대고 `cutoverDraftsToTasks`를 이미 돌렸다면(개발 중 테스트 실행) 대상이 0건으로 나올 수 있다** — 이미 `campaign_task`에 원고가 이관돼 있다는 뜻이므로 정상이다.
4. 이관 전 확인: `select t.influencer_handle, t.cost, t.scheduled_on, d.influencer_handle, d.cost, d.scheduled_on from campaign_task t join draft d on d.id = t.draft_id where d.campaign_id is not null;`로 이미 존재하는 작업 행이 원고의 **현재** 값(핸들·비용·예정일)과 같은지 확인한다. 다르면(원고를 이후에 고쳤는데 작업 행이 안 바뀐 경우) 그 작업 행을 `delete`하고 스크립트를 다시 실행한다.
5. `npx tsx --env-file=.env scripts/cutover-campaign-task.ts`(--dry-run 없이. 대상이 이미 0건이면 이관 없이 확인 표만 찍는다).
6. `vercel --prod`(`.vercel/project.json`의 projectId `prj_CoEqjNZytAqwaXXdgAxw2SgiEL34` 확인).
7. 배포 확인 후 `psql -f migrations/039_campaign_task_cutover.sql`.
8. 스모크: `/campaigns`에서 마인드스킨클리닉 9월 1주에 작업 1건(인용RT @my_lyun ₩30,000, 원고 붙음)이 보이는지.

- [ ] **Step 4: Commit**

```bash
git add scripts/cutover-campaign-task.ts docs/superpowers/plans/2026-08-28-campaign-task.md
git commit -m "chore(campaign-task): 이관 스크립트(dry-run 지원) + 배포 절차

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
