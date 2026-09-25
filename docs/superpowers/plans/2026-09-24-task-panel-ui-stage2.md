# 작업 패널 UI 개편 — 2단계(고르고 등록) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캠페인 v2 작업 패널에서 이 작업에 쓸 결제 수단을 고르고(§8-2)·그 자리에서 새로 등록하며(§8-3), 사람이 입력하는 모든 인플 칸을 "명부에서 고르기 / 명부에 등록하고 배정"으로 막고 서버도 명부 밖 핸들을 새로 저장하지 않게 한다(§9).

**Architecture:** DB는 `campaign_task.payment_method_id text` 칸 하나만 더한다(060, 추가만). "이 작업의 수단" 판정은 순수 함수 `taskPaymentMethod` 하나로 정산 후보·제자리 수정·캠페인 수수료 합계·패널이 같이 쓴다. 명부 판정은 서버 잎 모듈 `taskAssignGate.ts`(라우트 5곳 + `attachDraft`)와 화면 순수 모듈 `rosterPick.ts`(콤보박스·칩·교체 창) 두 곳이며, 둘 다 `lower(handle)` 비교 + 명부 표기 저장이라는 같은 규칙을 쓴다. 화면은 `InfluencerField`에 명부 전용 콤보박스 모드를 더하고, 명부 읽기·등록은 공용 훅 `useInfluencerRoster` 하나가 쥔다.

**Tech Stack:** 이 저장소의 커스텀 Next.js 16(App Router — 코드 전에 `node_modules/next/dist/docs/`의 해당 가이드 확인, AGENTS.md), React 19 + React Compiler 린트, Tailwind v4 토큰(`text-content`=15px·`text-ui`=13px·`text-caption`=11px, `x-*` 색), postgres.js, `node --import tsx --test`, psql(`npm run migrate:staging`).

**설계 문서:** `docs/superpowers/specs/2026-09-23-task-panel-ui-design.md` — 범위는 §8-2·§8-3·§9(09-24 개정본: 화면 + 서버)와 §10 표의 2단계 줄. 1단계 계획(`docs/superpowers/plans/2026-09-23-task-panel-ui-stage1.md`)은 머지·배포 끝(main `b5f468e`). 이 계획은 같은 브랜치 `cb-koo/task-panel-ui`(HEAD `3df81fb`) 위에서 이어 간다.

## Global Constraints

- 마이그레이션은 `060` 한 개, **추가만**(`alter table … add column if not exists`), 전 문장 멱등, 트랜잭션 안에서 도는 문장만. 이미 올라간 059 이하 파일은 건드리지 않는다(AGENTS.md "마이그레이션과 배포 순서"). 1번 머지로 끝난다.
- `payment_method_id`는 인플 `payment_methods[].id` **참조**다(스냅샷 아님). null = 인플의 기본 수단. 인플이 **대소문자 말고 실제로** 바뀔 때만 비운다(`updateTask`·`replaceInfluencer`) — `renameInfluencer`는 같은 사람이라 유지(그래서 트리거로 하지 않는다).
- "이 작업의 수단" = `taskPaymentMethod(methods, chosenId)` 하나 — 고른 id가 목록에 있으면 그것, 없으면 기본. 같은 판정을 다른 파일에서 다시 만들지 않는다.
- 활성 정산 요청이 있으면 서버가 `paymentMethodId` 변경을 거부한다. '활성' = `status = 'requested' and coalesce(external_status,'') <> 'cancelled'` — 패널의 잠금 표시(`loadPaymentView`)·단계 판정(`flowStage`)과 같은 조건(`hasActiveRequest`의 status-only 조건과 다르다 — 화면이 열려 보이는데 서버가 막는 어긋남을 피한다).
- 명부 게이팅: 사람을 **새로 넣거나 바꿀 때만** 판정한다. 해제(null)·같은 사람(대소문자만 다름)·명부 밖으로 이미 저장된 행의 다른 칸 편집은 막지 않는다. 비교는 `lower(handle)`, 저장 표기는 명부 표기.
- 서버 게이팅은 **라우트**(작업 POST·PATCH·교체, 원고 단건 PATCH·일괄 PATCH)와 **`attachDraft`**에서 한다 — 저장소 함수(`createTasks`·`updateTask`·`replaceInfluencer`)에는 넣지 않는다(설계 §9 "서버"와 다름 — 이유는 맨 아래 "설계와 다르게 정한 것" 1).
- 서버 명부 판정 모듈(`src/lib/taskAssignGate.ts`)은 잎 모듈이다 — `postgres` 타입과 `influencerPayment.ts`(순수)만 import한다. `campaignTaskStore.ts`가 값으로 import하므로 `influencerStore`·`draftStore`를 import하면 순환이 생긴다(`campaignTaskStore.ts` 머리 주석).
- 클라이언트 컴포넌트는 서버 모듈을 **값으로** import하지 않는다(1단계에서 이것 하나가 빌드를 깼고 tsc·lint·테스트는 못 잡았다). 화면이 값으로 쓰는 판정은 `rosterPick.ts`·`paymentChoice.ts`·`paymentMethodDraft.ts`·`influencerPayment.ts`(전부 DB·postgres 값 import 없음)에만 둔다. 클라이언트 파일을 고친 태스크는 전부 `npx next build`로 끝낸다.
- 결제 수단(계좌·이메일·QR)은 `listOptions`·`settlementByTaskIds`·FlowRow에 싣지 않는다 — 인플 한 명 단위 조회(`/api/influencers/payment-view`)로만. FlowRow에는 `paymentMethodId`(id 문자열)만 실린다.
- 문구(§10 표가 우선): 평소 상태엔 도움말 없음, 막힘·주의만 짧게 한 줄, 긴 이유는 ⓘ(`title` + `aria-label`). 오류 문구(무엇을 하면 되는지)는 줄이지 않는다. 결제 수단 소제목 옆 `· 이 작업에만 적용`은 **고를 수 있을 때만**(수단 2개 이상·요청 전) 붙인다(UX 원칙 4 — 고를 게 없는데 적용 범위를 말하지 않는다).
- 명부 입력칸의 확정 콜백(`onCommit`)은 **명부 표기 핸들을 믿는다 — 받는 쪽이 다시 명부 판정을 하지 않는다.** '등록하고 배정'은 await 뒤 같은 틱에 콜백을 부르므로 그때 받는 쪽 클로저의 명부 목록은 등록 전 것이다(다시 판정하면 방금 등록한 사람이 '명부 밖'으로 나온다). 판정은 콤보박스(`resolveRosterInput`)와 칩의 [저장] 버튼 두 곳뿐.
- 비용 유발(X 조회) 동작은 누르는 opt-in만: 명부에 없는 핸들은 Enter·blur로 배정하지 않고 `@핸들 명부에 등록하고 배정` 버튼을 눌러야 `POST /api/influencers`가 나간다(UX 원칙 6).
- 도구 화면 밀도: 본문 15px(`text-content`), 보조 13px 이상(`text-ui`) — `text-caption`(11px)을 새로 쓰지 않는다. 후보 행 높이 44px 이상(`min-h-11`), 한 행 정보 6개 이하.
- 테스트는 연습용 DB에서만: 단일 파일 `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/<파일>.test.ts`(순수 파일은 `node --import tsx --test src/lib/<파일>.test.ts`). 전체 `npm test`(약 17분)는 마지막 태스크에서 한 번. 운영 DB로 도는 명령(`npm run test:prod`·`npm run migrate`)은 쓰지 않는다.
- 진짜 X API를 부르는 테스트를 쓰지 않는다 — `POST /api/influencers`(등록 흐름)는 테스트가 건드리지 않는다. 테스트는 `taskAssignGate.ts`·`attachDraft`·순수 모듈만 본다. 등록 흐름은 수동 QA(Task 13)에서만.
- `payment_request` 행을 만드는 테스트는 `src/lib/settlementStore.test.ts` 안에서만, 그 파일의 핸들 헬퍼 `H()`(접두어 `tstl`)로 만든다 — `settlementTestFixture.ts`의 `TEST_FIXTURE_HANDLE_RE`에 등록된 접두어라 정산 프로덕트 폴링에 안 보인다. 새 테스트 파일에서 요청 행을 만들지 않는다.
- 린트는 기준선 **24개** 대비 증감 0. `react-hooks/set-state-in-effect`(이펙트 본문의 동기 setState)·`react-hooks/refs`(렌더 중 ref 읽기)는 에러다.
- 커밋은 경로를 명시해 스테이징한다(`git add -A` 금지 — 워크트리를 여러 세션이 공유한다). push된 커밋은 amend하지 않는다. 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- 병렬 묶음은 묶음마다 별도 워크트리(`superpowers:using-git-worktrees`)에서 돌리고, 워크트리마다 `.env.staging`을 링크한다(새 워크트리엔 `.env`류가 없다 — gitignore). 앞 묶음이 브랜치에 합쳐진 뒤 다음 묶음을 연다.

## 파일 지도와 병렬 묶음

| 묶음 | 태스크 | 만지는 파일(겹치지 않음) | 선행 |
|---|---|---|---|
| G0 | 0 기준선 | 없음 | — |
| G1(단독) | 1 칸 060 + 작업 행 배관 + `attachDraft` 명부 규칙 | `migrations/060_*.sql`, `src/lib/taskAssignGate.ts`(+test), `src/lib/campaignTaskStore.ts`(+test), `src/lib/campaignFlowView.test.ts` | 0 |
| G2(병렬 4) | 2 입력 검증·API 타입 | `src/lib/campaignTaskInput.ts`(+test), `src/lib/campaignApi.ts`, `src/lib/taskCreateBody.ts`(+test) | 1 |
| | 3 `taskPaymentMethod` + 정산 후보·수수료 합계 | `src/lib/influencerPayment.ts`(+test), `src/lib/settlementStore.ts`(+test), `src/lib/campaignStore.ts`(+test) | 1 |
| | 4 결제 수단 폼 떼어 공용으로 | `src/lib/paymentMethodDraft.ts`(+test), `src/components/PaymentMethodForm.tsx`, `src/components/PaymentQrField.tsx`(이동), `src/app/influencers/PaymentSection.tsx` | 0 |
| | 5 명부 판정(화면) + 명부 훅 | `src/lib/rosterPick.ts`(+test), `src/components/useInfluencerRoster.ts` | 0 |
| G3(병렬 3) | 6 서버 게이팅 — 라우트 5곳 | 라우트 5개, `src/lib/taskAssignGate.ts`(+test), `src/lib/settlementStore.test.ts`(테스트 1건 추가) | 1·2 |
| | 7 결제 수단 보기 넓히기 | `src/lib/paymentChoice.ts`(+test), `src/lib/paymentView.ts`(+test) | 3 |
| | 8 명부 전용 콤보박스·칩 | `src/components/InfluencerField.tsx`, `src/components/InfluencerChip.tsx`, `src/components/DraftCard.tsx`, `src/components/BulkActionBar.tsx` | 5 |
| G4(병렬 2) | 9 /generate 연결 | `src/app/generate/page.tsx` | 8 |
| | 10 캠페인 v2 인플 칸 연결 | `src/app/campaigns/flow/FlowDetail.tsx`, `ReplaceDialog.tsx`, `TaskPanel.tsx`, `panel/InfluencerSummary.tsx` | 6·8 |
| G5(단독) | 11 결제 수단 고르기·등록 | `TaskPanel.tsx`, `panel/PaymentLine.tsx`, `panel/PaymentMethodDialog.tsx`(새), `panel/PanelSection.tsx`(주석) | 2·4·6·7·10 |
| G6 | 12 업데이트 소식 → 13 최종 검증·QA | `src/content/updates.ts` | 전부 |

DB 테스트가 병렬로 겹치는 조합: G2는 Task 3만 DB를 쓰고(정산 설정 마커를 까는 두 테스트 파일이 같은 태스크 안에서 순서대로 돈다), G3는 Task 6(`taskAssignGate`·`settlementStore` 1건)과 Task 7(`paymentView` — 정산 설정을 안 건드린다)이라 서로 안 밟는다.

---

### Task 0: 기준선

**Files:** 없음

- [ ] **Step 1: 워크트리·환경 확인**

Run: `cd ~/orca/workspaces/cb-x-deck/task-panel-ui && git status -sb && git log --oneline -1 && ls -la .env .env.staging && cat .vercel/project.json && which psql`
Expected: 브랜치 `cb-koo/task-panel-ui`, HEAD `3df81fb`(또는 그 뒤), `.env`·`.env.staging` 존재, `"projectName":"cb-x-deck"`, psql 경로가 나온다.

- [ ] **Step 2: 타입·린트 기준선**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npm run lint 2>&1 | tail -2`
Expected: `tsc=0`, 린트 마지막 줄 `✖ 24 problems` — 이후 모든 태스크의 통과 기준(다르면 이 계획 맨 아래 "기준선" 줄을 실제 값으로 고치고 그 값을 기준으로 삼는다).

---

### Task 1: 칸 060 + 작업 행의 결제 수단 배관 + `attachDraft` 명부 규칙 (§8-2·§9) — G1 단독

`campaignTaskStore.ts`는 결제 수단 흐름과 명부 흐름이 둘 다 만지는 파일이라 한 태스크에서 끝낸다(병렬 워크트리에 나누면 충돌한다).

**Files:**
- Create: `migrations/060_campaign_task_payment_method.sql`
- Create: `src/lib/taskAssignGate.ts`, `src/lib/taskAssignGate.test.ts`
- Modify: `src/lib/campaignTaskStore.ts` — `TaskRow`(20-40)·`TaskCreateInput`(41-46)·`TaskPatch`(47-53)·`Row`(65-78)·`toRow`(94-113)·`SELECT`(116-133)·`createTasks`(151-175)·`updateTask`(179-201)·`attachDraft`(212-238)·`replaceInfluencer`(506-508)
- Modify: `src/lib/campaignTaskStore.test.ts` — import(8-11)·`after`(17-24)·attach 테스트의 'hana' 줄(92-95)·새 테스트 2개
- Modify: `src/lib/campaignFlowView.test.ts:12-19` (`mk()` 픽스처)

**Interfaces:**
- Produces:
  - DB `campaign_task.payment_method_id text null`
  - `TaskRow.paymentMethodId: string | null` (→ `FlowRow`·`CampaignTaskItem`에 그대로 실린다)
  - `TaskCreateInput.items[].paymentMethodId?: string | null`, `TaskPatch.paymentMethodId?: string | null`
  - `ROSTER_REQUIRED_MESSAGE = '명부에 없는 인플이에요 — 명부에 먼저 등록해 주세요'`
  - `rosterHandleOf(sql: postgres.Sql, handle: string): Promise<string | null>` — 명부 표기 핸들 또는 null

- [ ] **Step 1: 마이그레이션 파일**

```sql
-- migrations/060_campaign_task_payment_method.sql
-- 060: 작업별 결제 수단(설계 2026-09-23-task-panel-ui-design.md §8-2, koo 결정 "이 작업만")
-- 값은 인플 influencer.payment_methods[].id를 가리키는 참조다 — 스냅샷이 아니다(스냅샷은 정산 요청 때 이미 뜬다).
-- null = 인플의 기본 수단을 따른다. jsonb 안의 id라 FK를 걸 수 없다 — 고른 수단이 나중에 지워지면
-- 읽는 쪽(influencerPayment.taskPaymentMethod)이 기본 수단으로 돌아간다.
-- 칸 추가만(AGENTS.md "마이그레이션과 배포 순서") — 옛 코드는 이 칸을 모르니 무해하고, 1번 머지로 끝난다.
-- 인플이 실제로 바뀔 때 비우는 일은 트리거가 아니라 코드(updateTask·replaceInfluencer)가 한다 —
-- 개명(renameInfluencer)은 같은 사람이라 값을 유지해야 해서 트리거로는 구분할 수 없다.
alter table campaign_task add column if not exists payment_method_id text;
```

- [ ] **Step 2: 연습용 DB에 적용**

Run: `npm run migrate:staging 2>&1 | tail -3`
Expected: `== applying migrations/060_campaign_task_payment_method.sql` 다음 `== done`. (전 파일을 다시 돌리므로 059 이하의 NOTICE가 섞여 나와도 정상.)

- [ ] **Step 3: 실패하는 테스트 — 명부 판정**

```ts
// src/lib/taskAssignGate.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createInfluencer } from './influencerStore.ts';
import { rosterHandleOf } from './taskAssignGate.ts';

const sql = getSql();
const P = 'tgate' + process.pid;

after(async () => {
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

test('1) 명부 판정 — 대소문자 무관, 명부 표기를 돌려준다, 없으면 null', async () => {
  await createInfluencer(sql, { handle: P + '_Sakura', createdBy: null });
  assert.equal(await rosterHandleOf(sql, P + '_sakura'), P + '_Sakura');
  assert.equal(await rosterHandleOf(sql, P + '_SAKURA'), P + '_Sakura');
  assert.equal(await rosterHandleOf(sql, P + '_nobody'), null);
});
```

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/taskAssignGate.test.ts`
Expected: FAIL — `Cannot find module './taskAssignGate.ts'`

- [ ] **Step 4: 구현 — 잎 모듈**

```ts
// src/lib/taskAssignGate.ts
// 작업·원고에 사람을 넣을 때의 서버 관문(설계 §9·§8-2) — 라우트 5곳과 campaignTaskStore.attachDraft가 같이 쓴다.
// 잎 모듈이다: campaignTaskStore가 값으로 import하므로 여기서 influencerStore·draftStore를 import하면
// campaignTaskStore ↔ draftStore 순환이 생긴다(campaignTaskStore.ts 머리 주석). 명부는 SQL 한 줄로 직접 본다.
import type postgres from 'postgres';

// 라우트가 400으로 돌려주는 문구 — 무엇을 하면 되는지까지 말한다(옛 /campaigns 화면도 이 문구를 그대로 띄운다)
export const ROSTER_REQUIRED_MESSAGE = '명부에 없는 인플이에요 — 명부에 먼저 등록해 주세요';

// 명부 표기 핸들(대소문자 무관 비교, 지금 관례) 또는 null. 저장은 이 표기로 맞춘다(§9 "저장 표기는 명부 표기로").
export async function rosterHandleOf(sql: postgres.Sql, handle: string): Promise<string | null> {
  const rows = await sql<Array<{ handle: string }>>`
    select handle from influencer where lower(handle) = lower(${handle}) limit 1`;
  return rows[0]?.handle ?? null;
}
```

Run: Step 3 명령 → PASS 1/1

- [ ] **Step 5: 실패하는 테스트 — 작업 행 배관·비우기·attachDraft 명부 규칙**

`src/lib/campaignTaskStore.test.ts` 맨 위 import에 두 줄을 더한다:
```ts
import { createInfluencer } from './influencerStore.ts';
```
그리고 `campaignTaskStore.ts` import 목록(8-11행)에 `replaceInfluencer`를 추가한다.

`after`(17-24행)의 `await sql.end();` 바로 위에:
```ts
  await sql`delete from influencer where handle like ${P + '%'}`;
```

92-95행(원고 인플이 비어 있는 작업을 채우는 부분)을 명부 인플로 바꾼다 — 이제 명부에 있어야만 채운다:
```ts
  // 원고 인플이 명부에 있고 작업이 비어 있으면 붙일 때 작업 쪽으로 채운다 — 명부 표기로(설계 §9)
  await createInfluencer(sql, { handle: P + 'Hana', createdBy: null });
  await updateDraft(sql, other, { influencerHandle: P + 'hana' });
  await attachDraft(sql, t2.id, other);
  assert.equal((await getTask(sql, t2.id))!.influencerHandle, P + 'Hana');
```

파일 끝에 새 테스트 두 개:
```ts
test('060) 작업별 결제 수단 — 생성·패치 왕복, 인플이 실제로 바뀌면 비고 대소문자만 바뀌면 유지, 교체도 비운다', async () => {
  const c = await createClient(sql, P + '클라pm');
  const camp = await mkCampaign(c.id, c.name, 'pm');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: 'pmA', cost: null, paymentMethodId: 'm-1' }] });
  assert.equal(t.paymentMethodId, 'm-1');
  await updateTask(sql, t.id, { note: '메모' });
  assert.equal((await getTask(sql, t.id))!.paymentMethodId, 'm-1');        // 다른 칸 패치는 그대로
  await updateTask(sql, t.id, { influencerHandle: 'PMA' });
  assert.equal((await getTask(sql, t.id))!.paymentMethodId, 'm-1');        // 대소문자만 바뀜 = 같은 사람
  await updateTask(sql, t.id, { paymentMethodId: 'm-2' });
  assert.equal((await getTask(sql, t.id))!.paymentMethodId, 'm-2');
  await updateTask(sql, t.id, { paymentMethodId: null });
  assert.equal((await getTask(sql, t.id))!.paymentMethodId, null);         // null = 기본 수단으로
  await updateTask(sql, t.id, { paymentMethodId: 'm-3' });
  await updateTask(sql, t.id, { influencerHandle: null });
  assert.equal((await getTask(sql, t.id))!.paymentMethodId, null);         // 해제 = 실제로 바뀜
  await updateTask(sql, t.id, { influencerHandle: 'pmA', paymentMethodId: 'm-4' });
  assert.equal((await getTask(sql, t.id))!.paymentMethodId, 'm-4');        // 한 요청에 둘 다 오면 명시값이 이긴다
  const r = await replaceInfluencer(sql, t.id, { handle: 'pmB', cost: undefined, reason: null, note: '', actorId: null, today: '2026-09-24' });
  assert.equal(r, 'ok');
  assert.equal((await getTask(sql, t.id))!.paymentMethodId, null);         // 다른 사람의 수단 id가 남으면 안 된다
});

test('명부 게이팅 — attachDraft: 원고 핸들이 명부 밖이면 미배정 작업을 채우지 않는다(붙이기는 성공, 원고 핸들은 그대로)', async () => {
  const c = await createClient(sql, P + '클라명부');
  const camp = await mkCampaign(c.id, c.name, 'roster');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [] });
  const d = await mkDraft(c.id, c.name);
  await updateDraft(sql, d, { influencerHandle: P + 'coco' });
  await attachDraft(sql, t.id, d);
  const got = await getTask(sql, t.id);
  assert.equal(got!.draftId, d);
  assert.equal(got!.influencerHandle, null);
  assert.equal((await getDraft(sql, d))!.influencerHandle, P + 'coco');   // 기존 데이터는 바꾸지 않는다
});
```

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignTaskStore.test.ts`
Expected: FAIL — tsc가 아니라 실행 오류로: `paymentMethodId` undefined ≠ `'m-1'`(또는 insert 오류), 'hana' 테스트는 `null ≠ P+'Hana'`가 아니라 지금은 `P+'hana'`로 채워져 표기 불일치로 FAIL, 명부 게이팅 테스트는 `P+'coco' ≠ null`로 FAIL.

- [ ] **Step 6: 구현 — `campaignTaskStore.ts`**

import에 한 줄(9행 위, 순환 주석 앞):
```ts
import { rosterHandleOf } from './taskAssignGate.ts';   // 잎 모듈 — 순환 없음(그 파일 머리 주석)
```

`TaskRow`의 `proof` 줄(26행) 아래에:
```ts
  paymentMethodId: string | null;   // 이 작업에만 쓸 결제 수단(060) — 인플 payment_methods[].id 참조, null = 기본 수단(설계 §8-2)
```

`TaskCreateInput.items`(45행):
```ts
  items: Array<{ handle: string | null; cost: TaskCost | null; scheduledOn?: string | null; visitOn?: string | null; paymentMethodId?: string | null }>;
```

`TaskPatch`의 `proof` 줄(52행)아래에:
```ts
  paymentMethodId?: string | null;   // 3값: undefined 유지 · null 기본 수단으로 · id 설정. 인플이 실제로 바뀌면 updateTask가 비운다
```

`Row`의 `proof: unknown;`이 있는 줄(70행) 끝에 ` payment_method_id: string | null;`를 더한다.

`toRow`의 `proof: taskProofOf(r.proof),`(100행) 아래에:
```ts
  paymentMethodId: r.payment_method_id,
```

`SELECT`의 `t.cost, t.note, t.proof, t.created_at, t.updated_at,`(121행)을:
```ts
         t.cost, t.note, t.proof, t.payment_method_id, t.created_at, t.updated_at,
```

`createTasks`의 insert(160-166행)를:
```ts
      const rows = await tx<Array<{ id: string }>>`
        insert into campaign_task (campaign_id, influencer_handle, type, target_task_id, target_tweet_url,
                                   scheduled_on, visit_on, cost, note, created_by, payment_method_id, created_at)
        values (${campaignId}, ${it.handle}, ${input.type}, ${input.targetTaskId}, ${input.targetTweetUrl},
                ${it.scheduledOn ?? input.scheduledOn}::date, ${it.visitOn ?? input.visitOn}::date,
                ${it.cost ? tx.json(it.cost as never) : null}, ${input.note}, ${input.createdBy},
                ${it.paymentMethodId ?? null}::text, clock_timestamp())
        returning id`;
```

`updateTask`의 `const rows = await sql\`update campaign_task set` 줄(181행) 바로 위에 주석 두 줄(이 파일은 SQL 템플릿 안에 주석을 두지 않는다):
```ts
  // 결제 수단(§8-2): 명시값이 먼저. 명시가 없고 인플이 대소문자 말고 실제로 바뀌면 비운다 — 다른 사람의 수단 id가 남으면 안 된다.
  // SET 식은 모두 옛 행 값을 본다(Postgres) — 아래 payment_method_id 식의 influencer_handle은 이번 갱신 전 값이다.
```
그리고 템플릿 안 `proof = …` 줄(194행) 아래에:
```ts
      payment_method_id = case
        when ${patch.paymentMethodId !== undefined} then ${patch.paymentMethodId ?? null}::text
        when ${patch.influencerHandle !== undefined}
             and lower(coalesce(${patch.influencerHandle ?? null}::text, '')) <> lower(coalesce(influencer_handle, '')) then null
        else payment_method_id end,
```

`attachDraft`의 224-228행을:
```ts
  const taskHandle = t[0].influencer_handle;
  const draftHandle = d[0].influencer_handle;
  // 명부 게이팅(설계 §9) — 원고 쪽 핸들로 미배정 작업을 채우는 것은 그 핸들이 명부에 있을 때만, 명부 표기로.
  // 명부 밖이면 작업은 미배정 그대로 두고 붙이기는 성공한다. 원고의 옛 핸들은 건드리지 않는다(기존 데이터 보존).
  const fill = !taskHandle && draftHandle ? await rosterHandleOf(sql, draftHandle) : null;
  try {
    await sql`update campaign_task set draft_id = ${draftId},
        influencer_handle = coalesce(influencer_handle, ${fill}::text), updated_at = now() where id = ${taskId}`;
```

`replaceInfluencer`의 update(506-508행)를:
```ts
    // 사람이 실제로 바뀌는 자리(같은 사람 재선택은 위에서 이미 no-op으로 끝났다) — 앞사람이 고른 결제 수단은 비운다(§8-2)
    await tx`update campaign_task set influencer_handle = ${input.handle}, payment_method_id = null,
        cost = case when ${input.cost !== undefined} then ${input.cost ? tx.json(input.cost as never) : null}::jsonb else cost end,
        updated_at = now() where id = ${id}`;
```

- [ ] **Step 7: 픽스처 — FlowRow `mk()`**

`src/lib/campaignFlowView.test.ts:15`의 `proof: null,` 뒤에 ` paymentMethodId: null,`를 더한다.

Run: `npx tsc --noEmit -p . ; echo tsc=$?`
Expected: `tsc=0`. 다른 파일이 `TaskRow`/`CampaignTaskItem` 객체 리터럴을 만들어 오류가 나면(예: `campaignTaskCancel.test.ts`), 오류가 가리키는 픽스처에 `paymentMethodId: null`을 더한다(값을 퍼뜨리는 `...t` 모양은 고칠 필요 없다).

- [ ] **Step 8: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignTaskStore.test.ts src/lib/taskAssignGate.test.ts src/lib/campaignTaskCancel.test.ts src/lib/draftStore.task.test.ts && node --import tsx --test src/lib/campaignFlowView.test.ts`
Expected: 전부 PASS(`attachDraft`를 쓰는 취소·원고 테스트가 같이 통과해야 한다 — 거기서 원고 핸들로 미배정 작업을 채우던 가정이 있으면 이 단계에서 드러난다. 드러나면 그 테스트의 원고 핸들을 `createInfluencer`로 명부에 먼저 넣는다).

- [ ] **Step 9: 커밋**

```bash
git add migrations/060_campaign_task_payment_method.sql src/lib/taskAssignGate.ts src/lib/taskAssignGate.test.ts src/lib/campaignTaskStore.ts src/lib/campaignTaskStore.test.ts src/lib/campaignFlowView.test.ts
git commit -m "feat(task-panel-ui): 작업별 결제 수단 칸(060)과 명부 밖 원고 핸들은 작업에 안 채우기

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(Step 7에서 다른 픽스처 파일을 고쳤으면 그 경로도 `git add`에 적는다.)

---

### Task 2: 입력 검증·API 타입에 `paymentMethodId` (§8-2) — G2

**Files:**
- Modify: `src/lib/campaignTaskInput.ts` — 메시지(35행 근처)·`TaskCreateBody`(115-120)·`parseTaskCreate` 줄 파싱(137-146)·`parseTaskPatch`(164-197)
- Modify: `src/lib/campaignTaskInput.test.ts` (새 테스트)
- Modify: `src/lib/campaignApi.ts:65-77` (`TaskCreateRequest`·`TaskPatchRequest`)
- Modify: `src/lib/taskCreateBody.ts`, `src/lib/taskCreateBody.test.ts`

**Interfaces:**
- Consumes: `TaskPatch.paymentMethodId`(Task 1)
- Produces:
  - `PAYMENT_METHOD_ID_MESSAGE = '결제 수단 값이 올바르지 않아요'`
  - `parseTaskPatch` 결과에 `paymentMethodId?: string | null`; `TaskCreateBody.influencers[].paymentMethodId?: string`(값이 있을 때만 키가 실린다)
  - `TaskPatchRequest.paymentMethodId?: string | null`, `TaskCreateRequest.influencers[].paymentMethodId?: string | null`
  - `TaskCreateFormState.paymentMethodId?: string | null` — `buildTaskCreateBody`가 사람 줄에 싣는다

- [ ] **Step 1: 실패하는 테스트**

`src/lib/campaignTaskInput.test.ts` import 목록에 `PAYMENT_METHOD_ID_MESSAGE`를 더하고 파일 끝에:
```ts
test('결제 수단 id(§8-2) — 패치: 온 키만, null·빈 문자열 = 기본으로, 모양이 틀리면 문구', () => {
  const a = parseTaskPatch({ paymentMethodId: 'b9f0c1d2-0000-4000-8000-000000000001' });
  assert.ok(a.ok && a.value.paymentMethodId === 'b9f0c1d2-0000-4000-8000-000000000001');
  const b = parseTaskPatch({ paymentMethodId: null });
  assert.ok(b.ok && b.value.paymentMethodId === null);
  const c = parseTaskPatch({ paymentMethodId: '' });
  assert.ok(c.ok && c.value.paymentMethodId === null);
  const d = parseTaskPatch({ note: 'x' });
  assert.ok(d.ok && !('paymentMethodId' in d.value));
  assert.deepEqual(parseTaskPatch({ paymentMethodId: 3 }), { ok: false, message: PAYMENT_METHOD_ID_MESSAGE });
  assert.deepEqual(parseTaskPatch({ paymentMethodId: 'a b' }), { ok: false, message: PAYMENT_METHOD_ID_MESSAGE });
  assert.deepEqual(parseTaskPatch({ paymentMethodId: 'x'.repeat(65) }), { ok: false, message: PAYMENT_METHOD_ID_MESSAGE });
});

test('결제 수단 id(§8-2) — 생성: 사람 줄에 있으면 싣고, 없으면 키 자체가 없다', () => {
  const ok = parseTaskCreate({ type: 'post', influencers: [{ handle: 'Rio', paymentMethodId: 'm-1' }, { handle: 'sora' }] });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.influencers[0].paymentMethodId, 'm-1');
    assert.equal('paymentMethodId' in ok.value.influencers[1], false);
  }
  assert.deepEqual(parseTaskCreate({ type: 'post', influencers: [{ handle: 'Rio', paymentMethodId: 7 }] }), { ok: false, message: PAYMENT_METHOD_ID_MESSAGE });
});
```

`src/lib/taskCreateBody.test.ts` 끝에:
```ts
test('고른 결제 수단은 사람 줄에 실린다 — 사람이 없으면 보내지 않는다', () => {
  const b = buildTaskCreateBody({ ...base, handle: 'asyako0520', paymentMethodId: 'm-2' });
  assert.deepEqual(b.influencers, [{ handle: 'asyako0520', cost: null, paymentMethodId: 'm-2' }]);
  assert.deepEqual(buildTaskCreateBody({ ...base, paymentMethodId: 'm-2' }).influencers, []);
  assert.deepEqual(buildTaskCreateBody({ ...base, handle: 'asyako0520', paymentMethodId: null }).influencers, [{ handle: 'asyako0520', cost: null }]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/campaignTaskInput.test.ts src/lib/taskCreateBody.test.ts`
Expected: FAIL — `PAYMENT_METHOD_ID_MESSAGE` export 없음 / `paymentMethodId` 없음

- [ ] **Step 3: 구현 — `campaignTaskInput.ts`**

`fail` 함수 정의(35행) 아래에:
```ts
export const PAYMENT_METHOD_ID_MESSAGE = '결제 수단 값이 올바르지 않아요';
// 결제 수단 id(§8-2) — 인플 payment_methods[].id(jsonb 안의 uuid 문자열)라 uuid 컬럼 캐스팅이 없다. 모양만 본다:
// 공백 없는 64자 이하 문자열. 목록에 실제로 있는지는 라우트가 인플 명부를 보고 판정한다(taskAssignGate.checkTaskPaymentMethod).
// null·'' = 기본 수단으로 되돌리기.
function parsePaymentMethodId(v: unknown): Parsed<string | null> {
  if (v === null || v === '') return { ok: true, value: null };
  if (typeof v === 'string' && v.length <= 64 && !/\s/.test(v)) return { ok: true, value: v };
  return fail(PAYMENT_METHOD_ID_MESSAGE);
}
```

`TaskCreateBody.influencers`(118행):
```ts
  influencers: Array<{ handle: string; cost: TaskCost | null; scheduledOn: string | null; visitOn: string | null; paymentMethodId?: string }>;
```

`parseTaskCreate`의 줄 파싱(137-146행)을:
```ts
  for (const it of raw) {
    const o = (it ?? {}) as { handle?: unknown; cost?: unknown; scheduledOn?: unknown; visitOn?: unknown; paymentMethodId?: unknown };
    const h = parseXHandle(String(o.handle ?? ''));
    if (!h.ok) return fail(handleParseMessage(h.reason));
    const c = o.cost === undefined ? { ok: true as const, value: null } : parseTaskCost(o.cost); if (!c.ok) return c;
    const s = dateOrNull(o.scheduledOn); if (!s.ok) return s;
    const v = dateOrNull(o.visitOn); if (!v.ok) return v;
    if (v.value && b.type !== 'visit') return fail(VISIT_ON_MESSAGE);
    const pm = o.paymentMethodId === undefined ? { ok: true as const, value: null } : parsePaymentMethodId(o.paymentMethodId); if (!pm.ok) return pm;
    // 수단을 고른 줄만 키를 싣는다 — 안 고른 줄의 모양은 지금과 같게(기존 deepEqual 테스트·로그 모양 유지)
    influencers.push({ handle: h.handle, cost: c.value, scheduledOn: s.value, visitOn: v.value, ...(pm.value ? { paymentMethodId: pm.value } : {}) });
  }
```

`parseTaskPatch`의 `if ('proof' in b) {…}`(191-195행) 아래에:
```ts
  if ('paymentMethodId' in b) { const r = parsePaymentMethodId(b.paymentMethodId); if (!r.ok) return r; out.paymentMethodId = r.value; }
```

- [ ] **Step 4: 구현 — `campaignApi.ts`·`taskCreateBody.ts`**

`campaignApi.ts:69`:
```ts
  influencers: Array<{ handle: string; cost?: TaskCost | null; scheduledOn?: string | null; visitOn?: string | null; paymentMethodId?: string | null }>;
```
`campaignApi.ts:76`(`proof` 줄) 아래에:
```ts
  paymentMethodId?: string | null;   // 이 작업에만 쓸 결제 수단(§8-2) — null = 기본 수단으로. 인플이 바뀌면 서버가 비운다
```

`taskCreateBody.ts`:
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
  paymentMethodId?: string | null;   // 새 작업 폼에서 고른 결제 수단(§8-2) — 사람 줄에 싣는다. 기본 수단이면 null(안 보냄)
};

export function buildTaskCreateBody(input: TaskCreateFormState): TaskCreateRequest {
  return {
    type: input.type,
    influencers: input.handle
      ? [{ handle: input.handle, cost: input.cost, ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}) }]
      : [],
    ...(input.handle ? {} : { cost: input.cost ?? undefined }),
    scheduledOn: input.scheduledOn, visitOn: input.type === 'visit' ? input.visitOn : null,
    note: input.note,
    ...(input.target && 'taskId' in input.target ? { targetTaskId: input.target.taskId } : {}),
    ...(input.target && 'url' in input.target ? { targetTweetUrl: input.target.url } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --test src/lib/campaignTaskInput.test.ts src/lib/taskCreateBody.test.ts && npx tsc --noEmit -p . ; echo tsc=$?`
Expected: PASS, `tsc=0`

- [ ] **Step 6: 빌드 확인** — `campaignApi.ts`·`taskCreateBody.ts`는 클라이언트가 값으로 import한다.

Run: `npx next build 2>&1 | tail -5`
Expected: 성공(`✓ Compiled` 계열, 오류 없음)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/campaignTaskInput.ts src/lib/campaignTaskInput.test.ts src/lib/campaignApi.ts src/lib/taskCreateBody.ts src/lib/taskCreateBody.test.ts
git commit -m "feat(task-panel-ui): 작업 만들기·고치기가 결제 수단 id를 받는다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `taskPaymentMethod` + 정산 후보·캠페인 수수료 합계 (§8-2) — G2

**Files:**
- Modify: `src/lib/influencerPayment.ts` (`getDefaultPaymentMethod` 176-178행 아래)
- Modify: `src/lib/influencerPayment.test.ts` (import + 새 테스트)
- Modify: `src/lib/settlementStore.ts:10`(import)·`57-77`(`CandRow`·`CANDIDATE_BASE`)·`97-104`(`rowToCandidate`)
- Modify: `src/lib/settlementStore.test.ts` (새 테스트)
- Modify: `src/lib/campaignStore.ts:18`(import)·`FeeRow` 타입·`126-140`(수수료 루프)
- Modify: `src/lib/campaignStore.test.ts` (새 테스트)

**Interfaces:**
- Consumes: DB 칸 `payment_method_id`, `TaskCreateInput.items[].paymentMethodId`(Task 1)
- Produces: `taskPaymentMethod<T extends { id: string; isDefault: boolean }>(list: T[], chosenId: string | null | undefined): T | null`

- [ ] **Step 1: 실패하는 테스트 — 순수**

`influencerPayment.test.ts` import에 `taskPaymentMethod`를 더하고 `getDefaultPaymentMethod` 테스트(328행) 아래에:
```ts
test('taskPaymentMethod: 고른 id가 있으면 그것, 지워졌거나 null이면 기본, 비면 null', () => {
  const list = [{ id: 'a', isDefault: true }, { id: 'b', isDefault: false }];
  assert.equal(taskPaymentMethod(list, 'b')?.id, 'b');
  assert.equal(taskPaymentMethod(list, 'gone')?.id, 'a');   // 고른 수단이 나중에 지워짐 → 기본(설계 §8-2)
  assert.equal(taskPaymentMethod(list, null)?.id, 'a');
  assert.equal(taskPaymentMethod(list, undefined)?.id, 'a');
  assert.equal(taskPaymentMethod([], 'b'), null);
});
```

Run: `node --import tsx --test src/lib/influencerPayment.test.ts`
Expected: FAIL — `taskPaymentMethod` export 없음

- [ ] **Step 2: 구현 — 순수**

`influencerPayment.ts`의 `getDefaultPaymentMethod` 아래:
```ts
// 이 작업에 쓸 결제 수단(설계 §8-2) — 작업이 고른 id가 지금 목록에 있으면 그것, 없으면(null이거나 그 사이 지워짐) 기본 수단.
// 정산 후보·제자리 수정(reviseRequest)·캠페인 수수료 합계·작업 패널 표시가 이 하나를 쓴다 — 판정을 두 벌로 두지 않는다.
// 제네릭인 이유: 패널은 계좌번호를 뺀 요약(PaymentChoice, paymentChoice.ts)에 같은 규칙을 적용한다.
export function taskPaymentMethod<T extends { id: string; isDefault: boolean }>(list: T[], chosenId: string | null | undefined): T | null {
  if (chosenId) {
    const hit = list.find((m) => m.id === chosenId);
    if (hit) return hit;
  }
  return list.find((m) => m.isDefault) ?? null;
}
```

Run: Step 1 명령 → PASS

- [ ] **Step 3: 실패하는 테스트 — 정산 후보(연습용 DB, 픽스처 접두어 `tstl`)**

`settlementStore.test.ts` 끝(마지막 test 뒤)에. 핸들은 반드시 `H()`로(그쪽 폴링에서 감춰지는 접두어):
```ts
test('작업별 결제 수단(060) — 후보·요청 스냅샷이 작업이 고른 수단을 쓰고, 고른 수단이 지워지면 기본 수단으로', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라PM');
  const camp = await createCampaign(sql, base(c.id, c.name, 'pm', 'visit'));
  const inf = await influencerWithPaypal(H('pm'));   // 기본 = PayPal ¥ CB 5%
  const added = await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'bank', holder: 'K', currency: 'KRW', bank: '국민', account: '123' } }, null);
  const bank = added.paymentMethods.find((x) => x.type === 'bank')!;
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('pm'), cost: { amount: 30000, currency: 'KRW' }, paymentMethodId: bank.id }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/pm/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(cand.method?.id, bank.id);
  assert.equal(cand.money?.payoutCurrency, 'KRW');
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');   // expected.paymentMethodId 대조도 같은 id라 통과
  assert.equal(row.paymentMethod.type, 'bank');
  await cancelRequest(sql, row.id, '테스트', m);
  await updatePaymentMethods(sql, inf.id, { kind: 'remove', id: bank.id }, null);
  const again = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(again.method?.type, 'paypal');   // 고른 수단이 지워지면 기본(PayPal)으로 정산된다
});
```

`campaignStore.test.ts`의 `12-1)` 테스트 아래에:
```ts
test('12-2) spendByPeriods — 작업이 고른 결제 수단의 수수료로 합계(060), 고른 수단이 없어지면 기본 수단', async () => {
  const c = await createClient(sql, P + '수수료클라2');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const period = (await listBudgetPeriods(sql, c.id))[0];
  const camp = await createCampaign(sql, { ...base(c.id, c.name, 'fee2'), startsOn: '2026-08-12', endsOn: '2026-08-18' });
  const { row: inf } = await createInfluencer(sql, { handle: P + '_pick', createdBy: null });
  await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'bank', holder: 'K', currency: 'JPY', bank: 'b', account: '1' }, makeDefault: true }, null);   // 기본 = 인플 부담
  const r = await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'bank', holder: 'K', currency: 'JPY', bank: 'b', account: '2', fee: { mode: 'fixed', amount: 165 } } }, null);
  const cb = r.paymentMethods.find((x) => x.account === '2')!;
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: inf.handle, cost: { amount: 10_000, currency: 'JPY' }, paymentMethodId: cb.id }] });
  assert.equal((await spendByPeriods(sql, c.id, [period])).get(period.id)!.feeKrw, 1_650);   // ¥165 × 10(12-1과 같은 환산)
  await sql`update campaign_task set payment_method_id = 'gone' where id = ${t.id}`;
  assert.equal((await spendByPeriods(sql, c.id, [period])).get(period.id)!.feeKrw, 0);        // 기본(인플 부담)으로
});
```

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/settlementStore.test.ts` 그리고 따로 `… --test src/lib/campaignStore.test.ts`
Expected: 새 테스트 둘 다 FAIL — 후보 `method.id`가 PayPal id / `feeKrw` 0 ≠ 1650

- [ ] **Step 4: 구현 — 정산 후보**

`settlementStore.ts:10`:
```ts
import { taskPaymentMethod, type PaymentMethod } from './influencerPayment.ts';
```
`CandRow`의 `influencer_id: string | null; payment_methods: unknown; proof: unknown;` 줄 끝에 ` payment_method_id: string | null;`

`CANDIDATE_BASE` 첫 줄 `select t.id, t.type, t.influencer_handle, t.cost, …`의 `t.proof,`(70행) 뒤에 ` t.payment_method_id,`

`rowToCandidate`(102행)의 influencer 줄:
```ts
    // 작업이 고른 수단(060, 설계 §8-2) — 없거나 지워졌으면 기본. 생성·제자리 수정(reviseRequest)·expected 대조가 전부 이 한 줄을 지난다.
    influencer: { inRoster: r.influencer_id !== null, method: r.influencer_id ? taskPaymentMethod(methods, r.payment_method_id) : null },
```
(`getDefaultPaymentMethod`가 이 파일 다른 곳에서 안 쓰이는지 `grep -n getDefaultPaymentMethod src/lib/settlementStore.ts`로 확인 — 위 import에서 뺐으므로 남아 있으면 tsc가 알린다.)

- [ ] **Step 5: 구현 — 캠페인 수수료 합계**

`campaignStore.ts:18`:
```ts
import { taskPaymentMethod, type PaymentMethod } from './influencerPayment.ts';
```
`type FeeRow = { campaign_id: string; cost: unknown; payment_methods: unknown };`을:
```ts
type FeeRow = { campaign_id: string; cost: unknown; payment_methods: unknown; payment_method_id: string | null };
```
수수료 쿼리 `select t.campaign_id, t.cost, i.payment_methods`를 `select t.campaign_id, t.cost, i.payment_methods, t.payment_method_id`로, 136행을:
```ts
    const method = taskPaymentMethod(methods, r.payment_method_id);   // 작업이 고른 수단(060) — 정산 후보와 같은 규칙
```
(128행 근처 주석 "작업마다 그 인플의 기본 결제 수단을 조인해 온다"도 "작업이 고른 결제 수단(없으면 기본)"으로 고친다.)

- [ ] **Step 6: 통과 확인**

Run(차례로, 병렬 금지 — 두 파일 다 정산 설정 마커를 깐다): `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/settlementStore.test.ts && node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignStore.test.ts && node --import tsx --test src/lib/influencerPayment.test.ts && npx tsc --noEmit -p . ; echo tsc=$?`
Expected: 전부 PASS, `tsc=0`

- [ ] **Step 7: 커밋**

```bash
git add src/lib/influencerPayment.ts src/lib/influencerPayment.test.ts src/lib/settlementStore.ts src/lib/settlementStore.test.ts src/lib/campaignStore.ts src/lib/campaignStore.test.ts
git commit -m "feat(task-panel-ui): 정산 후보·수수료 합계가 작업이 고른 결제 수단을 쓴다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 결제 수단 폼을 떼어 공용으로 (§8-3) — G2

프로필의 `MethodForm`과 그 입력 상태·검증·`send()`를 떼어 프로필과 작업 패널(Task 11)이 같은 것을 쓴다. 폼 모양·문구·동작은 바꾸지 않는다(이동만). `src/components`가 `src/app/*`를 import하는 선례가 없어 `PaymentQrField`도 같이 옮긴다.

**Files:**
- Create: `src/lib/paymentMethodDraft.ts`, `src/lib/paymentMethodDraft.test.ts`
- Create: `src/components/PaymentMethodForm.tsx`
- Move: `src/app/influencers/PaymentQrField.tsx` → `src/components/PaymentQrField.tsx` (`git mv`, 내용 그대로)
- Modify: `src/app/influencers/PaymentSection.tsx` (16-79행 정의·103-128행 `send`·331-489행 `MethodForm` 삭제 → import)

**Interfaces:**
- Produces:
  - `paymentMethodDraft.ts`: `type FeeMode = 'none' | 'grossUp' | 'fixed'`, `FEE_MODE_LABEL`, `interface MethodDraft`, `holderLabel(t)`, `methodDraftOf(m: PaymentMethod | null): MethodDraft`, `methodInputOf(d: MethodDraft): unknown`, `parseMethodDraft(d: MethodDraft): PaymentMethodInput | string`, `newMethodIdOf(beforeIds: readonly string[], after: readonly { id: string }[]): string | null`
  - `PaymentMethodForm.tsx`: `MethodForm(props)`(예전 props 그대로, `draft: MethodDraft`), `type PaymentSendResult = { ok: true; paymentMethods: PaymentMethod[]; logs: InfluencerLogRow[] } | { ok: false; error: string | null }`(error null = 이미 보내는 중이라 무시함), `usePaymentMethodSend(influencerId: string): { busy: boolean; send: (method: 'POST' | 'PATCH' | 'DELETE', body: unknown) => Promise<PaymentSendResult> }`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/paymentMethodDraft.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { methodDraftOf, methodInputOf, parseMethodDraft, newMethodIdOf } from './paymentMethodDraft.ts';

test('1) 새 수단 기본값 — 유형은 목록 첫 번째, 통화는 엔화, 수수료는 인플 부담', () => {
  const d = methodDraftOf(null);
  assert.equal(d.type, 'paypal'); assert.equal(d.currency, 'JPY'); assert.equal(d.feeMode, 'none'); assert.equal(d.makeDefault, false);
});

test('2) 폼 값 → 검증 — 서버와 같은 parsePaymentMethodInput을 지난다(문구도 같다)', () => {
  const ok = parseMethodDraft({ ...methodDraftOf(null), holder: 'Sakura', email: 's@x.com' });
  assert.ok(typeof ok !== 'string' && ok.type === 'paypal' && ok.email === 's@x.com');
  assert.equal(parseMethodDraft({ ...methodDraftOf(null), holder: '' }), '수취인명을 입력해 주세요');
  // 고정액 칸을 비우면 0원이 아니라 '안 적음' — 검증에서 걸린다
  assert.equal(typeof parseMethodDraft({ ...methodDraftOf(null), holder: 'S', email: 's@x.com', feeMode: 'fixed', feeAmount: '' }), 'string');
  assert.deepEqual((methodInputOf({ ...methodDraftOf(null), feeMode: 'grossUp', feePercent: '3' }) as { fee: unknown }).fee, { mode: 'grossUp', percent: 3 });
});

test('3) 등록 뒤 새 수단 id — 응답 배열을 등록 전 id와 비교해 찾는다', () => {
  assert.equal(newMethodIdOf(['a'], [{ id: 'a' }, { id: 'b' }]), 'b');
  assert.equal(newMethodIdOf([], [{ id: 'a' }]), 'a');
  assert.equal(newMethodIdOf(['a'], [{ id: 'a' }]), null);
});
```

Run: `node --import tsx --test src/lib/paymentMethodDraft.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 2: 구현 — 순수 모듈** (`PaymentSection.tsx` 16-79행을 옮기고 이름만 바꾼다: `Draft`→`MethodDraft`, `draftOf`→`methodDraftOf`, `inputOf`→`methodInputOf`)

```ts
// src/lib/paymentMethodDraft.ts
// 결제 수단 폼의 입력 상태·변환 — 인플 프로필(PaymentSection)과 작업 패널의 등록 창(PaymentMethodDialog)이 같이 쓴다(설계 §8-3).
// DB·postgres import 없음 — 화면이 값으로 import한다. 검증은 서버와 같은 parsePaymentMethodInput 한 벌.
import type { Currency } from './influencerPricing.ts';
import { PAYMENT_TYPES, parsePaymentMethodInput, type PaymentMethod, type PaymentMethodInput, type PaymentMethodType } from './influencerPayment.ts';

// 수취인 칸의 이름은 유형에 따라 바뀐다 — 계좌이체에서 '수취인명'은 정산 담당이 쓰는 말이 아니다.
export const holderLabel = (t: PaymentMethodType) => (t === 'bank' ? '예금주' : '수취인명');

export type FeeMode = 'none' | 'grossUp' | 'fixed';
export const FEE_MODE_LABEL: Record<FeeMode, string> = {
  none: '인플 부담',
  grossUp: 'CB 부담 (비율)',
  fixed: 'CB 부담 (고정액)',
};

export interface MethodDraft {
  type: PaymentMethodType; holder: string; currency: Currency;
  email: string; paypalId: string; identifier: string; qr: string;
  bank: string; branch: string; account: string;
  feeMode: FeeMode; feePercent: string; feeAmount: string;
  memo: string; makeDefault: boolean;
}

export function methodDraftOf(m: PaymentMethod | null): MethodDraft {
  return {
    // 새 수단의 기본값: 유형은 목록 첫 번째, 통화는 ¥ — 이 통화는 '인플이 받는 돈의 통화(지급 통화)'라
    // 단가(₩ 기본, 캠페인 관리 기준)와 다른 질문이다. 실데이터 91건 중 84건이 엔화(koo 결정 08-27).
    type: m?.type ?? PAYMENT_TYPES[0],
    holder: m?.holder ?? '',
    currency: m?.currency ?? 'JPY',
    email: m?.email ?? '',
    paypalId: m?.paypalId ?? '',
    identifier: m?.identifier ?? '',
    qr: m?.qr ?? '',
    bank: m?.bank ?? '',
    branch: m?.branch ?? '',
    account: m?.account ?? '',
    feeMode: m?.fee?.mode ?? 'none',
    feePercent: m?.fee?.mode === 'grossUp' ? String(m.fee.percent) : '5',
    feeAmount: m?.fee?.mode === 'fixed' ? String(m.fee.amount) : '',
    memo: m?.memo ?? '',
    makeDefault: false,
  };
}

// 빈 칸은 0이 아니라 "안 적음" — Number('')=0이면 수수료 금액을 비워도 0원으로 통과해 버린다.
function numOf(s: string): number {
  const t = s.replace(/[,\s]/g, '');
  return t === '' ? NaN : Number(t);
}

// 폼 값 → 라우트에 보낼 입력. 유형에 맞지 않는 칸도 그대로 실어 보내고, 버리는 일은 parsePaymentMethodInput이 한다 —
// 클라이언트와 서버가 같은 한 벌 규칙을 쓴다(문구도 같아진다).
export function methodInputOf(d: MethodDraft): unknown {
  const fee = d.feeMode === 'grossUp' ? { mode: 'grossUp', percent: numOf(d.feePercent) }
    : d.feeMode === 'fixed' ? { mode: 'fixed', amount: numOf(d.feeAmount) }
      : undefined;
  return {
    type: d.type, holder: d.holder, currency: d.currency,
    email: d.email, paypalId: d.paypalId, identifier: d.identifier, qr: d.qr,
    bank: d.bank, branch: d.branch, account: d.account,
    fee, memo: d.memo,
  };
}

export const parseMethodDraft = (d: MethodDraft): PaymentMethodInput | string => parsePaymentMethodInput(methodInputOf(d));

// 등록 응답(배열 전체 스냅샷)에서 방금 생긴 수단 id — 등록 전 id 목록에 없던 것(설계 §8-3). 없으면 null.
export function newMethodIdOf(beforeIds: readonly string[], after: readonly { id: string }[]): string | null {
  const before = new Set(beforeIds);
  return after.find((m) => !before.has(m.id))?.id ?? null;
}
```

Run: Step 1 명령 → PASS 3/3

- [ ] **Step 3: `PaymentQrField` 이동**

Run: `git mv src/app/influencers/PaymentQrField.tsx src/components/PaymentQrField.tsx && grep -rn "PaymentQrField" src`
Expected: `PaymentSection.tsx`의 `import { PaymentQrField } from './PaymentQrField';` 한 줄만 남는다(다음 스텝에서 사라진다). 파일 안의 import는 전부 `@/lib/…`·`@/components/ImageLightbox`라 고칠 것이 없다.

- [ ] **Step 4: 구현 — 공용 폼 컴포넌트**

`src/components/PaymentMethodForm.tsx`를 만든다. 머리:
```tsx
'use client';
import { useCallback, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { CURRENCY_LABEL, CURRENCY_SYMBOL, type Currency } from '@/lib/influencerPricing';
import { PAYMENT_TYPES, PAYMENT_TYPE_LABEL, type PaymentMethod, type PaymentMethodType } from '@/lib/influencerPayment';
import { FEE_MODE_LABEL, holderLabel, type FeeMode, type MethodDraft } from '@/lib/paymentMethodDraft';
import type { InfluencerLogRow } from '@/lib/influencerStore';
import { PaymentQrField } from '@/components/PaymentQrField';

// 결제 수단 입력 폼 — 인플 프로필(PaymentSection)과 작업 패널 등록 창(PaymentMethodDialog)이 같은 것을 쓴다(설계 §8-3).
// 폼 모양·문구는 프로필에 있던 그대로다(이동만). 저장은 기존 /api/influencers/[id]/payment-methods 하나.

const CURRENCIES: readonly Currency[] = ['KRW', 'JPY'];
const FIELD = 'w-full rounded-lg border border-x-border-strong px-2.5 py-1.5 text-ui outline-none focus:border-x-blue';
const FIELD_LABEL = 'block text-caption text-x-secondary';

export type PaymentSendResult =
  | { ok: true; paymentMethods: PaymentMethod[]; logs: InfluencerLogRow[] }
  | { ok: false; error: string | null };   // null = 이미 보내는 중이라 이번 요청은 무시했다(오류 칸을 바꾸지 않는다)

// 저장 요청 — 응답은 언제나 배열 전체 스냅샷(서버가 행 잠금으로 직렬화한다)이라 호출부는 그대로 교체한다.
// busy는 state(화면용)와 ref(연타 차단용)를 같이 둔다 — state만 보면 같은 틱의 두 번째 클릭이 옛 값을 본다.
export function usePaymentMethodSend(influencerId: string) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const send = useCallback(async (method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<PaymentSendResult> => {
    if (inFlight.current) return { ok: false, error: null };
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/influencers/${influencerId}/payment-methods`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) {
        // 서버가 준 오류 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(profileShared.errOf와 같은 규칙)
        const error = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
        return { ok: false, error };
      }
      const b = (await r.json()) as { paymentMethods: PaymentMethod[]; logs: InfluencerLogRow[] };
      return { ok: true, paymentMethods: b.paymentMethods, logs: b.logs };
    } catch {
      return { ok: false, error: '결제 수단을 저장하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [influencerId]);
  return { busy, send };
}
```
그 아래에 `PaymentSection.tsx` 331-489행의 `function MethodForm(…)`을 **글자 그대로** 옮기고 두 곳만 바꾼다: 앞에 `export `를 붙이고, props 타입의 `Draft`를 `MethodDraft`로(`setDraft: (fn: (d: MethodDraft) => MethodDraft) => void`, `const set = <K extends keyof MethodDraft>(k: K, v: MethodDraft[K]) => …`).

- [ ] **Step 5: `PaymentSection.tsx` 다시 잇기**

- 16-79행(`CURRENCIES`~`FIELD_LABEL`)과 331-489행(`MethodForm`)을 지운다. `holderLabel`은 `MethodCard`가 계속 쓰므로 import로 받는다.
- import를 바꾼다:
```tsx
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { CURRENCY_SYMBOL } from '@/lib/influencerPricing';
import { PAYMENT_TYPE_LABEL, describeMethod, formatFee, type PaymentMethod } from '@/lib/influencerPayment';
import { holderLabel, methodDraftOf, parseMethodDraft, type MethodDraft } from '@/lib/paymentMethodDraft';
import { MethodForm, usePaymentMethodSend } from '@/components/PaymentMethodForm';
import { signPaymentQrUrl } from '@/lib/paymentQr';
import { ImageLightbox } from '@/components/ImageLightbox';
import { PANEL, PANEL_TITLE, useErrorReport } from './profileShared';
import type { InfluencerLogRow } from '@/lib/influencerStore';
```
(남은 코드가 쓰지 않는 이름은 빼고, 쓰는 이름이 빠졌으면 tsc가 알린다 — `useId`·`CURRENCY_LABEL`·`PAYMENT_TYPES`·`errOf`는 옮겨 간 코드만 썼다.)
- 컴포넌트 본문: `const [draft, setDraft] = useState<MethodDraft>(() => methodDraftOf(null));`, `const [busy, setBusy] = useState(false);`를 지우고 `const { busy, send: sendRaw } = usePaymentMethodSend(id);`. 103-128행 `send`를 이 얇은 판으로 바꾼다(부르는 쪽 세 곳의 모양은 그대로):
```tsx
  // 저장 요청 자체는 공용 훅(usePaymentMethodSend)이 한다 — 여기는 오류 칸 두 개(폼·목록)에 결과를 나눠 담는다.
  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: unknown, setErr: (v: string | null) => void): Promise<boolean> {
    const r = await sendRaw(method, body);
    if (!r.ok) { if (r.error !== null) setErr(r.error); return false; }
    setErr(null); setFormErr(null); setListErr(null);
    onSaved(r.paymentMethods, r.logs);
    return true;
  }
```
- `openAdd`의 `draftOf(null)` → `methodDraftOf(null)`, `openEdit`의 `draftOf(m)` → `methodDraftOf(m)`, `submit`의 `parsePaymentMethodInput(inputOf(draft))` → `parseMethodDraft(draft)`.

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/influencers/PaymentSection.tsx src/components/PaymentMethodForm.tsx src/components/PaymentQrField.tsx src/lib/paymentMethodDraft.ts`
Expected: `tsc=0`, 새 문제 없음

- [ ] **Step 6: 빌드 확인**

Run: `npx next build 2>&1 | tail -5`
Expected: 성공

- [ ] **Step 7: 커밋**

```bash
git add src/lib/paymentMethodDraft.ts src/lib/paymentMethodDraft.test.ts src/components/PaymentMethodForm.tsx src/components/PaymentQrField.tsx src/app/influencers/PaymentQrField.tsx src/app/influencers/PaymentSection.tsx
git commit -m "refactor(task-panel-ui): 결제 수단 폼·저장을 공용으로 떼어 낸다(프로필 동작은 그대로)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 명부 판정(화면 쪽) + 명부 훅 (§9) — G2

화면의 모든 명부 입력칸(Task 8)이 쓰는 순수 판정과, 명부 읽기·등록을 한 곳에서 쥐는 훅. 훅은 화면 두 곳(`/campaigns/flow`·`/generate`)이 각자 하던 `/api/drafts/influencers` 읽기를 대신한다 — 읽기 실패를 빈 목록과 구분해야 게이팅이 "모두 명부 밖"으로 오판하지 않는다(§9).

**Files:**
- Create: `src/lib/rosterPick.ts`, `src/lib/rosterPick.test.ts`
- Create: `src/components/useInfluencerRoster.ts`

**Interfaces:**
- Produces:
  - `type RosterStatus = 'loading' | 'ok' | 'failed'`
  - `type RegisterResult = { ok: true; handle: string } | { ok: false; error: string }`
  - `interface RosterGate { status: RosterStatus; register: (handle: string) => Promise<RegisterResult> }`
  - `ROSTER_FAILED_MESSAGE = '명부를 불러오지 못했어요 — 새로고침해 주세요'`, `ROSTER_LOADING_MESSAGE = '명부 불러오는 중…'`, `ROSTER_OUTSIDE_MESSAGE = '명부에 없는 인플이에요 — 아래 줄을 눌러 등록하고 배정해요'`
  - `type RosterResolve = { kind: 'empty' } | { kind: 'invalid'; message: string } | { kind: 'unavailable'; message: string } | { kind: 'roster'; handle: string; option: InfluencerOption } | { kind: 'outside'; handle: string }`
  - `findRosterOption(options: InfluencerOption[], handle: string): InfluencerOption | undefined`
  - `resolveRosterInput(raw: string, options: InfluencerOption[], status: RosterStatus): RosterResolve`
  - `rosterSuggestions(options: InfluencerOption[], raw: string, limit?: number): InfluencerOption[]`
  - `useInfluencerRoster(): { options: InfluencerOption[]; status: RosterStatus; reload: () => Promise<boolean>; gate: RosterGate; version: number }` — `version`은 등록이 성공할 때마다 1 오른다(명부에 매인 캐시를 다시 읽게)

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/rosterPick.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRosterInput, rosterSuggestions, findRosterOption, ROSTER_FAILED_MESSAGE, ROSTER_LOADING_MESSAGE } from './rosterPick.ts';

const opts = [
  { id: '1', handle: 'Sakura_jp', name: '사쿠라' },
  { id: '2', handle: 'coco_x', name: 'ココ' },
  { id: '3', handle: 'mika' },
];

test('1) 판정 — 빈 칸·형식 오류·명부 안(명부 표기로)·명부 밖', () => {
  assert.deepEqual(resolveRosterInput('  ', opts, 'ok'), { kind: 'empty' });
  assert.equal(resolveRosterInput('bad handle!', opts, 'ok').kind, 'invalid');
  const r = resolveRosterInput('@sakura_JP', opts, 'ok');
  assert.ok(r.kind === 'roster' && r.handle === 'Sakura_jp');
  const p = resolveRosterInput('https://x.com/Mika', opts, 'ok');   // 프로필 링크 붙여넣기도 같은 판정
  assert.ok(p.kind === 'roster' && p.handle === 'mika');
  assert.deepEqual(resolveRosterInput('coco', opts, 'ok'), { kind: 'outside', handle: 'coco' });
});

test('2) 명부를 아직 못 읽었거나 실패했으면 배정 판정을 하지 않는다 — 형식 오류는 먼저 말한다', () => {
  assert.deepEqual(resolveRosterInput('mika', [], 'loading'), { kind: 'unavailable', message: ROSTER_LOADING_MESSAGE });
  assert.deepEqual(resolveRosterInput('mika', [], 'failed'), { kind: 'unavailable', message: ROSTER_FAILED_MESSAGE });
  assert.equal(resolveRosterInput('bad handle!', [], 'failed').kind, 'invalid');
});

test('3) 후보 — 핸들·이름 부분 일치, 정확히 같은 것 → 앞부분 일치 → 나머지 순, 빈 칸이면 없음, 개수 제한', () => {
  assert.deepEqual(rosterSuggestions(opts, 'co').map((o) => o.handle), ['coco_x']);
  assert.deepEqual(rosterSuggestions(opts, '사쿠').map((o) => o.handle), ['Sakura_jp']);
  assert.deepEqual(rosterSuggestions(opts, ''), []);
  const many = Array.from({ length: 10 }, (_, i) => ({ handle: `aa${i}` }));
  assert.equal(rosterSuggestions(many, 'aa').length, 6);
  assert.deepEqual(rosterSuggestions([{ handle: 'xmika' }, { handle: 'mikan' }, { handle: 'mika' }], 'mika').map((o) => o.handle), ['mika', 'mikan', 'xmika']);
  assert.equal(findRosterOption(opts, 'MIKA')?.id, '3');
});
```

Run: `node --import tsx --test src/lib/rosterPick.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 2: 구현 — 순수 판정**

```ts
// src/lib/rosterPick.ts
// 명부 전용 입력칸의 판정(설계 §9) — 작업 패널·교체 창·원고 카드 칩·일괄 배정 바가 같은 규칙을 쓴다.
// 서버 쪽 같은 규칙은 taskAssignGate.ts(lower 비교 + 명부 표기 저장). DB 없음 — 화면이 값으로 import한다.
import type { InfluencerOption } from './draftTypes.ts';
import { parseXHandle, handleParseMessage } from './xHandle.ts';

export type RosterStatus = 'loading' | 'ok' | 'failed';
export type RegisterResult = { ok: true; handle: string } | { ok: false; error: string };
// 입력칸이 받는 명부 관문 — 목록은 따로(options prop) 받고, 여기는 상태와 '등록하고 배정'의 등록 단계만.
export interface RosterGate { status: RosterStatus; register: (handle: string) => Promise<RegisterResult> }

export const ROSTER_FAILED_MESSAGE = '명부를 불러오지 못했어요 — 새로고침해 주세요';
export const ROSTER_LOADING_MESSAGE = '명부 불러오는 중…';
// 저장 버튼(칩)을 눌렀는데 명부 밖일 때 — 등록 줄이 바로 아래에 있으니 그걸 가리킨다
export const ROSTER_OUTSIDE_MESSAGE = '명부에 없는 인플이에요 — 아래 줄을 눌러 등록하고 배정해요';

export type RosterResolve =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'roster'; handle: string; option: InfluencerOption }
  | { kind: 'outside'; handle: string };

export function findRosterOption(options: InfluencerOption[], handle: string): InfluencerOption | undefined {
  const k = handle.toLowerCase();
  return options.find((o) => o.handle.toLowerCase() === k);
}

export function resolveRosterInput(raw: string, options: InfluencerOption[], status: RosterStatus): RosterResolve {
  const v = raw.trim();
  if (!v) return { kind: 'empty' };
  const p = parseXHandle(v);
  // 형식 오류는 명부 상태와 무관하게 지금 말할 수 있다 — 먼저
  if (!p.ok) return { kind: 'invalid', message: handleParseMessage(p.reason) };
  // 명부를 못 읽었으면(실패 시 빈 배열) 모든 핸들이 명부 밖으로 보인다 — 그때는 판정 자체를 하지 않는다(§9)
  if (status === 'loading') return { kind: 'unavailable', message: ROSTER_LOADING_MESSAGE };
  if (status === 'failed') return { kind: 'unavailable', message: ROSTER_FAILED_MESSAGE };
  const option = findRosterOption(options, p.handle);
  return option ? { kind: 'roster', handle: option.handle, option } : { kind: 'outside', handle: p.handle };
}

// 입력 중 후보(사진·이름·핸들·단가 행) — 핸들·표시 이름 부분 일치. 한 번에 6개까지(도구 화면 밀도 기준).
export function rosterSuggestions(options: InfluencerOption[], raw: string, limit = 6): InfluencerOption[] {
  const v = raw.trim();
  if (!v) return [];
  const p = parseXHandle(v);
  const q = (p.ok ? p.handle : v.replace(/^@/, '')).toLowerCase();
  const rank = (o: InfluencerOption): number => {
    const h = o.handle.toLowerCase();
    if (h === q) return 0;
    if (h.startsWith(q)) return 1;
    if (h.includes(q) || (o.name ?? '').toLowerCase().includes(q)) return 2;
    return 9;
  };
  return options
    .map((o) => ({ o, r: rank(o) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.o.handle.localeCompare(b.o.handle))
    .slice(0, limit)
    .map((x) => x.o);
}
```

Run: Step 1 명령 → PASS 3/3

- [ ] **Step 3: 구현 — 명부 훅**

```ts
// src/components/useInfluencerRoster.ts
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { toApiResult } from '@/lib/campaignApi';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { RegisterResult, RosterGate, RosterStatus } from '@/lib/rosterPick';

// 명부(인플 옵션) 읽기·등록을 한 곳에서(설계 §9) — /campaigns/flow·/generate가 각자 하던 읽기를 대신한다.
// 실패와 빈 목록을 구분한다: 예전엔 실패해도 빈 배열로 삼켰는데(자유 입력이라 괜찮았다), 명부 게이팅에서는
// 빈 배열이 곧 "모두 명부 밖"이라 거짓 판정이 된다. 다시 읽기가 실패하면 들고 있던 목록을 유지한다.
export function useInfluencerRoster() {
  const [options, setOptions] = useState<InfluencerOption[]>([]);
  const [status, setStatus] = useState<RosterStatus>('loading');
  const [version, setVersion] = useState(0);

  const reload = useCallback(async (): Promise<boolean> => {
    const r = await apiFetch('/api/drafts/influencers').catch(() => null);
    const body: unknown = r && r.ok ? await r.json().catch(() => null) : null;
    // await 뒤에서만 setState — 이펙트 본문 동기 setState 금지(react-hooks/set-state-in-effect)
    if (!Array.isArray(body)) { setStatus((s) => (s === 'ok' ? s : 'failed')); return false; }
    setOptions(body as InfluencerOption[]);
    setStatus('ok');
    return true;
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  // '명부에 등록하고 배정'의 등록 단계 — 기존 POST /api/influencers(X 프로필 조회, 비용 유발 → 누를 때만).
  // 이미 있던 행(created:false, 대소문자만 다른 경우 포함)·개명(renamed)도 성공이다 — 돌려받은 명부 표기로 배정한다.
  // 실패 문구는 서버 것 그대로(X에 없는 계정 404 · 조회 실패 502).
  const register = useCallback(async (handle: string): Promise<RegisterResult> => {
    let res: Response;
    try {
      res = await apiFetch('/api/influencers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle }),
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'unauthorized') throw e;   // 로그인으로 보내는 중 — campaignApi.call과 같은 태도
      return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요' };
    }
    const r = await toApiResult<{ influencer: { handle: string } }>(res);
    if (!r.ok) return { ok: false, error: r.error };
    await reload();
    setVersion((v) => v + 1);
    return { ok: true, handle: r.data.influencer.handle };
  }, [reload]);

  const gate: RosterGate = useMemo(() => ({ status, register }), [status, register]);
  return { options, status, reload, gate, version };
}
```

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/components/useInfluencerRoster.ts src/lib/rosterPick.ts`
Expected: `tsc=0`, 새 문제 없음(`set-state-in-effect`가 `reload` 호출을 잡으면 이펙트를 `useEffect(() => { reload().catch(() => {}); }, [reload]);`로 바꿔 다시 본다 — setState는 전부 await 뒤라 규칙 위반이 아니다)

- [ ] **Step 4: 빌드 확인** — 훅이 `campaignApi.ts`를 값으로 import한다(이미 클라이언트가 쓰는 모듈).

Run: `npx next build 2>&1 | tail -5`
Expected: 성공(훅은 아직 쓰는 곳이 없어 번들에 안 들어가도 타입·린트 단계는 지난다)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/rosterPick.ts src/lib/rosterPick.test.ts src/components/useInfluencerRoster.ts
git commit -m "feat(task-panel-ui): 명부 판정과 명부 읽기·등록 훅

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 서버 게이팅 — 작업·원고 라우트 5곳 (§8-2·§9) — G3

라우트 하네스가 없어 판정은 `taskAssignGate.ts`의 함수로 빼고 거기를 DB 테스트로 본다. 라우트는 그 함수를 부르는 몇 줄만 더한다.

**Files:**
- Modify: `src/lib/taskAssignGate.ts`, `src/lib/taskAssignGate.test.ts`
- Modify: `src/lib/settlementStore.test.ts` (`hasLiveRequest` 테스트 1건 — 요청 행을 만들므로 이 파일에서만)
- Modify: `src/app/api/campaigns/[id]/tasks/route.ts` (POST)
- Modify: `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts` (PATCH)
- Modify: `src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts`
- Modify: `src/app/api/drafts/[id]/route.ts` (PATCH)
- Modify: `src/app/api/drafts/route.ts` (일괄 PATCH)

**Interfaces:**
- Consumes: `rosterHandleOf`·`ROSTER_REQUIRED_MESSAGE`(Task 1), `parseTaskPatch`·`TaskCreateBody.influencers[].paymentMethodId`(Task 2), `PAYMENT_NOT_FOUND`(기존)
- Produces:
  - `PAYMENT_METHOD_LOCKED_MESSAGE = '정산 요청된 작업이에요 — 결제 수단을 바꾸려면 정산 화면에서 요청을 먼저 취소해 주세요'`
  - `PAYMENT_METHOD_OWNER_MESSAGE = '인플루언서를 먼저 정해 주세요 — 결제 수단은 배정된 인플의 것만 고를 수 있어요'`
  - `checkTaskPaymentMethod(sql, handle: string | null, methodId: string): Promise<string | null>` — 오류 문구 또는 null
  - `hasLiveRequest(sql, taskId: string): Promise<boolean>`
  - HTTP: 명부 밖 핸들을 새로 넣거나 바꾸면 400 `ROSTER_REQUIRED_MESSAGE` / 목록에 없는 수단 id 400 `PAYMENT_NOT_FOUND` / 사람 없이 수단 400 `PAYMENT_METHOD_OWNER_MESSAGE` / 살아 있는 요청 중 수단 변경 409 `PAYMENT_METHOD_LOCKED_MESSAGE`

- [ ] **Step 1: 실패하는 테스트**

`taskAssignGate.test.ts` import를 `import { rosterHandleOf, checkTaskPaymentMethod, PAYMENT_METHOD_OWNER_MESSAGE } from './taskAssignGate.ts';`, `import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';`, `import { PAYMENT_NOT_FOUND } from './influencerPayment.ts';`로 넓히고 `after`의 influencer 삭제 위에 `await sql\`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})\`;`(수단 추가가 활동 기록을 남긴다)를 더한 뒤:
```ts
test('2) 결제 수단 고르기 — 그 인플의 지금 목록에 있어야 한다, 사람이 없으면 문구', async () => {
  const { row } = await createInfluencer(sql, { handle: P + '_Pay', createdBy: null });
  const r = await updatePaymentMethods(sql, row.id, { kind: 'add', input: { type: 'paypal', holder: 'K', currency: 'JPY', email: 'k@x.com' } }, null);
  const id = r.paymentMethods[0].id;
  assert.equal(await checkTaskPaymentMethod(sql, P + '_pay', id), null);             // 대소문자 무관
  assert.equal(await checkTaskPaymentMethod(sql, P + '_Pay', 'gone'), PAYMENT_NOT_FOUND);
  assert.equal(await checkTaskPaymentMethod(sql, P + '_ghost', id), PAYMENT_NOT_FOUND);   // 명부 밖이면 고를 수단도 없다
  assert.equal(await checkTaskPaymentMethod(sql, null, id), PAYMENT_METHOD_OWNER_MESSAGE);
});
```

`settlementStore.test.ts` import에 `import { hasLiveRequest } from './taskAssignGate.ts';`를 더하고 끝에:
```ts
test('hasLiveRequest — 요청 중이면 참, 우리가 취소하면 거짓(작업 패널 잠금·단계 판정과 같은 조건)', async () => {
  const { row, task, member } = await requestFor('live', 'live');
  assert.equal(await hasLiveRequest(sql, task.id), true);
  await cancelRequest(sql, row.id, '테스트', member);
  assert.equal(await hasLiveRequest(sql, task.id), false);
});
```

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/taskAssignGate.test.ts`
Expected: FAIL — `checkTaskPaymentMethod` export 없음

- [ ] **Step 2: 구현 — 판정 함수**

`taskAssignGate.ts`의 import 아래·끝에 더한다:
```ts
import { PAYMENT_NOT_FOUND, type PaymentMethod } from './influencerPayment.ts';   // 순수 모듈 — 잎 성질 유지

export const PAYMENT_METHOD_LOCKED_MESSAGE = '정산 요청된 작업이에요 — 결제 수단을 바꾸려면 정산 화면에서 요청을 먼저 취소해 주세요';
export const PAYMENT_METHOD_OWNER_MESSAGE = '인플루언서를 먼저 정해 주세요 — 결제 수단은 배정된 인플의 것만 고를 수 있어요';

// 작업이 고를 결제 수단이 그 인플의 지금 목록에 있는가(설계 §8-2). 오류 문구 또는 null.
// 명부 밖 핸들이면 고를 수단 자체가 없다 — '없음'과 같은 문구(새로고침하면 화면이 명부 상태를 다시 보여 준다).
export async function checkTaskPaymentMethod(sql: postgres.Sql, handle: string | null, methodId: string): Promise<string | null> {
  if (!handle) return PAYMENT_METHOD_OWNER_MESSAGE;
  const rows = await sql<Array<{ payment_methods: unknown }>>`
    select payment_methods from influencer where lower(handle) = lower(${handle}) limit 1`;
  const list = Array.isArray(rows[0]?.payment_methods) ? (rows[0].payment_methods as PaymentMethod[]) : [];
  return list.some((m) => m.id === methodId) ? null : PAYMENT_NOT_FOUND;
}

// 수단을 못 바꾸게 막는 '살아 있는 요청' — 작업 패널의 잠금 표시(paymentView.loadPaymentView)·단계 판정(flowStage)과 같은 조건.
// 요청 뒤에 수단을 바꾸면 제자리 수정(reviseRequest)이 후보를 다시 계산하며 스냅샷이 조용히 바뀐다 — UI 잠금만으론 못 막는다.
export async function hasLiveRequest(sql: postgres.Sql, taskId: string): Promise<boolean> {
  const r = await sql<Array<{ n: string | number }>>`
    select count(*) as n from payment_request
     where task_id = ${taskId} and status = 'requested' and coalesce(external_status, '') <> 'cancelled'`;
  return Number(r[0].n) > 0;
}
```

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/taskAssignGate.test.ts && node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/settlementStore.test.ts`
Expected: PASS

- [ ] **Step 3: 작업 생성 라우트** — `src/app/api/campaigns/[id]/tasks/route.ts`

import에:
```ts
import { rosterHandleOf, checkTaskPaymentMethod, ROSTER_REQUIRED_MESSAGE } from '@/lib/taskAssignGate';
```
`if (!(await getCampaign(sql, id))) return notFound();`(26행) 바로 아래에:
```ts
  // 명부 게이팅(설계 §9 ①·⑤-a) — 사람을 넣는 줄은 명부에 있어야 한다. 저장 표기는 명부 표기로.
  // 고른 결제 수단(§8-2)은 그 사람의 지금 목록에 있어야 한다.
  for (const it of v.influencers) {
    const canon = await rosterHandleOf(sql, it.handle);
    if (!canon) return NextResponse.json({ error: ROSTER_REQUIRED_MESSAGE }, { status: 400 });
    it.handle = canon;
    if (it.paymentMethodId) {
      const err = await checkTaskPaymentMethod(sql, canon, it.paymentMethodId);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
  }
```

- [ ] **Step 4: 작업 패치 라우트** — `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`

import에:
```ts
import { rosterHandleOf, checkTaskPaymentMethod, hasLiveRequest, ROSTER_REQUIRED_MESSAGE, PAYMENT_METHOD_LOCKED_MESSAGE } from '@/lib/taskAssignGate';
```
인플 가드 블록(40-43행) 바로 아래에:
```ts
  // 명부 게이팅(설계 §9 ②) — 사람을 새로 넣거나 바꿀 때만 판정한다. 해제(null)·같은 사람(대소문자만 다름)은 통과,
  // 이미 명부 밖으로 저장된 행의 메모·비용 편집은 influencerHandle을 안 보내므로 여기 오지 않는다. 명부에 있으면 명부 표기로.
  if (patch.influencerHandle) {
    const canon = await rosterHandleOf(sql, patch.influencerHandle);
    const changes = patch.influencerHandle.toLowerCase() !== (cur.influencerHandle ?? '').toLowerCase();
    if (!canon && changes) return NextResponse.json({ error: ROSTER_REQUIRED_MESSAGE }, { status: 400 });
    if (canon) patch.influencerHandle = canon;
  }
  // 결제 수단(설계 §8-2) — 살아 있는 요청이 있으면 바꾸지 못한다(제자리 수정이 스냅샷을 조용히 바꾼다).
  // 값이 있으면 이 요청 뒤의 인플(같이 바꾸면 새 사람)의 지금 목록에 있어야 한다.
  if (patch.paymentMethodId !== undefined) {
    if (await hasLiveRequest(sql, taskId)) return NextResponse.json({ error: PAYMENT_METHOD_LOCKED_MESSAGE }, { status: 409 });
    if (patch.paymentMethodId !== null) {
      const owner = patch.influencerHandle !== undefined ? patch.influencerHandle : cur.influencerHandle;
      const err = await checkTaskPaymentMethod(sql, owner, patch.paymentMethodId);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
  }
```
(이 블록은 `const { proofUrl, ...rest } = patch;`(49행)보다 **위**여야 한다 — 명부 표기로 바꾼 핸들이 `taskPatch`와 원고 전파(80-86행)에 같이 실린다. 취소된 작업은 35-38행이 메모 외 키를 이미 거절한다.)

- [ ] **Step 5: 교체 라우트** — `src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts`

import에 `import { rosterHandleOf, ROSTER_REQUIRED_MESSAGE } from '@/lib/taskAssignGate';`, 19행(`cur` 확인) 아래 20행을:
```ts
  // 명부 게이팅(설계 §9 ③) — 다른 사람으로 바꿀 때만 판정(같은 사람 재선택은 저장소가 no-op으로 끝낸다). 저장 표기는 명부 표기로.
  // 결제 수단은 저장소(replaceInfluencer)가 비운다 — 앞사람의 수단 id가 남으면 안 된다(§8-2).
  const canon = await rosterHandleOf(sql, parsed.value.handle);
  if (!canon && parsed.value.handle.toLowerCase() !== (cur.influencerHandle ?? '').toLowerCase()) {
    return NextResponse.json({ error: ROSTER_REQUIRED_MESSAGE }, { status: 400 });
  }
  const r = await replaceInfluencer(sql, taskId, { ...parsed.value, handle: canon ?? parsed.value.handle, actorId: gate.member.id, today: kstToday() });
```

- [ ] **Step 6: 원고 단건 PATCH** — `src/app/api/drafts/[id]/route.ts`

import에 `import { rosterHandleOf, ROSTER_REQUIRED_MESSAGE } from '@/lib/taskAssignGate';`
- 45행 `const influencerHandle = inf.value;`를 `let influencerHandle = inf.value;`로.
- 트랜잭션 반환 타입(73행)의 합집합에 `| 'not-in-roster'`를 더한다.
- `if (!before) return 'no-draft';`(78행) 바로 아래, `let syncHandle = influencerHandle;`(81행)보다 위에:
```ts
    // 명부 게이팅(설계 §9 ④·⑤) — 원고에 사람을 새로 넣거나 바꿀 때만. 해제(null)·같은 사람은 판정하지 않는다.
    // 명부에 있으면 명부 표기로 저장한다. 문자열 return이라 커밋되지만 아직 아무것도 쓰지 않았다(위의 행 잠금 select뿐).
    if (influencerHandle) {
      const canon = await rosterHandleOf(tx, influencerHandle);
      if (!canon && influencerHandle.toLowerCase() !== (before.influencerHandle ?? '').toLowerCase()) return 'not-in-roster';
      if (canon) influencerHandle = canon;
    }
```
- 113행 위에: `if (result === 'not-in-roster') return NextResponse.json({ error: ROSTER_REQUIRED_MESSAGE }, { status: 400 });`

- [ ] **Step 7: 원고 일괄 PATCH** — `src/app/api/drafts/route.ts`

import에 `import { rosterHandleOf, ROSTER_REQUIRED_MESSAGE } from '@/lib/taskAssignGate';`, `const sql = getSql();`(129행) 아래에:
```ts
  // 명부 게이팅(설계 §9 — 일괄 배정 바도 사람이 입력하는 인플 칸이다). 여러 건에 한 사람이라 '같은 사람' 예외 없이 판정한다.
  let bulkHandle = inf.value;
  if (bulkHandle) {
    const canon = await rosterHandleOf(sql, bulkHandle);
    if (!canon) return NextResponse.json({ error: ROSTER_REQUIRED_MESSAGE }, { status: 400 });
    bulkHandle = canon;
  }
```
그리고 트랜잭션 안의 `inf.value` 세 곳(`inf.value !== undefined ? { influencerHandle: inf.value }`, `influencerHandle: inf.value`)을 `bulkHandle`로 바꾼다(`inf.value === undefined` 판정 줄 126행은 그대로).

- [ ] **Step 8: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint "src/app/api/campaigns/[id]/tasks" "src/app/api/drafts" src/lib/taskAssignGate.ts`
Expected: `tsc=0`, 새 문제 없음. (서버 파일만 바꿔 `next build`는 이 태스크에서 필수가 아니다 — Task 13에서 전체 빌드.)

- [ ] **Step 9: 커밋**

```bash
git add src/lib/taskAssignGate.ts src/lib/taskAssignGate.test.ts src/lib/settlementStore.test.ts "src/app/api/campaigns/[id]/tasks/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts" "src/app/api/drafts/[id]/route.ts" src/app/api/drafts/route.ts
git commit -m "feat(task-panel-ui): 서버가 명부 밖 핸들 저장과 요청 뒤 결제 수단 변경을 거절한다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 결제 수단 보기 넓히기 — 고를 목록 싣기 (§8-2) — G3

1단계의 `/api/influencers/payment-view`에 고를 목록(계좌번호가 든 긴 설명이 아니라 `describeMethod` 요약 + 수수료 칩 + id·기본 여부)과 등록에 쓸 인플 id를 싣는다. 어느 수단이 이 작업의 것인지는 화면이 `task.paymentMethodId`(또는 새 작업의 로컬 값)로 `resolvePaymentChoice`에 물어본다 — 그래서 조회 키(핸들·작업·요청 상태)는 그대로다.

**Files:**
- Create: `src/lib/paymentChoice.ts`, `src/lib/paymentChoice.test.ts`
- Modify: `src/lib/paymentView.ts`, `src/lib/paymentView.test.ts`

**Interfaces:**
- Consumes: `taskPaymentMethod`(Task 3), `describeMethod`·`feeShortLabel`(기존)
- Produces:
  - `paymentChoice.ts`: `type FeeChip = { text: string; cb: boolean }`, `type PaymentChoice = { id: string; label: string; fee: FeeChip; isDefault: boolean }`, `toPaymentChoices(list: PaymentMethod[]): PaymentChoice[]`, `resolvePaymentChoice(choices: PaymentChoice[], chosenId: string | null): { choice: PaymentChoice | null; fallback: boolean }`, `choiceToStored(choices: PaymentChoice[], pickedId: string): string | null`
  - `PaymentView` 변경: `{ state: 'none'; influencerId: string }`, `{ state: 'ok'; label: string; fee: FeeChip; influencerId: string; choices: PaymentChoice[] }` (`label`·`fee`는 지금처럼 기본 수단 — 1단계 화면이 그대로 컴파일된다), `buildPaymentView`의 `roster` 입력이 `{ id: string; methods: PaymentMethod[] } | null`

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/paymentChoice.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaymentChoices, resolvePaymentChoice, choiceToStored } from './paymentChoice.ts';
import type { PaymentMethod } from './influencerPayment.ts';

const pm = (p: Partial<PaymentMethod>): PaymentMethod => ({
  id: 'm1', type: 'paypal', isDefault: true, holder: 'Sakura', currency: 'JPY', email: 's@x.com', updatedAt: '2026-09-01T00:00:00Z', ...p,
});
const list = [pm({ id: 'a' }), pm({ id: 'b', isDefault: false, type: 'paypay', fee: { mode: 'grossUp', percent: 3 } })];

test('1) 고를 목록 — 요약 한 줄 + 수수료 칩 + 기본 여부(계좌번호 같은 식별값은 describeMethod가 정한 만큼만)', () => {
  const c = toPaymentChoices(list);
  assert.deepEqual(c.map((x) => [x.id, x.isDefault]), [['a', true], ['b', false]]);
  assert.ok(c[0].label.startsWith('PayPal'));
  assert.deepEqual(c[1].fee, { text: 'CB 부담 3%', cb: true });
});

test('2) 이 작업의 수단 — 고른 것 / 없으면 기본 / 고른 게 지워졌으면 기본 + fallback', () => {
  const c = toPaymentChoices(list);
  assert.deepEqual(resolvePaymentChoice(c, 'b'), { choice: c[1], fallback: false });
  assert.deepEqual(resolvePaymentChoice(c, null), { choice: c[0], fallback: false });
  assert.deepEqual(resolvePaymentChoice(c, 'gone'), { choice: c[0], fallback: true });
});

test('3) 고른 값 → 저장 값 — 기본 수단을 고르면 null(= 기본을 따른다), 그 밖엔 id', () => {
  const c = toPaymentChoices(list);
  assert.equal(choiceToStored(c, 'a'), null);
  assert.equal(choiceToStored(c, 'b'), 'b');
  assert.equal(choiceToStored(c, 'nope'), null);
});
```

`paymentView.test.ts`의 `3)` 테스트를 새 모양으로 고친다:
```ts
test('3) 명부 밖 / 수단 없음 / 기본 수단 + 고를 목록', () => {
  assert.deepEqual(buildPaymentView({ request: null, roster: null }), { state: 'notInRoster' });
  assert.deepEqual(buildPaymentView({ request: null, roster: { id: 'inf1', methods: [] } }), { state: 'none', influencerId: 'inf1' });
  const v = buildPaymentView({ request: null, roster: { id: 'inf1', methods: [pm({ id: 'a', isDefault: false, type: 'paypay', currency: 'JPY', email: undefined, fee: { mode: 'grossUp', percent: 3 } }), pm({ id: 'b' })] } });
  assert.equal(v.state, 'ok');
  assert.ok(v.state === 'ok' && v.label.startsWith('PayPal') && v.fee.text === '인플 부담');   // label·fee는 기본 수단
  assert.ok(v.state === 'ok' && v.influencerId === 'inf1' && v.choices.map((c) => c.id).join(',') === 'a,b');
});
```
`2)`의 `roster: { methods: [pm({ email: 'new@x.com' })] }`는 `roster: { id: 'inf1', methods: [pm({ email: 'new@x.com' })] }`로. `4)`(DB 테스트) 끝에 한 줄: `assert.ok(v1.state === 'ok' && v1.influencerId === row.id && v1.choices.length === 1);`

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/paymentChoice.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현 — 순수 모듈**

```ts
// src/lib/paymentChoice.ts
// 작업 패널의 결제 수단 고르기(설계 §8-2) — 조회(paymentView)가 싣는 고를 목록과, 화면이 "이 작업의 수단"을 정하는 규칙.
// 규칙은 정산 후보와 같은 taskPaymentMethod 하나다. DB·postgres import 없음 — 화면이 값으로 import한다.
import { describeMethod, feeShortLabel, taskPaymentMethod, type PaymentMethod } from './influencerPayment.ts';

export type FeeChip = { text: string; cb: boolean };
export type PaymentChoice = { id: string; label: string; fee: FeeChip; isDefault: boolean };

export function toPaymentChoices(list: PaymentMethod[]): PaymentChoice[] {
  return list.map((m) => ({ id: m.id, label: describeMethod(m), fee: feeShortLabel(m.fee, m.currency), isDefault: m.isDefault }));
}

// fallback = 작업이 고른 수단이 그 사이 지워져 기본으로 정산된다(패널이 '기본 수단으로 바뀜 ⓘ'로 알린다, §10)
export function resolvePaymentChoice(choices: PaymentChoice[], chosenId: string | null): { choice: PaymentChoice | null; fallback: boolean } {
  return { choice: taskPaymentMethod(choices, chosenId), fallback: !!chosenId && !choices.some((c) => c.id === chosenId) };
}

// 드롭다운에서 고른 값 → 저장할 값. 기본 수단을 고르면 null(= 기본을 따른다)로 저장한다 — null이 "기본"의 유일한 표기라
// 같은 뜻이 두 값(null / 기본 id)으로 갈리지 않는다. 지워진 id를 쥔 작업도 기본을 고르면 깨끗이 null로 돌아간다.
export function choiceToStored(choices: PaymentChoice[], pickedId: string): string | null {
  const c = choices.find((x) => x.id === pickedId);
  return !c || c.isDefault ? null : c.id;
}
```

- [ ] **Step 4: 구현 — 조회 넓히기** (`src/lib/paymentView.ts`)

```ts
import type postgres from 'postgres';
import { describeMethod, getDefaultPaymentMethod, feeShortLabel, type PaymentMethod, type PaymentFee } from './influencerPayment.ts';
import { describeSnapshot, type PaymentMethodSnapshot } from './settlementCalc.ts';
import { toPaymentChoices, type FeeChip, type PaymentChoice } from './paymentChoice.ts';
import { isUuidLike } from './uuid.ts';

export type { FeeChip } from './paymentChoice.ts';   // 1단계 화면이 여기서 가져가던 이름 유지
export type PaymentView =
  | { state: 'notInRoster' }
  | { state: 'none'; influencerId: string }   // influencerId: 패널의 [+ 등록]이 이 인플에 수단을 추가한다(§8-3)
  // label·fee = 인플의 기본 수단(1단계 모양). choices = 고를 목록(§8-2) — 이 작업의 수단은 화면이 resolvePaymentChoice로 정한다
  | { state: 'ok'; label: string; fee: FeeChip; influencerId: string; choices: PaymentChoice[] }
  // paid = 정산 프로덕트가 지급 완료를 보냈다(external_status 'paid') — flowStage의 '완료' 판정과 같은 조건
  | { state: 'requested'; label: string; fee: FeeChip; paid: boolean };

export function buildPaymentView(input: {
  request: { method: PaymentMethodSnapshot; fee: PaymentFee | null; paid: boolean } | null;
  roster: { id: string; methods: PaymentMethod[] } | null;
}): PaymentView {
  if (input.request) {
    const m = input.request.method;
    // describeSnapshot은 슬랙 양식(`수단 | 수취인 | 식별`)이라 패널 한 줄엔 ' · '로 바꿔 쓴다
    return { state: 'requested', label: describeSnapshot(m).split(' | ').filter(Boolean).join(' · '), fee: feeShortLabel(input.request.fee, m.currency), paid: input.request.paid };
  }
  if (!input.roster) return { state: 'notInRoster' };
  const d = getDefaultPaymentMethod(input.roster.methods);
  if (!d) return { state: 'none', influencerId: input.roster.id };
  return { state: 'ok', label: describeMethod(d), fee: feeShortLabel(d.fee, d.currency), influencerId: input.roster.id, choices: toPaymentChoices(input.roster.methods) };
}
```
`loadPaymentView`의 명부 쿼리와 `roster`를:
```ts
  const inf = await sql<Array<{ id: string; payment_methods: unknown }>>`
    select id, payment_methods from influencer where lower(handle) = lower(${q.handle}) limit 1`;
  const roster = inf[0] ? { id: inf[0].id, methods: Array.isArray(inf[0].payment_methods) ? (inf[0].payment_methods as PaymentMethod[]) : [] } : null;
```
(파일 머리 주석과 `FeeChip` 정의 줄은 위 import·재수출로 대체된다 — `export type FeeChip = …` 원래 줄은 지운다.)

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --test src/lib/paymentChoice.test.ts && node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/paymentView.test.ts && npx tsc --noEmit -p . ; echo tsc=$?`
Expected: PASS, `tsc=0`(1단계 `PaymentLine.tsx`는 `label`·`fee`만 읽어 그대로 컴파일된다)

- [ ] **Step 6: 빌드 확인** — `paymentChoice.ts`는 다음 태스크부터 클라이언트가 값으로 import한다. 지금 서버 모듈을 값으로 끌어오지 않는지 여기서 한 번 본다.

Run: `grep -n "^import" src/lib/paymentChoice.ts && npx next build 2>&1 | tail -5`
Expected: import는 `./influencerPayment.ts` 하나, 빌드 성공

- [ ] **Step 7: 커밋**

```bash
git add src/lib/paymentChoice.ts src/lib/paymentChoice.test.ts src/lib/paymentView.ts src/lib/paymentView.test.ts
git commit -m "feat(task-panel-ui): 결제 수단 보기에 고를 목록과 인플 id를 싣는다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 명부 전용 콤보박스·칩 (§9 화면) — G3

`InfluencerField`에 `roster` prop이 오면 목록을 직접 그리는 콤보박스가 된다(사진·이름·핸들·단가 행 + `@핸들 명부에 등록하고 배정`). `roster`가 없으면 지금 `<datalist>` 그대로 — 링크 만들기(`LinkCreateModal`)·옛 작업 추가(`TaskAddModal`)는 바뀌지 않는다. 칩·원고 카드·일괄 배정 바는 `roster`를 받아 넘기기만 한다(값은 Task 9·10이 채운다).

**Files:**
- Modify: `src/components/InfluencerField.tsx`
- Modify: `src/components/InfluencerChip.tsx`
- Modify: `src/components/DraftCard.tsx:171-183`(props)·`460`(칩)
- Modify: `src/components/BulkActionBar.tsx:12-21`(props)·`54`(칩)

**Interfaces:**
- Consumes: `RosterGate`·`resolveRosterInput`·`rosterSuggestions`·`findRosterOption`·`ROSTER_FAILED_MESSAGE`·`ROSTER_OUTSIDE_MESSAGE`(Task 5), `Avatar`(1단계)
- Produces:
  - `InfluencerField` 새 props: `roster?: RosterGate`, `onCommit?: (handle: string) => void`(명부 표기 핸들, `''` = 비우기 — roster 모드에선 `onEnter`·`onBlur` 대신 이것. **받는 쪽은 다시 판정하지 않는다** — Global Constraints), `commitOnBlur?: boolean`(칸을 떠날 때도 확정 — 한 칸짜리 폼용, 팝오버 칩은 끈다), `priceType?: TaskType`(후보 행에 그 유형 단가)
  - `InfluencerChip`·`DraftCard`·`BulkActionBar`: `roster?: RosterGate` — 주면 명부 게이팅, 안 주면 지금 동작

- [ ] **Step 1: `InfluencerField` — 명부 모드 추가**

파일 머리 import를:
```tsx
'use client';
import { useId, useState } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { TaskType } from '@/lib/campaignJudgment';
import { formatAmount, suggestTaskCost } from '@/lib/campaignCost';
import { resolveRosterInput, rosterSuggestions, ROSTER_FAILED_MESSAGE, type RosterGate } from '@/lib/rosterPick';
import { Avatar } from '@/components/Avatar';
```
`InfluencerField`의 구조분해에 `roster, onCommit, commitOnBlur, priceType`을, props 타입 블록 끝(`hideHelp?: boolean;` 아래)에:
```tsx
  // 명부 전용(설계 §9) — 사람이 입력하는 작업·원고 인플 칸. roster가 없으면 아래 datalist 모드(자유 입력) 그대로.
  roster?: RosterGate;
  onCommit?: (handle: string) => void;   // roster 모드의 확정 — 명부 표기 핸들, '' = 비우기(onEnter·onBlur 대신)
  commitOnBlur?: boolean;                // 칸을 떠날 때도 확정(한 칸짜리 폼). 팝오버 칩은 끈다 — 저장 버튼으로 가는 blur가 확정이 되면 안 된다
  priceType?: TaskType;                  // 후보 행에 그 유형의 명부 단가
```
를 더한다. 분기는 기존 네 `useId` 호출 **뒤**, `return (` 바로 앞에 둔다(훅 호출 순서가 모드에 따라 바뀌면 안 된다):
```tsx
  const inputId = useId();
  const listId = useId();
  const helpId = useId();
  const errId = useId();

  if (roster) {
    return <RosterCombobox value={value} options={options} onChange={onChange} error={error} autoFocus={autoFocus}
                           hideLabel={hideLabel} roster={roster} onCommit={onCommit ?? (() => {})}
                           commitOnBlur={!!commitOnBlur} priceType={priceType} />;
  }

  return (
    // … 기존 datalist 모드 JSX 그대로 …
```

파일 끝에 콤보박스:
```tsx
// 명부 전용 콤보박스(설계 §9·§10, 시안 influencer-v1). 동작:
//  1) 입력하면 명부 후보(사진·이름·핸들·단가). 방향키로 고르고 Enter, 또는 눌러서 확정.
//  2) 정확히 같은 명부 핸들이 없으면 후보 아래에 `@핸들 명부에 등록하고 배정` 한 줄 — Enter·blur로는 배정하지 않는다
//     (X 프로필 조회 비용 → 누르는 opt-in, UX 원칙 6). 누르면 그 줄이 '불러오는 중…', 성공하면 명부 표기로 확정.
//  3) 명부를 못 읽었으면 한 줄 안내 + 배정 막음(서버가 어차피 거부한다).
// 후보 목록은 칸 아래 흐름 안에 그린다(absolute로 띄우지 않는다) — 패널 본문(overflow-y-auto)·교체 창 안에서 잘리지 않게.
// 후보를 누를 때 onMouseDown에서 기본 동작을 막아 입력칸 포커스를 지킨다 — 안 막으면 blur(commitOnBlur)가 클릭보다 먼저 돈다.
function RosterCombobox({ value, options, onChange, error, autoFocus, hideLabel, roster, onCommit, commitOnBlur, priceType }: {
  value: string; options: InfluencerOption[]; onChange: (v: string) => void; error: string | null;
  autoFocus?: boolean; hideLabel?: boolean; roster: RosterGate; onCommit: (handle: string) => void;
  commitOnBlur: boolean; priceType?: TaskType;
}) {
  const inputId = useId();
  const listId = useId();
  const errId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);   // 방향키로 고른 후보(-1 = 없음)
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [reg, setReg] = useState<{ handle: string; busy: boolean; error: string | null } | null>(null);

  const resolved = resolveRosterInput(value, options, roster.status);
  const list = roster.status === 'ok' ? rosterSuggestions(options, value) : [];
  const outside = resolved.kind === 'outside' ? resolved.handle : null;
  // 등록 상태는 그 핸들에만 붙는다 — 다른 핸들로 고쳐 치면 옛 '불러오는 중…'·오류가 남지 않는다
  const regFor = reg && outside && reg.handle.toLowerCase() === outside.toLowerCase() ? reg : null;
  const showList = open && list.length > 0;
  const shownErr = regFor?.error ?? localErr ?? error;

  function pick(handle: string) { setOpen(false); setActive(-1); setLocalErr(null); onCommit(handle); }
  function commitTyped(raw: string) {
    const r = resolveRosterInput(raw, options, roster.status);
    if (r.kind === 'empty') { setLocalErr(null); onCommit(''); return; }
    if (r.kind === 'roster') { pick(r.handle); return; }
    if (r.kind === 'invalid') { setLocalErr(r.message); return; }
    // outside·unavailable — 확정하지 않는다. 등록 줄·안내 줄이 이미 이유를 말한다.
  }
  async function registerAndPick(h: string) {
    setReg({ handle: h, busy: true, error: null });
    const r = await roster.register(h);
    if (!r.ok) { setReg({ handle: h, busy: false, error: r.error }); return; }   // 서버 문구 그대로(X에 없는 계정·조회 실패) — 다시 누를 수 있다
    setReg(null);
    pick(r.handle);
  }

  return (
    <div>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : 'block text-ui text-x-muted'}>게시할 인플루언서</label>
      <input id={inputId} role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
             aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
             value={value} autoFocus={autoFocus} placeholder="@핸들 또는 프로필 링크 붙여넣기"
             onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); setLocalErr(null); }}
             onFocus={() => setOpen(true)}
             onBlur={(e) => { setOpen(false); if (commitOnBlur) commitTyped(e.currentTarget.value); }}
             onKeyDown={(e) => {
               // 한글·일본어 조합을 확정하는 Enter가 저장으로 새면 안 된다(저장소 관례: nativeEvent.isComposing)
               if (e.nativeEvent.isComposing) return;
               if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, list.length - 1)); return; }
               if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
               // 목록이 열려 있으면 Esc는 목록만 닫는다 — 패널·교체 창의 document Esc까지 가지 않게 전파를 끊는다
               if (e.key === 'Escape' && showList) { e.stopPropagation(); setOpen(false); return; }
               if (e.key === 'Enter') {
                 e.preventDefault();
                 if (showList && active >= 0 && list[active]) pick(list[active].handle);
                 else commitTyped(e.currentTarget.value);   // 값은 state가 아니라 입력칸에서 읽는다(목록을 고른 직후 state가 늦다)
               }
             }}
             // 핸들은 대소문자 그대로 보존 — 모바일 자동 대문자·교정·브라우저 저장값 팝업을 끈다
             autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
             aria-invalid={shownErr ? true : undefined} aria-describedby={shownErr ? errId : undefined}
             className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
      {showList && (
        <ul id={listId} role="listbox" aria-label="명부 후보"
            className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-x-border-strong bg-white py-1 shadow-sm">
          {list.map((o, i) => {
            const name = o.name?.trim();
            const price = priceType ? suggestTaskCost(o.pricing, priceType) : null;
            return (
              <li key={o.handle} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.handle)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 ${i === active ? 'bg-x-hover' : 'hover:bg-x-hover'}`}>
                <Avatar url={o.avatarUrl} name={name || o.handle} size={28} />
                <span className="min-w-0 flex-1 truncate text-content">
                  {name ? <><b className="font-semibold">{name}</b> <span className="text-ui text-x-secondary">@{o.handle}</span></> : <b className="font-semibold">@{o.handle}</b>}
                </span>
                {price && <span className="shrink-0 text-ui text-x-secondary">{formatAmount(price.amount, price.currency)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {/* 등록 줄은 listbox 밖의 진짜 버튼이다 — 키보드(Tab)로도 닿고, 명시적으로 눌러야만 X 조회가 나간다 */}
      {outside && (
        <button type="button" onMouseDown={(e) => e.preventDefault()} disabled={!!regFor?.busy}
                onClick={() => void registerAndPick(outside)}
                className="mt-1 flex min-h-11 w-full items-center rounded-lg border border-dashed border-x-border-strong px-3 text-left text-content text-x-blue-text hover:bg-x-hover disabled:cursor-default disabled:text-x-muted">
          {regFor?.busy ? '불러오는 중…' : `@${outside} 명부에 등록하고 배정`}
        </button>
      )}
      {roster.status === 'failed'
        ? <p className="mt-1 text-ui text-amber-700">{ROSTER_FAILED_MESSAGE}</p>
        : resolved.kind === 'unavailable' && <p className="mt-1 text-ui text-x-muted">{resolved.message}</p>}
      {/* role="alert": 오류는 버튼(등록·저장)을 누른 뒤 뜬다 — 포커스가 버튼에 있어 describedby만으로는 안 읽힌다 */}
      {shownErr && <p id={errId} role="alert" className="mt-1 text-ui text-red-600">{shownErr}</p>}
    </div>
  );
}
```

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/components/InfluencerField.tsx`
Expected: `tsc=0`, 새 문제 없음

- [ ] **Step 2: `InfluencerChip` — 명부 모드**

import에 `import { resolveRosterInput, findRosterOption, ROSTER_OUTSIDE_MESSAGE, type RosterGate } from '@/lib/rosterPick';`

`POP_H` 상수 옆에:
```tsx
const POP_H_ROSTER = 400;   // 명부 모드는 후보 6행 + 등록 줄이 흐름 안에 붙는다 — 위/아래 뒤집기 판단용 근사치
```
props에 `roster?: RosterGate;`(주석: "주면 명부 게이팅(설계 §9 ④⑤) — 명부 밖 핸들은 저장하지 않고 등록 줄로 보낸다")를 더하고, `place`의 `POP_H` 두 곳을 `(roster ? POP_H_ROSTER : POP_H)`로(`place`의 `useCallback` 의존성에 `roster`를 넣는다 — 린트가 요구한다).

`save`의 `if (typed) { … }` 블록을:
```tsx
    if (typed) {
      if (roster) {
        // 명부 모드 — 명부 표기로만 저장한다. 명부 밖이면 닫지 않고 등록 줄을 가리킨다(거짓 성공 방지)
        const r = resolveRosterInput(typed, options, roster.status);
        if (r.kind === 'invalid' || r.kind === 'unavailable') { setErr(r.message); return; }
        if (r.kind === 'outside') { setErr(ROSTER_OUTSIDE_MESSAGE); return; }
        next = r.kind === 'roster' ? r.handle : null;
      } else {
        const parsed = parseXHandle(typed);
        // 형식이 틀리면 닫지 않는다 — 닫아버리면 안 저장된 채로 저장된 것처럼 보인다(거짓 성공 방지).
        if (!parsed.ok) { setErr(handleParseMessage(parsed.reason)); return; }
        next = parsed.handle;
      }
    }
```
`save` 아래에 명부 모드 확정 함수를 더한다 — `save`를 거치지 **않는다**:
```tsx
  // 명부 모드의 확정(후보 클릭·Enter·'등록하고 배정') — 콤보박스가 이미 명부 판정을 끝낸 명부 표기 핸들이 온다. 다시 판정하지 않는다:
  // '등록하고 배정'은 await 뒤 같은 틱에 이 함수를 부르는데, 그때 이 클로저의 options는 등록 전 목록이라
  // 다시 판정하면 방금 등록한 사람이 '명부 밖'으로 나와 저장이 안 된다. ''는 비우기(= 배정 해제).
  function commitRoster(h: string) {
    const next = h || null;
    if (bulk || next !== handle) onChange(next);
    close();
  }
```
팝오버 안의 `InfluencerField`를(명부 모드면 `onEnter`는 쓰이지 않으므로 넘기지 않는다):
```tsx
          <InfluencerField value={value} options={options} error={err} autoFocus
                           // 고치는 중에도 빨간 문구가 붙어 있으면 "고쳤는데 여전히 틀렸다"로 읽힌다 — 타이핑과 함께 지운다.
                           onChange={(v) => { setValue(v); setErr(null); }}
                           {...(roster
                             ? { roster, onCommit: commitRoster }
                             // 제안 목록에서 Enter로 고른 직후에는 state가 아직 그 값이 아니다 — 입력칸의 현재 값으로 저장한다.
                             : { onEnter: (v: string) => save(v) })} />
```
([저장] 버튼은 계속 `save()` — 사람이 친 값을 그 렌더의 목록으로 판정하는 게 맞는 자리다.)
칩 버튼 글자 — 예전 원고에 남은 명부 밖 핸들 표시(§9 "원고 쪽"):
```tsx
        {label ? <>{label} <span aria-hidden className="text-x-muted">⌄</span></>
               : (handle
                   ? <>@{handle}{roster && roster.status === 'ok' && !findRosterOption(options, handle) && <span className="text-amber-700"> · 명부에 없음</span>} <span aria-hidden className="text-x-muted">⌄</span></>
                   : '+ 인플루언서')}
```

- [ ] **Step 3: `DraftCard`·`BulkActionBar` — 통로**

`DraftCard.tsx`: props 구조분해(171행)에 `roster`를, 타입(182-183행 근처)에 `roster?: RosterGate; // 명부 게이팅(설계 §9 ④⑤) — 주는 화면에서만 켜진다(옛 /campaigns는 안 준다)`를, import에 `import type { RosterGate } from '@/lib/rosterPick';`를 더하고 460행을 `<InfluencerChip handle={draft.influencerHandle} options={influencerOptions} onChange={onAssignInfluencer} roster={roster} />`로.

`BulkActionBar.tsx`: props에 `roster?: RosterGate`(같은 import), 54행을 `<InfluencerChip handle={null} options={options} onChange={onInfluencer} label="인플루언서 배정" roster={roster} />`로.

- [ ] **Step 4: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/components/InfluencerField.tsx src/components/InfluencerChip.tsx src/components/DraftCard.tsx src/components/BulkActionBar.tsx ; node --import tsx --test src/lib/rosterPick.test.ts src/components/DraftCard.test.ts`
Expected: `tsc=0`, 새 문제 없음, PASS

- [ ] **Step 5: 빌드 확인**

Run: `npx next build 2>&1 | tail -5`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add src/components/InfluencerField.tsx src/components/InfluencerChip.tsx src/components/DraftCard.tsx src/components/BulkActionBar.tsx
git commit -m "feat(task-panel-ui): 인플 칸에 명부 전용 콤보박스와 '명부에 등록하고 배정'

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 콘텐츠 생성(`/generate`) 연결 (§9 ⑤) — G4

**Files:**
- Modify: `src/app/generate/page.tsx` — 54행(옵션 state)·199-201행(옵션 읽기)·668-679행(`onCreateTask`)·930·966·994행(DraftCard 2곳·BulkActionBar)

**Interfaces:**
- Consumes: `useInfluencerRoster`(Task 5), `DraftCard`·`BulkActionBar`의 `roster`(Task 8), `findRosterOption`(Task 5)

- [ ] **Step 1: 명부 훅으로 바꾸기**

54행 `const [influencerOptions, setInfluencerOptions] = useState<InfluencerOption[]>([]); // 편집창 자동완성 후보`를:
```tsx
  // 명부(배정 후보 + 단가·사진) — 읽기·등록은 공용 훅 하나(설계 §9). 실패와 빈 목록을 구분해 게이팅이 오판하지 않게 한다.
  const { options: influencerOptions, gate: rosterGate } = useInfluencerRoster();
```
199-201행(주석 두 줄 + `apiFetch('/api/drafts/influencers')…setInfluencerOptions…`)을 지운다. import에 `import { useInfluencerRoster } from '@/components/useInfluencerRoster';`, `import { findRosterOption } from '@/lib/rosterPick';`. (`InfluencerOption` 타입 import가 더 쓰이지 않으면 tsc/lint가 알린다 — 그때 뺀다.)

- [ ] **Step 2: 칩·일괄 배정 바에 관문**

`<DraftCard …>` 두 곳(930행 카드 뷰, 994행 피크)에 `roster={rosterGate}`, `<BulkActionBar …>`(966행)에 `roster={rosterGate}`.

- [ ] **Step 3: 원고 카드 '작업' 칸의 새 작업 만들기 — 명부 밖 옛 핸들**

668-679행 `onCreateTask`의 `createTasksApi` 호출을:
```tsx
      // 명부 밖 핸들(예전 원고에 남은 것)은 사람 줄에 싣지 않는다 — 서버가 거절한다(설계 §9). 빈 줄로 만들면
      // 미배정 작업 + 이 원고 붙이기가 되고, 붙일 때 attachDraft가 명부 밖 핸들을 채우지 않아 미배정으로 남는다(같은 규칙).
      const inRoster = !!d.influencerHandle && !!findRosterOption(influencerOptions, d.influencerHandle);
      const r = await createTasksApi(campaignId, {
        type, draftId: d.id, influencers: inRoster && d.influencerHandle ? [{ handle: d.influencerHandle }] : [],
      });
      if (!r.ok) { setToast(r.error); return false; }   // 409(이미 다른 작업에 붙음)도 이 문구로 충분하다
      if (d.influencerHandle && !inRoster) setToast('작업을 만들었어요 — 명부에 없는 인플이라 배정은 비워 뒀어요');
```
(나머지 줄 — 원고 다시 읽기·`return true` — 는 그대로.)

- [ ] **Step 4: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/generate/page.tsx`
Expected: `tsc=0`, 새 문제 없음

- [ ] **Step 5: 빌드 확인**

Run: `npx next build 2>&1 | tail -5`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add src/app/generate/page.tsx
git commit -m "feat(task-panel-ui): 콘텐츠 생성 원고 카드·일괄 배정도 명부에서만 고른다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: 캠페인 v2 인플 칸 연결 (§9 ①②③④) — G4

**Files:**
- Modify: `src/app/campaigns/flow/FlowDetail.tsx` — 117행(옵션 state)·286-290행(옵션 읽기)·329-335행(`saveProfilePricing`의 재조회)·678행(DraftCard)·966행 근처(TaskPanel props)·1092행(ReplaceDialog)
- Modify: `src/app/campaigns/flow/ReplaceDialog.tsx`
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` — props·`payRefresh`(205행)·`fillHandle`(281행)·`commitEditHandle`(369-380행)·편집 'influencer' 칸(425-465행)·새 작업 'influencer' 칸(561-579행)
- Modify: `src/app/campaigns/flow/panel/InfluencerSummary.tsx`

**Interfaces:**
- Consumes: `useInfluencerRoster`(Task 5), `InfluencerField`의 `roster`·`onCommit`·`commitOnBlur`·`priceType`, `DraftCard.roster`(Task 8), 서버 400 `ROSTER_REQUIRED_MESSAGE`(Task 6)
- Produces:
  - `TaskPanel` 새 props: `roster: RosterGate`, `rosterVersion: number`
  - `ReplaceDialog` 새 prop: `roster: RosterGate`
  - `InfluencerSummary` 새 prop: `note?: string`

- [ ] **Step 1: `FlowDetail` — 명부 훅**

117행을:
```tsx
  // 명부(배정 후보 + 단가·사진) — 읽기·등록은 공용 훅 하나(설계 §9). version은 등록할 때마다 올라 패널의 결제 수단 보기를 다시 읽게 한다.
  const { options: influencerOptions, gate: rosterGate, reload: reloadRoster, version: rosterVersion } = useInfluencerRoster();
```
286-290행(주석 + 옵션 읽기 이펙트)을 지운다. `saveProfilePricing`의 재조회(331-334행: 주석 두 줄 + `const inf …` + `if (Array.isArray(inf) …)`)를:
```tsx
    // 새 단가가 바로 보이게 명부를 다시 읽는다 — 실패하면 훅이 들고 있던 목록을 유지한다(빈 배열로 덮지 않는다)
    await reloadRoster();
```
로 바꾸고 `useCallback` 의존성을 `[show, reloadRoster]`로. import에 `import { useInfluencerRoster } from '@/components/useInfluencerRoster';`.

`renderDraftCard`의 `<DraftCard …>`(678행)에 `roster={rosterGate}`, `<TaskPanel …>`에 `roster={rosterGate} rosterVersion={rosterVersion}`, `<ReplaceDialog …>`(1092행)에 `roster={rosterGate}`.

- [ ] **Step 2: `ReplaceDialog` — 명부 판정**

import의 `parseXHandle, handleParseMessage` 줄을 `import { resolveRosterInput, type RosterGate } from '@/lib/rosterPick';`로 바꾸고 `resolveHandle`을:
```tsx
// 핸들 하나를 명부로 판정한다 — 사용자가 친 값이든(commitHandle) 카드에서 미리 골라 넘어온 값이든(initialHandle) 같은 길(koo QA 지적).
// 명부 밖이면 확정하지 않는다(handle '') — 입력칸의 '명부에 등록하고 배정' 줄이 다음 행동을 말한다(설계 §9 ③).
function resolveHandle(raw: string, currentHandle: string | null, options: InfluencerOption[], roster: RosterGate): { handle: string; handleInput: string; handleErr: string | null } {
  const r = resolveRosterInput(raw, options, roster.status);
  if (r.kind === 'empty') return { handle: '', handleInput: '', handleErr: null };
  if (r.kind === 'invalid' || r.kind === 'unavailable') return { handle: '', handleInput: raw, handleErr: r.message };
  if (r.kind === 'outside') return { handle: '', handleInput: raw, handleErr: null };
  if (currentHandle && r.handle.toLowerCase() === currentHandle.toLowerCase()) {
    return { handle: '', handleInput: r.handle, handleErr: '같은 인플루언서예요 — 바꿀 사람을 골라요' };
  }
  return { handle: r.handle, handleInput: r.handle, handleErr: null };
}
```
props에 `roster: RosterGate;`, `initial` 계산에 `influencerOptions, roster` 인자를 더한다(`resolveHandle`은 이제 카드에서 넘어온 `initialHandle`만 판정한다). `commitHandle`은 콤보박스가 이미 명부 판정을 끝낸 명부 표기 핸들을 받으므로 **다시 판정하지 않는다** — '등록하고 배정' 직후엔 이 클로저의 `influencerOptions`가 등록 전 목록이라 다시 판정하면 방금 등록한 사람이 명부 밖으로 나온다:
```tsx
  // h = 명부 표기 핸들(InfluencerField가 판정을 끝낸 값, '등록하고 배정' 포함) 또는 ''(비움). 같은 사람 확인만 여기서.
  function commitHandle(h: string) {
    const same = !!h && !!task.influencerHandle && h.toLowerCase() === task.influencerHandle.toLowerCase();
    setHandle(same ? '' : h); setHandleInput(h);
    setHandleErr(same ? '같은 인플루언서예요 — 바꿀 사람을 골라요' : null);
    if (h && !same) setCostChoice('keep');   // 사람이 바뀌면 새 단가 선택은 다시 기본값(유지)부터
  }
```
입력칸을:
```tsx
            <InfluencerField value={handleInput} options={influencerOptions} hideLabel
                             roster={roster} commitOnBlur priceType={task.type}
                             onChange={(v) => { setHandleInput(v); setHandleErr(null); setHandle(''); }} error={handleErr}
                             onCommit={commitHandle} />
```
(`onChange`에서 `setHandle('')` — 확정한 뒤 다시 고쳐 치면 [교체하기]가 옛 사람으로 나가지 않게.) ReplaceDialog 자체 Esc 리스너는 그대로 — 콤보박스가 목록이 열려 있을 때 Esc 전파를 끊는다(Task 8).

- [ ] **Step 3: `InfluencerSummary` — '명부에 없음'**

```tsx
// 배정된 인플 한 줄(설계 §6) — 사진 36px + 표시 이름 / @핸들. 이름이 없으면 @핸들 한 줄. 명부 밖이면 option이 없어 이니셜 원.
// note: 이름 줄 아래 짧은 주의 한 줄(예: '명부에 없음', §9·§10) — 주황.
export function InfluencerSummary({ handle, option, muted = false, actions, note }: {
  handle: string; option: InfluencerOption | undefined; muted?: boolean; actions?: ReactNode; note?: string;
}) {
  const name = option?.name?.trim();
  return (
    <div className={`flex min-w-0 items-center gap-3 ${muted ? 'opacity-60' : ''}`}>
      <Avatar url={option?.avatarUrl} name={name || handle} size={36} />
      <div className="min-w-0">
        {name
          ? <><p className="truncate text-content font-semibold">{name}</p><p className="truncate text-ui text-x-secondary">@{handle}</p></>
          : <p className="truncate text-content font-semibold">@{handle}</p>}
        {note && <p className="text-ui text-amber-700">{note}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-3">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 4: `TaskPanel` — props·상태**

import에 `import { findRosterOption, type RosterGate } from '@/lib/rosterPick';`. props 구조분해(68-71행)에 `roster, rosterVersion`을, 타입에:
```tsx
  // 명부 관문(설계 §9) — 인플 칸이 명부에서 고르거나 '명부에 등록하고 배정'만 된다. FlowDetail의 useInfluencerRoster가 준다.
  roster: RosterGate;
  rosterVersion: number;   // 명부 등록이 성공할 때마다 오른다 — 결제 수단 보기('명부에 등록하면 보여요')를 다시 읽는 키
```
편집 모드 로컬 상태(195-197행) 아래에:
```tsx
  // 이미 명부 밖으로 배정된 작업의 [명부에 등록](§9) — 등록만 한다(배정은 이미 돼 있다)
  const [regBusy, setRegBusy] = useState(false);
  const [regErr, setRegErr] = useState<string | null>(null);
```
205행 `payRefresh`를:
```tsx
  const payRefresh = task ? `${task.settlement?.status ?? ''}:${task.settlement?.externalStatus ?? ''}:${rosterVersion}` : `${rosterVersion}`;
```

- [ ] **Step 5: `TaskPanel` — 확정 함수들**

`fillHandle`(281행)을:
```tsx
  // 명부 밖 핸들(예전 원고의 주인)은 채우지 않는다 — 서버 attachDraft도 그 핸들로 작업을 채우지 않는다(설계 §9). 명부가 아직이면 그대로 둔다.
  const fillHandle = useEffectEvent((h: string) => {
    if (h && roster.status === 'ok' && !findRosterOption(influencerOptions, h)) return;
    commitNewHandle(h);
  });
```
`commitEditHandle`(369-380행)을:
```tsx
  // h는 명부 표기 핸들(InfluencerField가 명부 판정을 끝낸 값, '등록하고 배정'도 같은 길) 또는 ''(비움 — 아무것도 안 한다)
  async function commitEditHandle(t: FlowRow, h: string) {
    if (!h) return;
    setEditHandleErr(null);
    // 게시된 작업의 최초 배정은 저장하는 순간 잠긴다(서버가 그 뒤의 변경·해제를 거절한다) — 오타 한 번이
    // 삭제·재생성 말고는 되돌릴 수 없는 상태를 만들므로, 블러로 조용히 저장하지 않고 한 번 묻는다.
    if (t.postedAt && !window.confirm(`@${h}로 저장할까요?\n\n게시된 작업이라 나중에 바꿀 수 없어요.`)) return;
    const ok = await actions.assignInfluencer(t, h, { autoCost: false });   // 비용은 [확인]이 확정한다(R24)
    if (ok) setEditHandleInput('');
  }
  async function registerExisting(h: string) {
    setRegBusy(true); setRegErr(null);
    const r = await roster.register(h);
    setRegBusy(false);
    if (!r.ok) setRegErr(r.error);   // 서버 문구 그대로(X에 없는 계정·조회 실패) — 다시 누를 수 있다
  }
```

- [ ] **Step 6: `TaskPanel` — 편집 모드 인플 칸**

`renderEditField`의 `case 'influencer'`에서 `if (t.influencerHandle) { … }` 블록(431-458행)과 그 뒤 `return (<div><InfluencerField …/>…</div>)`(459-465행)을:
```tsx
        if (t.influencerHandle) {
          const opt = optionForHandle(t.influencerHandle);
          // 이미 명부 밖으로 배정된 작업(설계 §9, 9월 2주차 5건) — 자동 정리는 하지 않고 표시 + [명부에 등록]
          const outside = !opt && roster.status === 'ok';
          const note = outside ? '명부에 없음' : undefined;
          const registerBtn = outside ? (
            <button type="button" onClick={() => void registerExisting(t.influencerHandle as string)} disabled={regBusy}
                    className="text-ui text-x-blue-text hover:underline disabled:cursor-default disabled:text-x-muted disabled:no-underline">
              {regBusy ? '불러오는 중…' : '명부에 등록'}
            </button>
          ) : null;
          const regLine = regErr && <p role="alert" className="mt-1 text-ui text-red-600">{regErr}</p>;
          // 게시된 작업은 교체 자체가 서버 가드(POSTED_TASK_MESSAGE)에 막혀 있다 — FlowRowMenu의 prePost
          // 게이트와 같은 조건. 여기서 숨기지 않고 disabled로만 두면 눌렀을 때 400이 나는 거짓 어포던스가 된다.
          if (t.postedAt) return <div><InfluencerSummary handle={t.influencerHandle} option={opt} note={note} actions={registerBtn} />{regLine}</div>;
          const disabledReason = replaceDisabledReason(t, today);
          return (
            <div>
              {/* [해제]는 [바꾸기]와 같은 판정(replaceDisabledReason)으로 막는다 — 방문한 인플루언서를
                  떼면 서버가 거절하는 것과 같은 조작이라 이유 문구도 같아야 한다(라벨-값 일치). */}
              <InfluencerSummary handle={t.influencerHandle} option={opt} note={note} actions={
                <>
                  {registerBtn}
                  <button type="button" onClick={() => onReplace(t)} disabled={!!disabledReason} title={disabledReason ?? undefined}
                          className="text-ui text-x-secondary hover:underline disabled:cursor-not-allowed disabled:text-x-muted disabled:no-underline">
                    바꾸기
                  </button>
                  <button type="button" onClick={() => void handleDetach(t)} disabled={!!disabledReason} title={disabledReason ?? undefined}
                          className="text-ui text-x-secondary hover:underline disabled:cursor-not-allowed disabled:text-x-muted disabled:no-underline">
                    해제
                  </button>
                </>
              } />
              {/* title만으로 끝내지 않는다(UX 원칙 2·5) — 비활성 이유를 보이는 문구로도 말한다 */}
              {disabledReason && <p className="mt-1 text-ui text-x-muted">{disabledReason}</p>}
              {regLine}
            </div>
          );
        }
        return (
          <div>
            <InfluencerField value={editHandleInput} options={influencerOptions} hideLabel hideHelp
                             roster={roster} commitOnBlur priceType={t.type}
                             onChange={(v) => { setEditHandleInput(v); setEditHandleErr(null); }} error={editHandleErr}
                             onCommit={(h) => void commitEditHandle(t, h)} />
            {/* C1-b가 이 배정을 이제 서버에서 허용한다 — 왜 이 칸이 아직 남아 있는지, 채우면 뭐가 달라지는지 알린다 */}
            {t.postedAt && <p className="mt-1 text-ui text-x-muted">게시 확인된 작업이에요 — 누가 올렸는지 적으면 정산 후보에 잡혀요. 한 번 적으면 바꿀 수 없어요</p>}
          </div>
        );
```

- [ ] **Step 7: `TaskPanel` — 새 작업 인플 칸**

`renderNewField`의 `case 'influencer'` 끝 `return (<InfluencerField … onEnter={commitNewHandle} onBlur={commitNewHandle} />)`(575-579행)을:
```tsx
        return (
          <InfluencerField value={handleInput} options={influencerOptions} hideLabel hideHelp
                           roster={roster} commitOnBlur priceType={newType ?? undefined}
                           onChange={(v) => { setHandleInput(v); setHandleErr(null); }} error={handleErr}
                           onCommit={commitNewHandle} />
        );
```
(`commitNewHandle`은 그대로 — 명부 표기 핸들이 들어오면 지금처럼 parse·비용 초기화를 탄다.)

- [ ] **Step 8: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/campaigns/flow/ ; node --import tsx --test src/lib/campaignFlowView.test.ts src/lib/rosterPick.test.ts`
Expected: `tsc=0`, 새 문제 없음, PASS

- [ ] **Step 9: 빌드 확인**

Run: `npx next build 2>&1 | tail -5`
Expected: 성공

- [ ] **Step 10: 커밋**

```bash
git add src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/flow/ReplaceDialog.tsx src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/panel/InfluencerSummary.tsx
git commit -m "feat(task-panel-ui): 작업 패널·교체 창·원고 카드는 명부에서 고르거나 등록하고 배정

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: 결제 수단 고르기·등록 (§8-2·§8-3·§10) — G5 단독

**Files:**
- Modify: `src/app/campaigns/flow/panel/PaymentLine.tsx` (전체 교체)
- Create: `src/app/campaigns/flow/panel/PaymentMethodDialog.tsx`
- Modify: `src/app/campaigns/flow/TaskPanel.tsx` — 상태·`payRefresh`·`commitNewHandle`(338-348)·`resetNewFields`(314-321)·`submitNew`(355-359)·Esc/바깥 클릭 이펙트(290-312)·`costBox`(403-420)·다이얼로그 렌더
- Modify: `src/app/campaigns/flow/panel/PanelSection.tsx:4` (주석 한 줄)

**Interfaces:**
- Consumes: `PaymentView`의 `choices`·`influencerId`(Task 7), `resolvePaymentChoice`·`choiceToStored`(Task 7), `MethodForm`·`usePaymentMethodSend`(Task 4), `methodDraftOf`·`parseMethodDraft`·`newMethodIdOf`·`MethodDraft`(Task 4), `FlowRow.paymentMethodId`(Task 1), `actions.patch`·`TaskPatchRequest.paymentMethodId`·`buildTaskCreateBody({ paymentMethodId })`(Task 2), 서버 검증(Task 6)
- Produces:
  - `PaymentLine({ view, loading, failed, chosenId?, onChoose?, onRegister? })`, `canChoosePayment(view: PaymentView | null): boolean`
  - `PaymentMethodDialog({ influencerId, handle, isFirst, beforeIds, onClose, onSaved }: { …; beforeIds: string[]; onSaved: (list: PaymentMethod[], newId: string | null) => void })`

- [ ] **Step 1: `PaymentLine` 다시 쓰기**

```tsx
// src/app/campaigns/flow/panel/PaymentLine.tsx
import type { PaymentView } from '@/lib/paymentView';
import { resolvePaymentChoice, choiceToStored } from '@/lib/paymentChoice';

// '결제 수단' 한 줄(설계 §8-1~3·§10) — 평소엔 수단 + 수수료 칩만. 막힘·주의만 짧게. CB 부담은 비용이 늘어나는 쪽이라 주황.
// 수단 2개 이상이면 드롭다운(이 작업만, 맨 아래 '+ 새 결제 수단 등록'), 1개면 글자 + '+ 다른 수단 등록', 없으면 '결제 수단 없음' + [+ 등록].
// 이 작업의 수단은 resolvePaymentChoice(= 정산 후보와 같은 taskPaymentMethod) 하나로 정한다.
const NEW = '__new__';

// 소제목 옆 '· 이 작업에만 적용'을 붙일 때 — 실제로 고를 수 있을 때만(UX 원칙 4)
export function canChoosePayment(view: PaymentView | null): boolean {
  return view?.state === 'ok' && view.choices.length >= 2;
}

export function PaymentLine({ view, loading, failed, chosenId = null, onChoose, onRegister }: {
  view: PaymentView | null; loading: boolean; failed: boolean;
  chosenId?: string | null;                        // 작업이 고른 수단(null = 기본)
  onChoose?: (stored: string | null) => void;      // 저장할 값(기본을 고르면 null). 없으면 고를 수 없는 자리
  onRegister?: () => void;                         // 새 수단 등록 창 열기(§8-3). 없으면 등록 입구를 그리지 않는다
}) {
  if (loading) return <p className="text-content text-x-muted">불러오는 중…</p>;
  if (failed || !view) return <p className="text-content text-x-muted">결제 수단을 불러오지 못했어요</p>;
  const chipCls = (cb: boolean) => `whitespace-nowrap rounded-full border px-2.5 py-0.5 text-ui ${cb ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-x-border bg-x-surface text-x-secondary'}`;
  switch (view.state) {
    case 'notInRoster': return <p className="text-content text-x-muted">명부에 등록하면 보여요</p>;
    case 'none':
      return (
        <div className="flex items-center gap-3">
          <p className="text-content text-amber-700">결제 수단 없음</p>
          {onRegister && (
            <button type="button" onClick={onRegister}
                    className="rounded-lg border border-x-border-strong px-3 py-1.5 text-ui font-semibold hover:bg-x-hover">+ 등록</button>
          )}
        </div>
      );
    case 'requested':
      return (
        <div className="flex flex-wrap items-center gap-2">
          {/* 정산 프로덕트가 지급 완료를 보낸 건(단계 완료)은 '요청됨'이 아니라 '지급 완료' — 취소할 요청도 더는 없다 */}
          {view.paid
            ? <span title="이 수단으로 지급이 끝났어요" aria-label="이 수단으로 지급이 끝났어요" className="cursor-help text-ui text-x-secondary">🔒 지급 완료 ⓘ</span>
            : <span title="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" aria-label="요청에 담긴 수단이에요 — 바꾸려면 정산 화면에서 요청을 취소해요" className="cursor-help text-ui text-x-secondary">🔒 정산 요청됨 ⓘ</span>}
          <span className="min-w-0 truncate text-content" title={view.label}>{view.label}</span>
          <span className={chipCls(view.fee.cb)}>{view.fee.text}</span>
        </div>
      );
    case 'ok': {
      const { choice, fallback } = resolvePaymentChoice(view.choices, chosenId);
      const shown = choice ?? { id: '', label: view.label, fee: view.fee, isDefault: true };
      // 고른 수단이 프로필에서 지워짐 → 기본으로 정산된다(§8-2). 짧게 + ⓘ(§10)
      const fb = fallback && (
        <span title="고른 수단이 삭제돼 기본 수단으로 정산돼요" aria-label="고른 수단이 삭제돼 기본 수단으로 정산돼요"
              className="cursor-help text-ui text-amber-700">기본 수단으로 바뀜 ⓘ</span>
      );
      if (view.choices.length >= 2 && onChoose) {
        return (
          <div className="flex flex-wrap items-center gap-2">
            {/* 제어 컴포넌트라 '+ 새 결제 수단 등록'을 골라도 값은 지금 수단에 남는다 — 등록 창만 연다 */}
            <select value={shown.id} aria-label="이 작업의 결제 수단"
                    onChange={(e) => {
                      if (e.target.value === NEW) { onRegister?.(); return; }
                      onChoose(choiceToStored(view.choices, e.target.value));
                    }}
                    className="h-10 min-w-0 flex-1 rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue">
              {view.choices.map((c) => (
                <option key={c.id} value={c.id}>{`${c.label}${c.isDefault ? ' · 기본' : ''} · ${c.fee.text}`}</option>
              ))}
              {onRegister && <option value={NEW}>+ 새 결제 수단 등록</option>}
            </select>
            <span className={chipCls(shown.fee.cb)}>{shown.fee.text}</span>
            {fb}
          </div>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-content" title={shown.label}>{shown.label}</span>
          <span className={chipCls(shown.fee.cb)}>{shown.fee.text}</span>
          {fb}
          {onRegister && <button type="button" onClick={onRegister} className="text-ui text-x-blue-text hover:underline">+ 다른 수단 등록</button>}
        </div>
      );
    }
  }
}
```

- [ ] **Step 2: 등록 창**

```tsx
// src/app/campaigns/flow/panel/PaymentMethodDialog.tsx
'use client';
import { useEffect, useState } from 'react';
import { MethodForm, usePaymentMethodSend } from '@/components/PaymentMethodForm';
import { methodDraftOf, newMethodIdOf, parseMethodDraft, type MethodDraft } from '@/lib/paymentMethodDraft';
import type { PaymentMethod } from '@/lib/influencerPayment';

// 작업 패널에서 결제 수단 새로 등록(설계 §8-3) — 인플 프로필의 폼(MethodForm)을 그대로 띄운다(폼을 새로 짓지 않는다).
// 저장은 기존 POST /api/influencers/[id]/payment-methods — 결과는 프로필에도 그대로 남는다(같은 데이터).
// 첫 수단이면 자동 기본(기존 규칙). 새 id는 응답 배열을 등록 전 id와 비교해 찾아 부모에 넘긴다.
// 이 창이 떠 있는 동안 패널의 Esc·바깥 클릭은 TaskPanel이 끈다(overlayOpen 관례, payDialog).
export function PaymentMethodDialog({ influencerId, handle, isFirst, beforeIds, onClose, onSaved }: {
  influencerId: string; handle: string; isFirst: boolean; beforeIds: string[];
  onClose: () => void;
  onSaved: (list: PaymentMethod[], newId: string | null) => void;
}) {
  const [draft, setDraft] = useState<MethodDraft>(() => ({ ...methodDraftOf(null), makeDefault: isFirst }));
  const [err, setErr] = useState<string | null>(null);
  const { busy, send } = usePaymentMethodSend(influencerId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit() {
    // 클라이언트 검증도 서버와 같은 함수 — 문구가 갈리지 않는다
    const parsed = parseMethodDraft(draft);
    if (typeof parsed === 'string') { setErr(parsed); return; }
    const r = await send('POST', { input: parsed, makeDefault: isFirst || draft.makeDefault });
    if (!r.ok) { if (r.error !== null) setErr(r.error); return; }
    onSaved(r.paymentMethods, newMethodIdOf(beforeIds, r.paymentMethods));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="결제 수단 등록" className="w-full max-w-[560px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px]">@{handle} 결제 수단 등록</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        {/* 행동 전 기대(UX 원칙 2) — 여기서 등록한 수단이 어디에 남는지 한 줄 */}
        <p className="mt-1 text-ui text-x-secondary">인플 프로필에도 그대로 저장돼요</p>
        <div className="mt-3">
          <MethodForm draft={draft} setDraft={setDraft} isFirst={isFirst} showDefaultCheck
                      busy={busy} error={err} influencerId={influencerId}
                      onSubmit={() => void submit()} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `TaskPanel` — 상태·키·새 작업 배관**

import에:
```tsx
import { PaymentLine, canChoosePayment } from './panel/PaymentLine';
import { PaymentMethodDialog } from './panel/PaymentMethodDialog';
import type { PaymentMethod } from '@/lib/influencerPayment';
```
(기존 `import { PaymentLine } from './panel/PaymentLine';` 줄은 이것으로 대체.)

새 작업 로컬 상태(`const [note, setNote] = useState('');` 근처)에:
```tsx
  // 새 작업에서 고른 결제 수단(§8-2) — 만들기 전까지 로컬. 사람이 바뀌면 비운다(다른 사람의 수단 id가 남으면 안 된다)
  const [newMethodId, setNewMethodId] = useState<string | null>(null);
  // 결제 수단 등록 창(§8-3)과, 등록 뒤 결제 수단 보기를 다시 읽는 키
  const [payDialog, setPayDialog] = useState(false);
  const [payVersion, setPayVersion] = useState(0);
```
`payRefresh`(Task 10에서 바꾼 줄)을:
```tsx
  const payRefresh = task
    ? `${task.settlement?.status ?? ''}:${task.settlement?.externalStatus ?? ''}:${rosterVersion}:${payVersion}`
    : `${rosterVersion}:${payVersion}`;
```
`resetNewFields`에 `setNewMethodId(null);`를, `commitNewHandle`의 `if (p.handle.toLowerCase() !== handle.toLowerCase()) { setNewCost(null); setCostErr(null); }`를 `{ setNewCost(null); setCostErr(null); setNewMethodId(null); }`로, 빈 값 분기 `if (!v) { …; setNewCost(null); return; }`에도 `setNewMethodId(null);`를 더한다.

`submitNew`의 `buildTaskCreateBody({ … draftId: newDraft?.id ?? null, })`에 `paymentMethodId: newMethodId,`를 더한다.

바깥 클릭·Esc 이펙트(290-312행) 두 곳의 가드를 `if (overlayOpen || draftBusy || payDialog) return;`로, 의존성 배열에 `payDialog`를 더한다.

- [ ] **Step 4: `TaskPanel` — 고르기·등록 배선과 비용 · 정산 상자**

`costBox` 바로 위에:
```tsx
  // 이 작업의 결제 수단(§8-2) — 편집은 작업 행 값, 새 작업은 로컬 값. 고르면 편집은 즉시 PATCH(다른 칸과 같은 낙관적 갱신,
  // 실패하면 서버 문구 토스트 + 되돌림 — 요청 뒤 409 포함), 새 작업은 [만들기]에 함께 보낸다.
  const chosenMethodId = task ? task.paymentMethodId : newMethodId;
  function choosePayment(stored: string | null) {
    if (task) {
      if (stored !== task.paymentMethodId) void actions.patch(task, { paymentMethodId: stored }, { paymentMethodId: stored });
    } else {
      setNewMethodId(stored);
    }
  }
  // 등록 뒤(§8-3): 보기를 다시 읽고, 두 번째 이상이면 이 작업의 선택으로 바로 잡는다(방금 이 작업 때문에 등록했을 것이므로).
  // 새 수단을 기본으로 만들었으면 null(= 기본을 따른다) — choiceToStored와 같은 규칙.
  function onMethodRegistered(list: PaymentMethod[], newId: string | null) {
    setPayDialog(false);
    setPayVersion((v) => v + 1);
    const created = newId ? list.find((m) => m.id === newId) : undefined;
    if (list.length >= 2 && created) choosePayment(created.isDefault ? null : created.id);
  }
  const canRegisterMethod = pay.view?.state === 'ok' || pay.view?.state === 'none';
```
`costBox`의 결제 수단 부분(412-417행)을:
```tsx
        {!payCancelled && (
          <>
            <p className="mb-1.5 mt-3.5 text-[14px] font-semibold text-x-secondary">
              결제 수단
              {/* 고를 수 있을 때만 적용 범위를 말한다(§10 '결제 수단(평소)', UX 원칙 4) */}
              {canChoosePayment(pay.view) && <span className="text-ui font-normal text-x-muted"> · 이 작업에만 적용</span>}
            </p>
            {panelHandle
              ? <PaymentLine {...pay} chosenId={chosenMethodId} onChoose={choosePayment}
                             onRegister={canRegisterMethod ? () => setPayDialog(true) : undefined} />
              : <p className="text-content text-x-muted">인플 선택 후</p>}
          </>
        )}
```
`costBox` 위의 주석 "소제목에 '· 이 작업에만 적용'은 아직 붙이지 않는다 — …" 줄을 "소제목 옆 '· 이 작업에만 적용'은 고를 수 있을 때만(canChoosePayment)."으로 고친다.

`</aside>` 바로 위(푸터 `</div>` 뒤)에 등록 창:
```tsx
      {payDialog && panelHandle && pay.view && (pay.view.state === 'ok' || pay.view.state === 'none') && (
        <PaymentMethodDialog influencerId={pay.view.influencerId} handle={panelHandle} isFirst={pay.view.state === 'none'}
                             beforeIds={pay.view.state === 'ok' ? pay.view.choices.map((c) => c.id) : []}
                             onClose={() => setPayDialog(false)} onSaved={onMethodRegistered} />
      )}
```

`PanelSection.tsx:4` 주석을 `// aside: 칸 제목 줄 오른쪽 자리. 결제 수단의 '· 이 작업에만 적용'은 상자 제목이 아니라 '결제 수단' 소제목 옆에 붙는다(§10) — 지금 쓰는 곳 없음.`으로.

- [ ] **Step 5: 확인**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npx eslint src/app/campaigns/flow/ ; node --import tsx --test src/lib/paymentChoice.test.ts src/lib/taskCreateBody.test.ts src/lib/campaignFlowView.test.ts`
Expected: `tsc=0`, 새 문제 없음, PASS

- [ ] **Step 6: 빌드 확인** — 이 태스크가 클라이언트에서 `paymentChoice`·`paymentMethodDraft`·`PaymentMethodForm`을 처음 값으로 끌어온다.

Run: `npx next build 2>&1 | tail -5`
Expected: 성공(실패하면 오류가 가리키는 import 사슬에서 서버 모듈 값 import를 찾는다 — `paymentView.ts`에서는 **타입만** 가져와야 한다)

- [ ] **Step 7: 커밋**

```bash
git add src/app/campaigns/flow/panel/PaymentLine.tsx src/app/campaigns/flow/panel/PaymentMethodDialog.tsx src/app/campaigns/flow/TaskPanel.tsx src/app/campaigns/flow/panel/PanelSection.tsx
git commit -m "feat(task-panel-ui): 작업 패널에서 결제 수단을 고르고 새로 등록한다

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: 업데이트 소식 (AGENTS.md "업데이트 소식 작성 규칙") — G6

1단계는 이미 배포돼 09-24 항목이 따로 나가 있다 — 2단계는 별도 배포라 **새 항목 한 건**(설계 §12의 "한 건"을 단계마다 한 건으로 읽는다).

**Files:**
- Modify: `src/content/updates.ts` (맨 위, `UPDATES` 배열 첫 항목으로)

- [ ] **Step 1: 항목 추가** (날짜는 머지 예정일 — 머지 직전에 실제 날짜로 확인)

```ts
  {
    date: '2026-09-25', type: '개선',
    title: '작업마다 결제 수단을 고를 수 있고, 인플루언서는 명부에서 골라 배정해요',
    summary: '작업 패널의 비용 · 정산 칸에서 이 작업에 쓸 결제 수단을 고르거나 그 자리에서 새로 등록할 수 있어요. 인플루언서 칸은 이제 명부에서 고르거나, 명부에 없으면 그 자리에서 등록한 뒤 배정해요 — 핸들을 앞부분만 쳐서 엉뚱한 계정이 배정되는 일을 막기 위해서예요.',
    bullets: [
      '결제 수단이 두 개 이상인 인플은 칸에서 바로 고를 수 있어요 — 고른 수단은 이 작업의 정산에만 쓰이고, 인플 프로필의 기본 수단은 그대로예요',
      '결제 수단이 없으면 [+ 등록]으로 그 자리에서 추가해요 — 인플 프로필에도 그대로 저장되고, 두 번째 수단을 등록하면 이 작업의 수단으로 바로 골라져요',
      '고른 수단이 나중에 프로필에서 지워지면 기본 수단으로 정산되고, 패널에 "기본 수단으로 바뀜"이 떠요. 정산 요청을 보낸 작업은 수단을 바꿀 수 없어요',
      '쓰던 방식이 바뀐 것: 명부에 없는 인플은 작업 패널·교체 창·원고 카드(콘텐츠 생성 포함)·일괄 배정에서 바로 배정되지 않아요. 입력하면 "명부에 등록하고 배정" 줄이 나오고, 누르면 X에서 프로필을 불러와 명부에 올린 뒤 배정해요',
      '쓰던 방식이 바뀐 것: 예전 캠페인 화면에서도 명부에 없는 인플은 저장되지 않고 "명부에 먼저 등록해 주세요"가 떠요',
      '이미 명부 밖 인플로 배정된 작업은 그대로 두고, 인플 칸에 "명부에 없음"과 [명부에 등록]을 보여줘요',
    ],
    link: { label: '캠페인 v2', href: '/campaigns/flow' },
  },
```

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: PASS

- [ ] **Step 2: 커밋**

```bash
git add src/content/updates.ts
git commit -m "docs(task-panel-ui): 업데이트 소식 — 작업 패널 2단계(결제 수단 고르기·명부 게이팅)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: 최종 검증과 확인 넘기기 — G6

**Files:** 없음(고칠 것이 나오면 해당 태스크의 파일)

- [ ] **Step 1: 타입·린트**

Run: `npx tsc --noEmit -p . ; echo tsc=$? ; npm run lint 2>&1 | tail -2`
Expected: `tsc=0`, `✖ 24 problems`(기준선과 같음)

- [ ] **Step 2: 전체 테스트(연습용 DB)**

Run: `npm test` (약 17분, 출력이 늦게 나온다 — 파이프로 자르지 말 것. 다른 세션이 같은 연습용 DB로 `npm test`를 돌리는 중이면 끝난 뒤에)
Expected: 실패 0. `attachDraft`가 명부 밖 원고 핸들로 작업을 채우던 가정을 둔 테스트가 여기서 드러나면, 그 테스트의 원고 핸들을 `createInfluencer`로 명부에 넣는 쪽으로 고친다(규칙을 되돌리지 않는다).

- [ ] **Step 3: 빌드**

Run: `npx next build 2>&1 | tail -8`
Expected: 성공

- [ ] **Step 4: 운영 적용 전 확인** — 060은 운영 빌드 첫 단계(`scripts/migrate-on-build.mjs`)가 적용한다. 따로 운영 DB에 돌리지 않는다. 확인만:

Run: `ls migrations | tail -2 && grep -c "add column if not exists" migrations/060_campaign_task_payment_method.sql`
Expected: 마지막 파일이 `060_campaign_task_payment_method.sql`, `1`

- [ ] **Step 5: koo 화면 확인 넘기기**

배포: 명부 등록·결제 수단 등록이 **실제 데이터를 쓰므로** 스테이징(`npm run deploy:staging`, 연습용 DB, cb-x-deck-staging.vercel.app)을 먼저 쓴다. 안 되면 프리뷰(`npx vercel@58.9.1 --yes --scope clinic-bridge`, `--prod` 없이, 배포 전 `.vercel/project.json`이 `cb-x-deck`인지 확인) — 이때 등록 테스트는 원래 명부에 있어야 할 실제 인플로만. 로그인이 막히면 `npm run build && npx next start -p 3001` + `http://127.0.0.1:3001`.

**`window.confirm`은 사람이 직접 눌러야 한다** — Aside는 확인창을 자동으로 수락하므로, 아래 ★ 항목은 koo가 직접 확인하고 Aside로 대신 확인하지 않는다.

확인 목록:
1. 새 작업: 인플 칸에 핸들 앞부분 입력 → 명부 후보(사진·이름·단가) → 방향키+Enter / 클릭으로 배정. 명부에 없는 정확한 핸들 → 후보 아래 `@핸들 명부에 등록하고 배정`만, Enter·칸 떠나기로는 배정 안 됨 → 누르면 `불러오는 중…` → 배정.
2. X에 없는 핸들로 등록 → 빨간 서버 문구, 배정 안 됨, 다시 누를 수 있음.
3. 미배정 기존 작업: 같은 흐름으로 배정. ★ 게시 확인된 미배정 작업에서 '등록하고 배정' → "게시된 작업이라 나중에 바꿀 수 없어요" 확인창.
4. [바꾸기](교체 창): 명부 후보·등록 줄, 목록 열린 채 Esc → 목록만 닫힘(창은 그대로), 한 번 더 Esc → 창 닫힘.
5. 원고 모드 원고 카드 인플 칩 / 콘텐츠 생성 원고 카드 칩: 명부 밖 핸들 저장 → 문구로 막힘, 등록 줄로 배정. ★ 일괄 배정 바의 두 번 확인창(형제 시안 경고).
6. 예전 명부 밖 배정 작업(9월 2주차 5건 중 하나): 인플 칸 `명부에 없음` + [명부에 등록] → 등록 후 표시·결제 수단 줄이 바뀜. 메모·비용 편집은 그대로 저장됨.
7. 결제 수단: 수단 2개 이상 인플 → 드롭다운 + `· 이 작업에만 적용`, 바꾸면 정산 화면 후보의 수단이 바뀜, 프로필 기본은 그대로. 1개 → 글자 + `+ 다른 수단 등록`. 없음 → `결제 수단 없음` + [+ 등록] → 폼 팝업(PayPay QR 올리기 포함) → 저장 → 줄이 바뀜. 두 번째 수단 등록 → 이 작업의 선택이 새 수단으로.
8. 등록 창이 떠 있을 때 Esc → 창만 닫힘(패널은 그대로).
9. 고른 수단을 프로필에서 삭제 → 패널에 `기본 수단으로 바뀜 ⓘ`.
10. 정산 요청을 보낸 작업 → `🔒 정산 요청됨 ⓘ`(드롭다운 없음). 지급 완료 작업 → `🔒 지급 완료 ⓘ`.
11. 인플을 다른 사람으로 교체 → 결제 수단이 새 사람의 기본으로.
12. 예전 캠페인 화면(`/campaigns`)의 작업 추가에 명부 밖 핸들 → "명부에 없는 인플이에요 — 명부에 먼저 등록해 주세요"가 뜨고 저장 안 됨(화면을 따로 고치지 않았다 — 이 문구만으로 되는지 koo 판단).
13. 인플 프로필 결제 수단(추가·수정·기본으로·삭제·QR)이 전과 똑같이 동작(폼을 옮긴 영향 없음).
14. ★ 새 작업 폼에 입력한 채 닫기 → "입력한 내용이 사라져요. 닫을까요?" / ★ [해제] 확인창.

---

## 설계와 다르게 정한 것 · 애매해서 정한 것

1. **서버 명부 판정을 저장소 함수가 아니라 라우트에 둔다(설계 §9 "서버"와 다름).** 설계는 `createTasks·updateTask·replaceInfluencer`가 `requireRosterHandle`을 부른다고 적었지만, 테스트 11개 파일이 이 함수들을 가짜 핸들로 약 130번 부르고(정산 테스트는 `H('ghost')`로 '명부 없음'을 일부러 만든다) 시드·이관 스크립트도 같다. 저장소에 넣으면 그 전부를 명부 행 픽스처로 다시 써야 한다. 사람 입력은 전부 HTTP 라우트 5곳을 지나므로 "서버가 명부 밖 핸들을 새로 저장하지 않는다"는 그대로 성립한다. `attachDraft`(원고 핸들로 미배정 작업 채우기)만 저장소 안에서 판정한다 — 거기는 라우트가 끼어들 자리가 없다.
2. **활성 요청 판정은 `hasActiveRequest`(status만)가 아니라 `status='requested' and external_status<>'cancelled'`.** 패널 잠금 표시·단계 판정과 같은 조건이라 "화면은 열려 있는데 서버가 막는" 어긋남이 없다(`hasLiveRequest`).
3. **`· 이 작업에만 적용`은 상자 제목(`PanelSection.aside`)이 아니라 '결제 수단' 소제목 옆**(§10 "소제목 옆" 문자 그대로). 금액도 이 작업 것이라 상자 제목 옆에 붙이면 범위가 흐려진다. 수단이 2개 이상일 때만 보인다. `aside` prop은 쓰는 곳 없이 남기고 주석만 고친다.
4. **기본 수단을 고르면 `null`로 저장**(= 기본을 따른다). 기본 id를 박아 두면 같은 뜻이 두 값으로 갈린다. 대신 프로필의 기본이 바뀌면 그 작업도 따라간다 — 설계 §8-2 "null = 기본 수단"과 같은 의미.
5. **명부 밖 핸들의 등록 줄은 부분 일치 후보가 있어도 맨 아래에 함께 나온다.** 설계는 "후보 자리에 한 줄만"이라 적었는데, 부분 일치(예: `coco` 입력에 `coco_jp`)가 있을 때 등록 줄을 숨기면 진짜 `coco`를 등록할 길이 없다. 후보를 먼저 보여 줘 `coco_jp`를 고르게 유도하고, 등록은 X가 계정 존재를 확인한다. 정확히 일치하는 명부 핸들이 없을 때만 나온다.
6. **일괄 배정 바(`BulkActionBar`)도 게이팅한다** — §9 ①~⑤ 목록에 없지만 사람이 입력하는 원고 인플 칸이고(`/generate`), 서버 일괄 PATCH도 막는다. 옛 `/campaigns` 화면(`TaskTable` 칩·`TaskAddModal`·`CampaignDetail`의 원고 카드)은 `roster`를 안 넘겨 화면은 그대로이고, 서버가 400 문구(`명부에 없는 인플이에요 — 명부에 먼저 등록해 주세요`)를 돌려준다 — 그 화면은 이미 서버 문구를 그대로 띄우므로(`TaskAddModal`의 `setErr(r.error)`, `useCampaignTaskActions`의 `show(r.error)`) **따로 한 줄을 더하지 않는다**. 제거 예정 화면이라 게이팅 UI도 넣지 않는다. QA 12번에서 koo가 판단한다.
7. **새 작업 폼의 `formHandleFill`(있는 원고를 골라 주인을 채우는 신호)은 명부 밖 핸들이면 채우지 않는다** — 서버 `attachDraft`와 같은 규칙. `/generate`의 원고 카드 '작업 만들기'도 명부 밖 핸들은 사람 줄에 싣지 않고 미배정으로 만든 뒤 한 줄 토스트로 알린다(서버 400을 그대로 보이는 대신 — 붙이기는 성공시키는 `attachDraft`와 결을 맞춘다).
8. **`attachDraft`가 명부 밖 원고 핸들 때문에 작업을 미배정으로 둘 때, 원고의 핸들은 지우지 않는다**(기존 데이터 보존, §9 "이미 들어와 있는 명부 밖 핸들은 건드리지 않는다"). 원고 카드가 `명부에 없음`으로 보여 준다.
9. **수동 원고 생성(`/api/drafts/manual`)은 게이팅할 입력이 없다** — 본문에 인플 칸이 없고, 작업에 붙여 만들면 작업의 핸들이 원고로 간다(반대 방향). 설계 §9 "수동 원고 생성"은 이 확인으로 갈음한다.
10. **업데이트 소식은 1단계 항목에 불릿을 더하지 않고 새 항목 한 건** — 1단계가 이미 배포돼 그 항목이 공개됐고, 2단계는 별도 배포다.

## Self-Review

**1. 설계 대비 빠진 것:**
- §8-2 드롭다운·도움말(§10 `· 이 작업에만 적용`) → Task 11 / 060 → Task 1 / edit 즉시 PATCH·new 로컬 → Task 11 / 인플 변경 시 null(실제 변경만, 개명 유지) → Task 1(`updateTask`·`replaceInfluencer`, 개명은 손대지 않음) / 서버 검증·요청 중 거부 → Task 6 / 배관(`parseTaskPatch`·`TaskPatch`·`TaskCreateInput`·`buildTaskCreateBody`·Row/SELECT·`CandRow`/`CANDIDATE_BASE`) → Task 1·2·3 / 정산 후보·수수료 합계 → Task 3 / 고른 수단 삭제 → `기본 수단으로 바뀜 ⓘ` → Task 7(`fallback`)·11 / 요청 뒤 선택 불가 → Task 11(`requested` 분기는 고르기 없음)·6(서버).
- §8-3 입구 셋(없음 [+ 등록] / 1개 `+ 다른 수단 등록` / 드롭다운 맨 아래) → Task 11 / MethodForm 떼기(입력 상태·검증·send) → Task 4 / 새 id 찾기 → Task 4(`newMethodIdOf`) / 첫 수단 자동 기본·두 번째 이상 자동 선택 → Task 11 / 다이얼로그 동안 Esc 끔 → Task 11(`payDialog`).
- §9 ①②③④⑤ → Task 10(①②③④)·9(⑤) / 콤보박스(`role="listbox"`)·`rosterOnly`(여기선 `roster` prop) → Task 8 / 확정 로직 게이팅(`commitNewHandle`·`commitEditHandle`·`resolveHandle`·`InfluencerChip.save`) → Task 10·8 / 명부 읽기 실패 한 줄 + 막음 → Task 5·8 / 등록 흐름(불러오는 중·성공 created true/false·실패 문구) → Task 5·8 / 예전 명부 밖 배정 `명부에 없음 [명부에 등록]` → Task 10 / 원고 카드 `명부에 없음` → Task 8 / 서버(작업 생성·수정·교체·원고 PATCH) → Task 6 / `attachDraft` 미배정 유지 → Task 1 / 대소문자 같은 사람·명부 표기 저장 → Task 1·6 / 기존 데이터 불변 → Task 6(변경일 때만).
- §10 2단계 줄: 결제 수단 평소·없음·삭제됨·요청 뒤·지급 완료 → Task 11 / 명부에 없는 핸들 `@핸들 명부에 등록하고 배정` 한 줄 → Task 8 / 예전 명부 밖 배정 → Task 10.
- §12 검증: `taskPaymentMethod` 3케이스 → Task 3 / 060 뒤 정산 후보가 고른 수단 → Task 3 / 인플 변경 시 비움 → Task 1 / 전체 `npm test`·타입·린트 24 → Task 13 / 업데이트 글 → Task 12.
- 빠진 것 없음. 범위 밖(§11): 정산 후보 화면의 '고른 수단 삭제됨' 표시, 9월 2주차 명부 밖 5건 정리, 옛 `/campaigns` 게이팅 UI — 계획에 없음(의도).

**2. 자리표시자 점검:** "TBD/TODO/나중에"·"적절한 오류 처리"·"Task N과 비슷하게" 없음. 날짜 `2026-09-25`는 머지 예정일 값이고 머지 직전 확인하라고 적었다(1단계 관례). Task 1 Step 7·Task 13 Step 2의 "오류가 가리키는 픽스처/테스트를 고친다"는 파일을 미리 특정할 수 없는 도구 결과 대응이라 고칠 모양(`paymentMethodId: null` / `createInfluencer`)을 함께 적었다.

**3. 이름·타입 일관성:** `paymentMethodId`(TS)·`payment_method_id`(DB) 전 태스크 동일 / `rosterHandleOf`·`ROSTER_REQUIRED_MESSAGE`(Task 1) → Task 6에서 같은 이름 / `checkTaskPaymentMethod(sql, handle | null, methodId)`·`hasLiveRequest(sql, taskId)`(Task 6) / `taskPaymentMethod(list, chosenId)`(Task 3) → Task 7 `resolvePaymentChoice` 안에서 / `PaymentChoice`·`FeeChip`(Task 7, `paymentView`가 재수출) / `PaymentView.ok.choices`·`influencerId`(Task 7) → Task 11 / `MethodDraft`·`methodDraftOf`·`parseMethodDraft`·`newMethodIdOf`(Task 4) → Task 11 / `usePaymentMethodSend(influencerId).send(method, body)` 반환 `PaymentSendResult`(Task 4) → Task 11 / `RosterGate{status, register}`·`resolveRosterInput`·`findRosterOption`·`rosterSuggestions`(Task 5) → Task 8·9·10 / `useInfluencerRoster()` 반환 `{options, status, reload, gate, version}`(Task 5) → Task 9(`options`·`gate`)·10(`options`·`gate`·`reload`·`version`) / `InfluencerField`의 `roster`·`onCommit`·`commitOnBlur`·`priceType`(Task 8) → Task 10 / `TaskPanel`의 `roster`·`rosterVersion`(Task 10) → Task 11 `payRefresh` / `PaymentLine`의 `chosenId`·`onChoose`·`onRegister`·`canChoosePayment`(Task 11 안에서 정의·사용).

## 기준선

- 린트: 24 (Task 0에서 다시 재서 다르면 고친다)
