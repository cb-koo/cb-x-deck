# 정산팀 지급 금액 ≠ 작업 금액 처리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정산팀이 작업 금액과 다른 금액으로 지급한 건을 "작업 금액 vs 정산팀 지급"으로 판정해 정산 화면에서 바로 [그대로 두기]/[지급 금액에 맞추기]로 처리하고, 작업 금액이 바뀔 때마다 누가·언제·얼마에서 얼마로·왜를 남긴다.

**Architecture:** 판정은 순수 함수 하나(`settlementDisplay.taskPaidMismatch`)가 표 버튼·상단 안내·캠페인 배지·서버 가드를 모두 정한다. 정산 요청 행은 `R_SELECT`의 상관 서브쿼리로 "지금 작업 금액"을 함께 읽고, 처리(맞춤/그대로 둠)는 요청 행의 `diff_ack_*` 칸과 새 `task_change` 이력 테이블에 한 트랜잭션으로 쓴다(`payment_request.updated_at`은 건드리지 않아 정산팀 폴링에 흐르지 않는다). 작업 금액을 바꾸는 모든 쓰기(캠페인 PATCH·인플 교체·정산 맞추기)는 같은 트랜잭션에서 `task_change` 1행을 남긴다.

**Tech Stack:** Next.js(App Router, 이 저장소 버전 — `node_modules/next/dist/docs/` 확인), TypeScript, postgres.js, node:test + tsx, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-07-settlement-diff-reconcile-design.md` — 모든 태스크는 이 스펙이 우선. §9 문구표는 글자 하나까지 그대로.

## Global Constraints

- 작업 폴더 `/Users/koo_clinicbridge/cb-x-deck/.worktrees/settlement-diff`(브랜치 `cb-koo/settlement-diff`). 원 저장소 루트로 cd 금지. 모든 명령은 이 폴더에서.
- 경로 명시 스테이징(`git add -A`·`git add .` 금지). push·머지·배포 금지. 커밋 메시지 끝줄: 빈 줄 다음 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 마이그레이션은 `065` 하나, **추가만**·**전 문장 멱등**·트랜잭션 안에서 도는 문장만(AGENTS.md). 064는 방문 예약용으로 예약됨 — 건드리지 않는다. 연습용 DB에만 손으로 적용한다(운영은 머지 후 빌드가 적용).
- 순수 테스트: `node --import tsx --test <파일>`.
- DB 테스트: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test <파일>` — **연습용 DB만**. 워크트리의 `.env.staging`은 Task 1에서 복사한다. `.env`(운영)는 Task 12의 읽기 전용 확인 외에는 절대 쓰지 않는다. testGuard가 막으면 멈추고 보고.
- 새 테스트 파일이 정산 요청을 만들면 그 접두어를 `src/lib/settlementTestFixture.ts`의 `TEST_FIXTURE_HANDLE_RE/_PG`와 `settlementTestFixture.test.ts` 파일 목록에 넣어야 한다 — 이 계획은 요청을 만드는 DB 테스트를 전부 기존 `src/lib/settlementStore.test.ts`(접두어 `tstl`, 이미 등록됨)에 넣어 이 변경이 없다.
- 완료 기준(각 태스크 끝): `npx tsc --noEmit -p .` 0, 변경 파일 `npx eslint <파일들>`에서 **새로 생긴** 경고·오류 0(기존 린트 기준선 24개 — 표 컨테이너 예외 2건 포함 — 는 그대로 두고 고치지 않는다. 아래 각 태스크의 "eslint … → 0"도 이 뜻), 해당 테스트 통과. 마지막 태스크에서 `npx next build`(NOT `npm run build` — 그건 마이그레이션을 먼저 돌린다).
- **문구:** 사용자에게 보이는 새 문구는 스펙 §9 표에 있는 것만. 정산 상대는 사용자 문구에서 전부 `정산팀`(`정산 쪽`·`정산 프로덕트`·`정산 담당자`·`그쪽` 금지). 코드 주석·지난 업데이트 소식 글은 그대로 둔다.
- **판정 범위 상수는 한 곳:** `FX_RATIO_BAND = { min: 0.8, max: 1.0 }`(`src/lib/settlementDisplay.ts`). 정산팀은 적용 환율을 보내지 않는다(koo 결정) — 달러 지급·엔화 값 없는 지급은 이 비율 범위로만 본다.
- 예산·집행 기준은 계속 작업 금액. 정산 요청 행의 금액 스냅샷·정산팀 연동(내보내기 항목)은 바꾸지 않는다.
- 버튼 순서: 확정이 오른쪽 — 창은 `[취소][확정]`, 표는 `[그대로 두기][지급 금액에 맞추기]`(오른쪽이 진한 버튼).
- UX(AGENTS.md·메모리): 도구 화면은 14~15px·행 44px+. 표 행 안 버튼은 `stopPropagation`(행 클릭 = 펼치기).

## 파일 지도

| 파일 | 책임 | 태스크 |
|---|---|---|
| `migrations/065_settlement_diff_reconcile.sql` (새) | `task_change` 테이블 + `payment_request.diff_ack_kind/reason/task_cost` | 1 |
| `src/lib/campaignCost.ts` | `sameTaskCost` | 2 |
| `src/lib/settlementDisplay.ts` | 판정(`paidMismatch`·`taskPaidMismatch`·`FX_RATIO_BAND`)·그대로 두기 사유·표시 라벨·안내 문구 상수 | 2, 4, 8 |
| `src/lib/settlementCalc.ts` | 맞추기 창 제안 금액 `suggestTaskCostFromPaid`·집행액 차이 `budgetDeltaKrw` | 3 |
| `src/lib/settlementStore.ts` | 요청 읽기 모델(지금 작업 금액·처리 기록)·`matchTaskCostToPaid`·`keepTaskCost`·`undoKeepTaskCost` | 4, 8 |
| `src/lib/campaignTaskStore.ts` | `task_change` 쓰기/읽기·`hasPaidRequest`·배지 확장·교체 이력·`costChangeCount` | 4, 6 |
| `src/app/api/settlement/requests/[id]/route.ts`, `src/lib/settlementApi.ts` | 처리 동작 HTTP | 5, 8 |
| `src/lib/campaignTaskInput.ts`, `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`, `.../replace/route.ts`, `.../changes/route.ts`(새), `src/lib/campaignApi.ts` | 작업 금액 사유 관문·이력 쓰기·이력 조회 | 5, 6 |
| `src/app/settlement/RequestList.tsx`, `RequestRow.tsx`, `MatchDialog.tsx`(새), `KeepDialog.tsx`(새), `reconcileParts.tsx`(새) | 상단 안내·표·버튼·두 창 | 7 |
| `src/app/settlement/RequestRow.tsx`, `PartnerResultBlock.tsx`, `ReconcileRecord.tsx`(새), `RevisionHistory.tsx`, `src/components/ChangeEntry.tsx`(새), `src/lib/taskChangeView.ts`(새) | 펼침 두 블록·처리 기록·이력 한 모양 | 8 |
| `src/app/campaigns/flow/CostConfirmField.tsx`, `FlowDetail.tsx`, `panel/TaskCostHistory.tsx`(새), `src/app/campaigns/useCampaignTaskActions.ts` | 작업 패널 사유 칸·안내·변경 이력 | 9 |
| 정산 화면 나머지·인플 타임라인·결제 수단 문구, `CandidateTable.tsx` | 정산팀 통일·열 이름·필터 위치 | 10 |
| `src/content/updates.ts` | 업데이트 소식 | 11 |
| `scripts/check-paid-mismatch.ts`(새) | 배포 전 운영 판정 확인(읽기 전용) | 12 |

---

### Task 1: 작업 환경 + 마이그레이션 065

**Files:**
- Create: `migrations/065_settlement_diff_reconcile.sql`

**Interfaces:**
- Consumes: 없음
- Produces: 테이블 `task_change(id, task_id, field, before, after, source, reason, request_id, by_member, by_name, created_at)`, 칸 `payment_request.diff_ack_kind text ('matched'|'kept'|null)`, `diff_ack_reason text`, `diff_ack_task_cost jsonb ({amount,currency}|null)`. 연습용 DB에 적용된 상태.

- [ ] **Step 1: 워크트리 준비(의존성·연습용 접속 파일)**

```bash
cd /Users/koo_clinicbridge/cb-x-deck/.worktrees/settlement-diff
npm ci
cp /Users/koo_clinicbridge/cb-x-deck/.env.staging .env.staging   # .env*는 gitignore — 커밋되지 않는다. .env(운영)는 복사하지 않는다
git status --short   # 비어 있어야 한다(.env.staging은 무시됨)
```

- [ ] **Step 2: 마이그레이션 파일 작성**

`migrations/065_settlement_diff_reconcile.sql`:

```sql
-- 065: 정산팀 지급 금액 ≠ 작업 금액 처리(스펙 2026-10-07-settlement-diff-reconcile-design.md §7)
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 빌드 중 옛 코드는 새 테이블·칸을 모르니 무해하다.
-- 전 파일이 매 운영 빌드마다 다시 돌므로 모든 문장은 재실행 안전(멱등).

-- 작업 칸 변경 이력 — 지금은 금액만. field로 다른 칸을 나중에 같은 테이블에 쌓는다(koo 10-07 B-3).
-- 지우거나 고치는 API는 없다(스펙 §6). 작업이 지워지면 같이 지워진다 — 정산 요청이 있는 작업은 삭제가 이미 막혀 있다.
create table if not exists task_change (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references campaign_task(id) on delete cascade,
  field       text not null check (field in ('cost')),
  before      jsonb,            -- {amount,currency} | null
  after       jsonb,
  source      text not null check (source in ('campaign', 'replace', 'settlement')),
  reason      text not null default '',
  request_id  uuid references payment_request(id) on delete set null,
  by_member   uuid references member(id) on delete set null,
  by_name     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_task_change_task on task_change (task_id, created_at desc);

-- 지급 금액 차이 처리 기록. 기존 diff_ack_at·diff_ack_by_name을 그대로 쓰고 종류·사유·처리 때 값을 더한다.
-- 기존 확인 기록(종류 null)은 옛 기록으로 그대로 둔다 — 화면에 '확인함'으로만 보이고 판정을 숨기지 않는다(스펙 §7).
-- add column if not exists는 칸이 있으면 check까지 통째로 건너뛰므로 재실행해도 제약이 겹치지 않는다.
alter table payment_request
  add column if not exists diff_ack_kind      text check (diff_ack_kind in ('matched', 'kept')),
  add column if not exists diff_ack_reason    text,
  add column if not exists diff_ack_task_cost jsonb;   -- 처리 때의 작업 금액 — 지금과 다르면 다시 표시(§4-4)
```

- [ ] **Step 3: 연습용 DB에 두 번 적용(멱등 확인)**

```bash
set -a; source .env.staging; set +a
case "$PGUSER $PGHOST" in *xdwtehjlxsnntsuizxba*) echo "운영을 가리킨다 — 중단"; exit 1;; esac
psql -v ON_ERROR_STOP=1 -f migrations/065_settlement_diff_reconcile.sql
psql -v ON_ERROR_STOP=1 -f migrations/065_settlement_diff_reconcile.sql
psql -At -c "select count(*) from information_schema.columns where table_name='payment_request' and column_name in ('diff_ack_kind','diff_ack_reason','diff_ack_task_cost')"
psql -At -c "select count(*) from information_schema.tables where table_name='task_change'"
```
Expected: 두 번 모두 오류 없이 끝남, `3`, `1`.

- [ ] **Step 4: 커밋**

```bash
git add migrations/065_settlement_diff_reconcile.sql
git commit -m "feat(settlement-diff): 065 작업 금액 변경 이력·지급 금액 차이 처리 칸

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 판정 순수 함수 — `taskPaidMismatch`와 친구들

**Files:**
- Modify: `src/lib/campaignCost.ts` (끝에 `sameTaskCost` 추가)
- Modify: `src/lib/settlementDisplay.ts` (import 줄 교체 + 파일 끝에 블록 추가 — 기존 함수는 이 태스크에서 건드리지 않는다)
- Test: `src/lib/settlementMismatch.test.ts` (새, 순수)

**Interfaces:**
- Consumes: `computeMoney(cost, payoutCurrency, fee, rate)` (`settlementCalc.ts`), `formatMoney`, `TaskCost`, `PaymentFee`, `Currency`
- Produces:
```ts
// campaignCost.ts
export function sameTaskCost(a: TaskCost | null, b: TaskCost | null): boolean;
// settlementDisplay.ts
export type DiffAckKind = 'matched' | 'kept';
export const FX_RATIO_BAND: { readonly min: 0.8; readonly max: 1 };
export interface MismatchSource {
  status: SettlementBadgeStatus; externalStatus: ExternalStatus | null;
  taskId: string | null; taskCost: TaskCost | null;
  payoutCurrency: Currency; fee: PaymentFee | null; rateKrwPerJpy: number;
  paidAmountKrw: number | null; paidAmountJpy: number | null;
  diffAckKind: DiffAckKind | null; diffAckTaskCost: TaskCost | null;
}
export type PaidMismatch =
  | { kind: 'exact'; expectedGross: number; paid: number; diff: number; currency: Currency }
  | { kind: 'band'; expectedGross: number; ratio: number; diff: number; currency: 'KRW' };
export function paidMismatch(s: MismatchSource): PaidMismatch | null;      // 처리 기록 무시
export function taskPaidMismatch(s: MismatchSource): PaidMismatch | null;  // 처리 기록 반영 — 화면·서버가 쓰는 것
export const KEEP_REASONS: readonly ['환율·송금 수수료 차이', '추가 지급(별도 합의)', '기타'];
export type KeepReason = typeof KEEP_REASONS[number];
export const RECONCILE_REASON_MAX = 200;
export function composeKeepReason(kind: unknown, memo: unknown): string | null;
export const RECONCILE_STALE_MESSAGE: string;   // §9 경합 오류
export function requestCostOf(r: { costCurrency: Currency; amountKrw: number; rateKrwPerJpy: number }): TaskCost;
export function paidFxRateText(s: { payoutCurrency: Currency; paidAmountKrw: number | null; paidAmountJpy: number | null; amountGross: number }): string | null;
export function partnerNameLabel(name: string | null): string | null;
export function isPaidBadge(b: { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null } | null): boolean;
export function pendingRequestCost(t: { cost: TaskCost | null; settlement: { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; costCurrency: Currency; amountKrw: number; rateKrwPerJpy: number } | null }): TaskCost | null;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/settlementMismatch.test.ts`:

```ts
// 정산팀 지급 금액 ≠ 작업 금액 판정(스펙 2026-10-07 §4·§10) — 순수. 실례 2건(17dsy·saachan)과 정상 환율 건·경계를 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameTaskCost } from './campaignCost.ts';
import {
  paidMismatch, taskPaidMismatch, FX_RATIO_BAND, composeKeepReason, KEEP_REASONS, requestCostOf, paidFxRateText,
  partnerNameLabel, isPaidBadge, pendingRequestCost, type MismatchSource,
} from './settlementDisplay.ts';

// @17dsy_ 더스퀘어치과_10월1주차 인용RT — 작업 4,000엔, 정산팀 엔화 6,000엔 지급(메모 "인용 6000엔")
const dsy: MismatchSource = {
  status: 'requested', externalStatus: 'paid', taskId: 't1', taskCost: { amount: 4000, currency: 'JPY' },
  payoutCurrency: 'JPY', fee: null, rateKrwPerJpy: 10, paidAmountKrw: 51000, paidAmountJpy: 6000,
  diffAckKind: null, diffAckTaskCost: null,
};
// @saachan0013 더스퀘어치과_9월2주차 인용RT — 작업 50,000원, PayPal(5%) 달러 지급 $104.08 = 139,758원, 엔화 값 없음
const saachan: MismatchSource = {
  ...dsy, taskCost: { amount: 50000, currency: 'KRW' }, fee: { mode: 'grossUp', percent: 5 }, paidAmountKrw: 139758, paidAmountJpy: null,
};
// 정상 엔화 지급(엔화 값 없음) — 작업 5,000엔, 수수료 없음 → 기대 송금 5,000엔 × 요청 환율 10 = 50,000원
const band = (paidAmountKrw: number): MismatchSource => ({ ...dsy, taskCost: { amount: 5000, currency: 'JPY' }, paidAmountJpy: null, paidAmountKrw });

test('sameTaskCost — 둘 다 없음은 같다, 금액·통화가 모두 같아야 같다', () => {
  assert.equal(sameTaskCost(null, null), true);
  assert.equal(sameTaskCost({ amount: 1, currency: 'KRW' }, null), false);
  assert.equal(sameTaskCost({ amount: 1, currency: 'KRW' }, { amount: 1, currency: 'KRW' }), true);
  assert.equal(sameTaskCost({ amount: 1, currency: 'KRW' }, { amount: 1, currency: 'JPY' }), false);
});

test('FX_RATIO_BAND — 범위는 한 곳(0.80~1.00)', () => {
  assert.deepEqual(FX_RATIO_BAND, { min: 0.8, max: 1 });
});

test('실례 17dsy — 엔화 지급 + 엔화 값 있음: 엔화끼리 정확히 비교, 작업 금액을 6,000엔으로 고치면 풀린다', () => {
  assert.deepEqual(paidMismatch(dsy), { kind: 'exact', expectedGross: 4000, paid: 6000, diff: 2000, currency: 'JPY' });
  assert.equal(taskPaidMismatch({ ...dsy, taskCost: { amount: 6000, currency: 'JPY' } }), null);
});

test('실례 saachan — 달러 지급(엔화 값 없음): 비율 2.66이 범위 밖이라 다름, 맞는 금액이면 범위 안', () => {
  const m = paidMismatch(saachan);
  assert.ok(m && m.kind === 'band');
  assert.equal(m.expectedGross, 5263);              // round(5,000 ÷ 0.95)
  assert.equal(m.diff, 139758 - 52630);
  assert.ok(m.ratio > 2.65 && m.ratio < 2.66);
  // 150,000원이면 기대 15,789엔 × 10 = 157,890원, 비율 0.885 — 환율로 설명된다
  assert.equal(taskPaidMismatch({ ...saachan, taskCost: { amount: 150000, currency: 'KRW' } }), null);
});

test('정상 환율 건(0.85·0.90)과 경계(0.80·1.00)는 같음, 그 바깥은 다름', () => {
  assert.equal(paidMismatch(band(42500)), null);   // 0.85
  assert.equal(paidMismatch(band(45000)), null);   // 0.90
  assert.equal(paidMismatch(band(40000)), null);   // 0.80 — 경계 포함
  assert.equal(paidMismatch(band(50000)), null);   // 1.00 — 경계 포함
  assert.equal(paidMismatch(band(39999))?.kind, 'band');
  assert.equal(paidMismatch(band(50001))?.kind, 'band');
  assert.equal(paidMismatch(band(50001))?.diff, 1);
});

test('원화 지급 — 정액 수수료: 작업 30,000원 + 1,650원 = 기대 31,650원', () => {
  const krw: MismatchSource = { ...dsy, taskCost: { amount: 30000, currency: 'KRW' }, payoutCurrency: 'KRW', fee: { mode: 'fixed', amount: 1650 }, paidAmountJpy: null, paidAmountKrw: 31650 };
  assert.equal(paidMismatch(krw), null);
  assert.deepEqual(paidMismatch({ ...krw, paidAmountKrw: 30000 }), { kind: 'exact', expectedGross: 31650, paid: 30000, diff: -1650, currency: 'KRW' });
});

test('작업 원화 → 엔화 지급(비율 수수료 5%): 30,000원 → 3,000엔 → 송금 3,158엔', () => {
  const s: MismatchSource = { ...dsy, taskCost: { amount: 30000, currency: 'KRW' }, fee: { mode: 'grossUp', percent: 5 }, paidAmountJpy: 3158, paidAmountKrw: 27000 };
  assert.equal(paidMismatch(s), null);
  assert.deepEqual(paidMismatch({ ...s, paidAmountJpy: 4000 }), { kind: 'exact', expectedGross: 3158, paid: 4000, diff: 842, currency: 'JPY' });
});

test('작업 엔화 → 원화 지급: 3,000엔 × 10 = 30,000원', () => {
  const s: MismatchSource = { ...dsy, taskCost: { amount: 3000, currency: 'JPY' }, payoutCurrency: 'KRW', paidAmountJpy: null, paidAmountKrw: 30000 };
  assert.equal(paidMismatch(s), null);
});

test('판정 대상 아님 — 취소된 요청·지급 전·작업 없음·작업 금액 없음', () => {
  assert.equal(paidMismatch({ ...dsy, status: 'cancelled' }), null);
  assert.equal(paidMismatch({ ...dsy, externalStatus: 'scheduled' }), null);
  assert.equal(paidMismatch({ ...dsy, taskId: null }), null);
  assert.equal(paidMismatch({ ...dsy, taskCost: null }), null);
});

test('처리 기록 — 처리 때 작업 금액이 지금과 같으면 숨기고, 바뀌면 다시 뜬다. 옛 확인(종류 없음)은 숨기지 않는다', () => {
  const kept: MismatchSource = { ...dsy, diffAckKind: 'kept', diffAckTaskCost: { amount: 4000, currency: 'JPY' } };
  assert.equal(taskPaidMismatch(kept), null);
  assert.notEqual(paidMismatch(kept), null);                                                        // 차이 자체는 그대로 있다
  assert.equal(taskPaidMismatch({ ...kept, taskCost: { amount: 5000, currency: 'JPY' } })?.kind, 'exact');   // 누가 다시 고쳤다
  assert.equal(taskPaidMismatch({ ...dsy, diffAckKind: null, diffAckTaskCost: null })?.kind, 'exact');
});

test('composeKeepReason — 선택지 + 메모, 기타는 메모 필수, 모르는 선택지·200자 초과는 거절', () => {
  assert.deepEqual([...KEEP_REASONS], ['환율·송금 수수료 차이', '추가 지급(별도 합의)', '기타']);
  assert.equal(composeKeepReason('환율·송금 수수료 차이', ''), '환율·송금 수수료 차이');
  assert.equal(composeKeepReason('추가 지급(별도 합의)', ' 인용 6000엔 '), '추가 지급(별도 합의) — 인용 6000엔');
  assert.equal(composeKeepReason('기타', '  '), null);
  assert.equal(composeKeepReason('기타', '중복 지급'), '기타 — 중복 지급');
  assert.equal(composeKeepReason('아무거나', 'x'), null);
  assert.equal(composeKeepReason('기타', 'x'.repeat(200)), null);
});

test('requestCostOf — 요청에 담긴 작업 금액(엔화는 원화 ÷ 요청 환율)', () => {
  assert.deepEqual(requestCostOf({ costCurrency: 'JPY', amountKrw: 40000, rateKrwPerJpy: 10 }), { amount: 4000, currency: 'JPY' });
  assert.deepEqual(requestCostOf({ costCurrency: 'KRW', amountKrw: 50000, rateKrwPerJpy: 10 }), { amount: 50000, currency: 'KRW' });
});

test('paidFxRateText — 엔화로 보낸 건의 실제 환율(펼침 전용)', () => {
  assert.equal(paidFxRateText({ payoutCurrency: 'JPY', paidAmountKrw: 42450, paidAmountJpy: 5000, amountGross: 5000 }), '1엔 = 8.49원');
  assert.equal(paidFxRateText({ payoutCurrency: 'JPY', paidAmountKrw: 42450, paidAmountJpy: null, amountGross: 5000 }), '1엔 = 8.49원');
  assert.equal(paidFxRateText({ payoutCurrency: 'KRW', paidAmountKrw: 30000, paidAmountJpy: null, amountGross: 30000 }), null);
  assert.equal(paidFxRateText({ payoutCurrency: 'JPY', paidAmountKrw: null, paidAmountJpy: null, amountGross: 5000 }), null);
});

test('partnerNameLabel — 저장된 옛 이름(정산 프로덕트)은 화면에서 정산팀으로', () => {
  assert.equal(partnerNameLabel('정산 프로덕트'), '정산팀');
  assert.equal(partnerNameLabel('박구건'), '박구건');
  assert.equal(partnerNameLabel(null), null);
});

test('isPaidBadge / pendingRequestCost — 지급 전 살아 있는 요청의 금액이 작업 금액과 다를 때만 안내', () => {
  const badge = { status: 'requested' as const, externalStatus: 'received' as const, costCurrency: 'JPY' as const, amountKrw: 40000, rateKrwPerJpy: 10 };
  assert.deepEqual(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: badge }), { amount: 4000, currency: 'JPY' });
  assert.equal(pendingRequestCost({ cost: { amount: 4000, currency: 'JPY' }, settlement: badge }), null);
  assert.equal(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: { ...badge, externalStatus: 'paid' } }), null);
  assert.equal(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: { ...badge, status: 'cancelled' } }), null);
  assert.equal(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: null }), null);
  assert.equal(isPaidBadge({ ...badge, externalStatus: 'paid' }), true);
  assert.equal(isPaidBadge({ ...badge, status: 'cancelled', externalStatus: 'paid' }), false);
  assert.equal(isPaidBadge(badge), false);
  assert.equal(isPaidBadge(null), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/settlementMismatch.test.ts`
Expected: FAIL — `sameTaskCost`/`paidMismatch` 등이 export되지 않음(SyntaxError: does not provide an export named …).

- [ ] **Step 3: `sameTaskCost` 구현**

`src/lib/campaignCost.ts` 파일 끝에 추가:

```ts
// 작업 금액 두 개가 같은가 — 둘 다 없음(null)도 같다. 판정·이력·경합 확인이 같은 정의를 쓴다(스펙 2026-10-07 §4·§6).
export function sameTaskCost(a: TaskCost | null, b: TaskCost | null): boolean {
  if (a === null || b === null) return a === b;
  return a.amount === b.amount && a.currency === b.currency;
}
```

- [ ] **Step 4: `settlementDisplay.ts` import 교체**

파일 맨 위 import 세 줄

```ts
import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';
import { kstMonthDay } from './datetime.ts';
import { formatMoney } from './influencerPricing.ts';
```

을 아래로 교체:

```ts
import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';
import { kstMonthDay } from './datetime.ts';
import { formatMoney, type Currency } from './influencerPricing.ts';
import { sameTaskCost, type TaskCost } from './campaignCost.ts';
import type { PaymentFee } from './influencerPayment.ts';
import { computeMoney } from './settlementCalc.ts';   // 순수 모듈 — 요청을 만들 때와 같은 계산으로 기대 송금액을 낸다
```

- [ ] **Step 5: 판정 블록 추가**

`src/lib/settlementDisplay.ts` 파일 끝에 추가:

```ts
// ── 정산팀 지급 금액 ≠ 작업 금액(스펙 2026-10-07 §4) ──
// 이 함수 하나가 표 버튼·상단 안내·캠페인 배지·서버 가드(settlementStore.lockForReconcile)를 모두 정한다 — 판정이 두 곳이면 한쪽만 바뀐다.
// 비교 대상은 '요청 금액'이 아니라 '지금 작업 금액'이다: 작업 금액을 고치면 표시가 저절로 풀린다(§3-1).
export type DiffAckKind = 'matched' | 'kept';

// 달러 지급·엔화 값 없는 지급은 정확히 비교할 수 없어 '환율로 설명되는가'로 본다 — 지급 원화 ÷ (기대 송금액 × 요청 환율).
// 근거(§4-3): 정상 엔화 지급 84건 0.847~0.900(중앙 0.872), 오류 2건 1.27·2.65. 정산팀은 적용 환율을 보내지 않는다(koo 10-07).
// 범위를 바꿀 자리는 여기 하나.
export const FX_RATIO_BAND = { min: 0.8, max: 1.0 } as const;

export interface MismatchSource {
  status: SettlementBadgeStatus; externalStatus: ExternalStatus | null;
  taskId: string | null; taskCost: TaskCost | null;              // 지금 작업 금액(작업이 지워졌거나 비면 null) — 스냅샷이 아니다
  payoutCurrency: Currency; fee: PaymentFee | null; rateKrwPerJpy: number;   // 요청 스냅샷(보낸 통화·수수료·환율)
  paidAmountKrw: number | null; paidAmountJpy: number | null;    // 정산팀 결과
  diffAckKind: DiffAckKind | null; diffAckTaskCost: TaskCost | null;   // 처리 기록(065)
}
export type PaidMismatch =
  | { kind: 'exact'; expectedGross: number; paid: number; diff: number; currency: Currency }   // 보낸 통화로 정확히 비교
  | { kind: 'band'; expectedGross: number; ratio: number; diff: number; currency: 'KRW' };     // 비율로 본 것 — diff는 원화 차이

// 처리 기록을 보지 않은 판정 — "차이가 있는가" 자체. 화면·서버는 아래 taskPaidMismatch를 쓴다.
export function paidMismatch(s: MismatchSource): PaidMismatch | null {
  if (s.status === 'cancelled' || s.externalStatus !== 'paid' || !s.taskId || !s.taskCost || s.paidAmountKrw === null) return null;
  // 요청을 만들 때와 같은 계산을 지금 작업 금액으로 다시 한다(§4-2)
  const expectedGross = computeMoney(s.taskCost, s.payoutCurrency, s.fee ?? undefined, s.rateKrwPerJpy).amountGross;
  if (s.payoutCurrency === 'KRW') {
    const diff = s.paidAmountKrw - expectedGross;
    return diff === 0 ? null : { kind: 'exact', expectedGross, paid: s.paidAmountKrw, diff, currency: 'KRW' };
  }
  if (s.paidAmountJpy !== null) {
    const diff = s.paidAmountJpy - expectedGross;
    return diff === 0 ? null : { kind: 'exact', expectedGross, paid: s.paidAmountJpy, diff, currency: 'JPY' };
  }
  const expectedKrw = Math.round(expectedGross * s.rateKrwPerJpy);
  const ratio = expectedKrw === 0 ? (s.paidAmountKrw === 0 ? 1 : Number.POSITIVE_INFINITY) : s.paidAmountKrw / expectedKrw;
  if (ratio >= FX_RATIO_BAND.min && ratio <= FX_RATIO_BAND.max) return null;
  return { kind: 'band', expectedGross, ratio, diff: s.paidAmountKrw - expectedKrw, currency: 'KRW' };
}

// 처리 기록이 있으면 숨긴다 — 단 처리 때의 작업 금액이 지금과 같을 때만(§4-4). 지급 금액 쪽은 정산팀이 금액을 정정하면
// applyExternalStatus가 처리 기록을 통째로 비우므로 여기서 다시 볼 필요가 없다. 옛 확인(종류 null)은 숨기지 않는다.
export function taskPaidMismatch(s: MismatchSource): PaidMismatch | null {
  const m = paidMismatch(s);
  if (!m) return null;
  if (s.diffAckKind !== null && sameTaskCost(s.diffAckTaskCost, s.taskCost)) return null;
  return m;
}

// 그대로 두기 사유(§5-2) — 저장값은 "선택지 — 메모" 한 문자열(처리 기록 문장 `사유: {선택지}{ — 메모}`가 그대로 쓴다).
export const KEEP_REASONS = ['환율·송금 수수료 차이', '추가 지급(별도 합의)', '기타'] as const;
export type KeepReason = typeof KEEP_REASONS[number];
export const RECONCILE_REASON_MAX = 200;
export function composeKeepReason(kind: unknown, memo: unknown): string | null {
  if (typeof kind !== 'string' || !(KEEP_REASONS as readonly string[]).includes(kind)) return null;
  const m = typeof memo === 'string' ? memo.trim() : '';
  if (kind === '기타' && !m) return null;
  const s = m ? `${kind} — ${m}` : kind;
  return s.length > RECONCILE_REASON_MAX ? null : s;
}

// §9 경합 오류 — 서버(409)와 창이 같은 문장을 쓴다
export const RECONCILE_STALE_MESSAGE = '그 사이 작업 금액이나 정산팀 지급 금액이 바뀌었어요 — 새로 고친 내용을 확인해 주세요';

// 요청에 담긴 작업 금액(요청 시점). amount_krw = 작업 금액(원화) 또는 작업 금액(엔화) × 요청 환율(computeMoney)
export function requestCostOf(r: { costCurrency: Currency; amountKrw: number; rateKrwPerJpy: number }): TaskCost {
  return r.costCurrency === 'KRW'
    ? { amount: r.amountKrw, currency: 'KRW' }
    : { amount: Math.round(r.amountKrw / r.rateKrwPerJpy), currency: 'JPY' };
}

// 엔화로 보낸 건의 실제 환율 — 표에서 뺀 회색 환율 차이 대신 펼침에서만 보인다(§8-4)
export function paidFxRateText(s: { payoutCurrency: Currency; paidAmountKrw: number | null; paidAmountJpy: number | null; amountGross: number }): string | null {
  if (s.payoutCurrency !== 'JPY' || s.paidAmountKrw === null) return null;
  const jpy = s.paidAmountJpy ?? s.amountGross;
  if (!jpy) return null;
  return `1엔 = ${(s.paidAmountKrw / jpy).toFixed(2)}원`;
}

// 정산팀 취소가 남긴 처리자 이름은 저장값이 '정산 프로덕트'다(정산팀 API로도 나가는 값이라 바꾸지 않는다) — 화면에서만 정산팀으로
export const partnerNameLabel = (name: string | null): string | null => (name === '정산 프로덕트' ? '정산팀' : name);

// 캠페인 배지(settlementByTaskIds) 기준 — 지급이 끝난 요청이 붙은 작업인가(작업 금액 수정에 사유 필수, §6)
export function isPaidBadge(b: { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null } | null): boolean {
  return !!b && b.status === 'requested' && b.externalStatus === 'paid';
}
// 지급 전 살아 있는 요청의 금액이 지금 작업 금액과 다르면 그 요청 금액 — 작업 패널 안내 "정산 요청은 아직 {이전 금액}이에요"(§6)
export function pendingRequestCost(t: { cost: TaskCost | null; settlement: { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; costCurrency: Currency; amountKrw: number; rateKrwPerJpy: number } | null }): TaskCost | null {
  const b = t.settlement;
  if (!b || b.status !== 'requested' || b.externalStatus === 'paid' || b.externalStatus === 'cancelled') return null;
  const req = requestCostOf(b);
  return sameTaskCost(req, t.cost) ? null : req;
}
```

- [ ] **Step 6: 통과 확인**

Run: `node --import tsx --test src/lib/settlementMismatch.test.ts src/lib/settlementDisplay.test.ts`
Expected: PASS(기존 settlementDisplay 테스트도 그대로 통과 — 기존 함수는 안 건드렸다).
Run: `npx tsc --noEmit -p .` → 0, `npx eslint src/lib/campaignCost.ts src/lib/settlementDisplay.ts src/lib/settlementMismatch.test.ts` → 0.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/campaignCost.ts src/lib/settlementDisplay.ts src/lib/settlementMismatch.test.ts
git commit -m "feat(settlement-diff): 판정 함수 taskPaidMismatch — 작업 금액 vs 정산팀 지급, 달러·엔화 없음은 0.80~1.00 비율

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 맞추기 창의 제안 금액·집행액 차이(순수)

**Files:**
- Modify: `src/lib/settlementCalc.ts` (import 1줄 + `computeMoney` 바로 아래에 블록 추가)
- Test: `src/lib/settlementPaidSuggest.test.ts` (새, 순수)

**Interfaces:**
- Consumes: `JPY_TO_KRW`(`clientBudget.ts`, 예산 화면과 같은 1엔=10원)
- Produces:
```ts
export interface PaidSuggestion { cost: TaskCost; paid: number; paidCurrency: Currency; feeAmount: number }
export function suggestTaskCostFromPaid(i: { payoutCurrency: Currency; paidAmountKrw: number | null; paidAmountJpy: number | null; fee: PaymentFee | null; rateKrwPerJpy: number; taskCurrency: Currency }): PaidSuggestion | null;
export function budgetDeltaKrw(before: TaskCost | null, after: TaskCost): number;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/settlementPaidSuggest.test.ts`:

```ts
// 맞추기 창(스펙 2026-10-07 §5-1) — 정확히 비교 가능한 지급만 미리 채우고, 달러·엔화 없음은 비워 둔다(null).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTaskCostFromPaid, budgetDeltaKrw, computeMoney } from './settlementCalc.ts';

const base = { payoutCurrency: 'JPY' as const, paidAmountKrw: 51000, paidAmountJpy: 6000, fee: null, rateKrwPerJpy: 10, taskCurrency: 'JPY' as const };

test('엔화 지급·수수료 없음 → 지급 엔화 그대로(17dsy 6,000엔)', () => {
  assert.deepEqual(suggestTaskCostFromPaid(base), { cost: { amount: 6000, currency: 'JPY' }, paid: 6000, paidCurrency: 'JPY', feeAmount: 0 });
});

test('원화 지급·정액 수수료 → 지급 − 수수료', () => {
  const r = suggestTaskCostFromPaid({ ...base, payoutCurrency: 'KRW', paidAmountKrw: 41650, paidAmountJpy: null, fee: { mode: 'fixed', amount: 1650 }, taskCurrency: 'KRW' });
  assert.deepEqual(r, { cost: { amount: 40000, currency: 'KRW' }, paid: 41650, paidCurrency: 'KRW', feeAmount: 1650 });
});

test('엔화 지급·비율 수수료 5%, 작업은 원화 → 지급 × 0.95 반올림 × 요청 환율', () => {
  const r = suggestTaskCostFromPaid({ ...base, paidAmountJpy: 3158, fee: { mode: 'grossUp', percent: 5 }, taskCurrency: 'KRW' });
  assert.deepEqual(r, { cost: { amount: 30000, currency: 'KRW' }, paid: 3158, paidCurrency: 'JPY', feeAmount: 158 });
  // 제안값으로 다시 계산하면 지급과 같다(맞추면 판정이 풀린다)
  assert.equal(computeMoney(r!.cost, 'JPY', { mode: 'grossUp', percent: 5 }, 10).amountGross, 3158);
});

test('원화 지급, 작업은 엔화 → 순액 ÷ 요청 환율 반올림', () => {
  const r = suggestTaskCostFromPaid({ ...base, payoutCurrency: 'KRW', paidAmountKrw: 50000, paidAmountJpy: null, taskCurrency: 'JPY' });
  assert.deepEqual(r?.cost, { amount: 5000, currency: 'JPY' });
});

test('달러 지급·엔화 값 없음 → null(창이 비워 두고 직접 적게 한다)', () => {
  assert.equal(suggestTaskCostFromPaid({ ...base, paidAmountJpy: null }), null);
});

test('budgetDeltaKrw — 예산 화면과 같은 1엔 = 10원으로 집행액 차이', () => {
  assert.equal(budgetDeltaKrw({ amount: 4000, currency: 'JPY' }, { amount: 6000, currency: 'JPY' }), 20000);
  assert.equal(budgetDeltaKrw({ amount: 50000, currency: 'KRW' }, { amount: 140000, currency: 'KRW' }), 90000);
  assert.equal(budgetDeltaKrw({ amount: 40000, currency: 'KRW' }, { amount: 3000, currency: 'JPY' }), -10000);
  assert.equal(budgetDeltaKrw(null, { amount: 3000, currency: 'KRW' }), 3000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/settlementPaidSuggest.test.ts`
Expected: FAIL — `suggestTaskCostFromPaid` export 없음.

- [ ] **Step 3: 구현**

`src/lib/settlementCalc.ts` import 블록 끝(`import type { TaskProof } from './taskProofGuard.ts';` 다음 줄)에 추가:

```ts
import { JPY_TO_KRW } from './clientBudget.ts';   // 집행액 원화 환산 — 예산 화면과 같은 고정 환율
```

`computeMoney` 함수 바로 아래에 추가:

```ts
// ── 정산팀 지급 → 작업 금액 제안(스펙 2026-10-07 §5-1) — computeMoney의 거꾸로. 정확히 비교 가능한 지급만(원화 지급, 또는 엔화 지급 +
// 엔화 값 있음). 달러·엔화 값 없음은 null — 환산값을 넣으면 틀린 금액이 그럴듯해 보인다(창은 비워 두고 직접 적게 한다).
// 수수료: 정액은 빼고, 비율은 지급 × (1 − 비율) 반올림. 통화: 작업이 원화·지급이 엔화면 요청 환율을 곱하고, 반대면 나눈다(반올림).
export interface PaidSuggestion { cost: TaskCost; paid: number; paidCurrency: Currency; feeAmount: number }
export function suggestTaskCostFromPaid(i: { payoutCurrency: Currency; paidAmountKrw: number | null; paidAmountJpy: number | null; fee: PaymentFee | null; rateKrwPerJpy: number; taskCurrency: Currency }): PaidSuggestion | null {
  const paid = i.payoutCurrency === 'KRW' ? i.paidAmountKrw : i.paidAmountJpy;
  if (paid === null) return null;
  let net: number;
  if (i.fee?.mode === 'fixed') net = paid - i.fee.amount;
  else if (i.fee?.mode === 'grossUp') net = Math.round(paid * (1 - i.fee.percent / 100));
  else net = paid;
  net = Math.max(0, net);
  let amount: number;
  if (i.taskCurrency === i.payoutCurrency) amount = net;
  else if (i.taskCurrency === 'KRW') amount = Math.round(net * i.rateKrwPerJpy);
  else amount = Math.round(net / i.rateKrwPerJpy);
  return { cost: { amount, currency: i.taskCurrency }, paid, paidCurrency: i.payoutCurrency, feeAmount: paid - net };
}

// 작업 금액을 바꾸면 캠페인 집행액(원화 환산)이 얼마나 바뀌나 — 맞추기 창 하단 `{캠페인} 집행액이 {±n원} 돼요`
export function budgetDeltaKrw(before: TaskCost | null, after: TaskCost): number {
  const krw = (c: TaskCost) => (c.currency === 'KRW' ? c.amount : c.amount * JPY_TO_KRW);
  return krw(after) - (before ? krw(before) : 0);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/settlementPaidSuggest.test.ts src/lib/settlementCalc.test.ts src/lib/settlementMismatch.test.ts`
Expected: PASS. `npx tsc --noEmit -p .` 0, `npx eslint src/lib/settlementCalc.ts src/lib/settlementPaidSuggest.test.ts` 0.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/settlementCalc.ts src/lib/settlementPaidSuggest.test.ts
git commit -m "feat(settlement-diff): 맞추기 창 제안 금액(지급 − 수수료, 작업 통화로)·집행액 차이

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 저장소 — 요청 읽기 모델·처리(맞춤/그대로 둠/취소)·배지 확장·표시 전환

**Files:**
- Modify: `src/lib/campaignTaskStore.ts` (import·`SettlementBadge`/`settlementByTaskIds` 교체·`task_change` 함수 추가)
- Modify: `src/lib/settlementStore.ts` (import·`PaymentRequestRow`·`RRow`·`R_SELECT`·`toRequest`·`applyExternalStatus`·`reviseRequest`·새 함수)
- Modify: `src/lib/settlementDisplay.ts` (`StatusSource`·`keyOf`·`EXTERNAL_STATUS_LABEL`·`displayStatus`·`STATUS_GROUP_OPTIONS`)
- Test: `src/lib/settlementDisplay.test.ts` (전체 교체), `src/lib/settlementStore.test.ts` (import·usd1 테스트 2줄·옛 차액 확인 테스트 블록 교체)

**Interfaces:**
- Consumes: Task 2의 `taskPaidMismatch`, `MismatchSource`, `DiffAckKind`, `sameTaskCost`
- Produces:
```ts
// campaignTaskStore.ts
export type TaskChangeSource = 'campaign' | 'replace' | 'settlement';
export interface TaskChangeMeta { source: TaskChangeSource; reason: string; requestId: string | null; by: { id: string | null; name: string } }
export interface TaskChangeRow { id: string; taskId: string; before: TaskCost | null; after: TaskCost | null; source: TaskChangeSource; reason: string; requestId: string | null; byName: string; createdAt: string }
export async function insertTaskChange(tx: postgres.Sql, c: { taskId: string; before: TaskCost | null; after: TaskCost | null } & TaskChangeMeta): Promise<void>;
export async function listTaskChanges(sql: postgres.Sql, taskId: string): Promise<TaskChangeRow[]>;   // 최신순
export interface SettlementBadge { /* 기존 + */ taskId: string; taskCost: TaskCost | null; fee: PaymentFee | null; rateKrwPerJpy: number; diffAckKind: DiffAckKind | null; diffAckTaskCost: TaskCost | null; costCurrency: 'KRW' | 'JPY'; amountKrw: number }
// settlementStore.ts — PaymentRequestRow에 추가
taskCost: TaskCost | null; diffAckKind: DiffAckKind | null; diffAckReason: string | null; diffAckTaskCost: TaskCost | null; diffAckBeforeCost: TaskCost | null;
export interface ReconcileExpect { taskCost: TaskCost; paidAmountKrw: number; paidAmountJpy: number | null }
export type ReconcileFailure = 'not-found' | 'stale';
export async function matchTaskCostToPaid(sql: postgres.Sql, id: string, input: { expect: ReconcileExpect; newCost: TaskCost; reason: string }, by: { id: string; name: string }): Promise<PaymentRequestRow | ReconcileFailure>;
export async function keepTaskCost(sql: postgres.Sql, id: string, input: { expect: ReconcileExpect; reason: string }, by: { name: string }): Promise<PaymentRequestRow | ReconcileFailure>;
export async function undoKeepTaskCost(sql: postgres.Sql, id: string): Promise<PaymentRequestRow | 'not-found' | 'not-kept'>;
// settlementDisplay.ts
export interface StatusSource extends MismatchSource { ... }   // displayStatus/keyOf가 판정을 taskPaidMismatch로 한다
// displayStatus: 'paid_diff' 라벨 '지급 금액 다름', 'paid' + 처리 기록이면 '지급 완료 · 맞춤' / '지급 완료 · 그대로 둠'(요청 내역)
```
- 이 태스크에서는 옛 `ackDiff`/`unackDiff`/`hasPaidDiff`/`needsDiffAck`/`payoutDiff`/`fxDiffKrw`를 **지우지 않는다**(화면이 아직 쓴다 — Task 8에서 정리). 테스트만 새 판정으로 옮긴다.

- [ ] **Step 1: 표시 테스트 교체(실패 확인용)**

`src/lib/settlementDisplay.test.ts` 전체를 아래로 교체:

```ts
// src/lib/settlementDisplay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, inGroup, paidText, usdText, EXTERNAL_STATUS_LABEL, STATUS_GROUP_OPTIONS, type StatusSource } from './settlementDisplay.ts';

// 원화 지급·수수료 없음 기준 — 작업 31,650원 = 송금 31,650원
const base: StatusSource = { status: 'requested', externalStatus: null, externalNote: null, externalUpdatedAt: null, createdAt: '2026-08-28T03:00:00Z', cancelledAt: null,
  paidAmountKrw: null, grossKrw: 31650, diffAckAt: null, payoutCurrency: 'KRW', amountGross: 31650, paidAmountJpy: null,
  taskId: 't1', taskCost: { amount: 31650, currency: 'KRW' }, fee: null, rateKrwPerJpy: 10, diffAckKind: null, diffAckTaskCost: null };
const ext = (externalStatus: StatusSource['externalStatus'], note: string | null = null): StatusSource => ({ ...base, externalStatus, externalNote: note, externalUpdatedAt: '2026-08-29T03:00:00Z' });

test('displayStatus — 우리·정산팀 조합 → 라벨 하나(요청 내역)', () => {
  assert.deepEqual([displayStatus(base, 'list').key, displayStatus(base, 'list').label, displayStatus(base, 'list').tone], ['requested', '요청됨 8/28', 'blue']);
  assert.equal(displayStatus(ext('received'), 'list').label, '정산 접수 8/29');
  assert.equal(displayStatus(ext('scheduled'), 'list').label, '지급 예정');
  const hold = displayStatus(ext('on_hold', '계좌번호 다시 확인해 주세요 — 지점 코드가 없어요'), 'list');
  assert.equal(hold.key, 'on_hold'); assert.equal(hold.tone, 'warn'); assert.equal(hold.label, '보류 · 계좌번호 다시 확인해 주세요 — 지점…');
  assert.equal(displayStatus(ext('on_hold'), 'list').label, '보류');
  const paid = displayStatus(ext('paid'), 'list');
  assert.equal(paid.label, '지급 완료 8/29'); assert.equal(paid.tone, 'done');
  const cancelled = displayStatus({ ...ext('cancelled'), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list');
  assert.equal(cancelled.label, '취소됨 8/30'); assert.equal(cancelled.tone, 'gray');
  assert.equal(displayStatus({ ...ext('scheduled'), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list').key, 'cancelled');
});
test('displayStatus — 캠페인 표 라벨', () => {
  assert.equal(displayStatus(base, 'campaign').label, '정산 요청됨 8/28');
  assert.equal(displayStatus(ext('received'), 'campaign').label, '정산 접수 8/29');
  assert.equal(displayStatus(ext('scheduled'), 'campaign').label, '지급 예정');
  assert.equal(displayStatus(ext('on_hold', '계좌'), 'campaign').label, '정산 보류 — 확인 필요');
  assert.equal(displayStatus(ext('paid'), 'campaign').label, '지급 완료 8/29');
  assert.equal(displayStatus({ ...base, status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'campaign').label, '취소됨');
});
test('상태 라벨 — 정산팀 이름으로(§8-2)', () => {
  assert.equal(EXTERNAL_STATUS_LABEL.cancelled, '정산팀이 취소');
  assert.equal(STATUS_GROUP_OPTIONS.find((o) => o.value === 'paid_diff')?.label, '지급 금액 다름');
  for (const s of [base, ext('received'), ext('scheduled'), ext('on_hold')]) assert.doesNotMatch(displayStatus(s, 'list').title, /정산 쪽|그쪽|정산 프로덕트/);
});
test('inGroup — 진행 중은 요청됨·접수·지급 예정', () => {
  assert.ok(inGroup('requested', 'active') && inGroup('received', 'active') && inGroup('scheduled', 'active'));
  assert.ok(!inGroup('on_hold', 'active') && !inGroup('paid', 'active') && !inGroup('cancelled', 'active'));
  assert.ok(inGroup('on_hold', 'on_hold') && inGroup('paid', 'paid') && inGroup('cancelled', 'cancelled'));
  assert.ok(inGroup('paid', ''));
});
test('paidText — 차이 해석까지', () => {
  assert.equal(paidText(30000, 29700), '실지급 29,700원 (송금액 30,000원, −300)');
  assert.equal(paidText(30000, 30300), '실지급 30,300원 (송금액 30,000원, +300)');
  assert.equal(paidText(30000, 30000), '실지급 30,000원');
});

const paidWith = (paidAmountKrw: number): StatusSource => ({ ...ext('paid'), paidAmountKrw });

test('지급 금액 다름 — 작업 금액과 정산팀 지급이 다르면 paid_diff(요청 내역·캠페인 같은 라벨)', () => {
  assert.equal(displayStatus(paidWith(30000), 'list').key, 'paid_diff');
  assert.equal(displayStatus(paidWith(30000), 'list').label, '지급 금액 다름');
  assert.equal(displayStatus(paidWith(30000), 'list').tone, 'warn');
  assert.equal(displayStatus(paidWith(30000), 'campaign').label, '지급 금액 다름');
});
test('지급 금액 다름 — 작업 금액을 지급에 맞추면 그냥 지급 완료(요청 금액은 그대로여도)', () => {
  assert.equal(displayStatus({ ...paidWith(30000), taskCost: { amount: 30000, currency: 'KRW' } }, 'list').key, 'paid');
});
test('처리 기록 — 맞춤/그대로 둠은 요청 내역에 "지급 완료 · …", 캠페인 배지는 날짜', () => {
  const kept: StatusSource = { ...paidWith(30000), diffAckAt: '2026-10-07T04:00:00Z', diffAckKind: 'kept', diffAckTaskCost: { amount: 31650, currency: 'KRW' } };
  assert.equal(displayStatus(kept, 'list').key, 'paid');
  assert.equal(displayStatus(kept, 'list').label, '지급 완료 · 그대로 둠');
  assert.equal(displayStatus(kept, 'campaign').label, '지급 완료 8/29');
  const matched: StatusSource = { ...paidWith(30000), taskCost: { amount: 30000, currency: 'KRW' }, diffAckAt: '2026-10-07T04:00:00Z', diffAckKind: 'matched', diffAckTaskCost: { amount: 30000, currency: 'KRW' } };
  assert.equal(displayStatus(matched, 'list').label, '지급 완료 · 맞춤');
  // 옛 확인(종류 없음)은 판정을 숨기지 않는다 — 작업 금액이 지급과 다르면 다시 처리할 일이다
  assert.equal(displayStatus({ ...paidWith(30000), diffAckAt: '2026-09-01T05:00:00Z' }, 'list').key, 'paid_diff');
});
test('지급 금액 다름 — 취소된 요청에는 뜨지 않는다 · 지급 완료 필터에 포함', () => {
  assert.equal(displayStatus({ ...paidWith(30000), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list').key, 'cancelled');
  assert.ok(inGroup('paid_diff', 'paid'));
  assert.ok(inGroup('paid_diff', 'paid_diff'));
  assert.ok(!inGroup('paid', 'paid_diff'));
  assert.ok(inGroup('paid_diff', ''));
});
test('displayStatus — 고친 요청은 "요청됨 · 2판 M/D"(revised_at), 안 고쳤으면 그대로', () => {
  assert.equal(displayStatus({ ...base, externalStatus: null }, 'list').label, '요청됨 8/28');
  const revised = displayStatus({ ...base, externalStatus: null, revision: 1, revisedAt: '2026-09-07T03:50:14.000Z' }, 'list');
  assert.equal(revised.label, '요청됨 · 2판 9/7');
  assert.match(revised.title, /고쳐서 다시 보낸 요청/);
  assert.equal(displayStatus({ ...base, externalStatus: null, revision: 1, revisedAt: '2026-09-07T03:50:14.000Z' }, 'campaign').label, '정산 요청됨 8/28');
});
test('usdText — PayPal 달러 실지급액 표기(소수 둘째 자리, 천 단위 쉼표)', () => {
  assert.equal(usdText(18.62), '$18.62');
  assert.equal(usdText(1234.5), '$1,234.50');
  assert.equal(usdText(20), '$20.00');
});
test('엔화로 보낸 건 — 엔화 값이 요청대로면 원화가 달라도(환율) 지급 완료, 엔화가 다르면 지급 금액 다름', () => {
  const jpy: StatusSource = { ...ext('paid'), payoutCurrency: 'JPY', amountGross: 5000, grossKrw: 50000, paidAmountKrw: 42993, paidAmountJpy: 5000, taskCost: { amount: 5000, currency: 'JPY' } };
  assert.equal(displayStatus(jpy, 'list').key, 'paid');
  assert.equal(displayStatus({ ...jpy, paidAmountJpy: 4500 }, 'list').key, 'paid_diff');
  // 달러 지급(엔화 값 없음) — 비율 42,993 ÷ 50,000 = 0.86, 환율로 설명된다
  assert.equal(displayStatus({ ...jpy, paidAmountJpy: null }, 'list').key, 'paid');
});
```

Run: `node --import tsx --test src/lib/settlementDisplay.test.ts`
Expected: FAIL — `StatusSource`에 `taskId` 등이 없다는 타입 오류는 tsx가 무시하므로 실행 실패는 라벨 단언(`'지급 금액 다름'`, `'정산팀이 취소'`)에서 난다.

- [ ] **Step 2: `settlementDisplay.ts` 표시 전환**

(a) `StatusSource` 인터페이스 전체를 교체:

```ts
export interface StatusSource extends MismatchSource {
  externalNote: string | null; externalUpdatedAt: string | null;
  createdAt: string; cancelledAt: string | null;
  // 송금액·옛 확인 시각 — 표시용(판정은 MismatchSource의 지금 작업 금액으로 taskPaidMismatch가 한다)
  paidAmountKrw: number | null; grossKrw: number; diffAckAt: string | null;
  payoutCurrency: Currency; amountGross: number; paidAmountJpy: number | null;
  // 제자리 수정(2026-09-07): 고친 횟수·마지막 고친 시각. 캠페인 표 배지 소스엔 없을 수 있어 선택
  revision?: number; revisedAt?: string | null;
}
```
`MismatchSource` 선언이 파일 아래(Task 2 블록)에 있어도 인터페이스 확장은 호이스팅되므로 위치는 그대로 둔다.

(b) `keyOf`의 `case 'paid': return needsDiffAck(s) ? 'paid_diff' : 'paid';` 를 교체:

```ts
    case 'paid': return taskPaidMismatch(s) ? 'paid_diff' : 'paid';   // 작업 금액 vs 정산팀 지급(스펙 2026-10-07 §4)
```

(c) `EXTERNAL_STATUS_LABEL` 교체:

```ts
export const EXTERNAL_STATUS_LABEL: Record<ExternalStatus, string> = {
  received: '정산 접수', scheduled: '지급 예정', paid: '지급 완료', on_hold: '보류', cancelled: '정산팀이 취소',
};
```

(d) `displayStatus` 함수 전체 교체:

```ts
export function displayStatus(s: StatusSource, where: 'list' | 'campaign'): StatusDisplay {
  const key = keyOf(s);
  const extDay = kstMonthDay(s.externalUpdatedAt);
  const campaign = where === 'campaign';
  switch (key) {
    case 'requested': {
      // 고친 요청(revision>0)은 요청 내역에서 "요청됨 · 2판 M/D"로 — 만든 날짜만 보이면 고친 뒤에도 아무 일 없어 보인다(스펙 2026-09-07 §6).
      if (!campaign && (s.revision ?? 0) > 0 && s.revisedAt) {
        return { key, tone: 'blue', label: `요청됨 · ${(s.revision ?? 0) + 1}판 ${kstMonthDay(s.revisedAt)}`, title: '고쳐서 다시 보낸 요청이에요 — 정산팀이 다시 검토 중' };
      }
      return { key, tone: 'blue', label: `${campaign ? '정산 ' : ''}요청됨 ${kstMonthDay(s.createdAt)}`, title: campaign ? '정산 요청됨 — 클릭하면 요청 내역으로' : '정산팀이 아직 확인 전' };
    }
    case 'received': return { key, tone: 'blue', label: `정산 접수 ${extDay}`, title: '정산팀이 요청을 접수했어요' };
    case 'scheduled': return { key, tone: 'blue', label: '지급 예정', title: '정산팀이 지급을 예정해 두었어요' };
    case 'on_hold': {
      const p = preview(s.externalNote);
      return { key, tone: 'warn', label: campaign ? '정산 보류 — 확인 필요' : (p ? `보류 · ${p}` : '보류'), title: s.externalNote ?? '정산팀이 보류했어요' };
    }
    case 'paid': {
      // 처리한 건은 요청 내역에서 어떻게 처리했는지 말한다(§9 '표 상태(처리 후)'). 캠페인 배지는 짧게 날짜.
      if (!campaign && s.diffAckKind === 'matched') return { key, tone: 'done', label: '지급 완료 · 맞춤', title: '지급이 끝났어요' };
      if (!campaign && s.diffAckKind === 'kept') return { key, tone: 'done', label: '지급 완료 · 그대로 둠', title: '지급이 끝났어요' };
      return { key, tone: 'done', label: `지급 완료 ${extDay}`, title: '지급이 끝났어요' };
    }
    // 요청 내역 표에서는 이 배지 대신 [그대로 두기][지급 금액에 맞추기] 버튼이 보인다(§8-2) — 라벨은 캠페인 배지·필터와 같은 말
    case 'paid_diff': return { key, tone: 'warn', label: '지급 금액 다름', title: '지급 금액 다름' };
    case 'cancelled': return { key, tone: 'gray', label: campaign ? '취소됨' : `취소됨 ${kstMonthDay(s.cancelledAt)}`, title: '요청이 취소됐어요' };
  }
}
```

(e) `STATUS_GROUP_OPTIONS`의 `{ value: 'paid_diff', label: '차액 확인 필요' }` 를 `{ value: 'paid_diff', label: '지급 금액 다름' }` 로.

Run: `node --import tsx --test src/lib/settlementDisplay.test.ts src/lib/settlementMismatch.test.ts`
Expected: PASS.

- [ ] **Step 3: `campaignTaskStore.ts` — 이력 함수·배지 확장**

(a) import 추가(기존 `import { judgeStoredAuthor, … } from './postAuthor.ts';` 줄 다음):

```ts
import type { PaymentFee } from './influencerPayment.ts';
import type { DiffAckKind } from './settlementDisplay.ts';   // 타입만 — settlementDisplay도 이 파일에서 타입만 가져온다
```

(b) `SettlementBadge` 인터페이스와 `settlementByTaskIds` 함수 전체를 교체:

```ts
export interface SettlementBadge {
  taskId: string;
  status: SettlementBadgeStatus; createdAt: string; cancelledAt: string | null;
  externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
  paidAmountKrw: number | null; grossKrw: number; diffAckAt: string | null;
  payoutCurrency: 'KRW' | 'JPY'; amountGross: number; paidAmountJpy: number | null;
  // 065 판정 입력(스펙 2026-10-07 §4) — 지금 작업 금액·요청 스냅샷(수수료·환율)·처리 기록. 화면이 taskPaidMismatch로 배지를 정한다
  taskCost: TaskCost | null; fee: PaymentFee | null; rateKrwPerJpy: number;
  diffAckKind: DiffAckKind | null; diffAckTaskCost: TaskCost | null;
  // 요청에 담긴 작업 금액(요청 시점) — 지급 전 요청이 있는 작업의 금액을 고친 뒤 안내(§6, pendingRequestCost)
  costCurrency: 'KRW' | 'JPY'; amountKrw: number;
}
export async function settlementByTaskIds(sql: postgres.Sql, taskIds: string[]): Promise<Map<string, SettlementBadge>> {
  const ids = taskIds.filter(isUuidLike);
  if (!ids.length) return new Map();
  const rows = await sql<Array<{ task_id: string; status: SettlementBadgeStatus; created_at: Date; cancelled_at: Date | null;
    external_status: ExternalStatus | null; external_note: string | null; external_updated_at: Date | null;
    paid_amount_krw: number | null; gross_krw: string | number; diff_ack_at: Date | null;
    payout_currency: 'KRW' | 'JPY'; amount_gross: string | number; paid_amount_jpy: string | number | null;
    fee: PaymentFee | null; rate_krw_per_jpy: string | number; diff_ack_kind: DiffAckKind | null; diff_ack_task_cost: unknown;
    cost_currency: 'KRW' | 'JPY'; amount_krw: string | number; task_cost: unknown }>>`
    select distinct on (pr.task_id) pr.task_id, pr.status, pr.created_at, pr.cancelled_at, pr.external_status, pr.external_note, pr.external_updated_at,
           pr.paid_amount_krw, pr.gross_krw, pr.diff_ack_at, pr.payout_currency, pr.amount_gross, pr.paid_amount_jpy,
           pr.fee, pr.rate_krw_per_jpy, pr.diff_ack_kind, pr.diff_ack_task_cost, pr.cost_currency, pr.amount_krw,
           (select t.cost from campaign_task t where t.id = pr.task_id) as task_cost
      from payment_request pr where pr.task_id in ${sql(ids)}
     order by pr.task_id, (pr.status = 'requested') desc, pr.created_at desc`;
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return new Map(rows.map((r) => [r.task_id, {
    taskId: r.task_id,
    status: r.status, createdAt: new Date(r.created_at).toISOString(), cancelledAt: iso(r.cancelled_at),
    externalStatus: r.external_status, externalNote: r.external_note, externalUpdatedAt: iso(r.external_updated_at),
    paidAmountKrw: r.paid_amount_krw, grossKrw: Number(r.gross_krw), diffAckAt: iso(r.diff_ack_at),
    payoutCurrency: r.payout_currency, amountGross: Number(r.amount_gross), paidAmountJpy: r.paid_amount_jpy === null ? null : Number(r.paid_amount_jpy),
    taskCost: costOf(r.task_cost), fee: r.fee, rateKrwPerJpy: Number(r.rate_krw_per_jpy),
    diffAckKind: r.diff_ack_kind, diffAckTaskCost: costOf(r.diff_ack_task_cost),
    costCurrency: r.cost_currency, amountKrw: Number(r.amount_krw),
  }]));
}
```

(c) 파일 끝에 추가:

```ts
// ─────────────────────────── 작업 칸 변경 이력(065, 스펙 2026-10-07 §6) ───────────────────────────
// 작업 금액을 바꾸는 모든 쓰기(캠페인 화면·인플 교체·정산 화면 맞추기)가 같은 트랜잭션에서 1행을 남긴다. 지우거나 고치는 함수는 없다.
export type TaskChangeSource = 'campaign' | 'replace' | 'settlement';
export interface TaskChangeMeta { source: TaskChangeSource; reason: string; requestId: string | null; by: { id: string | null; name: string } }
export interface TaskChangeRow {
  id: string; taskId: string; before: TaskCost | null; after: TaskCost | null;
  source: TaskChangeSource; reason: string; requestId: string | null; byName: string; createdAt: string;
}
export async function insertTaskChange(tx: postgres.Sql, c: { taskId: string; before: TaskCost | null; after: TaskCost | null } & TaskChangeMeta): Promise<void> {
  await tx`
    insert into task_change (task_id, field, before, after, source, reason, request_id, by_member, by_name)
    values (${c.taskId}, 'cost', ${c.before ? tx.json(c.before as never) : null}, ${c.after ? tx.json(c.after as never) : null},
            ${c.source}, ${c.reason}, ${c.requestId}, ${c.by.id}, ${c.by.name})`;
}
export async function listTaskChanges(sql: postgres.Sql, taskId: string): Promise<TaskChangeRow[]> {
  if (!isUuidLike(taskId)) return [];
  const rows = await sql<Array<{ id: string; task_id: string; before: unknown; after: unknown; source: TaskChangeSource; reason: string; request_id: string | null; by_name: string; created_at: Date }>>`
    select id, task_id, before, after, source, reason, request_id, by_name, created_at
      from task_change where task_id = ${taskId} and field = 'cost'
     order by created_at desc, id desc`;
  return rows.map((r) => ({
    id: r.id, taskId: r.task_id, before: costOf(r.before), after: costOf(r.after), source: r.source, reason: r.reason,
    requestId: r.request_id, byName: r.by_name, createdAt: new Date(r.created_at).toISOString(),
  }));
}
```

- [ ] **Step 4: `settlementStore.ts` — 읽기 모델**

(a) import 교체:
- `import { parseTaskCost, type TaskCost } from './campaignCost.ts';` → `import { parseTaskCost, sameTaskCost, type TaskCost } from './campaignCost.ts';`
- `import { hasPaidDiff, needsPartnerConfirm } from './settlementDisplay.ts';` → `import { hasPaidDiff, needsPartnerConfirm, taskPaidMismatch, type DiffAckKind } from './settlementDisplay.ts';`
- `import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';` 다음 줄에 추가: `import { insertTaskChange } from './campaignTaskStore.ts';   // 이 파일은 이미 campaignTaskStore 값을 재수출한다(순환 없음)`

(b) `PaymentRequestRow`의 마지막 칸 `paymentMethodCorrection: PaymentMethodCorrectionMark | null;` 다음에 추가:

```ts
  // 065(스펙 2026-10-07) — 판정 입력은 '지금 작업 금액'. 스냅샷이 아니라 매번 작업 행에서 읽는다(작업이 지워졌거나 비면 null).
  // 정산팀 내보내기(toExternalItem)는 칸을 하나씩 골라 만들므로 이 칸들은 밖으로 나가지 않는다.
  taskCost: TaskCost | null;
  diffAckKind: DiffAckKind | null; diffAckReason: string | null; diffAckTaskCost: TaskCost | null;
  diffAckBeforeCost: TaskCost | null;   // '맞춤' 처리 때 바꾸기 전 작업 금액(task_change.before) — 처리 기록 문장용
```

(c) `RRow`의 `payment_method_correction: unknown;` 다음에 추가:

```ts
  diff_ack_kind: DiffAckKind | null; diff_ack_reason: string | null; diff_ack_task_cost: unknown;
  task_cost: unknown; diff_ack_before_cost: unknown;
```

(d) `R_SELECT`의 마지막 두 줄

```ts
         payment_method_correction
    from payment_request`;
```
을 교체(조인이 아니라 상관 서브쿼리 — 호출부가 `where id = …`·`for update`를 그대로 붙이므로 칸 이름이 모호해지거나 작업 행이 잠기면 안 된다):

```ts
         payment_method_correction, diff_ack_kind, diff_ack_reason, diff_ack_task_cost,
         (select t.cost from campaign_task t where t.id = payment_request.task_id) as task_cost,
         (select c.before from task_change c where c.request_id = payment_request.id and c.source = 'settlement'
           order by c.created_at desc limit 1) as diff_ack_before_cost
    from payment_request`;
```

(e) `const toRequest = (r: RRow): PaymentRequestRow => ({` 바로 위에 추가:

```ts
const costOrNull = (v: unknown): TaskCost | null => { const p = parseTaskCost(v ?? null); return p.ok ? p.value : null; };
```
그리고 `toRequest`의 `paymentMethodCorrection: correctionMarkOf(r.payment_method_correction),` 다음에 추가:

```ts
  taskCost: costOrNull(r.task_cost),
  diffAckKind: r.diff_ack_kind, diffAckReason: r.diff_ack_reason, diffAckTaskCost: costOrNull(r.diff_ack_task_cost),
  diffAckBeforeCost: costOrNull(r.diff_ack_before_cost),
```

(f) `applyExternalStatus`의 UPDATE에서

```ts
             diff_ack_at = case when ${paidAmountChanged} then null else diff_ack_at end,
             diff_ack_by_name = case when ${paidAmountChanged} then null else diff_ack_by_name end
```
을 교체(정산팀이 금액을 정정하면 처리 기록은 다른 금액에 대한 것 — 통째로 비워 다시 뜨게 한다, §4-4):

```ts
             diff_ack_at = case when ${paidAmountChanged} then null else diff_ack_at end,
             diff_ack_by_name = case when ${paidAmountChanged} then null else diff_ack_by_name end,
             diff_ack_kind = case when ${paidAmountChanged} then null else diff_ack_kind end,
             diff_ack_reason = case when ${paidAmountChanged} then null else diff_ack_reason end,
             diff_ack_task_cost = case when ${paidAmountChanged} then null else diff_ack_task_cost end
```

(g) `reviseRequest`의 UPDATE에서 `external_operator_id = null, external_operator_name = null, diff_ack_at = null, diff_ack_by_name = null,` 를
`external_operator_id = null, external_operator_name = null, diff_ack_at = null, diff_ack_by_name = null, diff_ack_kind = null, diff_ack_reason = null, diff_ack_task_cost = null,` 로.

- [ ] **Step 5: `settlementStore.ts` — 처리 함수**

`unackDiff` 함수 바로 아래에 추가:

```ts
// ── 정산팀 지급 금액 ≠ 작업 금액 처리(스펙 2026-10-07 §5) ──
// 우리 내부 기록이다 — payment_request.updated_at을 건드리지 않는다(정산팀 폴링이 updated_at 커서로 집어가므로, 바꾸면 의미 없는 변경이 흘러간다).
// 화면을 연 때의 값(expect: 작업 금액·지급 원화·지급 엔화)과 지금 값·판정이 그대로일 때만 쓴다 — 아니면 stale(§9 경합 오류).
export interface ReconcileExpect { taskCost: TaskCost; paidAmountKrw: number; paidAmountJpy: number | null }
export type ReconcileFailure = 'not-found' | 'stale';

// 요청 → 작업 순으로 잠근다. R_SELECT의 task_cost는 잠그기 전에 읽은 값이라, 잠근 작업 행의 금액으로 다시 맞춘 뒤 판정한다.
async function lockForReconcile(tx: postgres.Sql, id: string, expect: ReconcileExpect): Promise<PaymentRequestRow | ReconcileFailure> {
  const cur = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id} for update`;
  if (!cur.length) return 'not-found';
  const row = toRequest(cur[0]);
  if (!row.taskId) return 'not-found';
  const t = await tx<Array<{ cost: unknown }>>`select cost from campaign_task where id = ${row.taskId} for update`;
  if (!t.length) return 'not-found';
  const locked: PaymentRequestRow = { ...row, taskCost: costOrNull(t[0].cost) };
  if (!sameTaskCost(locked.taskCost, expect.taskCost)) return 'stale';
  if (locked.paidAmountKrw !== expect.paidAmountKrw || locked.paidAmountJpy !== expect.paidAmountJpy) return 'stale';
  if (!taskPaidMismatch(locked)) return 'stale';   // 판정은 settlementDisplay 한 곳 — 표 버튼과 같은 함수
  return locked;
}

// 지급 금액에 맞추기 — 작업 금액 변경 + 이력 1행(출처 settlement, 요청 id) + 처리 기록(matched)을 한 트랜잭션으로
export async function matchTaskCostToPaid(
  sql: postgres.Sql, id: string, input: { expect: ReconcileExpect; newCost: TaskCost; reason: string }, by: { id: string; name: string },
): Promise<PaymentRequestRow | ReconcileFailure> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const g = await lockForReconcile(tx, id, input.expect);
    if (typeof g === 'string') return g;
    const taskId = g.taskId as string;
    await tx`update campaign_task set cost = ${tx.json(input.newCost as never)}, updated_at = now() where id = ${taskId}`;
    await insertTaskChange(tx, { taskId, before: input.expect.taskCost, after: input.newCost, source: 'settlement', reason: input.reason, requestId: id, by });
    await tx`
      update payment_request
         set diff_ack_at = now(), diff_ack_by_name = ${by.name}, diff_ack_kind = 'matched',
             diff_ack_reason = ${input.reason}, diff_ack_task_cost = ${tx.json(input.newCost as never)}
       where id = ${id}`;
    const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id}`;
    return toRequest(saved);
  });
}

// 그대로 두기 — 작업은 안 바뀐다. 처리 때의 작업 금액을 남겨, 누가 나중에 작업 금액을 바꾸면 다시 뜨게 한다(§4-4)
export async function keepTaskCost(
  sql: postgres.Sql, id: string, input: { expect: ReconcileExpect; reason: string }, by: { name: string },
): Promise<PaymentRequestRow | ReconcileFailure> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const g = await lockForReconcile(tx, id, input.expect);
    if (typeof g === 'string') return g;
    await tx`
      update payment_request
         set diff_ack_at = now(), diff_ack_by_name = ${by.name}, diff_ack_kind = 'kept',
             diff_ack_reason = ${input.reason}, diff_ack_task_cost = ${tx.json(input.expect.taskCost as never)}
       where id = ${id}`;
    const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id}`;
    return toRequest(saved);
  });
}

// 처리 취소 — 그대로 두기만(§5-3). 맞춤은 이미 작업 금액이 바뀌었으므로 되돌리려면 캠페인 화면에서 금액을 고친다(그것도 이력에 남는다).
export async function undoKeepTaskCost(sql: postgres.Sql, id: string): Promise<PaymentRequestRow | 'not-found' | 'not-kept'> {
  if (!isUuidLike(id)) return 'not-found';
  const res = await sql`
    update payment_request
       set diff_ack_at = null, diff_ack_by_name = null, diff_ack_kind = null, diff_ack_reason = null, diff_ack_task_cost = null
     where id = ${id} and diff_ack_kind = 'kept'`;
  const [saved] = await sql<RRow[]>`${R_SELECT(sql)} where id = ${id}`;
  if (!saved) return 'not-found';
  if (res.count === 0) return 'not-kept';
  return toRequest(saved);
}
```

- [ ] **Step 6: DB 테스트 — import·옛 판정 정리**

`src/lib/settlementStore.test.ts`:
- 6번째 줄 `import { createTasks, updateTask, getTask, deleteTask, markSettledElsewhere, clearSettledElsewhere } from './campaignTaskStore.ts';` → `import { createTasks, updateTask, getTask, deleteTask, markSettledElsewhere, clearSettledElsewhere, listTaskChanges } from './campaignTaskStore.ts';`
- `  listForExport, getForExport, applyExternalStatus, ackDiff, unackDiff,` → `  listForExport, getForExport, applyExternalStatus, matchTaskCostToPaid, keepTaskCost, undoKeepTaskCost,`
- `import { hasPaidDiff } from './settlementDisplay.ts';` → `import { taskPaidMismatch, displayStatus } from './settlementDisplay.ts';`
- `applyExternalStatus — paid_amount_usd를 저장하고…` 테스트 안의 두 단언을 교체:
  - `  assert.equal(hasPaidDiff(p), false);  // 달러로 지급(PayPal)은 …` → `  assert.equal(taskPaidMismatch(p), null);  // 달러 지급은 원화 비율로 본다 — 25,934 ÷ 31,580 = 0.82, 환율로 설명된다(스펙 2026-10-07 §4)`
  - `  assert.equal(f.paidAmountUsd, 22.7); assert.equal(hasPaidDiff(f), false);` → `  assert.equal(f.paidAmountUsd, 22.7); assert.equal(taskPaidMismatch(f), null);   // 31,580 ÷ 31,580 = 1.00(경계 포함)`
- `test('차액 확인 — 확인·취소가 되고 updated_at을 건드리지 않는다'`부터 `test('unackDiff — 없는 id는 not-found', …);`의 닫는 `});`까지(7개 테스트) 통째로 지우고, 그 자리에 아래를 넣는다:

```ts
// ── 정산팀 지급 금액 ≠ 작업 금액 처리(065, 스펙 2026-10-07 §5·§10) ──
// requestFor 픽스처: 작업 30,000원 · PayPal 엔화 · 비율 수수료 5% → 송금 3,158엔(원화 31,580)
const paidJpy = (id: string, jpy: number, krw: number, at: string, note: string | null = null) =>
  applyExternalStatus(sql, id, upd('paid', at, { paidAmountKrw: krw, paidAmountJpy: jpy, paidAt: at, ...(note ? { note } : {}) }));

test('065 맞추기 — 작업 금액·이력·처리 기록이 한 번에, updated_at 그대로, 판정이 풀린다', async () => {
  const { row, member } = await requestFor('rcm1', 'rcm1');
  await paidJpy(row.id, 4000, 34000, '2026-10-07T03:00:00Z', '인용 6000엔');
  const [before] = await listRequests(sql, { taskId: row.taskId! });
  assert.deepEqual(before.taskCost, { amount: 30000, currency: 'KRW' });
  const mm = taskPaidMismatch(before);
  assert.ok(mm && mm.kind === 'exact' && mm.diff === 842 && mm.currency === 'JPY');
  assert.equal(displayStatus(before, 'list').key, 'paid_diff');

  // 38,000원 → 3,800엔 → 송금 4,000엔 = 지급과 같다
  const r = await matchTaskCostToPaid(sql, row.id, { expect: { taskCost: { amount: 30000, currency: 'KRW' }, paidAmountKrw: 34000, paidAmountJpy: 4000 }, newCost: { amount: 38000, currency: 'KRW' }, reason: '인용 6000엔' }, member);
  assert.ok(typeof r !== 'string');
  assert.deepEqual(r.taskCost, { amount: 38000, currency: 'KRW' });
  assert.equal(r.diffAckKind, 'matched'); assert.equal(r.diffAckReason, '인용 6000엔'); assert.equal(r.diffAckByName, member.name); assert.ok(r.diffAckAt);
  assert.deepEqual(r.diffAckTaskCost, { amount: 38000, currency: 'KRW' });
  assert.deepEqual(r.diffAckBeforeCost, { amount: 30000, currency: 'KRW' });
  assert.equal(r.updatedAt, before.updatedAt, '처리 기록은 정산팀 폴링에 흘러가면 안 된다');
  assert.equal(taskPaidMismatch(r), null);
  assert.equal(displayStatus(r, 'list').label, '지급 완료 · 맞춤');
  assert.deepEqual((await getTask(sql, row.taskId!))!.cost, { amount: 38000, currency: 'KRW' });
  const changes = await listTaskChanges(sql, row.taskId!);
  assert.equal(changes.length, 1);
  assert.deepEqual([changes[0].source, changes[0].requestId, changes[0].reason, changes[0].byName], ['settlement', row.id, '인용 6000엔', member.name]);
  assert.deepEqual([changes[0].before, changes[0].after], [{ amount: 30000, currency: 'KRW' }, { amount: 38000, currency: 'KRW' }]);
  // 맞춤은 처리 취소가 없다(§5-3)
  assert.equal(await undoKeepTaskCost(sql, row.id), 'not-kept');
});

test('065 맞추기·그대로 두기 — 창을 연 뒤 작업 금액·지급 금액이 바뀌었거나 판정이 없으면 stale, 아무것도 안 바뀐다', async () => {
  const { row, member } = await requestFor('rcm2', 'rcm2');
  const expect = { taskCost: { amount: 30000, currency: 'KRW' as const }, paidAmountKrw: 34000, paidAmountJpy: 4000 };
  // 지급 전 — 판정 없음
  assert.equal(await keepTaskCost(sql, row.id, { expect, reason: '환율·송금 수수료 차이' }, member), 'stale');
  await paidJpy(row.id, 4000, 34000, '2026-10-07T03:00:00Z');
  assert.equal(await matchTaskCostToPaid(sql, row.id, { expect: { ...expect, taskCost: { amount: 29000, currency: 'KRW' } }, newCost: { amount: 38000, currency: 'KRW' }, reason: 'x' }, member), 'stale');
  assert.equal(await matchTaskCostToPaid(sql, row.id, { expect: { ...expect, paidAmountJpy: 3900 }, newCost: { amount: 38000, currency: 'KRW' }, reason: 'x' }, member), 'stale');
  assert.equal(await keepTaskCost(sql, row.id, { expect: { ...expect, paidAmountKrw: 1 }, reason: 'x' }, member), 'stale');
  assert.equal(await matchTaskCostToPaid(sql, '00000000-0000-0000-0000-000000000000', { expect, newCost: { amount: 38000, currency: 'KRW' }, reason: 'x' }, member), 'not-found');
  const [now] = await listRequests(sql, { taskId: row.taskId! });
  assert.deepEqual(now.taskCost, { amount: 30000, currency: 'KRW' });
  assert.equal(now.diffAckKind, null);
  assert.equal((await listTaskChanges(sql, row.taskId!)).length, 0);
});

test('065 그대로 두기 — 작업은 그대로, 처리 기록만 · 처리 취소 · 작업 금액을 다시 바꾸면 다시 뜬다', async () => {
  const { row, member } = await requestFor('rck1', 'rck1');
  await paidJpy(row.id, 4000, 34000, '2026-10-07T03:00:00Z');
  const [before] = await listRequests(sql, { taskId: row.taskId! });
  const expect = { taskCost: { amount: 30000, currency: 'KRW' as const }, paidAmountKrw: 34000, paidAmountJpy: 4000 };
  const k = await keepTaskCost(sql, row.id, { expect, reason: '추가 지급(별도 합의) — 인용 추가분' }, member);
  assert.ok(typeof k !== 'string');
  assert.equal(k.diffAckKind, 'kept'); assert.equal(k.diffAckReason, '추가 지급(별도 합의) — 인용 추가분');
  assert.deepEqual(k.diffAckTaskCost, { amount: 30000, currency: 'KRW' });
  assert.equal(k.updatedAt, before.updatedAt);
  assert.equal(taskPaidMismatch(k), null);
  assert.equal(displayStatus(k, 'list').label, '지급 완료 · 그대로 둠');
  assert.deepEqual((await getTask(sql, row.taskId!))!.cost, { amount: 30000, currency: 'KRW' });
  assert.equal((await listTaskChanges(sql, row.taskId!)).length, 0);

  const u = await undoKeepTaskCost(sql, row.id);
  assert.ok(typeof u !== 'string');
  assert.equal(u.diffAckKind, null); assert.equal(u.diffAckAt, null); assert.equal(u.diffAckReason, null); assert.equal(u.diffAckTaskCost, null);
  assert.equal(u.updatedAt, before.updatedAt);
  assert.notEqual(taskPaidMismatch(u), null);
  assert.equal(await undoKeepTaskCost(sql, row.id), 'not-kept');

  await keepTaskCost(sql, row.id, { expect, reason: '환율·송금 수수료 차이' }, member);
  await updateTask(sql, row.taskId!, { cost: { amount: 31000, currency: 'KRW' } });   // 처리 뒤 누가 작업 금액을 바꿨다(아직 지급과 다름)
  const [again] = await listRequests(sql, { taskId: row.taskId! });
  assert.equal(again.diffAckKind, 'kept');
  assert.notEqual(taskPaidMismatch(again), null, '처리 때 작업 금액과 지금이 다르면 다시 뜬다');
});

test('065 — 정산팀이 지급 금액을 정정하면 처리 기록이 통째로 비워진다', async () => {
  const { row, member } = await requestFor('rck2', 'rck2');
  await paidJpy(row.id, 4000, 34000, '2026-10-07T03:00:00Z');
  await keepTaskCost(sql, row.id, { expect: { taskCost: { amount: 30000, currency: 'KRW' }, paidAmountKrw: 34000, paidAmountJpy: 4000 }, reason: '환율·송금 수수료 차이' }, member);
  await paidJpy(row.id, 4000, 34000, '2026-10-07T04:00:00Z');   // 같은 금액 재전송 — 유지
  assert.equal((await listRequests(sql, { taskId: row.taskId! }))[0].diffAckKind, 'kept');
  await paidJpy(row.id, 4200, 35700, '2026-10-07T05:00:00Z');   // 금액 정정 — 비움
  const [after] = await listRequests(sql, { taskId: row.taskId! });
  assert.deepEqual([after.diffAckAt, after.diffAckByName, after.diffAckKind, after.diffAckReason, after.diffAckTaskCost], [null, null, null, null, null]);
});

test('065 — 달러 지급은 비율로: 0.82는 같음, 2.63은 다름(saachan 모양)', async () => {
  const { row } = await requestFor('rcu1', 'rcu1');
  await applyExternalStatus(sql, row.id, upd('paid', '2026-10-07T03:00:00Z', { paidAmountKrw: 26000, paidAmountUsd: 18.62, paidAt: '2026-10-07T03:00:00Z' }));
  assert.equal(taskPaidMismatch((await listRequests(sql, { taskId: row.taskId! }))[0]), null);
  await applyExternalStatus(sql, row.id, upd('paid', '2026-10-07T04:00:00Z', { paidAmountKrw: 83000, paidAmountUsd: 59.4, paidAt: '2026-10-07T03:00:00Z' }));
  const m = taskPaidMismatch((await listRequests(sql, { taskId: row.taskId! }))[0]);
  assert.ok(m && m.kind === 'band' && m.diff === 83000 - 31580);
});

test('065 — 캠페인 배지도 같은 판정(지금 작업 금액·처리 기록이 실린다)', async () => {
  const { row } = await requestFor('rcb1', 'rcb1');
  await paidJpy(row.id, 4000, 34000, '2026-10-07T03:00:00Z');
  const badge = (await settlementByTaskIds(sql, [row.taskId!])).get(row.taskId!)!;
  assert.deepEqual(badge.taskCost, { amount: 30000, currency: 'KRW' });
  assert.equal(badge.costCurrency, 'KRW'); assert.equal(badge.amountKrw, 30000);
  assert.equal(displayStatus(badge, 'campaign').label, '지급 금액 다름');
});
```

- [ ] **Step 7: DB 테스트 실행**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/settlementStore.test.ts`
Expected: PASS(전 테스트). 운영이면 testGuard가 막는다 — 막히면 멈추고 보고.
Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignTaskStore.test.ts src/lib/campaignStore.test.ts`
Expected: PASS(배지 SQL 변경 회귀 확인).
Run: `node --import tsx --test src/lib/settlementDisplay.test.ts src/lib/settlementMismatch.test.ts src/lib/settlementExternal.test.ts`
Expected: PASS. — 그리고 `src/lib/settlementExternal.test.ts`의 `row` 픽스처(`const row: PaymentRequestRow = {`)는 새 필수 칸이 없어 tsc가 막으므로, 그 객체의 마지막 줄 `  campaignStartsOn: '2026-08-31', campaignEndsOn: '2026-09-06', postedOn: '2026-08-27', paymentMethodCorrection: null,` 다음에 한 줄 추가한다:
```ts
  taskCost: { amount: 30000, currency: 'KRW' }, diffAckKind: null, diffAckReason: null, diffAckTaskCost: null, diffAckBeforeCost: null,
```

- [ ] **Step 8: 타입·린트**

Run: `npx tsc --noEmit -p .` → 0. (`src/lib/campaignFlowView.test.ts` 등에서 `SettlementBadge` 리터럴이 없으므로 다른 수정은 필요 없다 — 오류가 나면 그 픽스처에 위 배지 칸을 채운다.)
Run: `npx eslint src/lib/settlementStore.ts src/lib/campaignTaskStore.ts src/lib/settlementDisplay.ts src/lib/settlementStore.test.ts src/lib/settlementDisplay.test.ts src/lib/settlementExternal.test.ts` → 0.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/settlementStore.ts src/lib/campaignTaskStore.ts src/lib/settlementDisplay.ts src/lib/settlementStore.test.ts src/lib/settlementDisplay.test.ts src/lib/settlementExternal.test.ts
git commit -m "feat(settlement-diff): 요청 행에 지금 작업 금액·처리 기록, 맞추기/그대로 두기/처리 취소 한 트랜잭션, 판정 전환

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API — 처리 동작 3개 + 클라이언트 함수

**Files:**
- Modify: `src/lib/campaignTaskInput.ts` (상수 1개 추가)
- Modify: `src/app/api/settlement/requests/[id]/route.ts`
- Modify: `src/lib/settlementApi.ts`

**Interfaces:**
- Consumes: Task 4의 `matchTaskCostToPaid`, `keepTaskCost`, `undoKeepTaskCost`, `ReconcileExpect`, `ReconcileFailure`; Task 2의 `composeKeepReason`, `RECONCILE_STALE_MESSAGE`, `RECONCILE_REASON_MAX`, `KeepReason`
- Produces:
```ts
// campaignTaskInput.ts
export const PAID_COST_REASON_MESSAGE = '지급이 끝난 작업이라 사유를 적어야 저장돼요';   // §9 — 캠페인 PATCH 400·정산 처리 빈 사유 400이 같은 문장
// PATCH /api/settlement/requests/[id]
//   { action: 'match-task-cost', expectedTaskCost, expectedPaidKrw, expectedPaidJpy, newCost, reason } → 200 PaymentRequestRow | 400 | 404 | 409(§9 경합)
//   { action: 'keep-task-cost', expectedTaskCost, expectedPaidKrw, expectedPaidJpy, reasonKind, memo } → 같음
//   { action: 'undo-keep-task-cost' } → 200 | 404 | 409
// settlementApi.ts
export const matchTaskCostApi: (r: PaymentRequestRow, newCost: TaskCost, reason: string) => Promise<ApiResult<PaymentRequestRow>>;
export const keepTaskCostApi: (r: PaymentRequestRow, reasonKind: KeepReason, memo: string) => Promise<ApiResult<PaymentRequestRow>>;
export const undoKeepTaskCostApi: (id: string) => Promise<ApiResult<PaymentRequestRow>>;
```

- [ ] **Step 1: 상수 추가**

`src/lib/campaignTaskInput.ts`의 `export const POSTED_TASK_MESSAGE = …;` 줄 다음에 추가:

```ts
// 지급이 끝난 작업의 금액은 사유가 있어야 바꾼다(스펙 2026-10-07 §6·§9) — 캠페인 PATCH와 정산 화면 처리의 빈 사유가 같은 문장을 쓴다
export const PAID_COST_REASON_MESSAGE = '지급이 끝난 작업이라 사유를 적어야 저장돼요';
```

- [ ] **Step 2: 라우트 확장**

`src/app/api/settlement/requests/[id]/route.ts` 전체를 교체(ack-diff·unack-diff는 Task 8에서 지운다 — 지금은 화면이 아직 쓴다):

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import {
  cancelRequest, ackDiff, unackDiff, reviseRequest, matchTaskCostToPaid, keepTaskCost, undoKeepTaskCost,
  type RevisionEdits, type ReconcileExpect, type ReconcileFailure, type PaymentRequestRow,
} from '@/lib/settlementStore';
import { REVISION_FAILURE_MESSAGE } from '@/lib/settlementRevisionCopy';
import { parseTaskCost, sameTaskCost, AMOUNT_MESSAGE } from '@/lib/campaignCost';
import { composeKeepReason, RECONCILE_STALE_MESSAGE, RECONCILE_REASON_MAX } from '@/lib/settlementDisplay';
import { PAID_COST_REASON_MESSAGE } from '@/lib/campaignTaskInput';

// 라우트 파일은 HTTP 핸들러만 export한다 — 상수는 모듈 내부에 둔다.
const CANCEL_REASON_MESSAGE = '취소 사유를 1~200자로 적어 주세요';
const NOT_FOUND_MESSAGE = '요청을 찾을 수 없어요 — 화면을 새로고침해 주세요';

// 창을 연 때의 값 — 모양이 어긋나면 화면이 오래된 것이다(경합과 같은 안내)
function parseReconcileExpect(b: Record<string, unknown>): ReconcileExpect | null {
  const c = parseTaskCost(b.expectedTaskCost ?? null);
  if (!c.ok || !c.value) return null;
  const krw = b.expectedPaidKrw;
  const jpy = b.expectedPaidJpy ?? null;
  if (typeof krw !== 'number' || !Number.isSafeInteger(krw)) return null;
  if (jpy !== null && (typeof jpy !== 'number' || !Number.isFinite(jpy))) return null;
  return { taskCost: c.value, paidAmountKrw: krw, paidAmountJpy: jpy as number | null };
}
function reconcileResponse(r: PaymentRequestRow | ReconcileFailure) {
  if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'stale') return NextResponse.json({ error: RECONCILE_STALE_MESSAGE }, { status: 409 });
  return NextResponse.json(r);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown };

  if (body.action === 'ack-diff' || body.action === 'unack-diff') {
    const r = body.action === 'ack-diff'
      ? await ackDiff(getSql(), id, { name: gate.member.name })
      : await unackDiff(getSql(), id);
    if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    if (r === 'no-diff') return NextResponse.json({ error: '확인할 차액이 없어요 — 화면을 새로고침해 주세요' }, { status: 409 });
    return NextResponse.json(r);
  }

  // 정산팀 지급 금액 ≠ 작업 금액 처리(스펙 2026-10-07 §5) — 판정·경합은 스토어(lockForReconcile), 여기는 입력 모양·HTTP 매핑만
  if (body.action === 'match-task-cost' || body.action === 'keep-task-cost') {
    const b = body as Record<string, unknown>;
    const expect = parseReconcileExpect(b);
    if (!expect) return NextResponse.json({ error: RECONCILE_STALE_MESSAGE }, { status: 409 });
    if (body.action === 'match-task-cost') {
      const nc = parseTaskCost(b.newCost ?? null);
      if (!nc.ok) return NextResponse.json({ error: nc.message }, { status: 400 });
      if (!nc.value) return NextResponse.json({ error: AMOUNT_MESSAGE }, { status: 400 });
      if (sameTaskCost(nc.value, expect.taskCost)) return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
      const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (!reason || reason.length > RECONCILE_REASON_MAX) return NextResponse.json({ error: PAID_COST_REASON_MESSAGE }, { status: 400 });
      return reconcileResponse(await matchTaskCostToPaid(getSql(), id, { expect, newCost: nc.value, reason }, { id: gate.member.id, name: gate.member.name }));
    }
    const reason = composeKeepReason(b.reasonKind, b.memo);
    if (!reason) return NextResponse.json({ error: PAID_COST_REASON_MESSAGE }, { status: 400 });
    return reconcileResponse(await keepTaskCost(getSql(), id, { expect, reason }, { name: gate.member.name }));
  }
  if (body.action === 'undo-keep-task-cost') {
    const r = await undoKeepTaskCost(getSql(), id);
    if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    if (r === 'not-kept') return NextResponse.json({ error: RECONCILE_STALE_MESSAGE }, { status: 409 });
    return NextResponse.json(r);
  }

  // 제자리 수정(스펙 2026-09-07 §4·§6) — 판정은 스토어(reviseRequest), 여기는 입력 모양·HTTP 매핑만
  if (body.action === 'revise') {
    const b = body as { expectedRevision?: unknown; reason?: unknown; edits?: unknown; partnerConfirmed?: unknown };
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason || reason.length > 200) return NextResponse.json({ error: '수정 사유를 1~200자로 적어 주세요' }, { status: 400 });
    if (typeof b.expectedRevision !== 'number' || !Number.isInteger(b.expectedRevision)) return NextResponse.json({ error: '화면이 오래됐어요 — 새로고침해 주세요' }, { status: 400 });
    const e = (b.edits ?? {}) as Record<string, unknown>;
    const edits: RevisionEdits = {
      category: typeof e.category === 'string' ? e.category : '',
      deadlineOn: typeof e.deadlineOn === 'string' ? e.deadlineOn : '',
      referenceUrl: typeof e.referenceUrl === 'string' && e.referenceUrl.trim() ? e.referenceUrl.trim() : null,
    };
    const r = await reviseRequest(getSql(), id, { expectedRevision: b.expectedRevision, reason, edits, partnerConfirmed: b.partnerConfirmed === true }, { id: gate.member.id, name: gate.member.name });
    if (typeof r === 'string') return NextResponse.json({ error: REVISION_FAILURE_MESSAGE[r] }, { status: r === 'not-found' ? 404 : 409 });
    if ('kind' in r && r.kind === 'blocked') return NextResponse.json({ error: r.issues.map((i) => i.text).join(' · ') }, { status: 409 });
    return NextResponse.json(r);
  }

  if (body.action !== 'cancel') return NextResponse.json({ error: '지원하지 않는 동작이에요' }, { status: 400 });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 200) return NextResponse.json({ error: CANCEL_REASON_MESSAGE }, { status: 400 });
  const r = await cancelRequest(getSql(), id, reason, { id: gate.member.id, name: gate.member.name });
  if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'already-cancelled') return NextResponse.json({ error: '이미 취소된 요청이에요' }, { status: 409 });
  if (r === 'paid-locked') return NextResponse.json({ error: '지급 완료된 요청은 취소할 수 없어요 — 정산팀에 알려 주세요' }, { status: 409 });
  return NextResponse.json(r);
}
```
`AMOUNT_MESSAGE`·`parseTaskCost`·`sameTaskCost`가 `@/lib/campaignCost`에서 export되는지 확인(앞 둘은 기존, 마지막은 Task 2).

- [ ] **Step 3: 클라이언트 함수**

`src/lib/settlementApi.ts`:
- import 추가(기존 import 블록 끝):

```ts
import type { TaskCost } from './campaignCost.ts';
import type { KeepReason } from './settlementDisplay.ts';
```
- `export const unackDiffApi = …;` 줄 다음에 추가:

```ts
// 정산팀 지급 금액 ≠ 작업 금액 처리(스펙 2026-10-07 §5) — 창을 연 때의 작업 금액·지급 금액을 함께 보낸다(서버가 경합을 409로)
const expectOf = (r: PaymentRequestRow) => ({ expectedTaskCost: r.taskCost, expectedPaidKrw: r.paidAmountKrw, expectedPaidJpy: r.paidAmountJpy });
export const matchTaskCostApi = (r: PaymentRequestRow, newCost: TaskCost, reason: string) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${r.id}`, json('PATCH', { action: 'match-task-cost', ...expectOf(r), newCost, reason }));
export const keepTaskCostApi = (r: PaymentRequestRow, reasonKind: KeepReason, memo: string) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${r.id}`, json('PATCH', { action: 'keep-task-cost', ...expectOf(r), reasonKind, memo }));
export const undoKeepTaskCostApi = (id: string) =>
  call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'undo-keep-task-cost' }));
```

- [ ] **Step 4: 검증**

라우트 테스트 하네스는 없다(메모리: cb-x-deck-verification-loop) — 판정·경합은 Task 4 DB 테스트가 덮었다. 여기서는 타입·린트만.
Run: `npx tsc --noEmit -p .` → 0
Run: `npx eslint "src/app/api/settlement/requests/[id]/route.ts" src/lib/settlementApi.ts src/lib/campaignTaskInput.ts` → 0

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/settlement/requests/[id]/route.ts" src/lib/settlementApi.ts src/lib/campaignTaskInput.ts
git commit -m "feat(settlement-diff): 정산 요청 PATCH — 지급 금액에 맞추기·그대로 두기·처리 취소

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 작업 금액 변경 이력 + 지급 완료 작업의 사유 관문

**Files:**
- Modify: `src/lib/campaignTaskInput.ts` (`TaskPatchParsed`·`parseTaskPatch`·`costReasonGateError`)
- Modify: `src/lib/campaignTaskStore.ts` (`TaskRow.costChangeCount`·`Row`·`SELECT`·`toRow`·`logCostChangeInTx`·`hasPaidRequest`·`replaceInfluencer`)
- Modify: `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`
- Modify: `src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts`
- Create: `src/app/api/campaigns/[id]/tasks/[taskId]/changes/route.ts`
- Modify: `src/lib/campaignApi.ts`
- Modify: `src/lib/campaignFlowView.test.ts` (픽스처 1칸)
- Test: `src/lib/taskCostReason.test.ts` (새, 순수), `src/lib/settlementStore.test.ts` (테스트 1개 추가), `src/lib/campaignTaskCancel.test.ts` (교체 테스트 단언 추가)

**Interfaces:**
- Consumes: Task 4의 `insertTaskChange`, `listTaskChanges`, `TaskChangeMeta`, `TaskChangeRow`; Task 5의 `PAID_COST_REASON_MESSAGE`; Task 2의 `sameTaskCost`
- Produces:
```ts
// campaignTaskInput.ts
export type TaskPatchParsed = Omit<TaskPatch, 'proof' | 'agreement'> & { proofUrl?: string | null; agreementInput?: TaskAgreementInput | null; costReason?: string };
export const COST_REASON_MAX = 200;
export function costReasonGateError(i: { before: TaskCost | null; next: TaskCost | null | undefined; hasPaidRequest: boolean; reason: string | undefined }): string | null;
// campaignTaskStore.ts
TaskRow.costChangeCount: number;
export async function logCostChangeInTx(tx: postgres.Sql, taskId: string, next: TaskCost | null, meta: TaskChangeMeta): Promise<void>;
export async function hasPaidRequest(sql: postgres.Sql, taskId: string): Promise<boolean>;
// replaceInfluencer input에 actorName?: string
// GET /api/campaigns/[id]/tasks/[taskId]/changes → { changes: TaskChangeRow[] }
// campaignApi.ts
TaskPatchRequest.costReason?: string;
export const fetchTaskChangesApi: (campaignId: string, taskId: string) => Promise<ApiResult<{ changes: TaskChangeRow[] }>>;
```

- [ ] **Step 1: 실패하는 순수 테스트**

`src/lib/taskCostReason.test.ts`:

```ts
// 지급이 끝난 작업의 금액 수정은 사유 필수(스펙 2026-10-07 §6) — 라우트 하네스가 없어 판정을 순수 함수로 뺐다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costReasonGateError, parseTaskPatch, PAID_COST_REASON_MESSAGE, COST_REASON_MAX } from './campaignTaskInput.ts';

const c = (amount: number) => ({ amount, currency: 'JPY' as const });

test('costReasonGateError — 지급 완료 작업의 금액을 실제로 바꿀 때만 사유가 필요하다', () => {
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: '' }), PAID_COST_REASON_MESSAGE);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: '   ' }), PAID_COST_REASON_MESSAGE);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: undefined }), PAID_COST_REASON_MESSAGE);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: '인용 6000엔' }), null);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: false, reason: '' }), null);   // 지급 전 — 사유 없어도 된다
  assert.equal(costReasonGateError({ before: c(4000), next: c(4000), hasPaidRequest: true, reason: '' }), null);    // 같은 값 재전송
  assert.equal(costReasonGateError({ before: c(4000), next: undefined, hasPaidRequest: true, reason: '' }), null);   // 금액을 안 바꾸는 PATCH
  assert.equal(costReasonGateError({ before: c(4000), next: null, hasPaidRequest: true, reason: '' }), PAID_COST_REASON_MESSAGE);   // 지우기도 바꾸기
});

test('parseTaskPatch — costReason은 다듬고 200자로 자른다', () => {
  const p = parseTaskPatch({ cost: { amount: 6000, currency: 'JPY' }, costReason: '  인용 6000엔  ' });
  assert.ok(p.ok); assert.equal(p.value.costReason, '인용 6000엔');
  const long = parseTaskPatch({ cost: { amount: 6000, currency: 'JPY' }, costReason: 'x'.repeat(300) });
  assert.ok(long.ok); assert.equal(long.value.costReason?.length, COST_REASON_MAX);
  const none = parseTaskPatch({ cost: { amount: 6000, currency: 'JPY' } });
  assert.ok(none.ok); assert.equal(none.value.costReason, undefined);
});
```

Run: `node --import tsx --test src/lib/taskCostReason.test.ts`
Expected: FAIL — `costReasonGateError` export 없음.

- [ ] **Step 2: `campaignTaskInput.ts` 구현**

(a) 두 번째 줄 `import type { Parsed, TaskCost } from './campaignCost.ts';` 다음 줄 `import { parseTaskCost } from './campaignCost.ts';` 를 `import { parseTaskCost, sameTaskCost } from './campaignCost.ts';` 로.

(b) `export type TaskPatchParsed = …;` 줄을 교체:

```ts
// costReason(스펙 2026-10-07 §6) — 작업 금액을 바꾸는 이유. 스토어 패치(TaskPatch)가 아니라 이력(task_change.reason)으로 간다.
export type TaskPatchParsed = Omit<TaskPatch, 'proof' | 'agreement'> & { proofUrl?: string | null; agreementInput?: TaskAgreementInput | null; costReason?: string };
export const COST_REASON_MAX = 200;
```

(c) `parseTaskPatch`의 `if ('cost' in b) { … }` 줄 다음에 추가:

```ts
  if ('costReason' in b) out.costReason = typeof b.costReason === 'string' ? b.costReason.trim().slice(0, COST_REASON_MAX) : '';
```

(d) `parseTaskPatch` 함수 바로 아래에 추가:

```ts
// 지급이 끝난 작업의 금액은 사유가 있어야 바꾼다(스펙 2026-10-07 §6). 실제로 바뀔 때만(같은 값 재전송·금액 없는 PATCH는 통과).
// 라우트 하네스가 없어 순수 함수로 둔다 — 라우트는 hasPaidRequest를 읽어 넣기만 한다.
export function costReasonGateError(i: { before: TaskCost | null; next: TaskCost | null | undefined; hasPaidRequest: boolean; reason: string | undefined }): string | null {
  if (i.next === undefined || sameTaskCost(i.before, i.next)) return null;
  if (i.hasPaidRequest && !(i.reason ?? '').trim()) return PAID_COST_REASON_MESSAGE;
  return null;
}
```

Run: `node --import tsx --test src/lib/taskCostReason.test.ts`
Expected: PASS.

- [ ] **Step 3: `campaignTaskStore.ts` — 이력 쓰기·관문 조회·변경 횟수**

(a) import: 첫 줄들 중 `import { parseTaskCost, type TaskCost } from './campaignCost.ts';` → `import { parseTaskCost, sameTaskCost, type TaskCost } from './campaignCost.ts';`

(b) `TaskRow`의 `settledElsewhereAt: string | null; settledElsewhereNote: string; settledElsewhereByName: string | null;` 줄 다음에 추가:

```ts
  costChangeCount: number;   // 작업 금액 변경 이력 행 수(065) — 작업 패널 '변경 이력 N'(0이면 숨김, 스펙 2026-10-07 §6)
```

(c) `Row` 타입의 `settled_elsewhere_at: string | null; settled_elsewhere_note: string; settled_elsewhere_by_name: string | null;` 다음에 `cost_change_count: number;` 추가.

(d) `SELECT`의 `to_char(t.settled_elsewhere_at, 'YYYY-MM-DD') as settled_elsewhere_at, t.settled_elsewhere_note, t.settled_elsewhere_by_name,` 줄 다음에 추가:

```ts
         (select count(*)::int from task_change c where c.task_id = t.id and c.field = 'cost') as cost_change_count,
```

(e) `toRow`의 `settledElsewhereAt: r.settled_elsewhere_at, settledElsewhereNote: r.settled_elsewhere_note, settledElsewhereByName: r.settled_elsewhere_by_name,` 다음에 `costChangeCount: r.cost_change_count,` 추가.

(f) 파일 끝(Task 4의 `listTaskChanges` 아래)에 추가:

```ts
// 작업 금액을 바꾸는 쓰기 직전에, 같은 트랜잭션 안에서 부른다 — 작업 행을 잠그고 지금 값을 읽어 실제로 바뀔 때만 1행.
// 쓰기가 뒤에서 실패하면 트랜잭션째 롤백되므로 이력만 남는 일은 없다.
export async function logCostChangeInTx(tx: postgres.Sql, taskId: string, next: TaskCost | null, meta: TaskChangeMeta): Promise<void> {
  const rows = await tx<Array<{ cost: unknown }>>`select cost from campaign_task where id = ${taskId} for update`;
  if (!rows.length) return;
  const before = costOf(rows[0].cost);
  if (sameTaskCost(before, next)) return;
  await insertTaskChange(tx, { taskId, before, after: next, ...meta });
}

// 지급이 끝난(정산팀 paid) 살아 있는 요청이 붙은 작업인가 — 금액 수정 사유 관문(costReasonGateError)의 입력
export async function hasPaidRequest(sql: postgres.Sql, taskId: string): Promise<boolean> {
  if (!isUuidLike(taskId)) return false;
  const rows = await sql`select 1 from payment_request where task_id = ${taskId} and status <> 'cancelled' and external_status = 'paid' limit 1`;
  return rows.length > 0;
}
```

(g) `replaceInfluencer`:
- 시그니처의 input 타입 `{ handle: string; cost: TaskCost | null | undefined; reason: CancelReason | null; note: string; actorId: string | null; today: string }` → `{ handle: string; cost: TaskCost | null | undefined; reason: CancelReason | null; note: string; actorId: string | null; actorName?: string; today: string }`
- `await tx\`update campaign_task set influencer_handle = ${input.handle}, payment_method_id = null,` 바로 위 줄(주석 `// 사람이 실제로 바뀌는 자리…` 다음)에 추가:

```ts
    // 금액도 바꾸면 이력 1행(출처 replace, 스펙 2026-10-07 §6). 게시 전 작업만 교체되므로 지급 완료 요청이 붙어 있을 수 없다 — 사유 관문 없음.
    if (input.cost !== undefined) {
      await logCostChangeInTx(tx, id, input.cost, { source: 'replace', reason: '', requestId: null, by: { id: input.actorId, name: input.actorName ?? '' } });
    }
```

- [ ] **Step 4: 라우트 — 캠페인 PATCH**

`src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`:
- import 교체:
  - `import { getTask, updateTask, deleteTask, hasActiveRequest, clearOldInfluencerTraces } from '@/lib/campaignTaskStore';` → `import { getTask, updateTask, deleteTask, hasActiveRequest, clearOldInfluencerTraces, hasPaidRequest, logCostChangeInTx } from '@/lib/campaignTaskStore';`
  - `parseTaskPatch, proofGateError, …, postedAtFromLinkGate } from '@/lib/campaignTaskInput';` 의 목록 끝에 `costReasonGateError`를 더한다.
- `if (Object.keys(patch).length === 0) return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });` → 

```ts
  if (Object.keys(patch).filter((k) => k !== 'costReason').length === 0) return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
```
- `const postedOn = postedAtFromLinkGate(cur, patch);` 블록(3줄) 다음, `const { proofUrl, agreementInput, ...rest } = patch;` 바로 위에 추가:

```ts
  // 작업 금액 변경 이력(스펙 2026-10-07 §6) — 지급이 끝난 작업은 사유가 있어야 바꾼다(화면도 같은 문장으로 막는다)
  if (patch.cost !== undefined) {
    const reasonError = costReasonGateError({ before: cur.cost, next: patch.cost, hasPaidRequest: await hasPaidRequest(sql, taskId), reason: patch.costReason });
    if (reasonError) return NextResponse.json({ error: reasonError }, { status: 400 });
  }
```
- `const { proofUrl, agreementInput, ...rest } = patch;` → `const { proofUrl, agreementInput, costReason, ...rest } = patch;`
- `const apply = async (tx: postgres.Sql) => {` 다음 첫 줄로 추가:

```ts
    // 이력은 쓰기 직전·같은 트랜잭션 — 잠근 지금 값과 다를 때만 1행(출처 campaign)
    if (taskPatch.cost !== undefined) {
      await logCostChangeInTx(tx, taskId, taskPatch.cost, { source: 'campaign', reason: costReason ?? '', requestId: null, by: { id: gate.member.id, name: gate.member.name } });
    }
```

- [ ] **Step 5: 라우트 — 교체·이력 조회**

`src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts`의 호출을 교체:

```ts
  const r = await replaceInfluencer(sql, taskId, { ...parsed.value, handle: canon ?? parsed.value.handle, actorId: gate.member.id, actorName: gate.member.name, today: kstToday() });
```

`src/app/api/campaigns/[id]/tasks/[taskId]/changes/route.ts` 새로 만들기:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getTask, listTaskChanges } from '@/lib/campaignTaskStore';
import { TASK_NOT_FOUND_MESSAGE } from '@/lib/campaignTaskInput';

// 작업 금액 변경 이력(스펙 2026-10-07 §6) — 읽기만. 지우거나 고치는 API는 없다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  return NextResponse.json({ changes: await listTaskChanges(sql, taskId) });
}
```
(라우트 모양은 같은 폴더의 `route.ts`·`replace/route.ts`와 같다 — 이 저장소의 Next 버전 규약. 의심되면 `node_modules/next/dist/docs/`의 route handlers 문서를 확인.)

`src/lib/campaignApi.ts`:
- `import type { TaskRow, TargetCandidate } from './campaignTaskStore.ts';` → `import type { TaskRow, TargetCandidate, TaskChangeRow } from './campaignTaskStore.ts';`
- `TaskPatchRequest`의 `scheduledOn?: string | null; visitOn?: string | null; cost?: TaskCost | null; note?: string;` 줄 다음에 추가:

```ts
  costReason?: string;   // 작업 금액을 바꾸는 이유 — 지급 완료된 작업은 필수(서버 400, 스펙 2026-10-07 §6)
```
- `export const deleteTaskApi = …;` 다음에 추가:

```ts
export const fetchTaskChangesApi = (campaignId: string, taskId: string) =>
  call<{ changes: TaskChangeRow[] }>(`/api/campaigns/${campaignId}/tasks/${taskId}/changes`);
```

`src/lib/campaignFlowView.test.ts`의 `mk` 픽스처에서 `settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null,` → `settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null, costChangeCount: 0,`

- [ ] **Step 6: DB 테스트 추가**

`src/lib/settlementStore.test.ts`:
- 6번째 줄 import에 `hasPaidRequest, logCostChangeInTx`를 더한다: `import { createTasks, updateTask, getTask, deleteTask, markSettledElsewhere, clearSettledElsewhere, listTaskChanges, hasPaidRequest, logCostChangeInTx } from './campaignTaskStore.ts';`
- Task 4에서 넣은 `test('065 — 캠페인 배지도 같은 판정…` 다음에 추가:

```ts
test('065 작업 금액 이력 — 바뀔 때만 1행·같은 값은 기록 없음 · hasPaidRequest는 지급 완료(취소 안 됨)만 · costChangeCount', async () => {
  const { row, member } = await requestFor('rch1', 'rch1');
  const taskId = row.taskId!;
  const meta = { source: 'campaign' as const, reason: '단가 착오', requestId: null, by: member };
  assert.equal(await hasPaidRequest(sql, taskId), false);
  await paidJpy(row.id, 3158, 27000, '2026-10-07T03:00:00Z');
  assert.equal(await hasPaidRequest(sql, taskId), true);
  await sql.begin(async (tx) => { await logCostChangeInTx(tx as unknown as typeof sql, taskId, { amount: 30000, currency: 'KRW' }, meta); });
  assert.equal((await listTaskChanges(sql, taskId)).length, 0, '같은 값은 이력이 없다');
  await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as typeof sql;
    await logCostChangeInTx(tx, taskId, { amount: 32000, currency: 'KRW' }, meta);
    await updateTask(tx, taskId, { cost: { amount: 32000, currency: 'KRW' } });
  });
  const ch = await listTaskChanges(sql, taskId);
  assert.equal(ch.length, 1);
  assert.deepEqual([ch[0].source, ch[0].reason, ch[0].byName, ch[0].requestId], ['campaign', '단가 착오', member.name, null]);
  assert.deepEqual([ch[0].before, ch[0].after], [{ amount: 30000, currency: 'KRW' }, { amount: 32000, currency: 'KRW' }]);
  assert.equal((await getTask(sql, taskId))!.costChangeCount, 1);
});
```
('취소된 paid' 경우는 테스트하지 않는다 — 041 트리거가 지급 완료 요청의 취소를 막아 그런 행은 만들 수 없다. `hasPaidRequest`의 `status <> 'cancelled'`는 방어용.)

`src/lib/campaignTaskCancel.test.ts`:
- import 줄에서 `campaignTaskStore.ts`를 가져오는 목록에 `listTaskChanges`를 더한다.
- `test('6) 교체 — …'` 안의 `const r = await replaceInfluencer(sql, t.id, { handle: newH, cost: { amount: 35000, currency: 'KRW' }, reason: 'no_response', note: '', actorId: null, today: '2026-09-16' });` 를 `… actorId: null, actorName: '박구건', today: '2026-09-16' });` 로 바꾸고, 바로 아래 `assert.deepEqual(g?.cost, { amount: 35000, currency: 'KRW' });` 다음에 추가:

```ts
  // 교체하면서 금액을 바꾸면 이력 1행(출처 replace, 스펙 2026-10-07 §6)
  const changes = await listTaskChanges(sql, t.id);
  assert.equal(changes.length, 1);
  assert.deepEqual([changes[0].source, changes[0].byName, changes[0].before, changes[0].after], ['replace', '박구건', { amount: 30000, currency: 'KRW' }, { amount: 35000, currency: 'KRW' }]);
```

- [ ] **Step 7: 테스트·타입·린트**

Run: `node --import tsx --test src/lib/taskCostReason.test.ts src/lib/campaignFlowView.test.ts`
Expected: PASS.
Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/settlementStore.test.ts src/lib/campaignTaskCancel.test.ts src/lib/campaignTaskStore.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p .` → 0
Run: `npx eslint src/lib/campaignTaskInput.ts src/lib/campaignTaskStore.ts "src/app/api/campaigns/[id]/tasks/[taskId]/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/changes/route.ts" src/lib/campaignApi.ts src/lib/taskCostReason.test.ts src/lib/settlementStore.test.ts src/lib/campaignTaskCancel.test.ts src/lib/campaignFlowView.test.ts` → 0

- [ ] **Step 8: 커밋**

```bash
git add src/lib/campaignTaskInput.ts src/lib/campaignTaskStore.ts "src/app/api/campaigns/[id]/tasks/[taskId]/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/replace/route.ts" "src/app/api/campaigns/[id]/tasks/[taskId]/changes/route.ts" src/lib/campaignApi.ts src/lib/taskCostReason.test.ts src/lib/settlementStore.test.ts src/lib/campaignTaskCancel.test.ts src/lib/campaignFlowView.test.ts
git commit -m "feat(settlement-diff): 작업 금액 변경 이력(캠페인·교체) + 지급 완료 작업은 사유 필수

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 정산 화면 — 상단 안내·표 열·행 버튼·두 창

**Files:**
- Create: `src/app/settlement/reconcileParts.tsx`, `src/app/settlement/MatchDialog.tsx`, `src/app/settlement/KeepDialog.tsx`
- Modify: `src/app/settlement/RequestList.tsx` (전체 교체)
- Modify: `src/app/settlement/RequestRow.tsx` (import·시그니처·요약 행 교체, 펼침 `colSpan`)

**Interfaces:**
- Consumes: `taskPaidMismatch`, `requestCostOf`, `usdText`, `KEEP_REASONS`, `composeKeepReason`, `RECONCILE_REASON_MAX`(Task 2), `suggestTaskCostFromPaid`, `budgetDeltaKrw`(Task 3), `matchTaskCostApi`, `keepTaskCostApi`(Task 5), `PaymentRequestRow.taskCost`(Task 4)
- Produces:
```ts
export function ReconcileHead({ target, title }: { target: PaymentRequestRow; title: string }): JSX.Element;   // 제목·부제·비교 줄
export function MatchDialog({ target, onDone, onClose }: { target: PaymentRequestRow; onDone: () => void; onClose: () => void }): JSX.Element;
export function KeepDialog({ target, onDone, onClose }: { target: PaymentRequestRow; onDone: () => void; onClose: () => void }): JSX.Element;
// RequestRow props에 onMatch: () => void; onKeep: () => void 추가
```

- [ ] **Step 1: 창 공용 머리**

`src/app/settlement/reconcileParts.tsx`:

```tsx
'use client';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { formatMoney } from '@/lib/influencerPricing';
import { usdText } from '@/lib/settlementDisplay';

// 맞추기·그대로 두기 창 머리(스펙 2026-10-07 §9) — 제목 / `@{핸들} · {유형} · {캠페인}` / `작업 금액 {현재} → 정산팀 지급 {지급}(외화)`.
// 버튼은 판정이 '다름'일 때만 보이고, 판정은 작업 금액·지급 원화가 있어야 성립한다 — 둘 다 있다고 보고 그린다.
export function ReconcileHead({ target, title }: { target: PaymentRequestRow; title: string }) {
  const cur = target.taskCost;
  const foreign = target.paidAmountUsd !== null
    ? ` (달러 ${usdText(target.paidAmountUsd)})`
    : target.paidAmountJpy !== null ? ` (엔화 ${formatMoney(target.paidAmountJpy, 'JPY')})` : '';
  return (
    <>
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="mt-1 text-ui text-x-secondary">@{target.influencerHandle} · {TASK_TYPE_LABEL[target.taskType]} · {target.campaignName}</p>
      <p className="mt-3 text-content tabular-nums">
        작업 금액 {cur ? formatMoney(cur.amount, cur.currency) : '—'} → 정산팀 지급 {formatMoney(target.paidAmountKrw ?? 0, 'KRW')}{foreign}
      </p>
    </>
  );
}
```

- [ ] **Step 2: 지급 금액에 맞추기 창**

`src/app/settlement/MatchDialog.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { CURRENCIES, CURRENCY_LABEL, parseAmount, sameTaskCost, type Currency, type TaskCost } from '@/lib/campaignCost';
import { formatMoney } from '@/lib/influencerPricing';
import { suggestTaskCostFromPaid, budgetDeltaKrw } from '@/lib/settlementCalc';
import { usdText, RECONCILE_REASON_MAX } from '@/lib/settlementDisplay';
import { matchTaskCostApi } from '@/lib/settlementApi';
import { ReconcileHead } from './reconcileParts';
import { signedMoney } from './tableStyle';

const FIELD = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-content';

// 작업 금액 바꾸기(스펙 2026-10-07 §5-1·§9). 저장 = 작업 금액 + 이력 + 처리 기록 한 트랜잭션(서버). 창을 연 뒤 값이 바뀌었으면 409 문구를 그대로 보인다.
export function MatchDialog({ target, onDone, onClose }: { target: PaymentRequestRow; onDone: () => void; onClose: () => void }) {
  const current = target.taskCost as TaskCost;
  // 정확히 비교 가능한 지급만 미리 채운다 — 달러·엔화 없음은 비워 둔다(환산값을 넣으면 틀린 금액이 그럴듯해 보인다)
  const suggestion = suggestTaskCostFromPaid({
    payoutCurrency: target.payoutCurrency, paidAmountKrw: target.paidAmountKrw, paidAmountJpy: target.paidAmountJpy,
    fee: target.fee, rateKrwPerJpy: target.rateKrwPerJpy, taskCurrency: current.currency,
  });
  const [amount, setAmount] = useState(suggestion ? String(suggestion.cost.amount) : '');
  const [currency, setCurrency] = useState<Currency>(current.currency);
  const [reason, setReason] = useState(target.externalNote ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const parsed = amount.trim() === '' ? null : parseAmount(amount);
  const next: TaskCost | null = parsed === null ? null : { amount: parsed, currency };
  const changes = next !== null && !sameTaskCost(next, current);
  const canSave = changes && reason.trim() !== '' && !busy;

  async function save() {
    if (!next || !canSave) return;
    setBusy(true); setErr('');
    const r = await matchTaskCostApi(target, next, reason.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="작업 금액 바꾸기" className="w-full max-w-[480px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <ReconcileHead target={target} title="작업 금액 바꾸기" />
        <label className="mt-4 block text-ui font-semibold text-x-secondary">새 작업 금액
          <span className="mt-1 flex gap-2 font-normal">
            <input autoFocus inputMode="numeric" className={`${FIELD} min-w-0 flex-1 tabular-nums`} value={amount}
                   onChange={(e) => { setAmount(e.target.value); setErr(''); }} />
            <select className={FIELD} value={currency} onChange={(e) => { setCurrency(e.target.value as Currency); setErr(''); }} aria-label="새 작업 금액 통화">
              {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
            </select>
          </span>
        </label>
        {suggestion && suggestion.feeAmount > 0 && (
          <p className="mt-1 text-ui text-x-muted">정산팀 지급 {formatMoney(suggestion.paid, suggestion.paidCurrency)} 중 송금 수수료 {formatMoney(suggestion.feeAmount, suggestion.paidCurrency)}를 뺀 금액이에요.</p>
        )}
        {!suggestion && (
          <p className="mt-1 text-ui text-amber-700">
            {target.paidAmountUsd !== null && <>정산팀은 달러 {usdText(target.paidAmountUsd)}로 보냈어요. </>}
            원화 {formatMoney(target.paidAmountKrw ?? 0, 'KRW')}은 정산팀이 바꾼 값이라, 실제로 약속한 금액을 적어 주세요.
          </p>
        )}
        <label className="mt-4 block text-ui font-semibold text-x-secondary">사유
          <textarea className="mt-1 w-full rounded-lg border border-x-border p-2 text-content font-normal" rows={2} maxLength={RECONCILE_REASON_MAX}
                    value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} />
        </label>
        {target.externalNote && <p className="mt-1 text-ui text-x-muted">정산팀 메모를 먼저 넣어 뒀어요. 고쳐 써도 돼요.</p>}
        {changes && next && (
          <p className="mt-3 text-ui text-x-secondary tabular-nums">{target.campaignName} 집행액이 {signedMoney(budgetDeltaKrw(current, next), 'KRW')} 돼요</p>
        )}
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
            {next ? `${formatMoney(next.amount, next.currency)}으로 바꾸기` : '바꾸기'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 그대로 두기 창**

`src/app/settlement/KeepDialog.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { KEEP_REASONS, composeKeepReason, RECONCILE_REASON_MAX, type KeepReason } from '@/lib/settlementDisplay';
import { keepTaskCostApi } from '@/lib/settlementApi';
import { ReconcileHead } from './reconcileParts';

// 작업 금액 그대로 두기(스펙 2026-10-07 §5-2·§9) — 작업은 안 바뀌고 처리 기록만. 기타는 메모 필수.
export function KeepDialog({ target, onDone, onClose }: { target: PaymentRequestRow; onDone: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<KeepReason>(KEEP_REASONS[0]);
  const [memo, setMemo] = useState(target.externalNote ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  const reason = composeKeepReason(kind, memo);

  async function save() {
    if (!reason || busy) return;
    setBusy(true); setErr('');
    const r = await keepTaskCostApi(target, kind, memo.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="작업 금액 그대로 두기" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <ReconcileHead target={target} title="작업 금액 그대로 두기" />
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">사유</legend>
          {KEEP_REASONS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-content">
              <input type="radio" name="keep-reason" className="h-4 w-4" checked={kind === k} onChange={() => { setKind(k); setErr(''); }} />
              {k}
            </label>
          ))}
        </fieldset>
        <label className="mt-3 block text-ui font-semibold text-x-secondary">메모
          <textarea className="mt-1 w-full rounded-lg border border-x-border p-2 text-content font-normal" rows={2} maxLength={RECONCILE_REASON_MAX}
                    value={memo} onChange={(e) => { setMemo(e.target.value); setErr(''); }} />
        </label>
        {target.externalNote && <p className="mt-1 text-ui text-x-muted">정산팀 메모를 먼저 넣어 뒀어요. 고쳐 써도 돼요.</p>}
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!reason || busy}>그대로 두기</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 요청 행 — 열·버튼**

`src/app/settlement/RequestRow.tsx`:
(a) import 블록 중 아래 두 줄

```ts
import { displayStatus, TONE_CLASS, payoutDiff, fxDiffKrw } from '@/lib/settlementDisplay';
import { formatDateKo } from '@/lib/campaignJudgment';
```
을 교체(`formatDateKo`는 마감 열이 빠져 더 안 쓴다):

```ts
import { displayStatus, TONE_CLASS, taskPaidMismatch, requestCostOf, usdText } from '@/lib/settlementDisplay';
import { sameTaskCost } from '@/lib/campaignCost';
```

(b) `export function RequestRow(` 줄부터 요약 행의 닫는 `</tr>`(▸ 칸 다음 줄)까지를 아래로 교체:

```tsx
export function RequestRow({ r, open, proofSignedUrl, revisionEnabled, onToggle, onCancel, onRevise, onMatch, onKeep, onChanged }: {
  r: PaymentRequestRow; open: boolean; proofSignedUrl: string | null; revisionEnabled: boolean;
  onToggle: () => void; onCancel: () => void; onRevise: () => void; onMatch: () => void; onKeep: () => void; onChanged: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const cancelled = r.status === 'cancelled';
  const paid = r.externalStatus === 'paid';
  const st = displayStatus(r, 'list');
  // 판정은 지금 작업 금액 vs 정산팀 지급(스펙 2026-10-07 §4) — '다름'이면 상태 칸에 배지 대신 두 버튼(§8-2)
  const mm = taskPaidMismatch(r);
  // '작업 금액' = 지금 작업 금액. 요청에 담긴 금액과 다르면 아래 작은 글씨로 `요청 {금액}`(§8-3)
  const reqCost = requestCostOf(r);
  const showReqCost = r.taskCost !== null && !sameTaskCost(r.taskCost, reqCost);
  // 표 한 줄 = 요청 하나, 칸마다 값 하나(koo 09-28) — 수수료는 송금액에 합치고 내역은 title로.
  const sendTitle = r.feeAmount > 0 ? `순액 ${formatMoney(r.amountNet, r.payoutCurrency)} + 송금 수수료 ${formatMoney(r.feeAmount, r.payoutCurrency)}` : undefined;
  const hasPaid = paid && r.paidAmountKrw !== null;
  // 정산팀 지급 — 판정에 쓰는 통화로(원화 지급=원화, 엔화 지급+엔화 값=엔화, 그 밖=원화). 다른 통화 값은 title로
  const paidCell = !hasPaid ? null
    : r.payoutCurrency === 'JPY' && r.paidAmountJpy !== null ? formatMoney(r.paidAmountJpy, 'JPY') : formatMoney(r.paidAmountKrw as number, 'KRW');
  const paidTitle = !hasPaid ? undefined
    : r.paidAmountUsd !== null ? `달러 ${usdText(r.paidAmountUsd)}`
    : r.paidAmountJpy !== null ? `원화 ${formatMoney(r.paidAmountKrw as number, 'KRW')}` : undefined;
  return (
    <>
      <tr onClick={onToggle} aria-expanded={open} className={`cursor-pointer text-[15px] hover:bg-x-hover ${open ? 'bg-x-hover/60' : ''}`}>
        <td className={`${CELL} font-semibold`}>@{r.influencerHandle}</td>
        <td className={CELL}><span className={TYPE_CHIP[r.taskType]}>{TASK_TYPE_LABEL[r.taskType]}</span></td>
        <td className={`${CELL} ${NUM}`}>
          {r.taskCost ? formatMoney(r.taskCost.amount, r.taskCost.currency) : <span className="text-x-muted">—</span>}
          {showReqCost && <span className="block text-caption text-x-muted">요청 {formatMoney(reqCost.amount, reqCost.currency)}</span>}
        </td>
        <td className={`${CELL} ${NUM}`} title={sendTitle}>{formatMoney(r.amountGross, r.payoutCurrency)}</td>
        {/* 옅은 세로선 — 왼쪽은 우리가 보낸 값, 오른쪽은 정산팀이 알려 준 결과 */}
        <td className={`${CELL} ${NUM} border-l border-x-border`} title={paidTitle}>{paidCell ?? <span className="text-x-muted">—</span>}</td>
        <td className={`${CELL} ${NUM}`}>
          {mm ? <span className="text-amber-700">{signedMoney(mm.diff, mm.currency)}</span> : <span className="text-x-muted">—</span>}
        </td>
        <td className={CELL}><span className={METHOD_CHIP}>{PAYMENT_TYPE_LABEL[r.paymentMethod.type]}</span></td>
        <td className={CELL}>
          {mm ? (
            // 행 클릭(펼치기)과 겹치지 않게 — 버튼 줄에서 이벤트를 멈춘다. 확정(맞추기)이 오른쪽·진한 버튼
            <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Button onClick={onKeep}>그대로 두기</Button>
              <Button variant="primary" onClick={onMatch}>지급 금액에 맞추기</Button>
            </span>
          ) : (
            <span className={`rounded-full px-2.5 py-0.5 text-ui whitespace-nowrap ${TONE_CLASS[st.tone]}`} title={st.title}>{st.label}</span>
          )}
        </td>
        <td className={`${CELL} w-8 text-x-muted`} aria-hidden>{open ? '▾' : '▸'}</td>
      </tr>
```
(c) 펼침의 `<tr><td colSpan={10} className="px-4 pb-4">` → `<tr><td colSpan={9} className="px-4 pb-4">`.

- [ ] **Step 5: 요청 내역 목록**

`src/app/settlement/RequestList.tsx` 전체 교체:

```tsx
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/lib/toastContext';
import { fetchRequests, cancelRequestApi, fetchSettlementConfig } from '@/lib/settlementApi';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { useSignedTaskProofUrls } from '@/components/useSignedTaskProofUrls';
import { RequestRow } from './RequestRow';
import { CancelDialog } from './CancelDialog';
import { ReviseDialog } from './ReviseDialog';
import { MatchDialog } from './MatchDialog';
import { KeepDialog } from './KeepDialog';
import { uniqPairs } from './uniqPairs';
import { HEAD, GROUP, groupByCampaign } from './tableStyle';
import { STATUS_GROUP_OPTIONS, inGroup, keyOf, taskPaidMismatch, type StatusGroup } from '@/lib/settlementDisplay';
import { kstDate } from '@/lib/datetime';

const SEL = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-ui';
const COLS = 9;   // 인플루언서 | 유형 | 작업 금액 | 송금액 | 정산팀 지급 | 차이 | 결제 수단 | 상태 · 처리 | ▸ (스펙 2026-10-07 §8-3)

type RequestFilter = { clientId: string; campaignId: string; status: StatusGroup; from: string; to: string };
const NO_FILTER: RequestFilter = { clientId: '', campaignId: '', status: '', from: '', to: '' };

export function RequestList({ focusTaskId }: { focusTaskId: string | null }) {
  const { show } = useToast();
  const [rows, setRows] = useState<PaymentRequestRow[] | null>(null);   // 필터 없이 전량 — 옵션 목록도 이걸로 만든다
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<RequestFilter>(NO_FILTER);
  const [open, setOpen] = useState<string | null>(null);        // 펼친 요청 id
  const [cancelling, setCancelling] = useState<PaymentRequestRow | null>(null);
  const [revising, setRevising] = useState<PaymentRequestRow | null>(null);
  const [matching, setMatching] = useState<PaymentRequestRow | null>(null);
  const [keeping, setKeeping] = useState<PaymentRequestRow | null>(null);
  const [revisionEnabled, setRevisionEnabled] = useState(false);   // 제자리 수정 전환 스위치(서버 env) — 켜지기 전엔 버튼 자체가 없다
  const didFocus = useRef(false);                                // 딥링크 자동 펼침을 첫 로드 1회로 제한

  const load = useCallback(async () => {
    const r = await fetchRequests({});
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setRows(r.data);
    // 배지에서 들어왔으면 그 작업의 활성 요청(없으면 최신)을 펼친다 — 최초 1회만(이후 토글은 사용자 의도 유지)
    if (focusTaskId && !didFocus.current) {
      didFocus.current = true;
      const hit = r.data.find((x) => x.taskId === focusTaskId && x.status === 'requested') ?? r.data.find((x) => x.taskId === focusTaskId);
      if (hit) setOpen(hit.id);
    }
  }, [focusTaskId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드(필터는 화면에서만 적용, 재조회 없음), 취소 후에도 load()로 재조회
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void fetchSettlementConfig().then((r) => { if (r.ok) setRevisionEnabled(r.data.revisionV2); }); }, []);

  // 옵션은 전량(rows)에서 뽑는다 — 필터에 걸려 안 보이는 클라이언트/캠페인도 계속 골라 쓸 수 있게(08-28 리뷰)
  const clients = useMemo(() => uniqPairs((rows ?? []).map((r) => [r.clientId, r.clientName] as const)), [rows]);
  const campaigns = useMemo(() => uniqPairs((rows ?? []).filter((r) => r.campaignId && (!filter.clientId || r.clientId === filter.clientId)).map((r) => [r.campaignId as string, r.campaignName] as const)), [rows, filter.clientId]);

  const filtered = useMemo(() => (rows ?? []).filter((r) =>
    (!filter.clientId || r.clientId === filter.clientId)
    && (!filter.campaignId || r.campaignId === filter.campaignId)
    && inGroup(keyOf(r), filter.status)
    && (!filter.from || kstDate(r.createdAt) >= filter.from)
    && (!filter.to || kstDate(r.createdAt) <= filter.to)), [rows, filter]);

  // 정산팀 지급 금액이 작업 금액과 다른 건(스펙 2026-10-07 §8-5) — 알림이 없으므로 화면 안에서 눈에 띄어야 한다. 필터와 무관하게
  // 전량에서 센다(다른 클라이언트로 좁혀 보고 있어도 놓치면 안 된다). 링크는 필터를 전부 풀고 '지급 금액 다름'만 남긴다 —
  // 안내의 건수와 눌러서 보이는 건수가 항상 같다(UX 원칙 4). 지금 필터 안에 이미 전부 보이면 안내는 필요 없다.
  const mismatched = useMemo(() => (rows ?? []).filter((r) => taskPaidMismatch(r) !== null), [rows]);
  const mismatchedVisible = useMemo(() => filtered.filter((r) => taskPaidMismatch(r) !== null).length, [filtered]);
  const otherFiltersOn = !!(filter.clientId || filter.campaignId || filter.from || filter.to);
  const n = mismatched.length;

  // 증빙 서명 URL — 펼친 행 하나의 증빙만 서명한다(리뷰 수정 5). 훅 호출은 조건부 return보다 앞에서 무조건.
  const openRow = (rows ?? []).find((r) => r.id === open) ?? null;
  const proofUrls = useSignedTaskProofUrls(openRow?.proof?.url ? [openRow.proof.url] : []);

  async function doCancel(reason: string): Promise<string | null> {
    if (!cancelling) return null;
    const r = await cancelRequestApi(cancelling.id, reason);
    if (!r.ok) return r.error;
    setCancelling(null); show('취소했어요');
    await load();
    return null;
  }
  // 처리 창은 닫힐 때 항상 다시 읽는다 — 409(그 사이 바뀜)로 닫아도 표가 지금 값을 보이게
  const closeReconcile = () => { setMatching(null); setKeeping(null); void load(); };

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!rows) return <p className="text-ui text-x-muted">불러오는 중…</p>;
  return (
    <section>
      {/* 제목 줄 — 필터는 오른쪽(스펙 §8-8, 요청 내역·검토 대기 같은 모양) */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold">요청 내역 {filtered.length}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className={SEL} value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value, campaignId: '' })} aria-label="클라이언트">
            <option value="">클라이언트 전체</option>{clients.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}
          </select>
          <select className={SEL} value={filter.campaignId} onChange={(e) => setFilter({ ...filter, campaignId: e.target.value })} aria-label="캠페인">
            <option value="">캠페인 전체</option>{campaigns.map(([id, nm]) => <option key={id} value={id}>{nm}</option>)}
          </select>
          <select className={SEL} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as StatusGroup })} aria-label="상태">
            {STATUS_GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-ui text-x-secondary">기간
            <input type="date" className={SEL} value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} aria-label="시작일" />
            ~
            <input type="date" className={SEL} value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} aria-label="종료일" />
          </label>
        </div>
      </div>
      {n > 0 && (filter.status !== 'paid_diff' || mismatchedVisible < n) && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-ui text-amber-700">
          정산팀 지급 금액이 작업 금액과 다른 건이 {n}건 있어요 — 표에서 어느 쪽이 맞는지 정해 주세요.
          <button type="button" className="underline" onClick={() => setFilter({ ...NO_FILTER, status: 'paid_diff' })}>
            {otherFiltersOn ? `필터를 풀고 그 ${n}건 보기` : `그 ${n}건만 보기`}
          </button>
        </p>
      )}
      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">
          {rows.length === 0 ? '아직 만든 요청이 없어요 — 검토 대기에서 골라 만들어요' : '조건에 맞는 요청이 없어요'}
        </p>
      ) : (
        // 표 — 캠페인별로 묶고 클라이언트·캠페인 이름은 묶음 머리에 한 번만(koo 09-28 '한눈에'). 칸마다 값 하나.
        <div className="mt-3 overflow-x-auto rounded-xl border border-x-border bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={HEAD}>인플루언서</th><th className={HEAD}>유형</th>
                <th className={`${HEAD} text-right`}>작업 금액</th><th className={`${HEAD} text-right`}>송금액</th>
                <th className={`${HEAD} border-l text-right`}>정산팀 지급</th><th className={`${HEAD} text-right`}>차이</th>
                <th className={HEAD}>결제 수단</th><th className={HEAD}>상태 · 처리</th><th className={HEAD} aria-label="펼치기" />
              </tr>
            </thead>
            {groupByCampaign(filtered).map((g) => (
              <tbody key={g.key}>
                <tr><td colSpan={COLS} className={GROUP}>
                  <b className="font-semibold text-x-text">{g.campaignName}</b>
                  <span className="text-x-muted"> · {g.clientName} · {g.rows.length}건</span>
                </td></tr>
                {g.rows.map((r) => (
                  <RequestRow key={r.id} r={r} open={open === r.id} proofSignedUrl={r.proof ? proofUrls[r.proof.url] ?? null : null} revisionEnabled={revisionEnabled}
                              onToggle={() => setOpen(open === r.id ? null : r.id)} onCancel={() => setCancelling(r)} onRevise={() => setRevising(r)}
                              onMatch={() => setMatching(r)} onKeep={() => setKeeping(r)} onChanged={() => void load()} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {cancelling && <CancelDialog target={cancelling} onConfirm={doCancel} onClose={() => setCancelling(null)} />}
      {revising && <ReviseDialog target={revising} onClose={() => setRevising(null)}
                                 onDone={(row) => { setRevising(null); show(`${row.revision + 1}판으로 반영했어요 — 정산팀이 다시 검토해요`); void load(); }} />}
      {matching && <MatchDialog target={matching} onDone={closeReconcile} onClose={closeReconcile} />}
      {keeping && <KeepDialog target={keeping} onDone={closeReconcile} onClose={closeReconcile} />}
    </section>
  );
}
```

- [ ] **Step 6: 타입·린트·화면 확인**

Run: `npx tsc --noEmit -p .` → 0
Run: `npx eslint src/app/settlement/RequestList.tsx src/app/settlement/RequestRow.tsx src/app/settlement/MatchDialog.tsx src/app/settlement/KeepDialog.tsx src/app/settlement/reconcileParts.tsx` → 0
화면 확인(메모리 cb-x-deck-local-dev-broken·verification-loop): 로그인이 OAuth 게이팅이라 에이전트는 화면을 못 본다 — `npx next build && npx next start -p 3001` 후 `http://127.0.0.1:3001/settlement?tab=requests`는 koo가 Task 12 뒤 연습용 데이터로 확인한다. 여기서는 빌드 오류가 없는지만 본다(빌드는 Task 12에서 한 번에).

- [ ] **Step 7: 커밋**

```bash
git add src/app/settlement/RequestList.tsx src/app/settlement/RequestRow.tsx src/app/settlement/MatchDialog.tsx src/app/settlement/KeepDialog.tsx src/app/settlement/reconcileParts.tsx
git commit -m "feat(settlement-diff): 요청 내역 — 상단 안내·작업 금액/정산팀 지급/차이 열·[그대로 두기][지급 금액에 맞추기]·두 창

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 펼침 두 블록·처리 기록·이력 한 모양 + 옛 차액 확인 정리

**Files:**
- Create: `src/components/ChangeEntry.tsx`, `src/lib/taskChangeView.ts`, `src/app/settlement/ReconcileRecord.tsx`
- Modify: `src/app/settlement/RequestRow.tsx` (펼침 블록 교체·import 정리)
- Modify: `src/app/settlement/PartnerResultBlock.tsx` (전체 교체)
- Modify: `src/app/settlement/RevisionHistory.tsx` (전체 교체)
- Modify (옛 정리): `src/lib/settlementDisplay.ts`, `src/lib/settlementStore.ts`, `src/app/api/settlement/requests/[id]/route.ts`, `src/lib/settlementApi.ts`
- Test: `src/lib/taskChangeView.test.ts` (새, 순수)

**Interfaces:**
- Consumes: `PaymentRequestRow.diffAck*`(Task 4), `undoKeepTaskCostApi`(Task 5), `paidFxRateText`·`partnerNameLabel`(Task 2), `TaskChangeSource`(Task 4)
- Produces:
```ts
// src/components/ChangeEntry.tsx — 이력 한 행(시각·사람 / 전→후 / 출처 / 사유) — 개정 이력과 작업 금액 변경 이력이 같은 모양
export function ChangeEntry(p: { at: string; by: string; change: ReactNode; source?: string; reason?: string | null; children?: ReactNode }): JSX.Element;
// src/lib/taskChangeView.ts
export const TASK_CHANGE_SOURCE_TEXT: Record<TaskChangeSource, string>;
export const costText: (c: TaskCost | null) => string;
// src/app/settlement/ReconcileRecord.tsx
export function ReconcileRecord(p: { r: PaymentRequestRow; onChanged: () => void }): JSX.Element | null;
// PartnerResultBlock props: { r } (onChanged 없음)
```
- 지우는 것: `payoutDiff`·`PayoutDiff`·`fxDiffKrw`·`hasPaidDiff`·`needsDiffAck`(settlementDisplay), `ackDiff`·`unackDiff`(settlementStore), 라우트 `ack-diff`/`unack-diff`, `ackDiffApi`·`unackDiffApi`.

- [ ] **Step 1: 실패하는 순수 테스트**

`src/lib/taskChangeView.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_CHANGE_SOURCE_TEXT, costText } from './taskChangeView.ts';

test('이력 출처 문장 — 스펙 §9 그대로', () => {
  assert.deepEqual(TASK_CHANGE_SOURCE_TEXT, {
    settlement: '정산 화면에서 정산팀 지급 금액에 맞췄어요',
    campaign: '캠페인 화면에서 고쳤어요',
    replace: '인플루언서를 바꾸면서 고쳤어요',
  });
});
test('costText — 금액 없으면 —', () => {
  assert.equal(costText({ amount: 6000, currency: 'JPY' }), '6,000엔');
  assert.equal(costText(null), '—');
});
```
Run: `node --import tsx --test src/lib/taskChangeView.test.ts` → FAIL(모듈 없음).

- [ ] **Step 2: 공용 조각**

`src/lib/taskChangeView.ts`:

```ts
// 작업 금액 변경 이력 표시(스펙 2026-10-07 §9 '이력 행'·'이력 출처 문장') — 작업 패널과 정산 화면이 같은 문장을 쓴다. 순수 모듈.
import { formatMoney } from './influencerPricing.ts';
import type { TaskCost } from './campaignCost.ts';
import type { TaskChangeSource } from './campaignTaskStore.ts';

export const TASK_CHANGE_SOURCE_TEXT: Record<TaskChangeSource, string> = {
  settlement: '정산 화면에서 정산팀 지급 금액에 맞췄어요',
  campaign: '캠페인 화면에서 고쳤어요',
  replace: '인플루언서를 바꾸면서 고쳤어요',
};
export const costText = (c: TaskCost | null): string => (c ? formatMoney(c.amount, c.currency) : '—');
```

`src/components/ChangeEntry.tsx`:

```tsx
import type { ReactNode } from 'react';
import { kstMonthDayTimeKo } from '@/lib/datetime';

// 이력 한 행(스펙 2026-10-07 §8-6·§9) — `{M월 D일 HH:mm} · {이름}` / `{전} → {후}` / 출처 문장 / `사유: {사유}`.
// 작업 금액 변경 이력(작업 패널)과 정산 요청 개정 이력이 같은 모양을 쓴다 — 같은 종류의 기록이 화면마다 다르게 보이지 않게.
export function ChangeEntry({ at, by, change, source, reason, children }: { at: string; by: string; change: ReactNode; source?: string; reason?: string | null; children?: ReactNode }) {
  return (
    <li className="py-2">
      <p className="text-ui text-x-muted">{kstMonthDayTimeKo(at)} · {by}</p>
      <p className="text-content tabular-nums">{change}</p>
      {source && <p className="text-ui text-x-secondary">{source}</p>}
      {reason && <p className="text-ui text-x-secondary">사유: {reason}</p>}
      {children}
    </li>
  );
}
```

Run: `node --import tsx --test src/lib/taskChangeView.test.ts` → PASS.

- [ ] **Step 3: 처리 기록 블록**

`src/app/settlement/ReconcileRecord.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { kstMonthDayTimeKo } from '@/lib/datetime';
import { costText } from '@/lib/taskChangeView';
import { undoKeepTaskCostApi } from '@/lib/settlementApi';

// 펼침의 '처리 기록'(스펙 2026-10-07 §8-6·§9) — 맞춤 / 그대로 둠(+처리 취소) / 옛 확인. 처리 기록이 없으면 그리지 않는다.
export function ReconcileRecord({ r, onChanged }: { r: PaymentRequestRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!r.diffAckAt) return null;
  const by = r.diffAckByName ?? '';
  const at = kstMonthDayTimeKo(r.diffAckAt);
  const fromNote = !!r.diffAckReason && !!r.externalNote && r.diffAckReason.trim() === r.externalNote.trim();

  async function undo() {
    setBusy(true); setErr('');
    const res = await undoKeepTaskCostApi(r.id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onChanged();
  }

  return (
    <section className="mt-4 border-t border-x-border pt-3">
      <h3 className="text-ui font-semibold">처리 기록</h3>
      {r.diffAckKind === 'matched' && (
        <div className="mt-1.5">
          <p className="tabular-nums">작업 금액을 {costText(r.diffAckBeforeCost)} → {costText(r.diffAckTaskCost)}로 바꿨어요 · {by} · {at}</p>
          {r.diffAckReason && <p className="text-x-secondary">사유: {r.diffAckReason}{fromNote ? ' (정산팀 메모)' : ''}</p>}
        </div>
      )}
      {r.diffAckKind === 'kept' && (
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <div>
            <p className="tabular-nums">작업 금액 {costText(r.diffAckTaskCost)} 그대로 두기로 했어요 · {by} · {at}</p>
            {r.diffAckReason && <p className="text-x-secondary">사유: {r.diffAckReason}</p>}
          </div>
          <Button onClick={() => void undo()} disabled={busy}>처리 취소</Button>
        </div>
      )}
      {r.diffAckKind === null && <p className="mt-1.5 text-x-secondary">확인함 · {by} · {at}</p>}
      {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
    </section>
  );
}
```

- [ ] **Step 4: 정산팀이 보낸 결과 블록**

`src/app/settlement/PartnerResultBlock.tsx` 전체 교체:

```tsx
'use client';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { formatMoney } from '@/lib/influencerPricing';
import { kstDateTime } from '@/lib/datetime';
import { EXTERNAL_STATUS_LABEL, usdText, paidFxRateText } from '@/lib/settlementDisplay';

// 펼침의 오른쪽 블록 — '정산팀이 보낸 결과'(스펙 2026-10-07 §8-6). 왼쪽 '우리가 보낸 요청'과 나란히 두어 어느 값이 누구 것인지 헷갈리지 않게.
// 처리 상태 라벨은 settlementDisplay.ts가 유일한 출처. 빈 값은 '—' 하나(§8-7). 판정·처리는 표와 '처리 기록' 블록이 맡는다.
export function PartnerResultBlock({ r }: { r: PaymentRequestRow }) {
  // "정산팀은 보냈다는데 우리 화면엔 없다" 조사가 시작되는 지점 — 호출 기록 링크는 결과가 없을 때도 보인다
  const logLink = (
    <a href={`/settlement?tab=log&request=${r.id}`} className="mt-3 inline-block text-ui text-x-blue-text hover:underline">
      이 요청의 호출 기록 보기 →
    </a>
  );
  const dash = <span className="text-x-muted">—</span>;

  if (!r.externalStatus) {
    return (
      <section>
        <h3 className="text-ui font-semibold">정산팀이 보낸 결과</h3>
        <p className="mt-2 text-ui text-x-muted">아직 정산팀이 확인 전이에요</p>
        {logLink}
      </section>
    );
  }
  const fx = paidFxRateText(r);
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h3 className="text-ui font-semibold">정산팀이 보낸 결과</h3>
        <span className="text-ui text-x-muted">{kstDateTime(r.externalUpdatedAt)} 받음</span>
      </div>
      <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-x-secondary">처리 상태</dt>
        <dd>{EXTERNAL_STATUS_LABEL[r.externalStatus]}</dd>

        {/* 사람이 실행한 전이에만 담당자가 실려 온다(09-04). 자동 전이면 없다 — 줄을 그리지 않는다 */}
        {r.externalOperatorName && <>
          <dt className="text-x-secondary">처리한 사람</dt>
          <dd>{r.externalOperatorName} <span className="text-x-muted">· 정산팀 담당자</span></dd>
        </>}

        {r.paidAmountKrw !== null && <>
          <dt className="text-x-secondary">실지급액</dt>
          <dd>
            <div className="font-medium tabular-nums">{formatMoney(r.paidAmountKrw, 'KRW')}</div>
            {r.paidAmountUsd !== null && <div className="text-x-secondary">달러 {usdText(r.paidAmountUsd)}로 송금됨 <span className="text-x-muted">· 원화는 정산팀 환산값</span></div>}
            {r.paidAmountJpy !== null && <div className="text-x-secondary">엔화 {formatMoney(r.paidAmountJpy, 'JPY')}로 송금됨 <span className="text-x-muted">· 원화는 정산팀 환산값</span></div>}
            {/* 표에서 뺀 환율 정보는 여기서만(§8-4) */}
            {fx && <div className="text-x-muted tabular-nums">{fx}</div>}
          </dd>
        </>}

        {r.paidAt && <><dt className="text-x-secondary">지급 시각</dt><dd>{kstDateTime(r.paidAt)}</dd></>}

        <dt className="text-x-secondary">메모</dt>
        <dd>{r.externalNote ?? dash}</dd>

        <dt className="text-x-secondary">정산팀 건 번호</dt>
        <dd>{r.externalId ?? dash}</dd>
      </dl>
      {logLink}
    </section>
  );
}
```

- [ ] **Step 5: 개정 이력 — 같은 모양**

`src/app/settlement/RevisionHistory.tsx` 전체 교체:

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { PaymentRequestRow, RevisionHistoryRow } from '@/lib/settlementStore';
import { fetchRevisions } from '@/lib/settlementApi';
import { formatMoney } from '@/lib/influencerPricing';
import { ChangeEntry } from '@/components/ChangeEntry';

// 개정 이력 블록(스펙 2026-09-07 §6) — 고친 요청에만. 모양은 작업 금액 변경 이력과 같다(시각·사람 / 전→후 / 사유, 스펙 2026-10-07 §8-6).
export function RevisionHistory({ r }: { r: PaymentRequestRow }) {
  const [rows, setRows] = useState<RevisionHistoryRow[] | null>(null);
  useEffect(() => {
    if (r.revision === 0) return;
    let on = true;
    void fetchRevisions(r.id).then((x) => { if (on && x.ok) setRows(x.data.revisions); });
    return () => { on = false; };
  }, [r.id, r.revision]);
  if (r.revision === 0) return null;
  return (
    <section className="mt-4 border-t border-x-border pt-3">
      <h3 className="text-ui font-semibold">개정 이력 <span className="font-normal text-x-muted">· 지금은 {r.revision + 1}판</span></h3>
      {!rows ? <p className="mt-1 text-ui text-x-muted">불러오는 중…</p> : (
        <ol className="mt-1 divide-y divide-x-border/60">
          {rows.map((h, i) => {
            const next = rows[i + 1]?.snapshot ?? r;   // 다음 판 = 이력의 다음 행, 마지막이면 지금 요청
            return (
              <ChangeEntry key={h.revision} at={h.createdAt} by={h.revisedByName} reason={h.reason}
                           change={`${h.revision + 1}판 ${formatMoney(h.snapshot.amountGross, h.snapshot.payoutCurrency)} → ${h.revision + 2}판 ${formatMoney(next.amountGross, next.payoutCurrency)}`}>
                {h.partnerConfirmed && <p className="text-ui text-x-muted">정산팀 확인 후</p>}
                {h.snapshot.externalNote && <p className="text-ui text-x-muted">정산팀 메모 “{h.snapshot.externalNote}”{h.snapshot.externalOperatorName ? `(${h.snapshot.externalOperatorName})` : ''}</p>}
              </ChangeEntry>
            );
          })}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 6: 요청 행 펼침 — 두 블록**

`src/app/settlement/RequestRow.tsx`:
(a) import에 추가: `import { ReconcileRecord } from './ReconcileRecord';` 그리고 `import { displayStatus, TONE_CLASS, taskPaidMismatch, requestCostOf, usdText } from '@/lib/settlementDisplay';` → `import { displayStatus, TONE_CLASS, taskPaidMismatch, requestCostOf, usdText, partnerNameLabel } from '@/lib/settlementDisplay';`

(b) `{open && (` 부터 그 블록의 닫는 `)}`(`{zoom && proofSignedUrl && <ImageLightbox …/>}` 다음 `</td></tr>` 뒤)까지를 교체:

```tsx
      {open && (
        <tr><td colSpan={9} className="px-4 pb-4">
        <div className="rounded-xl bg-x-surface p-4 text-ui">
          {/* 좌우 두 블록(스펙 2026-10-07 §8-6) — 요청자·클리닉은 표·묶음 머리와 겹쳐 뺐다 */}
          <div className="grid gap-6 md:grid-cols-2">
            <section>
              <h3 className="text-ui font-semibold">우리가 보낸 요청</h3>
              <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5">
                <Item k="분류" v={r.category} sub={r.categoryDefault && r.categoryDefault !== r.category ? `미리 채운 값: ${r.categoryDefault}` : undefined} />
                {/* 금액은 통화별로 줄을 나눈다(koo 09-01). '원화' 줄은 엔화로 보낼 때만 */}
                <Item k="송금액" v={formatMoney(r.amountGross, r.payoutCurrency)}
                      sub={r.feeAmount > 0 ? `순액 ${formatMoney(r.amountNet, r.payoutCurrency)} + 송금 수수료 ${formatMoney(r.feeAmount, r.payoutCurrency)}` : undefined} />
                {r.payoutCurrency === 'JPY' && (
                  <Item k="원화"
                        v={r.grossKrw !== r.amountKrw ? `실지출 ${formatMoney(r.grossKrw, 'KRW')}` : formatMoney(r.amountKrw, 'KRW')}
                        sub={[
                          r.grossKrw !== r.amountKrw ? `단가 ${formatMoney(r.amountKrw, 'KRW')} + 송금 수수료 ${formatMoney(r.grossKrw - r.amountKrw, 'KRW')}` : null,
                          `환율 ${r.rateKrwPerJpy}원 = 1엔`,
                        ].filter(Boolean).join(' · ')} />
                )}
                <Item k="데드라인" v={r.deadlineOn} />
                {/* 정산팀이 이번 건의 수취 정보를 고친 경우(056·057) — 이 요청과 인플루언서 명부에 함께 반영된다 */}
                <Item k="결제수단" v={describeSnapshot(r.paymentMethod)}
                      sub={(r.paymentMethodCorrection || r.paymentMethod.qr)
                        ? <>
                            {r.paymentMethodCorrection && (
                              <span className="text-x-secondary">정산팀이 수취 정보를 고쳤어요 · {r.paymentMethodCorrection.byName} · {new Date(r.paymentMethodCorrection.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}{r.paymentMethodCorrection.reason ? <> — {r.paymentMethodCorrection.reason}</> : null}
                                <span className="block text-x-muted">이 요청과 인플루언서 명부에 함께 반영됐어요</span></span>
                            )}
                            {r.paymentMethod.qr && (
                              <div className={r.paymentMethodCorrection ? 'mt-1.5' : undefined}>
                                <QrPreviewCell path={r.paymentMethod.qr} />
                              </div>
                            )}
                          </>
                        : undefined} />
                <Item k="참고자료" v={r.referenceUrl ? <a href={r.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline break-all">{r.referenceUrl}</a> : '—'}
                      sub={r.referenceUrl && r.taskType !== 'rt' ? '이 링크가 정산팀 확인 자료예요' : undefined} />
                {/* 증빙이 필요 없는 유형엔 줄 자체를 안 그린다(리뷰 수정 4) */}
                {(r.taskType === 'rt' || r.proof) && (
                  <Item k="증빙" v={r.proof
                    ? (proofSignedUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={proofSignedUrl} alt="증빙 스크린샷" onClick={() => setZoom(true)}
                             className="h-16 w-16 cursor-zoom-in rounded border border-x-border object-cover" />
                      : '있음')
                    : '—'} sub={<>{r.proof ? proofUploadedLine(r.proof.byName, r.proof.at) : null}
                                  <div className="text-x-muted">
                                    {r.taskType === 'rt'
                                      ? (r.proof ? '정산팀도 이 증빙을 봐요' : '증빙을 올리면 정산팀에도 자동으로 전달돼요')
                                      : '정산에는 안 보내요 (우리 보관용)'}
                                  </div></>} />
                )}
                <Item k="메모" v={r.note || '—'} />
              </dl>
              {/* 항목·목적은 정산팀에 나간 문구라 확인할 일이 있어 맨 아래 흐린 글씨로 남긴다(§8-6) */}
              <p className="mt-2 text-x-muted">{r.itemText} · {r.purposeText}</p>
            </section>
            <PartnerResultBlock r={r} />
          </div>
          <ReconcileRecord r={r} onChanged={onChanged} />
          <RevisionHistory r={r} />
          <div className="mt-3 flex items-center justify-between gap-3 text-x-muted">
            <span>만든 사람 {r.requesterName} · {new Date(r.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              {cancelled && <> · <span className="text-x-secondary">취소 · {partnerNameLabel(r.cancelledByName)} · {r.cancelledAt ? new Date(r.cancelledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''} · {r.cancelReason}</span></>}
            </span>
            {!cancelled && (paid
              ? <span className="text-x-secondary">지급 완료된 요청은 취소·수정할 수 없어요 — 정산팀에 알려 주세요</span>
              : (
                <span className="flex items-center gap-2">
                  {revisionEnabled && <Button onClick={onRevise} title="프로필·캠페인에서 고친 값을 이 요청에 반영해요 — 정산팀에는 같은 건의 수정으로 전달돼요">고친 값으로 다시 반영</Button>}
                  <Button onClick={onCancel}>취소</Button>
                </span>
              ))}
          </div>
        </div>
        {zoom && proofSignedUrl && <ImageLightbox urls={[proofSignedUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
        </td></tr>
      )}
```

- [ ] **Step 7: 옛 차액 확인 정리**

이제 아무도 쓰지 않는다 — `grep -rn "payoutDiff\|fxDiffKrw\|hasPaidDiff\|needsDiffAck\|ackDiff\|unackDiff\|ack-diff" src`로 남은 사용처가 아래 정의뿐인지 먼저 확인.
- `src/lib/settlementDisplay.ts`: `// 차액 = 그쪽 실지급액 − …` 주석부터 `needsDiffAck` 함수 끝까지(`PayoutDiff`·`payoutDiff`·`fxDiffKrw`·`hasPaidDiff`·`needsDiffAck`)를 지운다.
- `src/lib/settlementStore.ts`: `// 차액 확인 — 우리 내부 표시다. …` 주석부터 `unackDiff` 함수 끝까지 지우고, import `hasPaidDiff, needsPartnerConfirm, taskPaidMismatch, type DiffAckKind` → `needsPartnerConfirm, taskPaidMismatch, type DiffAckKind`.
- `src/app/api/settlement/requests/[id]/route.ts`: `if (body.action === 'ack-diff' || body.action === 'unack-diff') { … }` 블록을 지우고 import에서 `ackDiff, unackDiff, `를 뺀다.
- `src/lib/settlementApi.ts`: `ackDiffApi`·`unackDiffApi` 두 줄을 지운다.

- [ ] **Step 8: 테스트·타입·린트**

Run: `node --import tsx --test src/lib/taskChangeView.test.ts src/lib/settlementDisplay.test.ts src/lib/settlementMismatch.test.ts`
Expected: PASS.
Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/settlementStore.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p .` → 0
Run: `npx eslint src/components/ChangeEntry.tsx src/lib/taskChangeView.ts src/lib/taskChangeView.test.ts src/app/settlement/ReconcileRecord.tsx src/app/settlement/PartnerResultBlock.tsx src/app/settlement/RevisionHistory.tsx src/app/settlement/RequestRow.tsx src/lib/settlementDisplay.ts src/lib/settlementStore.ts "src/app/api/settlement/requests/[id]/route.ts" src/lib/settlementApi.ts` → 0

- [ ] **Step 9: 커밋**

```bash
git add src/components/ChangeEntry.tsx src/lib/taskChangeView.ts src/lib/taskChangeView.test.ts src/app/settlement/ReconcileRecord.tsx src/app/settlement/PartnerResultBlock.tsx src/app/settlement/RevisionHistory.tsx src/app/settlement/RequestRow.tsx src/lib/settlementDisplay.ts src/lib/settlementStore.ts "src/app/api/settlement/requests/[id]/route.ts" src/lib/settlementApi.ts
git commit -m "feat(settlement-diff): 펼침 두 블록·처리 기록·이력 한 모양, 옛 차액 확인 정리

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 작업 패널 — 사유 칸·지급 전 요청 안내·변경 이력

**Files:**
- Modify: `src/app/campaigns/flow/CostConfirmField.tsx`
- Modify: `src/app/campaigns/useCampaignTaskActions.ts`
- Modify: `src/app/campaigns/flow/FlowDetail.tsx` (import·`slots.cost`)
- Create: `src/app/campaigns/flow/panel/TaskCostHistory.tsx`

**Interfaces:**
- Consumes: `isPaidBadge`·`pendingRequestCost`(Task 2), `PAID_COST_REASON_MESSAGE`·`COST_REASON_MAX`(Task 5·6), `fetchTaskChangesApi`·`TaskPatchRequest.costReason`(Task 6), `TaskRow.costChangeCount`(Task 6), `ChangeEntry`·`TASK_CHANGE_SOURCE_TEXT`·`costText`(Task 8), `SettlementBadge` 확장(Task 4)
- Produces:
```ts
// CostConfirmField props: reasonRequired?: boolean; onSave: (cost: TaskCost, reason?: string) => Promise<boolean>
// useCampaignTaskActions().changeCost(t, next, reason?: string)
export function TaskCostHistory(p: { campaignId: string; taskId: string; count: number }): JSX.Element | null;
```

- [ ] **Step 1: 금액 칸에 사유**

`src/app/campaigns/flow/CostConfirmField.tsx`:
(a) import 추가(`import { Button } from '@/components/ui';` 다음):

```ts
import { PAID_COST_REASON_MESSAGE, COST_REASON_MAX } from '@/lib/campaignTaskInput';
```

(b) 함수 시그니처의 구조 분해에 `reasonRequired = false,` 를 `error: externalError,` 다음에 더하고, props 타입에서
`  onSave: (cost: TaskCost) => Promise<boolean>;` → `  onSave: (cost: TaskCost, reason?: string) => Promise<boolean>;   // reason — 지급 완료 작업의 '바꾸는 이유'(스펙 2026-10-07 §6)`
그리고 `error?: string | null; …` 줄 다음에 추가:

```ts
  reasonRequired?: boolean;               // 지급이 끝난 정산 요청이 붙은 작업 — 금액을 바꾸려면 사유를 적어야 저장(서버도 400)
```

(c) `const [dialog, setDialog] = useState<…>(null);` 다음에 추가:

```ts
  const [reason, setReason] = useState('');   // 바꾸는 이유 — reasonRequired일 때만 쓴다
```

(d) `confirm()` 안의 

```ts
    if (entered === null) { setErr(AMOUNT_MESSAGE); return; }
    setErr(null);
    setBusy(true);
    const ok = await onSave(entered);
    setBusy(false);
    if (!ok) return;   // 저장 실패 — 값은 그대로 미확정, 부모가 이미 오류를 토스트로 알린다
    setNote('');
```
를 교체:

```ts
    if (entered === null) { setErr(AMOUNT_MESSAGE); return; }
    if (reasonRequired && !reason.trim()) { setErr(PAID_COST_REASON_MESSAGE); return; }
    setErr(null);
    setBusy(true);
    const ok = await onSave(entered, reasonRequired ? reason.trim() : undefined);
    setBusy(false);
    if (!ok) return;   // 저장 실패 — 값은 그대로 미확정, 부모가 이미 오류를 토스트로 알린다
    setNote('');
    setReason('');
```

(e) 확인 버튼의 `disabled={parsed === null || busy}` → `disabled={parsed === null || busy || (reasonRequired && !reason.trim())}`

(f) 마지막 return의 `{(err ?? externalError) && <p role="alert" …>…</p>}` 줄 **바로 앞**에 추가(바꾸는 중일 때만 — 저장된 값 그대로면 열지 않는다):

```tsx
      {reasonRequired && mode === 'confirm' && !saved && entered !== null && (
        <div className="mt-1.5">
          <p className="text-ui text-amber-700">지급이 끝난 작업이라 사유를 적어야 저장돼요</p>
          <label className="mt-1.5 block text-ui text-x-secondary">바꾸는 이유
            <input value={reason} maxLength={COST_REASON_MAX}
                   onChange={(e) => { setReason(e.target.value); setErr(null); }}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void confirm(); }}
                   className="mt-1 h-10 w-full rounded-md border border-x-border-strong px-3 text-content outline-none focus:border-x-blue" />
          </label>
        </div>
      )}
```

- [ ] **Step 2: 동작 훅**

`src/app/campaigns/useCampaignTaskActions.ts`의 `changeCost` 교체:

```ts
    // reason — 지급이 끝난 작업의 '바꾸는 이유'(스펙 2026-10-07 §6). 서버가 이력(task_change)에 남기고, 없으면 400으로 막는다.
    // 이전 캠페인 화면(TaskTable의 CostPopover)은 사유 칸이 없어 지급 완료 작업이면 서버 문구가 토스트로 뜬다(보관 화면이라 둔다).
    changeCost: async (t: Item, next: TaskCost | null, reason?: string) => {
      const ok = await patch(t, { cost: next, ...(reason ? { costReason: reason } : {}) }, { cost: next });
      if (ok) onChanged();   // 합계가 목록 보조줄에도 실린다
      return ok;
    },
```

- [ ] **Step 3: 변경 이력 펼침**

`src/app/campaigns/flow/panel/TaskCostHistory.tsx`:

```tsx
'use client';
import { useState } from 'react';
import type { TaskChangeRow } from '@/lib/campaignTaskStore';
import { fetchTaskChangesApi } from '@/lib/campaignApi';
import { ChangeEntry } from '@/components/ChangeEntry';
import { TASK_CHANGE_SOURCE_TEXT, costText } from '@/lib/taskChangeView';

// 작업 패널 금액 옆 `변경 이력 N`(스펙 2026-10-07 §6·§9) — 0이면 숨김. 펼칠 때 읽는다(부모가 key에 N을 넣어 수가 바뀌면 다시 읽게 한다).
export function TaskCostHistory({ campaignId, taskId, count }: { campaignId: string; taskId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TaskChangeRow[] | null>(null);
  const [err, setErr] = useState('');
  if (count === 0) return null;

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (rows) return;
    const r = await fetchTaskChangesApi(campaignId, taskId);
    if (r.ok) setRows(r.data.changes); else setErr(r.error);
  }

  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="text-ui text-x-blue-text hover:underline">
        변경 이력 {count} {open ? '▾' : '▸'}
      </button>
      {open && (
        rows ? (
          <ol className="mt-1 divide-y divide-x-border/60">
            {rows.map((c) => (
              <ChangeEntry key={c.id} at={c.createdAt} by={c.byName} change={`${costText(c.before)} → ${costText(c.after)}`}
                           source={TASK_CHANGE_SOURCE_TEXT[c.source]} reason={c.reason || null} />
            ))}
          </ol>
        ) : err ? <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>
          : <p className="mt-1 text-ui text-x-muted">불러오는 중…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: FlowDetail 비용 칸**

`src/app/campaigns/flow/FlowDetail.tsx`:
(a) import 추가(`import { SettledElsewhereLine } from './panel/SettledElsewhereLine';` 다음):

```ts
import Link from 'next/link';
import { TaskCostHistory } from './panel/TaskCostHistory';
import { isPaidBadge, pendingRequestCost } from '@/lib/settlementDisplay';
import { formatAmount } from '@/lib/campaignCost';
```
(`formatAmount`·`Link`가 이미 import돼 있으면 그 줄은 넣지 않는다.)

(b) `slots={{` 안의 `cost: panelTask ? <CostConfirmField … /> : null,` 항목 전체를 교체:

```tsx
                     cost: panelTask
                       ? (() => {
                           // 지급 전 요청이 붙은 작업의 금액을 고쳤으면, 요청은 아직 옛 금액이다 — '고친 값으로 다시 반영'으로 안내(스펙 2026-10-07 §6)
                           const pending = pendingRequestCost(panelTask);
                           return (
                             <div>
                               <CostConfirmField key={panelTask.influencerHandle ?? ''} value={panelTask.cost} option={optionFor(panelTask.influencerHandle)} type={panelTask.type}
                                                 label={panelTask.type === 'visit' ? '예산' : '비용'}
                                                 onSave={(c, reason) => actions.changeCost(panelTask, c, reason)}
                                                 onSaveProfile={(opt, c) => saveProfilePricing(opt, c, panelTask.type)}
                                                 disabledReason={panelTask.influencerHandle ? undefined : ''}
                                                 reasonRequired={isPaidBadge(panelTask.settlement)} />
                               {pending && (
                                 <p className="mt-1.5 text-ui text-amber-700">
                                   정산 요청은 아직 {formatAmount(pending.amount, pending.currency)}이에요 — 정산 화면에서 &apos;고친 값으로 다시 반영&apos;을 눌러 주세요{' '}
                                   <Link href={`/settlement?tab=requests&task=${panelTask.id}`} className="underline">정산 요청 보기</Link>
                                 </p>
                               )}
                               <TaskCostHistory key={`${panelTask.id}:${panelTask.costChangeCount}`} campaignId={id} taskId={panelTask.id} count={panelTask.costChangeCount} />
                             </div>
                           );
                         })()
                       : null,
```
(`id`는 이 컴포넌트의 캠페인 id — 같은 파일의 `campaignId={id}` 사용처와 같은 변수.)

- [ ] **Step 5: 타입·린트**

Run: `npx tsc --noEmit -p .` → 0
Run: `npx eslint src/app/campaigns/flow/CostConfirmField.tsx src/app/campaigns/useCampaignTaskActions.ts src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/flow/panel/TaskCostHistory.tsx` → 0
Run: `node --import tsx --test src/lib/campaignFlowView.test.ts` → PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/campaigns/flow/CostConfirmField.tsx src/app/campaigns/useCampaignTaskActions.ts src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/flow/panel/TaskCostHistory.tsx
git commit -m "feat(settlement-diff): 작업 패널 — 지급 완료 작업은 바꾸는 이유, 지급 전 요청 안내, 변경 이력 N

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: '정산팀' 문구 통일·검토 대기 열 이름·필터 위치

**Files:**
- Modify: `src/app/settlement/SettingsTab.tsx`, `src/lib/settlementSettings.ts`, `src/lib/settlementSettings.test.ts`
- Modify: `src/app/settlement/ReviseDialog.tsx`, `src/app/settlement/ExternalLogTab.tsx`, `src/app/settlement/CandidateTable.tsx`
- Modify: `src/lib/externalLogCopy.ts`, `src/lib/externalApiLog.test.ts`, `src/lib/settlementRevisionCopy.ts`, `src/lib/settlementCalc.ts`
- Modify: `src/app/influencers/Timeline.tsx`, `src/app/influencers/PaymentSection.tsx`, `src/components/PaymentMethodForm.tsx`

**Interfaces:**
- Consumes: 없음(문구만)
- Produces: 사용자 문구에 `정산 쪽`·`정산 프로덕트`·`정산 담당자`·`그쪽`이 남지 않음. 검토 대기 표 `요청액` → `작업 금액`, 두 탭 필터가 제목 줄 오른쪽.
- 바꾸지 않는 것(데이터·연동): `settlementStore.cancelInTx`의 `name: '정산 프로덕트'`·사유 기본값 `'정산에서 취소'` — DB에 저장되고 정산팀 API(`cancelled.by_name`)로 나가는 값이다(`settlementExternal.test.ts`가 단언). 화면은 Task 8의 `partnerNameLabel`로 바꿔 보인다. `src/app/api/campaigns/[id]/route.ts`·`CampaignHeader.tsx`의 "정산에서 취소해 주세요"는 정산 '화면'을 뜻해 그대로.

- [ ] **Step 1: 문구 교체(정확한 전→후)**

| 파일 | 전 | 후 |
|---|---|---|
| `src/app/settlement/SettingsTab.tsx` (2곳: 표 머리 `<th>`, 입력 `aria-label`) | `정산 쪽 이름` | `정산팀에 보내는 이름` |
| `src/lib/settlementSettings.ts` | `'정산 쪽 이름을 입력해 주세요'` | `'정산팀에 보내는 이름을 입력해 주세요'` |
| `src/lib/settlementSettings.test.ts` (28행 단언) | `'정산 쪽 이름을 입력해 주세요'` | `'정산팀에 보내는 이름을 입력해 주세요'` |
| `src/app/settlement/ReviseDialog.tsx` 82행 | `요청 번호와 정산 쪽 건 번호는 그대로이고, 정산 쪽에는 같은 건의 수정으로 전달돼 처음부터 다시 검토해요.` | `요청 번호와 정산팀 건 번호는 그대로이고, 정산팀에는 같은 건의 수정으로 전달돼 처음부터 다시 검토해요.` |
| 같은 파일 121행 | `<p>정산 쪽이 이 요청의 수취 정보를 고쳤어요(` | `<p>정산팀이 이 요청의 수취 정보를 고쳤어요(` |
| 같은 파일 126행 | `<p>정산 쪽이 이미 처리한 요청이에요(` … `<b>슬랙으로 정산 담당자에게 먼저 확인</b>하고` | `<p>정산팀이 이미 처리한 요청이에요(` … `<b>슬랙으로 정산팀에 먼저 확인</b>하고` |
| 같은 파일 129행 | `정산 담당자에게 확인했어요 — 고쳐도 된다고 했어요` | `정산팀에 확인했어요 — 고쳐도 된다고 했어요` |
| `src/app/settlement/ExternalLogTab.tsx` 35행 | `정산 프로덕트가 우리 서버를 호출한 기록이에요.` | `정산팀이 우리 서버를 호출한 기록이에요.` |
| 같은 파일 61행 | `아직 정산 프로덕트가 호출한 기록이 없어요.` | `아직 정산팀이 호출한 기록이 없어요.` |
| 같은 파일 126행 | `k="정산 프로덕트가 보낸 상태"` | `k="정산팀이 보낸 상태"` |
| 같은 파일 127행 | `k="정산 프로덕트가 보낸 내용"` | `k="정산팀이 보낸 내용"` |
| `src/lib/externalLogCopy.ts` 89·158행 | `— 그쪽이 최신 내용으로 다시 보내요` | `— 정산팀이 최신 내용으로 다시 보내요` |
| 같은 파일 92·142행 | `정산 프로덕트에 운영 키를 다시 확인해 달라고 알려 주세요` | `정산팀에 운영 키를 다시 확인해 달라고 알려 주세요` |
| 같은 파일 144행 | `— 그쪽이 최신 아이템 값을 붙여 다시 보내요` | `— 정산팀이 최신 아이템 값을 붙여 다시 보내요` |
| 같은 파일 172행 | `return { label: '정산 프로덕트', kind: 'partner' };` | `return { label: '정산팀', kind: 'partner' };` |
| `src/lib/externalApiLog.test.ts` 68행 | `'API 키가 맞지 않아 거부했어요 — 정산 프로덕트에 운영 키를 다시 확인해 달라고 알려 주세요'` | `'API 키가 맞지 않아 거부했어요 — 정산팀에 운영 키를 다시 확인해 달라고 알려 주세요'` |
| 같은 파일 125·127행 | `test('describeCaller — 그 외(node 등)는 정산 프로덕트로 추정'` / `{ label: '정산 프로덕트', kind: 'partner' }` | `test('describeCaller — 그 외(node 등)는 정산팀으로 추정'` / `{ label: '정산팀', kind: 'partner' }` |
| `src/lib/settlementRevisionCopy.ts` | `'아직 정산 쪽과 전환 전이에요 — …'` / `'… 금액 정정은 정산 쪽에 요청해요'` / `'정산 쪽이 처리한 요청이에요 — 슬랙으로 정산 담당자에게 확인한 뒤 체크하고 반영해 주세요'` | `'아직 정산팀과 전환 전이에요 — …'` / `'… 금액 정정은 정산팀에 요청해요'` / `'정산팀이 처리한 요청이에요 — 슬랙으로 정산팀에 확인한 뒤 체크하고 반영해 주세요'` |
| `src/lib/settlementCalc.ts` `NO_PROOF_ISSUE` | `— 정산 쪽이 지급 전에 확인해요` | `— 정산팀이 지급 전에 확인해요` |
| 같은 파일 `referenceIssue` | `— 정산 쪽이 이 링크로 게시를 확인해요` | `— 정산팀이 이 링크로 게시를 확인해요` |
| 같은 파일 PayPay 이슈 | `… 둘 중 하나가 있어야 정산 쪽이 송금할 수 있어요` | `… 둘 중 하나가 있어야 정산팀이 송금할 수 있어요` |
| `src/app/influencers/Timeline.tsx` 82·88행 | `정산 쪽이 수취 정보 정정` | `정산팀이 수취 정보 정정` |
| 같은 파일 111행 | `` `정산 쪽 수취 정보 정정 ${n}건` `` | `` `정산팀 수취 정보 정정 ${n}건` `` |
| `src/app/influencers/PaymentSection.tsx` 149행 | `'미입력 — 정산 쪽에서 확인되면 적어 두세요'` | `'미입력 — 정산팀에서 확인되면 적어 두세요'` |
| `src/components/PaymentMethodForm.tsx` 132행 | `— 정산 쪽에서 확인되면 그때 채우면 됩니다.` | `— 정산팀에서 확인되면 그때 채우면 됩니다.` |

`src/lib/settlementCalc.ts`의 세 문구는 화면 신호등과 서버 거절(`createRequests`)이 같은 객체를 쓰므로 한 곳 변경으로 둘 다 바뀐다. 테스트가 이 문장을 직접 단언하는지 `grep -rn "정산 쪽이" src --include="*.test.ts"`로 확인(주석만 나와야 한다).

- [ ] **Step 2: 검토 대기 — 열 이름·필터 위치**

`src/app/settlement/CandidateTable.tsx`:
(a) 표 머리 `<th className={`${HEAD} text-right`}>요청액</th>` → `<th className={`${HEAD} text-right`}>작업 금액</th>`

(b) return 안의 첫 `<div className="flex flex-wrap items-center gap-2">`(필터 4개 + 기본 마감 span) 부터 `<h2 className="mt-4 text-[16px] font-semibold">검토 대기 {rows.length}</h2>`까지를 아래로 교체(제목 왼쪽, 필터 오른쪽 — 요청 내역과 같은 모양, 스펙 §8-8):

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold">검토 대기 {rows.length}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className={SEL} value={filter.clientId} onChange={(e) => { setFilter({ ...filter, clientId: e.target.value, campaignId: '' }); setDeepLinkNote(''); }} aria-label="클라이언트">
            <option value="">클라이언트 전체</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className={SEL} value={filter.campaignId} onChange={(e) => { setFilter({ ...filter, campaignId: e.target.value }); setDeepLinkNote(''); }} aria-label="캠페인">
            <option value="">캠페인 전체</option>{campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className={SEL} value={filter.type} onChange={(e) => { setFilter({ ...filter, type: e.target.value as '' | TaskType }); setDeepLinkNote(''); }} aria-label="유형">
            <option value="">유형 전체</option>{TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}
          </select>
          <select className={SEL} value={filter.method} onChange={(e) => { setFilter({ ...filter, method: e.target.value as '' | PaymentMethodType }); setDeepLinkNote(''); }} aria-label="결제 수단">
            <option value="">결제 수단 전체</option>{PAYMENT_TYPES.map((t) => <option key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</option>)}
          </select>
          <span className="text-ui text-x-muted" title="요청한 주의 다음 주 월요일까지. 급한 건은 행에서 마감을 직접 당겨 주세요">기본 마감 {deadlineLabel(rows[0]?.deadlineDefault ?? data.today)} · 다음 주 월요일</span>
        </div>
      </div>
      {deepLinkNote && <p className="mt-2 text-ui text-x-muted">{deepLinkNote}</p>}
```

- [ ] **Step 3: 남은 금지어 확인**

```bash
grep -rnE "정산 쪽|정산 프로덕트|정산 담당자|그쪽" src --include="*.ts" --include="*.tsx" \
  | grep -v "\.test\.ts:" | grep -v "src/content/updates.ts" \
  | grep -vE "^[^:]+:[0-9]+:\s*(//|\*|/\*|\{/\*)" \
  | grep -vE "//.*(정산 쪽|정산 프로덕트|정산 담당자|그쪽)"
```
Expected: 남는 줄은 아래 둘뿐(데이터·연동 값, 위 '바꾸지 않는 것'):
- `src/lib/settlementStore.ts: … cancelInTx(tx, id, { id: null, name: '정산 프로덕트' }, u.note ?? '정산에서 취소');`
- (`그쪽 몫` 같은 줄 끝 주석은 두 번째 grep -v가 걸러낸다.) 다른 줄이 나오면 사용자 문구인지 보고 `정산팀`으로 고친다.

- [ ] **Step 4: 테스트·타입·린트**

Run: `node --import tsx --test src/lib/externalApiLog.test.ts src/lib/settlementSettings.test.ts src/lib/settlementCalc.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p .` → 0
Run: `npx eslint src/app/settlement/SettingsTab.tsx src/lib/settlementSettings.ts src/lib/settlementSettings.test.ts src/app/settlement/ReviseDialog.tsx src/app/settlement/ExternalLogTab.tsx src/app/settlement/CandidateTable.tsx src/lib/externalLogCopy.ts src/lib/externalApiLog.test.ts src/lib/settlementRevisionCopy.ts src/lib/settlementCalc.ts src/app/influencers/Timeline.tsx src/app/influencers/PaymentSection.tsx src/components/PaymentMethodForm.tsx` → 0

- [ ] **Step 5: 커밋**

```bash
git add src/app/settlement/SettingsTab.tsx src/lib/settlementSettings.ts src/lib/settlementSettings.test.ts src/app/settlement/ReviseDialog.tsx src/app/settlement/ExternalLogTab.tsx src/app/settlement/CandidateTable.tsx src/lib/externalLogCopy.ts src/lib/externalApiLog.test.ts src/lib/settlementRevisionCopy.ts src/lib/settlementCalc.ts src/app/influencers/Timeline.tsx src/app/influencers/PaymentSection.tsx src/components/PaymentMethodForm.tsx
git commit -m "chore(settlement-diff): 사용자 문구를 '정산팀'으로 통일, 검토 대기 '작업 금액'·필터를 제목 줄 오른쪽으로

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 업데이트 소식

**Files:**
- Modify: `src/content/updates.ts` (배열 맨 위에 항목 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `/updates`에 개선 1건(날짜 2026-10-08 — 머지 예정일, 실제 머지일이 다르면 그날로 고친다)

- [ ] **Step 1: 항목 추가**

`export const UPDATES: UpdateEntry[] = [` 바로 다음 줄에 추가(스펙 §12 + AGENTS.md "쓰던 방식이 바뀐 것은 반드시 적는다"):

```ts
  {
    date: '2026-10-08', type: '개선',
    title: '정산팀이 다른 금액으로 지급한 건을 정산 화면에서 바로 처리할 수 있어요',
    summary: "작업 금액을 지급 금액에 맞추거나 그대로 두고, 누가 언제 왜 바꿨는지 작업의 '변경 이력'에 남아요. 달러로 지급된 건도 이제 금액이 크게 다르면 알려 줘요.",
    bullets: [
      '정산팀 지급 금액이 작업 금액과 다르면 요청 내역 위에 한 줄 안내가 뜨고, 그 행에 [그대로 두기]·[지급 금액에 맞추기] 버튼이 생겨요',
      '[지급 금액에 맞추기]는 바꿀 금액을 미리 채워 두고(송금 수수료를 뺀 값), 정산팀 메모를 사유로 넣어 둬요. 캠페인 집행액이 얼마나 바뀌는지도 보여요',
      '쓰던 방식이 바뀌었어요: 예전엔 "요청한 송금액과 다르면" 알렸는데, 이제는 "지금 작업 금액과 다르면" 알려요 — 캠페인에서 작업 금액을 고치면 안내가 저절로 사라져요. 예전 [확인함] 버튼은 없어졌어요',
      '쓰던 방식이 바뀌었어요: 지급이 끝난 작업의 금액을 캠페인 화면에서 바꾸려면 바꾸는 이유를 적어야 저장돼요',
      '작업 금액이 바뀔 때마다(캠페인 화면·인플루언서 교체·정산 화면) 작업 패널의 \'변경 이력\'에 남아요. 이전 기록은 없어서 이번부터 쌓여요',
      "정산 화면 문구를 '정산팀'으로 통일하고, 요청 내역 표의 '요청액'을 '작업 금액'으로 바꿨어요(마감 열은 뺐어요). 검토 대기도 '작업 금액'이고, 두 탭 모두 필터가 제목 줄 오른쪽으로 옮겨졌어요",
    ],
    link: { label: '정산', href: '/settlement?tab=requests' },
  },
```

- [ ] **Step 2: 검증·커밋**

Run: `node --import tsx --test src/lib/updates.test.ts` → PASS
Run: `npx eslint src/content/updates.ts` → 0

```bash
git add src/content/updates.ts
git commit -m "docs(updates): 정산팀 지급 금액 ≠ 작업 금액 처리 소식

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 배포 전 확인 — 운영 판정(읽기 전용)·전체 테스트·빌드·문구 감사

**Files:**
- Create: `scripts/check-paid-mismatch.ts`

**Interfaces:**
- Consumes: `taskPaidMismatch`·`MismatchSource`(Task 2), `parseTaskCost`
- Produces: 운영 지급 완료 요청 중 '다름' 목록(예상 0건) — koo에게 보고할 숫자

- [ ] **Step 1: 확인 스크립트**

`scripts/check-paid-mismatch.ts`:

```ts
// 배포 전 확인(스펙 2026-10-07 §10) — 운영 지급 완료 요청에 새 판정(taskPaidMismatch)을 돌려 '다름' 목록을 찍는다.
// 쓰기 없음: read only 트랜잭션 안에서 select 한 번. 065 적용 전 운영에서도 돌도록 065 칸(diff_ack_kind 등)·task_change는 읽지 않는다
// (처리 기록 없이 본 판정 — 지금 운영엔 처리 기록이 없다).
// 실행: node --import tsx --env-file=<env 파일> scripts/check-paid-mismatch.ts
import { getSql } from '../src/lib/db.ts';
import { parseTaskCost, type TaskCost } from '../src/lib/campaignCost.ts';
import { taskPaidMismatch, type MismatchSource } from '../src/lib/settlementDisplay.ts';
import type { PaymentFee } from '../src/lib/influencerPayment.ts';
import { formatMoney } from '../src/lib/influencerPricing.ts';

type Row = {
  id: string; task_id: string | null; influencer_handle: string; campaign_name: string; payout_currency: 'KRW' | 'JPY';
  fee: PaymentFee | null; rate_krw_per_jpy: string | number; paid_amount_krw: number | null; paid_amount_jpy: string | number | null;
  paid_amount_usd: string | number | null; external_note: string | null; task_cost: unknown;
};
const costOf = (v: unknown): TaskCost | null => { const p = parseTaskCost(v ?? null); return p.ok ? p.value : null; };

(async () => {
  const sql = getSql();
  try {
    console.log(`== target: ${process.env.PGHOST ?? '?'}`);
    const rows = await sql.begin('read only', async (tx) => tx<Row[]>`
      select pr.id, pr.task_id, pr.influencer_handle, pr.campaign_name, pr.payout_currency, pr.fee, pr.rate_krw_per_jpy,
             pr.paid_amount_krw, pr.paid_amount_jpy, pr.paid_amount_usd, pr.external_note, t.cost as task_cost
        from payment_request pr left join campaign_task t on t.id = pr.task_id
       where pr.external_status = 'paid' and pr.status <> 'cancelled'
       order by pr.created_at`);
    let hits = 0;
    for (const r of rows) {
      const s: MismatchSource = {
        status: 'requested', externalStatus: 'paid', taskId: r.task_id, taskCost: costOf(r.task_cost),
        payoutCurrency: r.payout_currency, fee: r.fee, rateKrwPerJpy: Number(r.rate_krw_per_jpy),
        paidAmountKrw: r.paid_amount_krw, paidAmountJpy: r.paid_amount_jpy === null ? null : Number(r.paid_amount_jpy),
        diffAckKind: null, diffAckTaskCost: null,
      };
      const m = taskPaidMismatch(s);
      if (!m) continue;
      hits += 1;
      const cost = s.taskCost ? formatMoney(s.taskCost.amount, s.taskCost.currency) : '—';
      const how = m.kind === 'exact' ? `차이 ${m.diff} ${m.currency}` : `비율 ${m.ratio.toFixed(3)} (원화 차이 ${m.diff})`;
      console.log(`@${r.influencer_handle} · ${r.campaign_name} · 작업 ${cost} · 지급 원화 ${r.paid_amount_krw}${r.paid_amount_jpy !== null ? ` / 엔화 ${r.paid_amount_jpy}` : ''}${r.paid_amount_usd !== null ? ` / 달러 ${r.paid_amount_usd}` : ''} · ${how} · 메모 ${r.external_note ?? '—'} · ${r.id}`);
    }
    console.log(`== 지급 완료 ${rows.length}건 중 '다름' ${hits}건`);
  } finally {
    await sql.end();
  }
})();
```

- [ ] **Step 2: 연습용 DB에서 먼저 실행**

Run: `node --import tsx --env-file=.env.staging scripts/check-paid-mismatch.ts`
Expected: 오류 없이 `== 지급 완료 N건 중 '다름' M건`(연습용 데이터라 숫자는 무엇이든 된다 — 실행만 확인).

- [ ] **Step 3: 운영 판정 확인(읽기 전용) — koo에게 알리고 실행**

운영 DB를 **읽기만** 한다(read only 트랜잭션, select 1회). 실행 전에 koo에게 "운영 지급 완료 요청에 새 판정을 읽기 전용으로 돌립니다"라고 알리고 진행한다.
Run: `node --import tsx --env-file=/Users/koo_clinicbridge/cb-x-deck/.env scripts/check-paid-mismatch.ts`
Expected: `== target:`이 운영 호스트, 마지막 줄 `'다름' 0건`(스펙 §4 예상 — 두 실례는 이미 손으로 맞춰져 있다). 0이 아니면 목록을 그대로 koo에게 보고하고 멈춘다(범위 0.80~1.00이 맞는지·작업 금액이 틀렸는지는 koo가 판단).

- [ ] **Step 4: 전체 테스트·타입·린트·빌드**

Run: `npm test` (연습용 DB, 약 17분)
Expected: 전부 PASS.
Run: `npx tsc --noEmit -p .` → 0
Run: `npx eslint $(git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx')` → 0(린트 기준선 24개는 기존 파일의 것 — 변경 파일에서 새로 생긴 것만 0이어야 한다)
Run: `npx next build`
Expected: 성공(NOT `npm run build` — 그건 마이그레이션을 먼저 돌린다).

- [ ] **Step 5: 문구 감사 — §9가 그대로 있는지, 금지어가 없는지**

```bash
for s in \
  '정산팀 지급 금액이 작업 금액과 다른 건이' '표에서 어느 쪽이 맞는지 정해 주세요.' '건만 보기' '필터를 풀고 그 ' \
  '그대로 두기' '지급 금액에 맞추기' '요청 {formatMoney' '지급 완료 · 맞춤' '지급 완료 · 그대로 둠' \
  '작업 금액 바꾸기' '작업 금액 {cur ?' ' → 정산팀 지급 ' '(달러 ' '(엔화 ' '새 작업 금액' \
  '중 송금 수수료' '를 뺀 금액이에요.' '정산팀은 달러 ' '은 정산팀이 바꾼 값이라, 실제로 약속한 금액을 적어 주세요.' \
  '정산팀 메모를 먼저 넣어 뒀어요. 고쳐 써도 돼요.' ' 집행액이 ' '으로 바꾸기' '작업 금액 그대로 두기' \
  '환율·송금 수수료 차이' '추가 지급(별도 합의)' '작업 금액을 ' '로 바꿨어요 · ' ' 그대로 두기로 했어요 · ' \
  '(정산팀 메모)' '처리 취소' '확인함 · ' \
  '그 사이 작업 금액이나 정산팀 지급 금액이 바뀌었어요 — 새로 고친 내용을 확인해 주세요' '변경 이력 ' \
  '정산 화면에서 정산팀 지급 금액에 맞췄어요' '캠페인 화면에서 고쳤어요' '인플루언서를 바꾸면서 고쳤어요' \
  '지급이 끝난 작업이라 사유를 적어야 저장돼요' '바꾸는 이유' '정산 요청은 아직 ' "을 눌러 주세요" '정산 요청 보기' \
  '우리가 보낸 요청' '정산팀이 보낸 결과' '처리 기록' '개정 이력' '사유: ' ; do
  grep -rqF -- "$s" src || echo "MISSING: $s"
done
echo "--- 금지어(사용자 문구) ---"
grep -rnE "정산 쪽|정산 프로덕트|정산 담당자|그쪽" src --include="*.ts" --include="*.tsx" \
  | grep -v "\.test\.ts:" | grep -v "src/content/updates.ts" \
  | grep -vE "^[^:]+:[0-9]+:\s*(//|\*|/\*|\{/\*)" | grep -vE "//.*(정산 쪽|정산 프로덕트|정산 담당자|그쪽)"
```
Expected: `MISSING:` 줄 없음. 금지어 목록은 `settlementStore.ts`의 `cancelInTx(… name: '정산 프로덕트' …, '정산에서 취소')` 한 줄뿐(저장·연동 값 — Task 10 참고).
그리고 §9 표를 열어 화면 코드와 한 줄씩 눈으로 대조한다(템플릿 문자열은 grep 조각으로만 잡힌다): 상단 안내·표 버튼·상태·두 창 제목/부제/비교 줄/안내/버튼·처리 기록 3종·경합 오류·패널 `변경 이력 N`·이력 행·출처 문장·사유 칸·지급 전 안내·펼침 블록 제목.

- [ ] **Step 6: 커밋**

```bash
git add scripts/check-paid-mismatch.ts
git commit -m "chore(settlement-diff): 배포 전 운영 판정 확인 스크립트(읽기 전용)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 보고**

koo에게: 운영 판정 결과(N건 중 '다름' M건 + 목록), 전체 테스트·빌드 결과, 화면 확인 요청(연습용 배포 또는 로컬 `npx next start -p 3001` + `127.0.0.1`) — 확인할 장면: ① 요청 내역 상단 안내·[그 N건만 보기] ② 행 버튼 → 맞추기 창(수수료 안내·집행액 줄) ③ 그대로 두기 창 → 처리 기록·[처리 취소] ④ 작업 패널 `변경 이력 N`·지급 완료 작업의 '바꾸는 이유' ⑤ 지급 전 요청이 있는 작업 금액 수정 후 안내. 머지·배포는 koo QA 후.

---

## 스펙 대응표(자체 점검)

| 스펙 | 태스크 |
|---|---|
| §3-1·§4 판정(작업 금액 vs 지급, 원화/엔화 정확·그 밖 0.80~1.00, 처리 기록 숨김) | 2, 4 |
| §4-4 지급 금액이 바뀌면 다시 표시 | 4(`applyExternalStatus`가 처리 기록 비움) |
| §5-1 맞추기 창(비교 줄·미리 채움·비워 둠·사유·집행액·한 트랜잭션·409) | 3, 4, 5, 7 |
| §5-2 그대로 두기(선택지·메모·기타 필수) | 2, 4, 5, 7 |
| §5-3 처리 취소(kept만) | 4, 5, 8 |
| §6 이력(캠페인·교체·정산), 지급 완료 사유 필수(서버 400), 지급 전 안내, 이력 수정 API 없음, `변경 이력 N` | 4, 6, 9 |
| §7 065 | 1 |
| §8-1 정산팀 통일 | 4(상태 설명), 5(취소 오류), 7(토스트), 8(펼침), 10(나머지) |
| §8-2 라벨(`정산팀이 취소`·`지급 금액 다름`) | 4 |
| §8-3·§8-4 표 열·차이 칸·환율은 펼침에서만 | 7, 8 |
| §8-5 상단 안내 | 7 |
| §8-6 펼침 두 블록·처리 기록·개정 이력 같은 모양 | 8 |
| §8-7 빈 값 `—` | 8 |
| §8-8 필터 위치(두 탭) | 7, 10 |
| §9 문구표 | 7, 8, 9 + 12 감사 |
| §10 테스트·배포 전 운영 판정 | 2, 3, 4, 6, 12 |
| §12 업데이트 소식 | 11 |
