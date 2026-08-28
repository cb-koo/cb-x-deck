# 정산 페이지(payment_request) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게시 확인된 캠페인 작업을 한 화면에서 검토해 여러 건을 결제 요청(`payment_request`)으로 스냅샷 저장하고, 내역 확인·사유 있는 취소·분류/환율 설정까지 되는 `/settlement` 페이지.

**Architecture:** 순수 계산 모듈(`settlementCalc.ts` — 환산·수수료·기본값·신호등)을 화면·확인 창·서버 저장이 공유한다. 후보는 저장하지 않고 SQL로 계산(`campaign_task` ⋈ `campaign` ⋈ `influencer.payment_methods` ⋈ 활성 요청 없음). 일괄 생성은 "전부 재계산·검증 → 하나라도 실패면 0건 저장(409 건별 이유) → 전부 통과면 한 트랜잭션 저장 + 인플 활동 기록". 설정은 `prompt_template_version`처럼 jsonb 버전 행. 캠페인 모듈은 읽기 + 배지 한 줄 + 삭제 보호만.

**Tech Stack:** Next.js(App Router, `node_modules/next/dist/docs/` 참고) · TypeScript · postgres.js(`getSql()`) · node:test(`node --import tsx --test`) · Tailwind 유틸(`text-ui` `text-x-muted` `text-x-secondary` `border-x-border` `bg-x-bg` `PANEL`) · `Button`(`@/components/ui`) · `useToast().show`.

**Spec:** `docs/superpowers/specs/2026-08-28-settlement-page-design.md` — 절 번호(§)는 이 문서를 가리킨다.

## Global Constraints

- 마이그레이션 번호 **040**. 모든 문장 멱등(`if not exists`, `drop constraint if exists` + `add`). 적용은 `bash scripts/apply-migrations.sh`(전 파일 재실행) — `.env`가 프로덕션이므로 **테스트가 실 DB에 붙는다**: 테스트 데이터는 `P = 'tstl' + process.pid` 접두어, `after()`에서 전부 삭제.
- 단일 테스트 파일: `node --import tsx --env-file-if-exists=.env --test <file>` (수초). 전체 `npm test`는 4분 — 마지막 작업에서만.
- 금액은 정수. 반올림은 전부 `Math.round`. 환산 기본 `rateKrwPerJpy = 10`. grossUp: `gross = round(net / (1 − p/100))`, `fee = gross − net` (실측 1000→1053, 3000→3158, 8000→8421, 10000→10526, 20000→21053).
- 상태 값은 `'requested' | 'cancelled'`만. `sent_at`·`external_id`는 이번에 항상 null.
- 사용자 문구는 사용자 말(UX 원칙 1·3·5): `요청 만들기 · 보낼 수 있음 · 결제 수단 없음 · 게시 내려짐 · 분류를 골라 주세요`. 내부어(grossUp·readiness·snapshot) 노출 금지. 서버 400/409 문구는 화면이 그대로 보인다.
- 날짜는 `date` 컬럼 + `to_char(…, 'YYYY-MM-DD')`로 읽기(시간대 시프트 방지). 오늘은 `kstToday()`.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. 커밋은 작업마다.
- 새 UI는 B안 두 줄 행(시안 `.superpowers/brainstorm/58705-1787881570/content/row-layout.html`): 행 ≥ 76px, 본문 14~15px(`text-ui`), 숫자 `tabular-nums`, 윗줄 = 읽기 6개(핸들·유형·클리닉/캠페인·₩→¥+수수료·수단·신호등), 아랫줄 = 편집 3개(분류·마감·참고).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `migrations/040_payment_request.sql` | §2 테이블 2개 + 로그 이벤트 제약 |
| `src/lib/settlementSettings.ts` (+test) | 설정 타입·기본값·검증(순수) |
| `src/lib/settlementCalc.ts` (+test) | 금액·기본값·문구·신호등·후보 계산(순수) |
| `src/lib/settlementStore.ts` (+test, 실 DB) | 설정 버전 행, 후보 조회, 일괄 생성, 취소, 목록, 배지용 조회 |
| `src/lib/settlementApi.ts` | 브라우저 fetch 래퍼 |
| `src/app/api/settlement/candidates/route.ts` · `requests/route.ts` · `requests/[id]/route.ts` · `settings/route.ts` | §5-1 |
| `src/app/settlement/layout.tsx` · `page.tsx` · `CandidateTable.tsx` · `CandidateRow.tsx` · `CreateConfirmDialog.tsx` · `RequestList.tsx` · `RequestRow.tsx` · `CancelDialog.tsx` · `SettingsTab.tsx` · `readinessView.ts` | 화면 |
| `src/components/Sidebar.tsx` | 메뉴 1줄 |
| `src/lib/campaignStore.ts` · `campaignTaskStore.ts` · `src/app/campaigns/TaskTable.tsx` · `CampaignHeader.tsx` · `src/app/api/campaigns/[id]/route.ts` · `tasks/[taskId]/route.ts` | 배지 + 삭제 보호 |
| `src/lib/influencerStore.ts` · `src/app/influencers/Timeline.tsx` | 이벤트 2종 |
| `src/content/updates.ts` | 새 기능 항목 |

---

### Task 1: 마이그레이션 040

**Files:**
- Create: `migrations/040_payment_request.sql`

**Interfaces:**
- Produces: 테이블 `payment_request`, `settlement_setting_version`; `influencer_log.event_type`에 `'payment_requested','payment_cancelled'` 허용.

- [ ] **Step 1: 파일 작성**

```sql
-- 040: 정산 결제 요청 (스펙 2026-08-28-settlement-page-design §2)
-- main 최신 039(캠페인 작업 전환 마무리) → 040. apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 멱등.

-- §2-1 요청 1건 = 행 1개. 만든 시점 스냅샷 — 이후 인플 결제 수단·작업 비용이 바뀌어도 이 행은 그대로.
create table if not exists payment_request (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid references campaign_task(id) on delete set null,   -- 작업이 지워져도 요청 기록은 남는다
  campaign_id         uuid references campaign(id) on delete set null,
  campaign_name       text not null,
  client_id           uuid references client(id) on delete set null,          -- 정산 쪽에 ID+이름 동봉
  client_name         text not null,
  influencer_handle   text not null,                                          -- 표기 보존
  task_type           text not null check (task_type in ('post','quoteRt','rt','visit')),
  category            text not null,                                          -- 양식 '분류' = 옵션의 정산 쪽 이름(sendAs)
  category_default    text,                                                   -- 화면이 미리 채웠던 값(사람이 바꿨는지 추적)
  item_text           text not null,
  purpose_text        text not null,
  amount_krw          int not null,
  cost_currency       text not null check (cost_currency in ('KRW','JPY')),
  payout_currency     text not null check (payout_currency in ('KRW','JPY')),
  rate_krw_per_jpy    int not null,
  amount_net          int not null,
  fee                 jsonb,                                                  -- 결제 수단 fee 스냅샷. null = 인플 부담
  fee_amount          int not null default 0,
  amount_gross        int not null,                                           -- net + fee = 실제 송금액 = 양식 '금액'
  deadline_on         date not null,
  reference_url       text,
  payment_method      jsonb not null,                                         -- 결제 수단 스냅샷(type·holder·currency·식별값)
  requester_member_id uuid references member(id) on delete set null,
  requester_name      text not null,
  status              text not null default 'requested' check (status in ('requested','cancelled')),
  cancelled_at        timestamptz,
  cancelled_by        uuid references member(id) on delete set null,
  cancelled_by_name   text,
  cancel_reason       text,
  sent_at             timestamptz,                                            -- 송신 작업이 채운다(이번엔 항상 null)
  external_id         text,
  note                text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()                      -- 트리거 없음 — 스토어가 now() 수동 갱신
);
-- 작업당 활성 요청 1건 — 두 사람이 동시에 눌러도 DB가 막는다(koo 08-28). 취소 후 재요청은 허용.
create unique index if not exists idx_payment_request_active_task
  on payment_request (task_id) where status = 'requested';
create index if not exists idx_payment_request_created on payment_request (created_at desc);
create index if not exists idx_payment_request_handle on payment_request (lower(influencer_handle));
create index if not exists idx_payment_request_campaign on payment_request (campaign_id);

-- §2-2 설정은 버전 행(prompt_template_version 021과 같은 문법) — 마지막 행이 현재값
create table if not exists settlement_setting_version (
  id         uuid primary key default gen_random_uuid(),
  settings   jsonb not null,
  member_id  uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);

-- §2-3 인플 활동 기록 이벤트 추가 — 제약 이름은 036과 동일(drop + add)
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled'));
```

- [ ] **Step 2: 적용(프로덕션 DB, 멱등)**

Run: `bash scripts/apply-migrations.sh 2>&1 | tail -3`
Expected: 오류 없이 끝남(마지막 줄에 040 적용 표시 또는 조용히 종료).

- [ ] **Step 3: 확인**

Run: `node --input-type=module -e "import postgres from 'postgres'; import {readFileSync} from 'node:fs'; const e=Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^\"|\"$/g,'')]})); const sql=postgres({host:e.PGHOST,port:+e.PGPORT,database:e.PGDATABASE,username:e.PGUSER,password:e.PGPASSWORD,ssl:'require',max:1}); console.log(await sql\`select indexname from pg_indexes where tablename='payment_request'\`); await sql.end();"`
Expected: `idx_payment_request_active_task` 포함 4개 인덱스 + pkey.

- [ ] **Step 4: Commit**

```bash
git add migrations/040_payment_request.sql
git commit -m "feat(settlement): 마이그레이션 040 — payment_request·settlement_setting_version + 활동 기록 이벤트 2종

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 설정 모듈 `settlementSettings.ts` (순수)

**Files:**
- Create: `src/lib/settlementSettings.ts`, `src/lib/settlementSettings.test.ts`

**Interfaces:**
- Consumes: `TaskType`, `TASK_TYPES` from `./campaignJudgment.ts`
- Produces:
  ```ts
  export interface SettlementCategory { id: string; label: string; sendAs: string; hidden: boolean; defaultFor: TaskType[] }
  export interface SettlementSettings { categories: SettlementCategory[]; rateKrwPerJpy: number }
  export const SETTLEMENT_DEFAULTS: SettlementSettings
  export function sanitizeSettlementSettings(v: unknown): SettlementSettings | string   // string = 오류 문구
  export function visibleCategories(s: SettlementSettings): SettlementCategory[]
  export function categoryBySendAs(s: SettlementSettings, sendAs: string | null): SettlementCategory | null   // 숨김 포함
  export function defaultCategoryFor(s: SettlementSettings, type: TaskType): SettlementCategory | null       // 숨김 제외
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/settlementSettings.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTLEMENT_DEFAULTS, sanitizeSettlementSettings, visibleCategories, categoryBySendAs, defaultCategoryFor,
} from './settlementSettings.ts';

test('기본값 — 슬랙 3분류, RT만 기본값, 환율 10', () => {
  assert.equal(SETTLEMENT_DEFAULTS.categories.length, 3);
  assert.equal(SETTLEMENT_DEFAULTS.rateKrwPerJpy, 10);
  assert.equal(defaultCategoryFor(SETTLEMENT_DEFAULTS, 'rt')?.label, '프로모션 RT·인용RT');
  assert.equal(defaultCategoryFor(SETTLEMENT_DEFAULTS, 'quoteRt'), null);   // 인용RT는 요청자 최근 선택으로
  assert.equal(defaultCategoryFor(SETTLEMENT_DEFAULTS, 'post'), null);      // 투고는 캠페인 종류 규칙(calc)
});

test('sanitize — 정상 입력은 정돈되어 통과', () => {
  const r = sanitizeSettlementSettings({
    categories: [{ id: 'a', label: ' 프로모션 ', sendAs: 'X', hidden: false, defaultFor: ['rt'] }],
    rateKrwPerJpy: 10,
  });
  assert.ok(typeof r !== 'string');
  assert.equal(r.categories[0].label, '프로모션');
});

test('sanitize — 거절 사유', () => {
  assert.equal(typeof sanitizeSettlementSettings(null), 'string');
  assert.equal(sanitizeSettlementSettings({ categories: [], rateKrwPerJpy: 10 }), '분류가 하나 이상 필요해요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: '', sendAs: 'X', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10 }), '분류 이름을 입력해 주세요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: '', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10 }), '정산 쪽 이름을 입력해 주세요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: ['rt'] }, { id: 'b', label: 'B', sendAs: 'Y', hidden: false, defaultFor: ['rt'] }], rateKrwPerJpy: 10 }), '한 유형은 한 분류의 기본값으로만 둘 수 있어요 (RT)');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: [] }], rateKrwPerJpy: 0 }), '환율은 1 이상 정수예요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10.5 }), '환율은 1 이상 정수예요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: ['nope'] }], rateKrwPerJpy: 10 }), '알 수 없는 작업 유형이에요');
  assert.equal(sanitizeSettlementSettings({ categories: [{ id: 'a', label: 'A', sendAs: 'X', hidden: false, defaultFor: [] }, { id: 'a', label: 'B', sendAs: 'Y', hidden: false, defaultFor: [] }], rateKrwPerJpy: 10 }), '분류 id가 겹쳐요');
});

test('visible/bySendAs/defaultFor — 숨김 처리', () => {
  const s = sanitizeSettlementSettings({
    categories: [
      { id: 'a', label: 'A', sendAs: 'X', hidden: true, defaultFor: ['rt'] },
      { id: 'b', label: 'B', sendAs: 'Y', hidden: false, defaultFor: [] },
    ], rateKrwPerJpy: 10,
  });
  assert.ok(typeof s !== 'string');
  assert.deepEqual(visibleCategories(s).map((c) => c.id), ['b']);
  assert.equal(categoryBySendAs(s, 'X')?.id, 'a');           // 스냅샷 표시용 — 숨김도 찾는다
  assert.equal(categoryBySendAs(s, null), null);
  assert.equal(defaultCategoryFor(s, 'rt'), null);          // 숨긴 옵션은 기본값으로 쓰지 않는다
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementSettings.test.ts`
Expected: FAIL — `Cannot find module './settlementSettings.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/settlementSettings.ts
// 정산 설정(스펙 2026-08-28 §2-2) — 순수. 저장·버전은 settlementStore가, 규칙 적용은 settlementCalc가.
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from './campaignJudgment.ts';

export interface SettlementCategory {
  id: string;            // 화면 편집용 안정 키(uuid 문자열이면 충분, 형식 검증 없음)
  label: string;         // 표시명
  sendAs: string;        // 정산 쪽 이름 — payment_request.category에 스냅샷되는 값
  hidden: boolean;       // 새 요청 드롭다운에서만 숨김. 기존 요청 표시엔 영향 없음
  defaultFor: TaskType[];// 이 유형의 기본값. 한 유형은 한 옵션에만
}
export interface SettlementSettings { categories: SettlementCategory[]; rateKrwPerJpy: number }

// 첫 화면부터 동작하는 기본값 — 슬랙 3채널 실데이터의 분류 3종. 인용RT는 어느 옵션에도 없다(요청자 최근 선택, calc §3-3).
export const SETTLEMENT_DEFAULTS: SettlementSettings = {
  categories: [
    { id: 'promo-rt', label: '프로모션 RT·인용RT', sendAs: '마케팅비 > X(트위터) 프로모션 RT·인용RT', hidden: false, defaultFor: ['rt'] },
    { id: 'fee', label: '인플루언서 협찬 원고료', sendAs: '마케팅비 > X(트위터) 인플루언서 협찬 원고료', hidden: false, defaultFor: [] },
    { id: 'info-post', label: '정보성콘텐츠 업로드 (게시물)', sendAs: '마케팅비 > X(트위터) 정보성콘텐츠 업로드 (게시물)', hidden: false, defaultFor: [] },
  ],
  rateKrwPerJpy: 10,
};
// 캠페인 종류 규칙(§3-3 2단계)이 가리키는 옵션 id — calc가 쓴다
export const CATEGORY_ID_FEE = 'fee';
export const CATEGORY_ID_INFO = 'info-post';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function sanitizeSettlementSettings(v: unknown): SettlementSettings | string {
  if (!v || typeof v !== 'object') return '설정 형식이 올바르지 않아요';
  const o = v as { categories?: unknown; rateKrwPerJpy?: unknown };
  if (!Array.isArray(o.categories) || o.categories.length === 0) return '분류가 하나 이상 필요해요';
  const categories: SettlementCategory[] = [];
  const ids = new Set<string>();
  const seenType = new Map<TaskType, string>();
  for (const raw of o.categories as unknown[]) {
    const c = (raw ?? {}) as { id?: unknown; label?: unknown; sendAs?: unknown; hidden?: unknown; defaultFor?: unknown };
    const id = str(c.id); const label = str(c.label); const sendAs = str(c.sendAs);
    if (!id) return '분류 id가 비어 있어요';
    if (ids.has(id)) return '분류 id가 겹쳐요';
    ids.add(id);
    if (!label) return '분류 이름을 입력해 주세요';
    if (!sendAs) return '정산 쪽 이름을 입력해 주세요';
    const hidden = c.hidden === true;
    const defaultFor: TaskType[] = [];
    for (const t of Array.isArray(c.defaultFor) ? c.defaultFor : []) {
      if (!(TASK_TYPES as readonly string[]).includes(String(t))) return '알 수 없는 작업 유형이에요';
      const tt = t as TaskType;
      if (seenType.has(tt)) return `한 유형은 한 분류의 기본값으로만 둘 수 있어요 (${TASK_TYPE_LABEL[tt]})`;
      seenType.set(tt, id);
      if (!defaultFor.includes(tt)) defaultFor.push(tt);
    }
    categories.push({ id, label, sendAs, hidden, defaultFor });
  }
  const rate = o.rateKrwPerJpy;
  if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 1) return '환율은 1 이상 정수예요';
  return { categories, rateKrwPerJpy: rate };
}

export function visibleCategories(s: SettlementSettings): SettlementCategory[] {
  return s.categories.filter((c) => !c.hidden);
}
export function categoryBySendAs(s: SettlementSettings, sendAs: string | null): SettlementCategory | null {
  if (!sendAs) return null;
  return s.categories.find((c) => c.sendAs === sendAs) ?? null;
}
export function defaultCategoryFor(s: SettlementSettings, type: TaskType): SettlementCategory | null {
  return visibleCategories(s).find((c) => c.defaultFor.includes(type)) ?? null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementSettings.test.ts`
Expected: `pass 4`

- [ ] **Step 5: Commit**

```bash
git add src/lib/settlementSettings.ts src/lib/settlementSettings.test.ts
git commit -m "feat(settlement): 설정 모듈 — 분류 옵션(표시명·정산 쪽 이름·숨김·유형별 기본값)·환율 검증(순수)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 3: 계산 모듈 `settlementCalc.ts` (순수)

**Files:**
- Create: `src/lib/settlementCalc.ts`, `src/lib/settlementCalc.test.ts`

**Interfaces:**
- Consumes: `Currency`, `PRICE_TYPE_LABEL`(= `TASK_TYPE_LABEL`) from `./influencerPricing.ts`; `PaymentMethod`, `PaymentFee` from `./influencerPayment.ts`; `TaskType`, `CampaignKind` from `./campaignJudgment.ts`; `TaskCost` from `./campaignCost.ts`; Task 2의 `SettlementSettings`, `defaultCategoryFor`, `CATEGORY_ID_FEE`, `CATEGORY_ID_INFO`, `visibleCategories`.
- Produces(전부 export):
  ```ts
  export interface MoneyCalc { costAmount: number; costCurrency: Currency; amountKrw: number; payoutCurrency: Currency; rateKrwPerJpy: number; amountNet: number; fee: PaymentFee | null; feeAmount: number; amountGross: number }
  export function computeMoney(cost: TaskCost, payoutCurrency: Currency, fee: PaymentFee | undefined, rateKrwPerJpy: number): MoneyCalc
  export function defaultDeadline(today: string): string
  export function defaultCategory(i: { type: TaskType; campaignKind: CampaignKind | null; settings: SettlementSettings; lastQuoteRtCategory: string | null }): string | null   // sendAs
  export function itemText(handle: string, type: TaskType): string
  export function purposeText(clientName: string, kind: CampaignKind | null, type: TaskType): string
  export function referenceUrlFor(t: { type: TaskType; postUrl: string | null; targetTweetUrl: string | null; targetPostUrl: string | null }): string | null
  export type ReadinessLevel = 'ready' | 'warn' | 'blocked'
  export type IssueCode = 'no-influencer' | 'no-payment-method' | 'no-category' | 'no-reference' | 'removed' | 'paypay-no-identifier'
  export interface ReadinessIssue { level: 'warn' | 'blocked'; code: IssueCode; text: string }
  export function assessReadiness(i: { inRoster: boolean; method: PaymentMethod | null; category: string | null; referenceUrl: string | null; removedAt: string | null; removedReason: string }): { level: ReadinessLevel; issues: ReadinessIssue[] }
  export interface PaymentMethodSnapshot { type: PaymentMethod['type']; holder: string; currency: Currency; email?: string; paypalId?: string; identifier?: string; bank?: string; branch?: string; account?: string }
  export function toMethodSnapshot(m: PaymentMethod): PaymentMethodSnapshot
  export function describeSnapshot(m: PaymentMethodSnapshot): string   // 'PayPal | 홍길동 | a@b.c' — 양식 8번 문자열
  export interface CandidateInput { task: { id: string; type: TaskType; influencerHandle: string; cost: TaskCost; postUrl: string | null; targetTweetUrl: string | null; targetPostUrl: string | null; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null }; campaign: { id: string; name: string; kind: CampaignKind | null; clientId: string | null; clientName: string }; influencer: { inRoster: boolean; method: PaymentMethod | null }; settings: SettlementSettings; lastQuoteRtCategory: string | null; today: string }
  export interface SettlementCandidate { taskId: string; campaignId: string; campaignName: string; clientId: string | null; clientName: string; campaignKind: CampaignKind | null; influencerHandle: string; taskType: TaskType; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null; money: MoneyCalc | null; method: PaymentMethod | null; categoryDefault: string | null; deadlineDefault: string; referenceDefault: string | null; itemText: string; purposeText: string; readiness: ReadinessLevel; issues: ReadinessIssue[] }
  export function computeCandidate(i: CandidateInput): SettlementCandidate
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/settlementCalc.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMoney, defaultDeadline, defaultCategory, itemText, purposeText, referenceUrlFor, assessReadiness,
  toMethodSnapshot, describeSnapshot, computeCandidate,
} from './settlementCalc.ts';
import { SETTLEMENT_DEFAULTS, sanitizeSettlementSettings } from './settlementSettings.ts';
import type { PaymentMethod } from './influencerPayment.ts';

const paypal: PaymentMethod = { id: 'pm1', type: 'paypal', isDefault: true, holder: 'SAWADA KEIKO', currency: 'JPY', email: 'ucymk@gmail.com', updatedAt: '2026-08-27T00:00:00.000Z' };
const bankJp: PaymentMethod = { id: 'pm2', type: 'bank', isDefault: true, holder: 'オオクボナナ', currency: 'JPY', bank: '三菱UFJ', branch: '赤坂見附支店(064)', account: '0441321', fee: { mode: 'fixed', amount: 165 }, updatedAt: '2026-08-27T00:00:00.000Z' };
const bankKr: PaymentMethod = { id: 'pm3', type: 'bank', isDefault: true, holder: 'KAWAGOE AMI', currency: 'KRW', bank: '신한', account: '110543468512', updatedAt: '2026-08-27T00:00:00.000Z' };
const paypay: PaymentMethod = { id: 'pm4', type: 'paypay', isDefault: true, holder: 'A', currency: 'JPY', updatedAt: '2026-08-27T00:00:00.000Z' };

test('computeMoney — grossUp 5%는 슬랙 실측 5쌍과 일치(반올림)', () => {
  for (const [net, gross] of [[1000, 1053], [3000, 3158], [8000, 8421], [10000, 10526], [20000, 21053]] as const) {
    const m = computeMoney({ amount: net * 10, currency: 'KRW' }, 'JPY', { mode: 'grossUp', percent: 5 }, 10);
    assert.equal(m.amountNet, net); assert.equal(m.amountGross, gross); assert.equal(m.feeAmount, gross - net);
  }
});
test('computeMoney — 고정 165·인플 부담 0·환산 방향·같은 통화', () => {
  assert.deepEqual(computeMoney({ amount: 20000, currency: 'KRW' }, 'JPY', { mode: 'fixed', amount: 165 }, 10),
    { costAmount: 20000, costCurrency: 'KRW', amountKrw: 20000, payoutCurrency: 'JPY', rateKrwPerJpy: 10, amountNet: 2000, fee: { mode: 'fixed', amount: 165 }, feeAmount: 165, amountGross: 2165 });
  assert.equal(computeMoney({ amount: 30000, currency: 'KRW' }, 'JPY', undefined, 10).amountGross, 3000);
  assert.equal(computeMoney({ amount: 30005, currency: 'KRW' }, 'JPY', undefined, 10).amountNet, 3001);   // 반올림
  assert.equal(computeMoney({ amount: 30000, currency: 'KRW' }, 'KRW', undefined, 10).amountNet, 30000);  // 같은 통화 그대로
  const j = computeMoney({ amount: 3000, currency: 'JPY' }, 'KRW', undefined, 10);
  assert.equal(j.amountNet, 30000); assert.equal(j.amountKrw, 30000);                                       // 엔→원, 원화 열도 채움
  assert.equal(computeMoney({ amount: 3000, currency: 'JPY' }, 'JPY', undefined, 10).amountKrw, 30000);
});

test('defaultDeadline — 월~금 그 주 금요일, 토 다음 금요일, 일 다음날 월요일', () => {
  assert.equal(defaultDeadline('2026-08-24'), '2026-08-28'); // 월
  assert.equal(defaultDeadline('2026-08-26'), '2026-08-28'); // 수
  assert.equal(defaultDeadline('2026-08-28'), '2026-08-28'); // 금 = 당일
  assert.equal(defaultDeadline('2026-08-29'), '2026-09-04'); // 토 → 다음 금
  assert.equal(defaultDeadline('2026-08-30'), '2026-08-31'); // 일 → 월
  assert.equal(defaultDeadline('2026-08-31'), '2026-09-04'); // 월(월말 넘김)
  assert.equal(defaultDeadline('2026-09-01'), '2026-09-04'); // 화
});

test('defaultCategory — 설정 defaultFor > 캠페인 종류 규칙 > 인용RT 최근값 > 빈칸', () => {
  const s = SETTLEMENT_DEFAULTS;
  const promo = s.categories[0].sendAs, fee = s.categories[1].sendAs, info = s.categories[2].sendAs;
  assert.equal(defaultCategory({ type: 'rt', campaignKind: 'visit', settings: s, lastQuoteRtCategory: null }), promo);
  assert.equal(defaultCategory({ type: 'post', campaignKind: 'visit', settings: s, lastQuoteRtCategory: null }), fee);
  assert.equal(defaultCategory({ type: 'visit', campaignKind: 'visit', settings: s, lastQuoteRtCategory: null }), fee);
  assert.equal(defaultCategory({ type: 'post', campaignKind: 'content', settings: s, lastQuoteRtCategory: null }), info);
  assert.equal(defaultCategory({ type: 'post', campaignKind: null, settings: s, lastQuoteRtCategory: null }), info);
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: s, lastQuoteRtCategory: info }), info);
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: s, lastQuoteRtCategory: null }), null);
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: s, lastQuoteRtCategory: '없어진 옵션' }), null);
  // 숨긴 옵션은 기본값이 되지 않는다 — 최근값이 숨긴 옵션이면 빈칸
  const hidden = sanitizeSettlementSettings({ ...s, categories: s.categories.map((c, i) => (i === 2 ? { ...c, hidden: true } : c)) });
  assert.ok(typeof hidden !== 'string');
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: hidden, lastQuoteRtCategory: info }), null);
  assert.equal(defaultCategory({ type: 'post', campaignKind: 'content', settings: hidden, lastQuoteRtCategory: null }), null);
  // 설정에서 인용RT 기본값을 지정하면 그게 최근값보다 우선
  const q = sanitizeSettlementSettings({ ...s, categories: s.categories.map((c, i) => (i === 0 ? { ...c, defaultFor: ['rt', 'quoteRt'] } : c)) });
  assert.ok(typeof q !== 'string');
  assert.equal(defaultCategory({ type: 'quoteRt', campaignKind: 'content', settings: q, lastQuoteRtCategory: info }), promo);
});

test('문구 — 항목·목적', () => {
  assert.equal(itemText('seikeinu', 'quoteRt'), '@seikeinu 인용RT 1건 정산');
  assert.equal(itemText('a', 'rt'), '@a RT 1건 정산');
  assert.equal(itemText('a', 'post'), '@a 투고 1건 정산');
  assert.equal(itemText('a', 'visit'), '@a 방문협찬 1건 정산');
  assert.equal(purposeText('닥터손유나클리닉', 'content', 'quoteRt'), '닥터손유나클리닉 정보성 콘텐츠 Viral 협찬');
  assert.equal(purposeText('C', 'visit', 'rt'), 'C 방문협찬 리뷰 바이럴 목적');
  assert.equal(purposeText('C', 'visit', 'post'), 'C 방문협찬 원고료');
  assert.equal(purposeText('C', 'visit', 'visit'), 'C 방문협찬 원고료');
  assert.equal(purposeText('C', 'seeding', 'rt'), 'C 제품협찬 바이럴 목적');
  assert.equal(purposeText('C', null, 'post'), 'C 콘텐츠 협찬');
});

test('referenceUrlFor — RT는 대상, 나머지는 자기 게시물', () => {
  assert.equal(referenceUrlFor({ type: 'rt', postUrl: null, targetTweetUrl: 'https://x.com/a/status/1', targetPostUrl: null }), 'https://x.com/a/status/1');
  assert.equal(referenceUrlFor({ type: 'rt', postUrl: null, targetTweetUrl: null, targetPostUrl: 'https://x.com/b/status/2' }), 'https://x.com/b/status/2');
  assert.equal(referenceUrlFor({ type: 'rt', postUrl: 'https://x.com/z', targetTweetUrl: null, targetPostUrl: null }), null);
  assert.equal(referenceUrlFor({ type: 'quoteRt', postUrl: 'https://x.com/q/status/3', targetTweetUrl: 'https://x.com/a/status/1', targetPostUrl: null }), 'https://x.com/q/status/3');
  assert.equal(referenceUrlFor({ type: 'post', postUrl: null, targetTweetUrl: null, targetPostUrl: null }), null);
});

test('assessReadiness — 🔴 > 🟡, 문구 나열', () => {
  const ok = assessReadiness({ inRoster: true, method: paypal, category: 'X', referenceUrl: 'https://x.com/1', removedAt: null, removedReason: '' });
  assert.equal(ok.level, 'ready'); assert.equal(ok.issues.length, 0);
  const noRoster = assessReadiness({ inRoster: false, method: null, category: 'X', referenceUrl: null, removedAt: null, removedReason: '' });
  assert.equal(noRoster.level, 'blocked');
  assert.deepEqual(noRoster.issues.map((i) => i.code), ['no-influencer', 'no-reference']);
  assert.match(noRoster.issues[0].text, /명부에 없는 인플루언서예요/);
  const noPm = assessReadiness({ inRoster: true, method: null, category: null, referenceUrl: null, removedAt: '2026-08-27', removedReason: '계정 정지' });
  assert.equal(noPm.level, 'blocked');
  assert.deepEqual(noPm.issues.map((i) => i.code), ['no-payment-method', 'no-category', 'no-reference', 'removed']);
  assert.match(noPm.issues[3].text, /게시 내려짐 8-27 · 계정 정지/);
  const warn = assessReadiness({ inRoster: true, method: paypay, category: 'X', referenceUrl: null, removedAt: null, removedReason: '' });
  assert.equal(warn.level, 'warn');
  assert.deepEqual(warn.issues.map((i) => i.code), ['no-reference', 'paypay-no-identifier']);
});

test('snapshot — 필드 선별·양식 8번 문자열', () => {
  const s = toMethodSnapshot(bankJp);
  assert.deepEqual(s, { type: 'bank', holder: 'オオクボナナ', currency: 'JPY', bank: '三菱UFJ', branch: '赤坂見附支店(064)', account: '0441321' });
  assert.equal(describeSnapshot(s), '계좌이체 | オオクボナナ | 三菱UFJ / 赤坂見附支店(064) / 0441321');
  assert.equal(describeSnapshot(toMethodSnapshot(bankKr)), '계좌이체 | KAWAGOE AMI | 신한 /  / 110543468512');
  assert.equal(describeSnapshot(toMethodSnapshot(paypal)), 'PayPal | SAWADA KEIKO | ucymk@gmail.com');
  assert.equal(describeSnapshot(toMethodSnapshot({ ...paypal, email: undefined, paypalId: 'keiko' })), 'PayPal | SAWADA KEIKO | paypal.me/keiko');
  assert.equal(describeSnapshot(toMethodSnapshot(paypay)), 'PayPay | A | ');
});

test('computeCandidate — 전부 합친 한 건', () => {
  const c = computeCandidate({
    task: { id: 't1', type: 'quoteRt', influencerHandle: 'seikeinu', cost: { amount: 30000, currency: 'KRW' }, postUrl: 'https://x.com/seikeinu/status/9', targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: '원고 A' },
    campaign: { id: 'c1', name: '손유나 9월 1주', kind: 'content', clientId: 'cl1', clientName: '닥터손유나클리닉' },
    influencer: { inRoster: true, method: { ...paypal, fee: { mode: 'grossUp', percent: 5 } } },
    settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: SETTLEMENT_DEFAULTS.categories[2].sendAs, today: '2026-08-28',
  });
  assert.equal(c.money?.amountGross, 3158);
  assert.equal(c.categoryDefault, SETTLEMENT_DEFAULTS.categories[2].sendAs);
  assert.equal(c.deadlineDefault, '2026-08-28');
  assert.equal(c.referenceDefault, 'https://x.com/seikeinu/status/9');
  assert.equal(c.itemText, '@seikeinu 인용RT 1건 정산');
  assert.equal(c.purposeText, '닥터손유나클리닉 정보성 콘텐츠 Viral 협찬');
  assert.equal(c.readiness, 'ready');
  const blocked = computeCandidate({
    task: { id: 't2', type: 'rt', influencerHandle: 'nobody', cost: { amount: 20000, currency: 'KRW' }, postUrl: null, targetTweetUrl: null, targetPostUrl: null, postedAt: '2026-08-27', removedAt: null, removedReason: '', draftLabel: null },
    campaign: { id: 'c1', name: 'N', kind: null, clientId: null, clientName: '기타' },
    influencer: { inRoster: false, method: null }, settings: SETTLEMENT_DEFAULTS, lastQuoteRtCategory: null, today: '2026-08-28',
  });
  assert.equal(blocked.money, null); assert.equal(blocked.readiness, 'blocked');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementCalc.test.ts`
Expected: FAIL — `Cannot find module './settlementCalc.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/settlementCalc.ts
// 정산 계산(스펙 2026-08-28 §3) — 순수. 화면·확인 창·서버 저장이 같은 함수를 부른다(화면 3,158 / 저장 3,157 같은 일이 없게).
import type { Currency } from './influencerPricing.ts';
import { TASK_TYPE_LABEL, type TaskType, type CampaignKind } from './campaignJudgment.ts';
import type { TaskCost } from './campaignCost.ts';
import { PAYMENT_TYPE_LABEL, type PaymentMethod, type PaymentFee } from './influencerPayment.ts';
import { defaultCategoryFor, visibleCategories, CATEGORY_ID_FEE, CATEGORY_ID_INFO, type SettlementSettings } from './settlementSettings.ts';

// ── 금액(§3-1·3-2) ──
export interface MoneyCalc {
  costAmount: number; costCurrency: Currency;   // 작업 비용 그대로(화면 '원가' 표시용)
  amountKrw: number; payoutCurrency: Currency; rateKrwPerJpy: number;
  amountNet: number; fee: PaymentFee | null; feeAmount: number; amountGross: number;
}
export function computeMoney(cost: TaskCost, payoutCurrency: Currency, fee: PaymentFee | undefined, rateKrwPerJpy: number): MoneyCalc {
  const rate = rateKrwPerJpy;
  let net: number;
  if (cost.currency === payoutCurrency) net = cost.amount;
  else if (cost.currency === 'KRW') net = Math.round(cost.amount / rate);
  else net = cost.amount * rate;
  const amountKrw = cost.currency === 'KRW' ? cost.amount : cost.amount * rate;
  let feeAmount = 0;
  if (fee?.mode === 'grossUp') feeAmount = Math.round(net / (1 - fee.percent / 100)) - net;
  else if (fee?.mode === 'fixed') feeAmount = fee.amount;
  return { costAmount: cost.amount, costCurrency: cost.currency, amountKrw, payoutCurrency, rateKrwPerJpy: rate, amountNet: net, fee: fee ?? null, feeAmount, amountGross: net + feeAmount };
}

// ── 데드라인(§3-4) — 월~금 그 주 금요일, 토 다음 금요일, 일 다음날 월요일. 문자열 날짜만 다룬다(UTC 정오로 계산해 시프트 없음).
export function defaultDeadline(today: string): string {
  const d = new Date(today + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0 일 … 6 토
  const add = dow === 0 ? 1 : dow === 6 ? 6 : 5 - dow;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

// ── 분류 기본값(§3-3) — 반환은 sendAs(스냅샷 값) ──
export function defaultCategory(i: { type: TaskType; campaignKind: CampaignKind | null; settings: SettlementSettings; lastQuoteRtCategory: string | null }): string | null {
  const byType = defaultCategoryFor(i.settings, i.type);
  if (byType) return byType.sendAs;
  const visible = visibleCategories(i.settings);
  if (i.type === 'post' || i.type === 'visit') {
    const id = i.campaignKind === 'visit' ? CATEGORY_ID_FEE : CATEGORY_ID_INFO;
    return visible.find((c) => c.id === id)?.sendAs ?? null;
  }
  if (i.type === 'quoteRt' && i.lastQuoteRtCategory) {
    return visible.find((c) => c.sendAs === i.lastQuoteRtCategory)?.sendAs ?? null;
  }
  return null;
}

// ── 문구(§3-5) ──
export function itemText(handle: string, type: TaskType): string {
  return `@${handle} ${TASK_TYPE_LABEL[type]} 1건 정산`;
}
export function purposeText(clientName: string, kind: CampaignKind | null, type: TaskType): string {
  let p: string;
  if (kind === 'content') p = '정보성 콘텐츠 Viral 협찬';
  else if (kind === 'visit') p = type === 'rt' || type === 'quoteRt' ? '방문협찬 리뷰 바이럴 목적' : '방문협찬 원고료';
  else if (kind === 'seeding') p = '제품협찬 바이럴 목적';
  else p = '콘텐츠 협찬';
  return `${clientName} ${p}`;
}

// ── 참고자료(§3-6) ──
export function referenceUrlFor(t: { type: TaskType; postUrl: string | null; targetTweetUrl: string | null; targetPostUrl: string | null }): string | null {
  if (t.type === 'rt') return t.targetTweetUrl ?? t.targetPostUrl ?? null;
  return t.postUrl ?? null;
}

// ── 신호등(§3-7) ──
export type ReadinessLevel = 'ready' | 'warn' | 'blocked';
export type IssueCode = 'no-influencer' | 'no-payment-method' | 'no-category' | 'no-reference' | 'removed' | 'paypay-no-identifier';
export interface ReadinessIssue { level: 'warn' | 'blocked'; code: IssueCode; text: string }
const monthDay = (ymd: string) => `${Number(ymd.slice(5, 7))}-${Number(ymd.slice(8, 10))}`;
export function assessReadiness(i: { inRoster: boolean; method: PaymentMethod | null; category: string | null; referenceUrl: string | null; removedAt: string | null; removedReason: string }): { level: ReadinessLevel; issues: ReadinessIssue[] } {
  const issues: ReadinessIssue[] = [];
  if (!i.inRoster) issues.push({ level: 'blocked', code: 'no-influencer', text: '명부에 없는 인플루언서예요 — 명부에 추가하고 결제 수단을 등록해 주세요' });
  else if (!i.method) issues.push({ level: 'blocked', code: 'no-payment-method', text: '결제 수단이 없어요 — 프로필에서 등록해 주세요' });
  if (!i.category) issues.push({ level: 'blocked', code: 'no-category', text: '분류를 골라 주세요' });
  if (!i.referenceUrl) issues.push({ level: 'warn', code: 'no-reference', text: '참고 링크 없음' });
  if (i.removedAt) issues.push({ level: 'warn', code: 'removed', text: `게시 내려짐 ${monthDay(i.removedAt)}${i.removedReason ? ` · ${i.removedReason}` : ''}` });
  if (i.method?.type === 'paypay' && !i.method.identifier) issues.push({ level: 'warn', code: 'paypay-no-identifier', text: 'PayPay 수취 정보 미입력' });
  const level: ReadinessLevel = issues.some((x) => x.level === 'blocked') ? 'blocked' : issues.length ? 'warn' : 'ready';
  return { level, issues };
}

// ── 결제 수단 스냅샷(§2-1 payment_method) ──
export interface PaymentMethodSnapshot {
  type: PaymentMethod['type']; holder: string; currency: Currency;
  email?: string; paypalId?: string; identifier?: string; bank?: string; branch?: string; account?: string;
}
export function toMethodSnapshot(m: PaymentMethod): PaymentMethodSnapshot {
  const s: PaymentMethodSnapshot = { type: m.type, holder: m.holder, currency: m.currency };
  for (const k of ['email', 'paypalId', 'identifier', 'bank', 'branch', 'account'] as const) {
    if (m[k]) s[k] = m[k];
  }
  return s;
}
// 슬랙 양식 8번 `수단 | 수취인 | 식별정보` — 실데이터 형식 그대로(계좌는 은행 / 지점 / 번호, 지점 없으면 빈칸 유지)
export function describeSnapshot(m: PaymentMethodSnapshot): string {
  let ident = '';
  if (m.type === 'paypal') ident = m.email ?? (m.paypalId ? `paypal.me/${m.paypalId}` : '');
  else if (m.type === 'paypay') ident = m.identifier ?? '';
  else ident = `${m.bank ?? ''} / ${m.branch ?? ''} / ${m.account ?? ''}`;
  return `${PAYMENT_TYPE_LABEL[m.type]} | ${m.holder} | ${ident}`;
}

// ── 후보 한 건(§2-4 + §3 전부) ──
export interface CandidateInput {
  task: { id: string; type: TaskType; influencerHandle: string; cost: TaskCost; postUrl: string | null; targetTweetUrl: string | null; targetPostUrl: string | null; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null };
  campaign: { id: string; name: string; kind: CampaignKind | null; clientId: string | null; clientName: string };
  influencer: { inRoster: boolean; method: PaymentMethod | null };
  settings: SettlementSettings; lastQuoteRtCategory: string | null; today: string;
}
export interface SettlementCandidate {
  taskId: string; campaignId: string; campaignName: string; clientId: string | null; clientName: string; campaignKind: CampaignKind | null;
  influencerHandle: string; taskType: TaskType; postedAt: string; removedAt: string | null; removedReason: string; draftLabel: string | null;
  money: MoneyCalc | null; method: PaymentMethod | null;
  categoryDefault: string | null; deadlineDefault: string; referenceDefault: string | null; itemText: string; purposeText: string;
  readiness: ReadinessLevel; issues: ReadinessIssue[];
}
export function computeCandidate(i: CandidateInput): SettlementCandidate {
  const { task, campaign, influencer } = i;
  const method = influencer.method;
  const money = method ? computeMoney(task.cost, method.currency, method.fee, i.settings.rateKrwPerJpy) : null;
  const categoryDefault = defaultCategory({ type: task.type, campaignKind: campaign.kind, settings: i.settings, lastQuoteRtCategory: i.lastQuoteRtCategory });
  const referenceDefault = referenceUrlFor(task);
  const r = assessReadiness({ inRoster: influencer.inRoster, method, category: categoryDefault, referenceUrl: referenceDefault, removedAt: task.removedAt, removedReason: task.removedReason });
  return {
    taskId: task.id, campaignId: campaign.id, campaignName: campaign.name, clientId: campaign.clientId, clientName: campaign.clientName, campaignKind: campaign.kind,
    influencerHandle: task.influencerHandle, taskType: task.type, postedAt: task.postedAt, removedAt: task.removedAt, removedReason: task.removedReason, draftLabel: task.draftLabel,
    money, method,
    categoryDefault, deadlineDefault: defaultDeadline(i.today), referenceDefault,
    itemText: itemText(task.influencerHandle, task.type), purposeText: purposeText(campaign.clientName, campaign.kind, task.type),
    readiness: r.level, issues: r.issues,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementCalc.test.ts`
Expected: `pass 9`

- [ ] **Step 5: Commit**

```bash
git add src/lib/settlementCalc.ts src/lib/settlementCalc.test.ts
git commit -m "feat(settlement): 계산 모듈 — 원↔엔 환산·수수료(grossUp 반올림·고정)·분류/데드라인/참고 기본값·문구·신호등(순수)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 4: 스토어 ① — 설정 버전 행 + 후보 조회

**Files:**
- Create: `src/lib/settlementStore.ts`, `src/lib/settlementStore.test.ts`

**Interfaces:**
- Consumes: Task 2·3 전부; `getSql` `./db.ts`; `kstToday` `./datetime.ts`; `parseTaskCost` `./campaignCost.ts`; `parsePaymentMethods`? — **없다**: `influencer.payment_methods`는 jsonb 배열이며 `PaymentMethod[]`로 그대로 신뢰한다(influencerStore가 검증해 저장). `getDefaultPaymentMethod(list)` `./influencerPayment.ts`.
- Produces:
  ```ts
  export async function getSettlementSettings(sql): Promise<SettlementSettings>          // 행 없으면 SETTLEMENT_DEFAULTS
  export async function saveSettlementSettings(sql, s: SettlementSettings, memberId: string | null): Promise<void>
  export interface SettlementVersionRow { id: string; memberName: string | null; createdAt: string }
  export async function listSettlementVersions(sql, limit = 5): Promise<SettlementVersionRow[]>
  export async function lastQuoteRtCategory(sql, requesterMemberId: string | null): Promise<string | null>
  export async function listCandidates(sql, settings: SettlementSettings, requesterMemberId: string | null, today?: string): Promise<SettlementCandidate[]>
  ```

- [ ] **Step 1: 실패하는 테스트 (파일 생성 — Task 5가 같은 파일에 테스트를 더한다)**

```ts
// src/lib/settlementStore.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, updateTask } from './campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';
import { SETTLEMENT_DEFAULTS } from './settlementSettings.ts';
import {
  getSettlementSettings, saveSettlementSettings, listSettlementVersions, lastQuoteRtCategory, listCandidates,
} from './settlementStore.ts';

const sql = getSql();
const P = 'tstl' + process.pid;
const H = (s: string) => `${P}_${s}`;   // 핸들도 접두어 — 명부 정리를 위해
after(async () => {
  await sql`delete from payment_request where influencer_handle like ${P + '%'}`;
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});
const base = (clientId: string, clientName: string, suffix: string, kind: 'content' | 'visit' | null = 'content') => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind, note: '', createdBy: null,
});
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
async function influencerWithPaypal(handle: string) {
  const { row } = await createInfluencer(sql, { handle, createdBy: null });
  await updatePaymentMethods(sql, row.id, { kind: 'add', input: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: `${handle}@x.com`, fee: { mode: 'grossUp', percent: 5 } }, makeDefault: true }, null);
  return row;
}

test('설정 — 행 없으면 기본값, 저장하면 마지막 행이 현재값, 버전 목록', async () => {
  // 다른 세션이 이미 저장한 행이 있을 수 있어 "기본값과 같다"는 단정 대신 모양만 본다
  const before = await getSettlementSettings(sql);
  assert.ok(before.categories.length >= 1 && before.rateKrwPerJpy >= 1);
  const mine = { ...SETTLEMENT_DEFAULTS, rateKrwPerJpy: 11, marker: P } as typeof SETTLEMENT_DEFAULTS & { marker: string };
  await saveSettlementSettings(sql, mine, null);
  const cur = await getSettlementSettings(sql);
  assert.equal(cur.rateKrwPerJpy, 11);
  const versions = await listSettlementVersions(sql, 1);
  assert.equal(versions.length, 1);
  // 원상복구 — 프로덕션 설정을 테스트 값으로 남기지 않는다
  await saveSettlementSettings(sql, { ...before, marker: P } as typeof before & { marker: string }, null);
  assert.equal((await getSettlementSettings(sql)).rateKrwPerJpy, before.rateKrwPerJpy);
});

test('후보 — 게시됨+비용+인플만, 명부/결제 수단 유무가 신호등, 활성 요청 있으면 제외', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, base(c.id, c.name, 'a'));
  await influencerWithPaypal(H('pay'));
  const { row: noPm } = await createInfluencer(sql, { handle: H('nopm'), createdBy: null });
  assert.ok(noPm);
  const [tPay, tNoPm, tNoRoster, tNoCost, tNotPosted] = await createTasks(sql, camp.id, {
    ...tin, type: 'quoteRt',
    items: [
      { handle: H('pay'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('nopm'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('ghost'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('pay'), cost: null },
      { handle: H('pay'), cost: { amount: 1000, currency: 'KRW' } },
    ],
  });
  for (const t of [tPay, tNoPm, tNoRoster, tNoCost]) await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/a/status/1' });
  const list = (await listCandidates(sql, SETTLEMENT_DEFAULTS, null, '2026-08-28')).filter((x) => x.influencerHandle.startsWith(P));
  const ids = list.map((x) => x.taskId);
  assert.ok(ids.includes(tPay.id) && ids.includes(tNoPm.id) && ids.includes(tNoRoster.id));
  assert.ok(!ids.includes(tNoCost.id) && !ids.includes(tNotPosted.id));
  const pay = list.find((x) => x.taskId === tPay.id)!;
  assert.equal(pay.money?.amountGross, 3158); assert.equal(pay.method?.type, 'paypal');
  assert.equal(pay.readiness, 'blocked');   // 인용RT 첫 요청 — 분류 빈칸
  assert.equal(pay.categoryDefault, null);
  assert.equal(list.find((x) => x.taskId === tNoPm.id)!.issues[0].code, 'no-payment-method');
  assert.equal(list.find((x) => x.taskId === tNoRoster.id)!.issues[0].code, 'no-influencer');
  assert.equal(pay.clientName, c.name); assert.equal(pay.campaignName, camp.name); assert.equal(pay.deadlineDefault, '2026-08-28');
});

test('lastQuoteRtCategory — 없으면 null', async () => {
  assert.equal(await lastQuoteRtCategory(sql, '00000000-0000-0000-0000-000000000000'), null);
  assert.equal(await lastQuoteRtCategory(sql, null), null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: FAIL — `Cannot find module './settlementStore.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/settlementStore.ts
// 정산 저장소(스펙 2026-08-28 §2·§5) — 후보는 계산, 요청은 스냅샷, 설정은 버전 행. 계산은 전부 settlementCalc에 위임.
import postgres from 'postgres';
import { kstToday } from './datetime.ts';
import { isUuidLike } from './uuid.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';
import type { TaskType, CampaignKind } from './campaignJudgment.ts';
import { getDefaultPaymentMethod, type PaymentMethod } from './influencerPayment.ts';
import { SETTLEMENT_DEFAULTS, sanitizeSettlementSettings, type SettlementSettings } from './settlementSettings.ts';
import { computeCandidate, type SettlementCandidate } from './settlementCalc.ts';

const asJson = (v: object): postgres.JSONValue => v as unknown as postgres.JSONValue;

// ── 설정(§2-2) ──
export async function getSettlementSettings(sql: postgres.Sql): Promise<SettlementSettings> {
  const rows = await sql<Array<{ settings: unknown }>>`
    select settings from settlement_setting_version order by created_at desc, id desc limit 1`;
  if (!rows.length) return SETTLEMENT_DEFAULTS;
  const s = sanitizeSettlementSettings(rows[0].settings);
  return typeof s === 'string' ? SETTLEMENT_DEFAULTS : s;   // 깨진 행이면 기본값으로 — 화면이 멈추지 않게
}
export async function saveSettlementSettings(sql: postgres.Sql, s: SettlementSettings, memberId: string | null): Promise<void> {
  await sql`insert into settlement_setting_version (settings, member_id) values (${sql.json(asJson(s))}, ${memberId})`;
}
export interface SettlementVersionRow { id: string; memberName: string | null; createdAt: string }
export async function listSettlementVersions(sql: postgres.Sql, limit = 5): Promise<SettlementVersionRow[]> {
  const rows = await sql<Array<{ id: string; created_at: Date; member_name: string | null }>>`
    select v.id, v.created_at, m.name as member_name
      from settlement_setting_version v left join member m on m.id = v.member_id
     order by v.created_at desc, v.id desc limit ${limit}`;
  return rows.map((r) => ({ id: r.id, memberName: r.member_name, createdAt: new Date(r.created_at).toISOString() }));
}

// ── 후보(§2-4) ──
// 요청자가 마지막에 고른 인용RT 분류 — 취소된 것도 "고른 값"이므로 status 무관
export async function lastQuoteRtCategory(sql: postgres.Sql, requesterMemberId: string | null): Promise<string | null> {
  if (!requesterMemberId || !isUuidLike(requesterMemberId)) return null;
  const rows = await sql<Array<{ category: string }>>`
    select category from payment_request
     where requester_member_id = ${requesterMemberId} and task_type = 'quoteRt'
     order by created_at desc, id desc limit 1`;
  return rows.length ? rows[0].category : null;
}

type CandRow = {
  id: string; type: TaskType; influencer_handle: string; cost: unknown; post_url: string | null; target_tweet_url: string | null;
  target_post_url: string | null; posted_at: string; removed_at: string | null; removed_reason: string; draft_label: string | null;
  campaign_id: string; campaign_name: string; kind: CampaignKind | null; client_id: string | null; client_name: string | null;
  influencer_id: string | null; payment_methods: unknown;
};
// 후보 조건은 campaignJudgment.isSettlementCandidate와 같은 정의 — 스토어 테스트가 대조한다
const CANDIDATE_SQL = (sql: postgres.Sql) => sql`
  select t.id, t.type, t.influencer_handle, t.cost, t.post_url, t.target_tweet_url, tg.post_url as target_post_url,
         to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, to_char(t.removed_at, 'YYYY-MM-DD') as removed_at, t.removed_reason,
         coalesce(d.title, d.ko_title) as draft_label,
         c.id as campaign_id, c.name as campaign_name, c.kind, c.client_id, c.client_name,
         i.id as influencer_id, i.payment_methods
    from campaign_task t
    join campaign c on c.id = t.campaign_id
    left join campaign_task tg on tg.id = t.target_task_id
    left join draft d on d.id = t.draft_id
    left join influencer i on lower(i.handle) = lower(t.influencer_handle)
   where t.posted_at is not null and t.cost is not null and t.influencer_handle is not null
     and not exists (select 1 from payment_request r where r.task_id = t.id and r.status = 'requested')`;

export async function listCandidates(
  sql: postgres.Sql, settings: SettlementSettings, requesterMemberId: string | null, today: string = kstToday(),
): Promise<SettlementCandidate[]> {
  const [rows, lastQ] = await Promise.all([
    sql<CandRow[]>`${CANDIDATE_SQL(sql)} order by t.posted_at asc, t.created_at asc, t.id asc`,
    lastQuoteRtCategory(sql, requesterMemberId),
  ]);
  const out: SettlementCandidate[] = [];
  for (const r of rows) {
    const cost = parseTaskCost(r.cost ?? null);
    if (!cost.ok) continue;   // jsonb 모양 보증 없음 — 검증 통과분만(campaignTaskStore.costOf 태도)
    out.push(rowToCandidate(r, cost.value, settings, lastQ, today));
  }
  return out;
}
function rowToCandidate(r: CandRow, cost: TaskCost, settings: SettlementSettings, lastQ: string | null, today: string): SettlementCandidate {
  const methods = Array.isArray(r.payment_methods) ? (r.payment_methods as PaymentMethod[]) : [];
  return computeCandidate({
    task: { id: r.id, type: r.type, influencerHandle: r.influencer_handle, cost, postUrl: r.post_url, targetTweetUrl: r.target_tweet_url, targetPostUrl: r.target_post_url, postedAt: r.posted_at, removedAt: r.removed_at, removedReason: r.removed_reason, draftLabel: r.draft_label },
    campaign: { id: r.campaign_id, name: r.campaign_name, kind: r.kind, clientId: r.client_id, clientName: r.client_name ?? '기타' },
    influencer: { inRoster: r.influencer_id !== null, method: r.influencer_id ? getDefaultPaymentMethod(methods) : null },
    settings, lastQuoteRtCategory: lastQ, today,
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: `pass 3`

- [ ] **Step 5: Commit**

```bash
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts
git commit -m "feat(settlement): 스토어 ① — 설정 버전 행·요청자 최근 인용RT 분류·정산 후보 조회(작업⋈캠페인⋈결제 수단, 활성 요청 제외)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 스토어 ② — 일괄 생성(전체 검증)·취소·목록·배지 조회

**Files:**
- Modify: `src/lib/settlementStore.ts`, `src/lib/settlementStore.test.ts`
- Modify: `src/lib/campaignTaskStore.ts` — `settlementByTaskIds`(배지용)는 **여기**에 둔다(campaignStore가 settlementStore를 import하면 influencerStore 경로로 순환)
- Modify: `src/lib/influencerStore.ts` — `InfluencerAutoEvent`에 `'payment_requested' | 'payment_cancelled'`, `LogPayload`에 `PaymentLogPayload`

**Interfaces:**
- Produces:
  ```ts
  // influencerStore.ts
  export interface PaymentLogPayload { requestId: string; amountGross: number; currency: Currency; taskType: TaskType; reason?: string }
  // settlementStore.ts
  export type RequestStatus = 'requested' | 'cancelled'
  export interface PaymentRequestRow { id; taskId: string | null; campaignId: string | null; campaignName; clientId: string | null; clientName; influencerHandle; taskType: TaskType; category; categoryDefault: string | null; itemText; purposeText; amountKrw: number; costCurrency: Currency; payoutCurrency: Currency; rateKrwPerJpy: number; amountNet: number; fee: PaymentFee | null; feeAmount: number; amountGross: number; deadlineOn: string; referenceUrl: string | null; paymentMethod: PaymentMethodSnapshot; requesterMemberId: string | null; requesterName: string; status: RequestStatus; cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null; sentAt: string | null; externalId: string | null; note: string; createdAt: string; updatedAt: string }
  export interface CreateItemInput { taskId: string; category: string; deadlineOn: string; referenceUrl: string | null; expected: { amountGross: number; payoutCurrency: Currency; paymentMethodId: string } }
  export class SettlementCreateError extends Error { failures: Array<{ taskId: string; reason: string }> }
  export async function createRequests(sql, items: CreateItemInput[], member: { id: string; name: string }, today?: string): Promise<PaymentRequestRow[]>   // throws SettlementCreateError
  export async function cancelRequest(sql, id: string, reason: string, member: { id: string; name: string }): Promise<PaymentRequestRow | 'not-found' | 'already-cancelled'>
  export interface RequestFilter { clientId?: string; campaignId?: string; status?: RequestStatus; from?: string; to?: string; taskId?: string }
  export async function listRequests(sql, f: RequestFilter): Promise<PaymentRequestRow[]>
  export async function settlementByTaskIds(sql, taskIds: string[]): Promise<Map<string, { status: RequestStatus; createdAt: string }>>   // 활성 우선, 없으면 최신 취소
  ```

- [ ] **Step 1: influencerStore 타입 확장**

`src/lib/influencerStore.ts`의 두 타입을 이렇게 바꾼다(Currency·TaskType import 추가):

```ts
import type { Currency } from './influencerPricing.ts';
import type { TaskType } from './campaignJudgment.ts';
// …
export type InfluencerAutoEvent =
  'draft_assigned' | 'draft_unassigned' | 'draft_delivered' | 'handle_changed' | 'pricing_changed'
  | 'payment_method_changed' | 'payment_requested' | 'payment_cancelled';
// 정산 요청/취소 한 줄 — 타임라인은 금액·통화·유형만 보인다(요청 상세는 정산 페이지)
export interface PaymentLogPayload { requestId: string; amountGross: number; currency: Currency; taskType: TaskType; reason?: string }
export type LogPayload = { from?: string; to?: string } | PricingChange | PaymentMethodChange | PaymentLogPayload;
```

(`influencerPricing`·`campaignJudgment` import가 이미 있으면 중복하지 않는다. `campaignJudgment`가 `influencerStore`를 import하지 않는지 확인 — 순환 없음: campaignJudgment는 influencerPricing만 본다.)

- [ ] **Step 2: 실패하는 테스트 추가 (같은 파일 끝에)**

```ts
import { createRequests, cancelRequest, listRequests, settlementByTaskIds, SettlementCreateError } from './settlementStore.ts';
import type { CreateItemInput } from './settlementStore.ts';

const MEMBER = { id: '00000000-0000-0000-0000-000000000001', name: P + '멤버' };
// member FK가 있어 실제 멤버가 필요 — 테스트 멤버를 만들고 after에서 지운다
let memberId = '';
async function ensureMember() {
  if (memberId) return { id: memberId, name: MEMBER.name };
  const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${MEMBER.name}, '#000') returning id`;
  memberId = m.id;
  return { id: memberId, name: MEMBER.name };
}
const itemOf = (c: { taskId: string; money: { amountGross: number; payoutCurrency: 'KRW' | 'JPY' } | null; method: { id: string } | null; deadlineDefault: string; referenceDefault: string | null }, category: string): CreateItemInput => ({
  taskId: c.taskId, category, deadlineOn: c.deadlineDefault, referenceUrl: c.referenceDefault,
  expected: { amountGross: c.money!.amountGross, payoutCurrency: c.money!.payoutCurrency, paymentMethodId: c.method!.id },
});

test('생성 — 스냅샷·로그·후보에서 제외·배지', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라B');
  const camp = await createCampaign(sql, base(c.id, c.name, 'b', 'visit'));
  await influencerWithPaypal(H('gen'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('gen'), cost: { amount: 200000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/g/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  assert.equal(cand.readiness, 'ready');
  assert.equal(cand.categoryDefault, SETTLEMENT_DEFAULTS.categories[1].sendAs);   // visit 캠페인 투고 → 원고료
  const [row] = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  assert.equal(row.status, 'requested'); assert.equal(row.amountKrw, 200000); assert.equal(row.amountNet, 20000); assert.equal(row.amountGross, 21053);
  assert.equal(row.category, cand.categoryDefault); assert.equal(row.categoryDefault, cand.categoryDefault);
  assert.equal(row.itemText, `@${H('gen')} 투고 1건 정산`); assert.equal(row.purposeText, `${c.name} 방문협찬 원고료`);
  assert.equal(row.paymentMethod.type, 'paypal'); assert.equal(row.requesterName, m.name); assert.equal(row.deadlineOn, '2026-08-28');
  assert.equal(row.sentAt, null);
  // 후보에서 빠짐
  assert.ok(!(await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).some((x) => x.taskId === t.id));
  // 로그 1건
  const logs = await sql<Array<{ event_type: string; payload: { requestId: string } }>>`
    select event_type, payload from influencer_log where influencer_id = (select id from influencer where handle = ${H('gen')}) and event_type = 'payment_requested'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.requestId, row.id);
  // 배지
  const badge = await settlementByTaskIds(sql, [t.id]);
  assert.equal(badge.get(t.id)?.status, 'requested');
  // 최근 인용RT 분류는 quoteRt만 본다
  assert.equal(await lastQuoteRtCategory(sql, m.id), null);
});

test('생성 — 전체 검증: 하나라도 실패면 0건 저장, 건별 이유', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라C');
  const camp = await createCampaign(sql, base(c.id, c.name, 'c'));
  await influencerWithPaypal(H('v1')); await influencerWithPaypal(H('v2'));
  const [t1, t2] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H('v1'), cost: { amount: 30000, currency: 'KRW' } }, { handle: H('v2'), cost: { amount: 30000, currency: 'KRW' } }] });
  for (const t of [t1, t2]) await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
  const cands = await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28');
  const c1 = cands.find((x) => x.taskId === t1.id)!, c2 = cands.find((x) => x.taskId === t2.id)!;
  // t2의 expected 금액을 틀리게(화면이 낡은 값을 들고 있던 상황)
  const stale = { ...itemOf(c2, c2.categoryDefault!), expected: { ...itemOf(c2, c2.categoryDefault!).expected, amountGross: 999 } };
  await assert.rejects(createRequests(sql, [itemOf(c1, c1.categoryDefault!), stale], m, '2026-08-28'), (e: unknown) => {
    assert.ok(e instanceof SettlementCreateError);
    assert.deepEqual(e.failures.map((f) => f.taskId), [t2.id]);
    assert.match(e.failures[0].reason, /금액이 바뀌었어요/);
    return true;
  });
  assert.equal((await listRequests(sql, { campaignId: camp.id })).length, 0);   // 0건 저장
  // 분류 빈칸·숨김/모르는 분류·날짜 형식·URL 형식
  await assert.rejects(createRequests(sql, [{ ...itemOf(c1, '없는 분류') }], m), (e: SettlementCreateError) => /분류/.test(e.failures[0].reason));
  await assert.rejects(createRequests(sql, [{ ...itemOf(c1, c1.categoryDefault!), deadlineOn: '2026-13-40' }], m), (e: SettlementCreateError) => /마감/.test(e.failures[0].reason));
  await assert.rejects(createRequests(sql, [{ ...itemOf(c1, c1.categoryDefault!), referenceUrl: 'ftp://x' }], m), (e: SettlementCreateError) => /링크/.test(e.failures[0].reason));
  // 정상 2건 → 저장, 같은 작업 다시 → 전체 거절(이미 요청됨)
  const rows = await createRequests(sql, [itemOf(c1, c1.categoryDefault!), itemOf(c2, c2.categoryDefault!)], m, '2026-08-28');
  assert.equal(rows.length, 2);
  await assert.rejects(createRequests(sql, [itemOf(c1, c1.categoryDefault!)], m), (e: SettlementCreateError) => /이미 요청됐어요/.test(e.failures[0].reason));
});

test('취소 — 상태·사유·사람·시각, 후보 복귀, 재요청 허용, 배지는 취소됨', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라D');
  const camp = await createCampaign(sql, base(c.id, c.name, 'd'));
  await influencerWithPaypal(H('cx'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H('cx'), cost: { amount: 10000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const [row] = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  const cancelled = await cancelRequest(sql, row.id, '금액 착오', m);
  assert.ok(typeof cancelled === 'object');
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.cancelReason, '금액 착오'); assert.equal(cancelled.cancelledByName, m.name); assert.ok(cancelled.cancelledAt);
  assert.equal(await cancelRequest(sql, row.id, '다시', m), 'already-cancelled');
  assert.equal(await cancelRequest(sql, '00000000-0000-0000-0000-000000000009', 'x', m), 'not-found');
  assert.ok((await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).some((x) => x.taskId === t.id));   // 복귀
  assert.equal((await settlementByTaskIds(sql, [t.id])).get(t.id)?.status, 'cancelled');
  const again = await createRequests(sql, [itemOf(cand, cand.categoryDefault!)], m, '2026-08-28');
  assert.equal(again.length, 1);
  assert.equal((await settlementByTaskIds(sql, [t.id])).get(t.id)?.status, 'requested');   // 활성 우선
  const logs = await sql<Array<{ event_type: string }>>`select event_type from influencer_log where influencer_id = (select id from influencer where handle = ${H('cx')}) order by created_at`;
  assert.deepEqual(logs.map((l) => l.event_type), ['payment_method_changed', 'payment_requested', 'payment_cancelled', 'payment_requested']);
  // 목록 필터
  const list = await listRequests(sql, { campaignId: camp.id, status: 'cancelled' });
  assert.equal(list.length, 1); assert.equal(list[0].id, row.id);
  assert.equal((await listRequests(sql, { taskId: t.id })).length, 2);
});
```

`after()` 정리에 멤버 삭제를 추가한다(파일 상단 after 블록 안, 마지막 `sql.end()` 직전): `await sql\`delete from member where name = ${P + '멤버'}\`;` — payment_request의 requester FK는 set null이지만 요청 행은 위에서 먼저 지워진다.

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: FAIL — `createRequests is not exported` 류.

- [ ] **Step 4: 구현 (settlementStore.ts에 추가)**

```ts
import type { Currency } from './influencerPricing.ts';
import type { PaymentFee } from './influencerPayment.ts';
import { insertAutoLog, type PaymentLogPayload } from './influencerStore.ts';
import { categoryBySendAs } from './settlementSettings.ts';
import { toMethodSnapshot, type PaymentMethodSnapshot } from './settlementCalc.ts';
import { isDateOnlyString } from './campaignJudgment.ts';   // 'YYYY-MM-DD' + 실제 달력일 검증(캠페인 라우트 가드)

export type RequestStatus = 'requested' | 'cancelled';
export interface PaymentRequestRow {
  id: string; taskId: string | null; campaignId: string | null; campaignName: string; clientId: string | null; clientName: string;
  influencerHandle: string; taskType: TaskType; category: string; categoryDefault: string | null; itemText: string; purposeText: string;
  amountKrw: number; costCurrency: Currency; payoutCurrency: Currency; rateKrwPerJpy: number; amountNet: number;
  fee: PaymentFee | null; feeAmount: number; amountGross: number; deadlineOn: string; referenceUrl: string | null;
  paymentMethod: PaymentMethodSnapshot; requesterMemberId: string | null; requesterName: string;
  status: RequestStatus; cancelledAt: string | null; cancelledByName: string | null; cancelReason: string | null;
  sentAt: string | null; externalId: string | null; note: string; createdAt: string; updatedAt: string;
}
export interface CreateItemInput {
  taskId: string; category: string; deadlineOn: string; referenceUrl: string | null;
  expected: { amountGross: number; payoutCurrency: Currency; paymentMethodId: string };
}
export class SettlementCreateError extends Error {
  constructor(public failures: Array<{ taskId: string; reason: string }>) { super('settlement-create-failed'); this.name = 'SettlementCreateError'; }
}

type RRow = {
  id: string; task_id: string | null; campaign_id: string | null; campaign_name: string; client_id: string | null; client_name: string;
  influencer_handle: string; task_type: TaskType; category: string; category_default: string | null; item_text: string; purpose_text: string;
  amount_krw: number; cost_currency: Currency; payout_currency: Currency; rate_krw_per_jpy: number; amount_net: number;
  fee: PaymentFee | null; fee_amount: number; amount_gross: number; deadline_on: string; reference_url: string | null;
  payment_method: PaymentMethodSnapshot; requester_member_id: string | null; requester_name: string;
  status: RequestStatus; cancelled_at: Date | null; cancelled_by_name: string | null; cancel_reason: string | null;
  sent_at: Date | null; external_id: string | null; note: string; created_at: Date; updated_at: Date;
};
const R_SELECT = (sql: postgres.Sql) => sql`
  select id, task_id, campaign_id, campaign_name, client_id, client_name, influencer_handle, task_type, category, category_default,
         item_text, purpose_text, amount_krw, cost_currency, payout_currency, rate_krw_per_jpy, amount_net, fee, fee_amount, amount_gross,
         to_char(deadline_on, 'YYYY-MM-DD') as deadline_on, reference_url, payment_method, requester_member_id, requester_name,
         status, cancelled_at, cancelled_by_name, cancel_reason, sent_at, external_id, note, created_at, updated_at
    from payment_request`;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
const toRequest = (r: RRow): PaymentRequestRow => ({
  id: r.id, taskId: r.task_id, campaignId: r.campaign_id, campaignName: r.campaign_name, clientId: r.client_id, clientName: r.client_name,
  influencerHandle: r.influencer_handle, taskType: r.task_type, category: r.category, categoryDefault: r.category_default, itemText: r.item_text, purposeText: r.purpose_text,
  amountKrw: r.amount_krw, costCurrency: r.cost_currency, payoutCurrency: r.payout_currency, rateKrwPerJpy: r.rate_krw_per_jpy, amountNet: r.amount_net,
  fee: r.fee, feeAmount: r.fee_amount, amountGross: r.amount_gross, deadlineOn: r.deadline_on, referenceUrl: r.reference_url,
  paymentMethod: r.payment_method, requesterMemberId: r.requester_member_id, requesterName: r.requester_name,
  status: r.status, cancelledAt: iso(r.cancelled_at), cancelledByName: r.cancelled_by_name, cancelReason: r.cancel_reason,
  sentAt: iso(r.sent_at), externalId: r.external_id, note: r.note, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

const isHttpUrl = (u: string) => /^https?:\/\/\S+$/.test(u);

// §5-2 전부 검증 → 전부 저장. 하나라도 실패면 0건(koo 08-28 "튕겨서 다시 보게").
export async function createRequests(
  sql: postgres.Sql, items: CreateItemInput[], member: { id: string; name: string }, today: string = kstToday(),
): Promise<PaymentRequestRow[]> {
  if (items.length === 0) throw new SettlementCreateError([]);
  const settings = await getSettlementSettings(sql);
  const lastQ = await lastQuoteRtCategory(sql, member.id);
  const ids = items.map((i) => i.taskId).filter(isUuidLike);
  const rows = await sql<CandRow[]>`${CANDIDATE_SQL(sql)} and t.id in ${sql(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}`;
  const byTask = new Map(rows.map((r) => [r.id, r]));
  const failures: Array<{ taskId: string; reason: string }> = [];
  const prepared: Array<{ item: CreateItemInput; cand: SettlementCandidate; r: CandRow }> = [];
  for (const item of items) {
    const r = byTask.get(item.taskId);
    if (!r) {   // 후보가 아니거나(게시 취소·비용 삭제) 이미 활성 요청이 있다
      const active = isUuidLike(item.taskId) ? await sql<Array<{ requester_name: string }>>`select requester_name from payment_request where task_id = ${item.taskId} and status = 'requested'` : [];
      failures.push({ taskId: item.taskId, reason: active.length ? `이미 요청됐어요 (${active[0].requester_name})` : '지금은 정산 후보가 아니에요 — 목록을 다시 확인해 주세요' });
      continue;
    }
    const cost = parseTaskCost(r.cost ?? null);
    if (!cost.ok) { failures.push({ taskId: item.taskId, reason: '비용 형식이 올바르지 않아요' }); continue; }
    const cand = rowToCandidate(r, cost.value, settings, lastQ, today);
    if (!cand.method || !cand.money) { failures.push({ taskId: item.taskId, reason: cand.issues.find((x) => x.level === 'blocked')?.text ?? '결제 수단이 없어요' }); continue; }
    const cat = categoryBySendAs(settings, item.category);
    if (!cat || cat.hidden) { failures.push({ taskId: item.taskId, reason: '분류를 다시 골라 주세요 — 목록에 없는 분류예요' }); continue; }
    if (!isDateOnlyString(item.deadlineOn)) { failures.push({ taskId: item.taskId, reason: '마감일 형식을 확인해 주세요' }); continue; }
    if (item.referenceUrl !== null && item.referenceUrl !== '' && !isHttpUrl(item.referenceUrl)) { failures.push({ taskId: item.taskId, reason: '참고 링크는 http(s) 주소여야 해요' }); continue; }
    if (cand.money.amountGross !== item.expected.amountGross || cand.money.payoutCurrency !== item.expected.payoutCurrency) {
      failures.push({ taskId: item.taskId, reason: '금액이 바뀌었어요 — 다시 확인해 주세요' }); continue;
    }
    if (cand.method.id !== item.expected.paymentMethodId) { failures.push({ taskId: item.taskId, reason: '결제 수단이 바뀌었어요 — 다시 확인해 주세요' }); continue; }
    prepared.push({ item, cand, r });
  }
  if (failures.length) throw new SettlementCreateError(failures);

  try {
    return await sql.begin(async (tx) => {
      const out: PaymentRequestRow[] = [];
      for (const { item, cand, r } of prepared) {
        const m = cand.money!; const pm = cand.method!;
        const ins = await tx<RRow[]>`
          insert into payment_request (task_id, campaign_id, campaign_name, client_id, client_name, influencer_handle, task_type,
            category, category_default, item_text, purpose_text, amount_krw, cost_currency, payout_currency, rate_krw_per_jpy,
            amount_net, fee, fee_amount, amount_gross, deadline_on, reference_url, payment_method, requester_member_id, requester_name)
          values (${cand.taskId}, ${cand.campaignId}, ${cand.campaignName}, ${cand.clientId}, ${cand.clientName}, ${cand.influencerHandle}, ${cand.taskType},
            ${item.category}, ${cand.categoryDefault}, ${cand.itemText}, ${cand.purposeText}, ${m.amountKrw}, ${m.costCurrency}, ${m.payoutCurrency}, ${m.rateKrwPerJpy},
            ${m.amountNet}, ${m.fee ? tx.json(asJson(m.fee)) : null}, ${m.feeAmount}, ${m.amountGross}, ${item.deadlineOn}, ${item.referenceUrl || null},
            ${tx.json(asJson(toMethodSnapshot(pm)))}, ${member.id}, ${member.name})
          returning *, to_char(deadline_on, 'YYYY-MM-DD') as deadline_on`;
        const row = toRequest(ins[0]);
        const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType };
        if (r.influencer_id) await insertAutoLog(tx as unknown as postgres.Sql, { influencerId: r.influencer_id, eventType: 'payment_requested', draftId: null, draftTitle: null, payload, authorId: member.id });
        out.push(row);
      }
      return out;
    });
  } catch (e) {
    // 동시 클릭으로 unique(활성 요청 1건) 위반 — 어느 작업인지 다시 조회해 건별 이유로
    if ((e as { code?: string }).code === '23505') {
      const dup = await sql<Array<{ task_id: string; requester_name: string }>>`
        select task_id, requester_name from payment_request where status = 'requested' and task_id in ${sql(prepared.map((p) => p.cand.taskId))}`;
      throw new SettlementCreateError(dup.map((d) => ({ taskId: d.task_id, reason: `이미 요청됐어요 (${d.requester_name})` })));
    }
    throw e;
  }
}

export async function cancelRequest(
  sql: postgres.Sql, id: string, reason: string, member: { id: string; name: string },
): Promise<PaymentRequestRow | 'not-found' | 'already-cancelled'> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx) => {
    const cur = await tx<RRow[]>`${R_SELECT(tx as unknown as postgres.Sql)} where id = ${id} for update`;
    if (!cur.length) return 'not-found';
    if (cur[0].status === 'cancelled') return 'already-cancelled';
    const upd = await tx<RRow[]>`
      update payment_request set status = 'cancelled', cancelled_at = now(), cancelled_by = ${member.id}, cancelled_by_name = ${member.name},
             cancel_reason = ${reason}, updated_at = now()
       where id = ${id} returning *, to_char(deadline_on, 'YYYY-MM-DD') as deadline_on`;
    const row = toRequest(upd[0]);
    const inf = await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${row.influencerHandle})`;
    if (inf.length) {
      const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType, reason };
      await insertAutoLog(tx as unknown as postgres.Sql, { influencerId: inf[0].id, eventType: 'payment_cancelled', draftId: null, draftTitle: null, payload, authorId: member.id });
    }
    return row;
  });
}

export interface RequestFilter { clientId?: string; campaignId?: string; status?: RequestStatus; from?: string; to?: string; taskId?: string }
export async function listRequests(sql: postgres.Sql, f: RequestFilter): Promise<PaymentRequestRow[]> {
  const rows = await sql<RRow[]>`${R_SELECT(sql)}
    where true
      ${f.clientId && isUuidLike(f.clientId) ? sql`and client_id = ${f.clientId}` : sql``}
      ${f.campaignId && isUuidLike(f.campaignId) ? sql`and campaign_id = ${f.campaignId}` : sql``}
      ${f.taskId && isUuidLike(f.taskId) ? sql`and task_id = ${f.taskId}` : sql``}
      ${f.status ? sql`and status = ${f.status}` : sql``}
      ${f.from && isDateOnlyString(f.from) ? sql`and created_at >= (${f.from}::date)::timestamptz` : sql``}
      ${f.to && isDateOnlyString(f.to) ? sql`and created_at < ((${f.to}::date) + 1)::timestamptz` : sql``}
    order by created_at desc, id desc`;
  return rows.map(toRequest);
}

// 배지 조회(settlementByTaskIds)는 campaignTaskStore에 있다(순환 방지: settlementStore→influencerStore→campaignStore) — 여기서는 re-export만
export { settlementByTaskIds } from './campaignTaskStore.ts';
```

`src/lib/campaignTaskStore.ts` 끝에 추가:
```ts
// 캠페인 표 정산 배지(정산 스펙 §4-4) — 활성 요청 우선, 없으면 가장 최근 취소. payment_request는 040.
export type SettlementBadgeStatus = 'requested' | 'cancelled';
export async function settlementByTaskIds(sql: postgres.Sql, taskIds: string[]): Promise<Map<string, { status: SettlementBadgeStatus; createdAt: string }>> {
  const ids = taskIds.filter(isUuidLike);
  if (!ids.length) return new Map();
  const rows = await sql<Array<{ task_id: string; status: SettlementBadgeStatus; created_at: Date }>>`
    select distinct on (task_id) task_id, status, created_at
      from payment_request where task_id in ${sql(ids)}
     order by task_id, (status = 'requested') desc, created_at desc`;
  return new Map(rows.map((r) => [r.task_id, { status: r.status, createdAt: new Date(r.created_at).toISOString() }]));
}
```

`returning *, to_char(...)`: postgres.js에서 `returning *`에 같은 이름 별칭을 덧붙이면 뒤 열이 이긴다 — `deadline_on`이 문자열로 온다. 불안하면 insert 후 `R_SELECT … where id = ${ins[0].id}`로 다시 읽는다(두 문장, 같은 트랜잭션).

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: `pass 6`. 실패 시 `after()` 정리가 돌았는지(`select count(*) from payment_request where influencer_handle like 'tstl%'` = 0) 확인.

- [ ] **Step 6: 기존 영향 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/influencerStore.test.ts src/lib/influencerPayment.test.ts`
Expected: 전부 pass(타입만 넓혔다).

- [ ] **Step 7: Commit**

```bash
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts src/lib/influencerStore.ts src/lib/campaignTaskStore.ts
git commit -m "feat(settlement): 스토어 ② — 일괄 생성(전부 재계산·검증→전부 저장, 실패 시 0건+건별 이유)·사유 있는 취소·목록·배지 조회 + 인플 활동 기록 2종

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 6: 내부 API 4개 + 브라우저 래퍼

**Files:**
- Create: `src/app/api/settlement/candidates/route.ts`, `src/app/api/settlement/requests/route.ts`, `src/app/api/settlement/requests/[id]/route.ts`, `src/app/api/settlement/settings/route.ts`, `src/lib/settlementApi.ts`

**Interfaces:**
- Consumes: Task 4·5 스토어 전부; `requireAllowedUser`·`requireMember` `@/lib/authGuard`; `getSql` `@/lib/db`; `toApiResult`·`ApiResult` from `@/lib/campaignApi`(export 되어 있다) 또는 동일 패턴 복제.
- Produces(브라우저용):
  ```ts
  export const fetchCandidates = () => ApiResult<{ candidates: SettlementCandidate[]; settings: SettlementSettings; today: string }>
  export const fetchRequests = (f: RequestFilter) => ApiResult<PaymentRequestRow[]>
  export const createRequestsApi = (items: CreateItemInput[]) => ApiResult<{ created: PaymentRequestRow[] }>   // 409면 error 문구 + failures
  export type CreateFailure = { taskId: string; reason: string }
  export const cancelRequestApi = (id: string, reason: string) => ApiResult<PaymentRequestRow>
  export const fetchSettlementSettings = () => ApiResult<{ settings: SettlementSettings; versions: SettlementVersionRow[] }>
  export const saveSettlementSettingsApi = (settings: SettlementSettings) => ApiResult<{ settings: SettlementSettings }>
  ```
  409 응답 body: `{ error: '만들지 못했어요 — 아래 건을 확인해 주세요', failures: CreateFailure[] }`. 래퍼는 `ApiResult`의 `error`에 문구를, 추가로 `failures`를 얹기 위해 `createRequestsApi`만 별도 처리한다.

- [ ] **Step 1: 라우트 — candidates**

```ts
// src/app/api/settlement/candidates/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { kstToday } from '@/lib/datetime';
import { getSettlementSettings, listCandidates } from '@/lib/settlementStore';

// 후보는 저장하지 않고 계산한다(§2-4). requireMember — 요청자 최근 인용RT 분류(§3-3)에 멤버가 필요하다.
export async function GET() {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const settings = await getSettlementSettings(sql);
  const today = kstToday();
  const candidates = await listCandidates(sql, settings, gate.member.id, today);
  return NextResponse.json({ candidates, settings, today });
}
```

- [ ] **Step 2: 라우트 — requests (GET 목록 · POST 일괄 생성)**

```ts
// src/app/api/settlement/requests/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { listRequests, createRequests, SettlementCreateError, type CreateItemInput, type RequestStatus } from '@/lib/settlementStore';

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const q = new URL(req.url).searchParams;
  const status = q.get('status');
  const rows = await listRequests(getSql(), {
    clientId: q.get('clientId') ?? undefined, campaignId: q.get('campaignId') ?? undefined, taskId: q.get('taskId') ?? undefined,
    status: status === 'requested' || status === 'cancelled' ? (status as RequestStatus) : undefined,
    from: q.get('from') ?? undefined, to: q.get('to') ?? undefined,
  });
  return NextResponse.json(rows);
}

// 일괄 생성(§5-2) — 하나라도 실패면 0건 저장 + 409 건별 이유. body의 사람 정보는 무시(요청자 = 서버가 해석한 멤버).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { items?: unknown };
  const items = parseItems(body.items);
  if (typeof items === 'string') return NextResponse.json({ error: items }, { status: 400 });
  try {
    const created = await createRequests(getSql(), items, { id: gate.member.id, name: gate.member.name });
    return NextResponse.json({ created });
  } catch (e) {
    if (e instanceof SettlementCreateError) {
      return NextResponse.json({ error: '만들지 못했어요 — 아래 건을 확인해 주세요', failures: e.failures }, { status: 409 });
    }
    throw e;
  }
}

function parseItems(v: unknown): CreateItemInput[] | string {
  if (!Array.isArray(v) || v.length === 0) return '요청할 작업을 골라 주세요';
  if (v.length > 200) return '한 번에 200건까지 만들 수 있어요';
  const out: CreateItemInput[] = [];
  for (const raw of v as unknown[]) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const ex = (o.expected ?? {}) as Record<string, unknown>;
    if (typeof o.taskId !== 'string' || typeof o.category !== 'string' || typeof o.deadlineOn !== 'string') return '요청 형식이 올바르지 않아요';
    if (typeof ex.amountGross !== 'number' || (ex.payoutCurrency !== 'KRW' && ex.payoutCurrency !== 'JPY') || typeof ex.paymentMethodId !== 'string') return '요청 형식이 올바르지 않아요';
    out.push({
      taskId: o.taskId, category: o.category.trim(), deadlineOn: o.deadlineOn,
      referenceUrl: typeof o.referenceUrl === 'string' && o.referenceUrl.trim() ? o.referenceUrl.trim() : null,
      expected: { amountGross: ex.amountGross, payoutCurrency: ex.payoutCurrency, paymentMethodId: ex.paymentMethodId },
    });
  }
  return out;
}
```

- [ ] **Step 3: 라우트 — requests/[id] (PATCH 취소)**

```ts
// src/app/api/settlement/requests/[id]/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { cancelRequest } from '@/lib/settlementStore';

export const CANCEL_REASON_MESSAGE = '취소 사유를 1~200자로 적어 주세요';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown };
  if (body.action !== 'cancel') return NextResponse.json({ error: '지원하지 않는 동작이에요' }, { status: 400 });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 200) return NextResponse.json({ error: CANCEL_REASON_MESSAGE }, { status: 400 });
  const r = await cancelRequest(getSql(), id, reason, { id: gate.member.id, name: gate.member.name });
  if (r === 'not-found') return NextResponse.json({ error: '요청을 찾을 수 없어요 — 화면을 새로고침해 주세요' }, { status: 404 });
  if (r === 'already-cancelled') return NextResponse.json({ error: '이미 취소된 요청이에요' }, { status: 409 });
  return NextResponse.json(r);
}
```

(Next.js 라우트 파일에서 `export const CANCEL_REASON_MESSAGE`가 빌드 경고를 내면 상수를 파일 내부 `const`로 내린다 — 라우트 파일은 HTTP 핸들러만 export해야 한다.)

- [ ] **Step 4: 라우트 — settings**

```ts
// src/app/api/settlement/settings/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { sanitizeSettlementSettings } from '@/lib/settlementSettings';
import { getSettlementSettings, saveSettlementSettings, listSettlementVersions } from '@/lib/settlementStore';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const [settings, versions] = await Promise.all([getSettlementSettings(sql), listSettlementVersions(sql, 5)]);
  return NextResponse.json({ settings, versions });
}

export async function PUT(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { settings?: unknown };
  const clean = sanitizeSettlementSettings(body.settings);
  if (typeof clean === 'string') return NextResponse.json({ error: clean }, { status: 400 });
  await saveSettlementSettings(getSql(), clean, gate.member.id);   // 저장자 = 서버가 해석한 멤버(프롬프트 설정 관례)
  return NextResponse.json({ settings: clean });
}
```

- [ ] **Step 5: 브라우저 래퍼**

```ts
// src/lib/settlementApi.ts
// 정산 화면 전용 fetch 래퍼 — campaignApi와 같은 모양(ApiResult). 409의 failures만 추가로 실어 준다.
import { apiFetch } from './apiFetch.ts';
import { toApiResult, type ApiResult } from './campaignApi.ts';
import type { SettlementCandidate } from './settlementCalc.ts';
import type { SettlementSettings } from './settlementSettings.ts';
import type { PaymentRequestRow, CreateItemInput, RequestFilter, SettlementVersionRow } from './settlementStore.ts';

export type CreateFailure = { taskId: string; reason: string };
export type CreateResult = ApiResult<{ created: PaymentRequestRow[] }> & { failures?: CreateFailure[] };

const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function call<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try { return await toApiResult<T>(await apiFetch(input, init)); }
  catch (e) {
    if (e instanceof Error && e.message === 'unauthorized') throw e;
    return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요', status: 0 };
  }
}

export const fetchCandidates = () => call<{ candidates: SettlementCandidate[]; settings: SettlementSettings; today: string }>('/api/settlement/candidates');
export const fetchRequests = (f: RequestFilter) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  const qs = p.toString();
  return call<PaymentRequestRow[]>(`/api/settlement/requests${qs ? `?${qs}` : ''}`);
};
export async function createRequestsApi(items: CreateItemInput[]): Promise<CreateResult> {
  try {
    const r = await apiFetch('/api/settlement/requests', json('POST', { items }));
    const body: unknown = await r.json().catch(() => null);
    if (r.ok) return { ok: true, data: body as { created: PaymentRequestRow[] } };
    const b = (body ?? {}) as { error?: string; failures?: CreateFailure[] };
    return { ok: false, error: b.error ?? `오류 ${r.status}`, status: r.status, failures: b.failures };
  } catch (e) {
    if (e instanceof Error && e.message === 'unauthorized') throw e;
    return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요', status: 0 };
  }
}
export const cancelRequestApi = (id: string, reason: string) => call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'cancel', reason }));
export const fetchSettlementSettings = () => call<{ settings: SettlementSettings; versions: SettlementVersionRow[] }>('/api/settlement/settings');
export const saveSettlementSettingsApi = (settings: SettlementSettings) => call<{ settings: SettlementSettings }>('/api/settlement/settings', json('PUT', { settings }));
```

- [ ] **Step 6: 타입 체크·린트**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "settlement|campaignApi" | head; npx eslint src/app/api/settlement src/lib/settlementApi.ts`
Expected: 출력 없음(오류 0). `toApiResult`가 `campaignApi.ts`에서 export 되지 않았다면 export 한 줄 추가.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/settlement src/lib/settlementApi.ts src/lib/campaignApi.ts
git commit -m "feat(settlement): 내부 API — 후보 조회·요청 목록/일괄 생성(409 건별 이유)·취소·설정 + 브라우저 래퍼

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 7: 화면 ① — `/settlement` 셸·탭·사이드바 + 검토 대기(B안 두 줄 행)·확인 창

**Files:**
- Create: `src/app/settlement/layout.tsx`, `src/app/settlement/page.tsx`, `src/app/settlement/tabs.ts`, `src/app/settlement/readinessView.ts`, `src/app/settlement/CandidateTable.tsx`, `src/app/settlement/CandidateRow.tsx`, `src/app/settlement/CreateConfirmDialog.tsx`, `src/app/settlement/money.ts`
- Modify: `src/components/Sidebar.tsx:57` (캠페인 아래 한 줄)

**Interfaces:**
- Consumes: Task 6 `fetchCandidates`·`createRequestsApi`·`CreateFailure`; `SettlementCandidate`·`MoneyCalc`·`ReadinessLevel` from `@/lib/settlementCalc`; `visibleCategories` `@/lib/settlementSettings`; `describeMethod`·`PAYMENT_TYPE_LABEL` `@/lib/influencerPayment`; `TASK_TYPE_LABEL` `@/lib/campaignJudgment`; `formatMoney` `@/lib/influencerPricing`; `Button`·`PANEL` `@/components/ui`; `useToast` `@/lib/toastContext`; `GlobalShell`.
- Produces: `RowEdit = { category: string | null; deadlineOn: string; referenceUrl: string }`(행별 편집 상태), `formatKrwToPayout(m: MoneyCalc): { base: string; fee: string | null }`.

- [ ] **Step 1: 사이드바**

`src/components/Sidebar.tsx`의 `globalNav`에서 `{ href: '/campaigns', label: '캠페인', Ic: CampaignIcon },` 바로 다음 줄에:
```ts
    // 정산은 캠페인 바로 아래 — 만든 것(작업) → 돈 보내는 것(요청) 순으로 읽힌다(정산 스펙 §4)
    { href: '/settlement', label: '정산', Ic: CampaignIcon },
```
(아이콘은 우선 `CampaignIcon` 재사용. `XIcons.tsx`에 지갑/영수증 모양 아이콘이 있으면 그걸 쓴다 — 없으면 새로 그리지 않는다, YAGNI.)

- [ ] **Step 2: 탭 헬퍼 (순수, `profileTabs.ts` 문법)**

```ts
// src/app/settlement/tabs.ts
export type SettlementTab = 'candidates' | 'requests' | 'settings';
export const SETTLEMENT_TABS: readonly SettlementTab[] = ['candidates', 'requests', 'settings'];
export const SETTLEMENT_TAB_LABEL: Record<SettlementTab, string> = { candidates: '검토 대기', requests: '요청 내역', settings: '설정' };
export function parseSettlementTab(v: string | null): SettlementTab {
  return (SETTLEMENT_TABS as readonly string[]).includes(v ?? '') ? (v as SettlementTab) : 'candidates';
}
```

- [ ] **Step 3: 신호등 표시 헬퍼 + 금액 표시 헬퍼 (순수)**

```ts
// src/app/settlement/readinessView.ts
import type { ReadinessLevel, SettlementCandidate } from '@/lib/settlementCalc';
// 색은 신호등 3색만 — 라벨-값 일치(UX 원칙 4): 값은 서버가 계산한 readiness에서만 파생
export const READINESS_STYLE: Record<ReadinessLevel, { dot: string; text: string; label: string }> = {
  ready:   { dot: 'bg-emerald-500', text: 'text-emerald-700', label: '보낼 수 있음' },
  warn:    { dot: 'bg-amber-500',   text: 'text-amber-700',   label: '확인 필요' },
  blocked: { dot: 'bg-red-500',     text: 'text-red-700',     label: '못 보냄' },
};
// 행의 실제 신호등 — 서버 값에 "사람이 분류를 골랐는지"만 얹는다(분류 빈칸은 🔴, 골랐으면 그 이유가 빠진다)
export function effectiveReadiness(c: SettlementCandidate, e: { category: string | null } | undefined): ReadinessLevel {
  const issues = c.issues.filter((i) => !(i.code === 'no-category' && e?.category));
  if (issues.some((i) => i.level === 'blocked')) return 'blocked';
  return issues.length ? 'warn' : 'ready';
}
```
```ts
// src/app/settlement/money.ts
import { formatMoney } from '@/lib/influencerPricing';
import type { MoneyCalc } from '@/lib/settlementCalc';
// '₩30,000 → ¥3,000' + 수수료 조각 '+ 158'. 원가와 지급액을 항상 둘 다, 수수료는 분리(스펙 §4-1 "이름만 바꿔 붙이지 않는다").
// 같은 통화면 화살표 없이 지급액만.
export function formatKrwToPayout(m: MoneyCalc): { base: string; fee: string | null } {
  const cost = formatMoney(m.costAmount, m.costCurrency);
  const net = formatMoney(m.amountNet, m.payoutCurrency);
  const base = m.costCurrency === m.payoutCurrency ? net : `${cost} → ${net}`;
  return { base, fee: m.feeAmount > 0 ? `+ ${m.feeAmount.toLocaleString('ko-KR')}` : null };
}
```

- [ ] **Step 4: 레이아웃·페이지(탭 라우팅)**

```tsx
// src/app/settlement/layout.tsx
'use client';
import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';
// 토스트 프로바이더 필수 — 이 화면은 만들기·취소 결과를 토스트로만 알린다(campaigns/layout.tsx와 같은 이유)
export default function SettlementLayout({ children }: { children: React.ReactNode }) {
  return <GlobalShell><ToastProvider>{children}</ToastProvider></GlobalShell>;
}
```
```tsx
// src/app/settlement/page.tsx
'use client';
import { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SETTLEMENT_TABS, SETTLEMENT_TAB_LABEL, parseSettlementTab, type SettlementTab } from './tabs';
import { CandidateTable } from './CandidateTable';
import { RequestList } from './RequestList';
import { SettingsTab } from './SettingsTab';

function SettlementInner() {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const tab = parseSettlementTab(sp.get('tab'));
  const setTab = useCallback((t: SettlementTab) => {
    const p = new URLSearchParams(sp.toString());
    if (t === 'candidates') p.delete('tab'); else p.set('tab', t);
    p.delete('task');
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, sp]);
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-6">
      <h1 className="text-[20px] font-bold">정산</h1>
      <p className="mt-1 text-ui text-x-muted">캠페인에서 게시 확인된 작업이 자동으로 모여요. 확인하고 골라서 요청을 만들어요.</p>
      <nav className="mt-4 flex gap-1 border-b border-x-border" aria-label="정산 탭">
        {SETTLEMENT_TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
                  className={`px-3.5 py-2 text-ui ${tab === t ? 'border-b-2 border-x-blue font-semibold text-x-text' : 'text-x-secondary hover:text-x-text'}`}>
            {SETTLEMENT_TAB_LABEL[t]}
          </button>
        ))}
      </nav>
      <div className="mt-5">
        {tab === 'candidates' && <CandidateTable />}
        {tab === 'requests' && <RequestList focusTaskId={sp.get('task')} />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </main>
  );
}
export default function SettlementPage() {
  return <Suspense fallback={null}><SettlementInner /></Suspense>;
}
```
(`RequestList`·`SettingsTab`은 Task 8·9에서 만든다 — 이 작업에서는 두 파일을 **빈 껍데기**로 먼저 만든다: `export function RequestList(_: { focusTaskId: string | null }) { return <p className="text-ui text-x-muted">요청 내역 — 준비 중</p>; }`, `export function SettingsTab() { return null; }`. 탭 개수 표시(`검토 대기 5`)는 CandidateTable이 자기 제목에 보인다.)

- [ ] **Step 5: 검토 대기 표**

```tsx
// src/app/settlement/CandidateTable.tsx
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { fetchCandidates, createRequestsApi, type CreateFailure } from '@/lib/settlementApi';
import type { SettlementCandidate } from '@/lib/settlementCalc';
import type { SettlementSettings } from '@/lib/settlementSettings';
import { visibleCategories } from '@/lib/settlementSettings';
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { PAYMENT_TYPES, PAYMENT_TYPE_LABEL, type PaymentMethodType } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { CandidateRow, type RowEdit } from './CandidateRow';
import { CreateConfirmDialog } from './CreateConfirmDialog';
import { effectiveReadiness } from './readinessView';

const SEL = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-ui';
const deadlineLabel = (ymd: string) => {
  const d = new Date(ymd + 'T12:00:00Z');
  return `${d.getUTCMonth() + 1}-${d.getUTCDate()}(${'일월화수목금토'[d.getUTCDay()]})`;
};

export function CandidateTable() {
  const { show } = useToast();
  const [data, setData] = useState<{ candidates: SettlementCandidate[]; settings: SettlementSettings; today: string } | null>(null);
  const [err, setErr] = useState('');
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<{ clientId: string; campaignId: string; type: '' | TaskType; method: '' | PaymentMethodType }>({ clientId: '', campaignId: '', type: '', method: '' });
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchCandidates();
    if (!r.ok) { setErr(r.error); return; }
    setErr('');
    setData(r.data);
    // 편집 상태는 서버 기본값으로 초기화 — 이미 사람이 고친 행은 유지(재조회로 손댄 값을 잃지 않게)
    setEdits((prev) => {
      const next: Record<string, RowEdit> = {};
      for (const c of r.data.candidates) next[c.taskId] = prev[c.taskId] ?? { category: c.categoryDefault, deadlineOn: c.deadlineDefault, referenceUrl: c.referenceDefault ?? '' };
      return next;
    });
    setSelected((prev) => new Set([...prev].filter((id) => r.data.candidates.some((c) => c.taskId === id))));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = data.candidates.filter((c) =>
      (!filter.clientId || c.clientId === filter.clientId) && (!filter.campaignId || c.campaignId === filter.campaignId)
      && (!filter.type || c.taskType === filter.type) && (!filter.method || c.method?.type === filter.method));
    // 🔴 맨 아래, 나머지 게시일 오래된 순(서버 정렬 유지) — §4-1
    const blocked = (c: SettlementCandidate) => effectiveReadiness(c, edits[c.taskId]) === 'blocked';
    return [...f.filter((c) => !blocked(c)), ...f.filter(blocked)];
  }, [data, filter, edits]);

  const clients = useMemo(() => uniq(data?.candidates.map((c) => [c.clientId ?? '', c.clientName] as const) ?? []), [data]);
  const campaigns = useMemo(() => uniq((data?.candidates ?? []).filter((c) => !filter.clientId || c.clientId === filter.clientId).map((c) => [c.campaignId, c.campaignName] as const)), [data, filter.clientId]);

  const picked = rows.filter((c) => selected.has(c.taskId));
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of picked) if (c.money) t[c.money.payoutCurrency] = (t[c.money.payoutCurrency] ?? 0) + c.money.amountGross;
    return t;
  }, [picked]);

  async function submit() {
    if (!data) return;
    const items = picked.map((c) => ({
      taskId: c.taskId, category: edits[c.taskId].category ?? '', deadlineOn: edits[c.taskId].deadlineOn,
      referenceUrl: edits[c.taskId].referenceUrl || null,
      expected: { amountGross: c.money!.amountGross, payoutCurrency: c.money!.payoutCurrency, paymentMethodId: c.method!.id },
    }));
    const r = await createRequestsApi(items);
    setConfirming(false);
    if (r.ok) {
      show(`${r.data.created.length}건 만들었어요`);
      setSelected(new Set()); setFailures({});
      await load();
      return;
    }
    // 전체 거절(§5-2) — 목록 재조회 + 실패 건에 이유, 체크 해제
    const f: Record<string, string> = {};
    for (const x of (r.failures ?? []) as CreateFailure[]) f[x.taskId] = x.reason;
    setFailures(f); setSelected(new Set());
    show(r.error);
    await load();
  }

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!data) return <p className="text-ui text-x-muted">불러오는 중…</p>;
  const cats = visibleCategories(data.settings);
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <select className={SEL} value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value, campaignId: '' })} aria-label="클라이언트">
          <option value="">클라이언트 전체</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className={SEL} value={filter.campaignId} onChange={(e) => setFilter({ ...filter, campaignId: e.target.value })} aria-label="캠페인">
          <option value="">캠페인 전체</option>{campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select className={SEL} value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as '' | TaskType })} aria-label="유형">
          <option value="">유형 전체</option>{TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}
        </select>
        <select className={SEL} value={filter.method} onChange={(e) => setFilter({ ...filter, method: e.target.value as '' | PaymentMethodType })} aria-label="결제 수단">
          <option value="">결제 수단 전체</option>{PAYMENT_TYPES.map((t) => <option key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</option>)}
        </select>
        <span className="ml-auto text-ui text-x-muted">이번 주 마감 {deadlineLabel(rows[0]?.deadlineDefault ?? data.today)}</span>
      </div>
      <h2 className="mt-4 text-[16px] font-semibold">검토 대기 {rows.length}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">게시 확인된 작업이 없어요 — 캠페인에서 게시된 날을 적으면 여기 나타나요</p>
      ) : (
        <ul className="mt-3 divide-y divide-x-border rounded-xl border border-x-border bg-white">
          {rows.map((c) => (
            <CandidateRow key={c.taskId} c={c} edit={edits[c.taskId]} categories={cats} failure={failures[c.taskId]}
                          selected={selected.has(c.taskId)}
                          onEdit={(e) => setEdits((p) => ({ ...p, [c.taskId]: e }))}
                          onToggle={(on) => setSelected((p) => { const n = new Set(p); if (on) n.add(c.taskId); else n.delete(c.taskId); return n; })} />
          ))}
        </ul>
      )}
      {/* 하단 고정 바 — 지급 통화별 합계, 0인 통화는 생략 */}
      <div className="sticky bottom-0 mt-4 flex items-center justify-between rounded-xl border border-x-border bg-white px-4 py-3 shadow-sm">
        <span className="text-ui tabular-nums">선택 {picked.length}건{Object.keys(totals).length > 0 && ' · '}{Object.entries(totals).map(([cur, v]) => formatMoney(v, cur as 'KRW' | 'JPY')).join(' / ')}</span>
        <Button variant="primary" disabled={picked.length === 0} onClick={() => setConfirming(true)}>선택 {picked.length}건 요청 만들기</Button>
      </div>
      {confirming && <CreateConfirmDialog items={picked} edits={edits} onConfirm={submit} onClose={() => setConfirming(false)} />}
    </section>
  );
}

function uniq<T extends readonly [string, string]>(pairs: T[]): T[] {
  const m = new Map<string, T>(); for (const p of pairs) if (!m.has(p[0])) m.set(p[0], p); return [...m.values()];
}
```

- [ ] **Step 6: 행(B안 두 줄)**

```tsx
// src/app/settlement/CandidateRow.tsx
'use client';
import Link from 'next/link';
import type { SettlementCandidate } from '@/lib/settlementCalc';
import type { SettlementCategory } from '@/lib/settlementSettings';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL, describeMethod } from '@/lib/influencerPayment';
import { READINESS_STYLE, effectiveReadiness } from './readinessView';
import { formatKrwToPayout } from './money';

export interface RowEdit { category: string | null; deadlineOn: string; referenceUrl: string }
const FIELD = 'rounded-lg border border-x-border bg-white px-2 py-1 text-ui';

export function CandidateRow({ c, edit, categories, selected, failure, onEdit, onToggle }: {
  c: SettlementCandidate; edit: RowEdit; categories: SettlementCategory[]; selected: boolean; failure?: string;
  onEdit: (e: RowEdit) => void; onToggle: (on: boolean) => void;
}) {
  const level = effectiveReadiness(c, edit);
  const st = READINESS_STYLE[level];
  const issues = c.issues.filter((i) => !(i.code === 'no-category' && edit.category));
  const money = c.money ? formatKrwToPayout(c.money) : null;
  return (
    <li className={`px-4 py-3 ${level === 'blocked' ? 'bg-x-bg/60' : ''}`} style={{ minHeight: 76 }}>
      {/* 윗줄 — 읽기 6개: 체크 · 핸들 · 유형 · 클리닉/캠페인 · 금액 · 수단 · 신호등 */}
      <div className="flex items-center gap-3 text-[15px]">
        <input type="checkbox" className="h-4 w-4" checked={selected} disabled={level === 'blocked'} onChange={(e) => onToggle(e.target.checked)} aria-label={`@${c.influencerHandle} 선택`} />
        <span className="font-semibold">@{c.influencerHandle}</span>
        <span className="rounded-full border border-x-border px-2 py-0.5 text-ui">{TASK_TYPE_LABEL[c.taskType]}</span>
        <span className="text-x-secondary truncate">{c.clientName} · {c.campaignName}</span>
        <span className="ml-auto tabular-nums font-medium whitespace-nowrap">
          {money ? <>{money.base}{money.fee && <span className="ml-1 text-x-muted font-normal">{money.fee}</span>}</> : <span className="text-x-muted">→ —</span>}
        </span>
        <span className="text-ui text-x-secondary truncate max-w-[260px]" title={c.method ? describeMethod(c.method) : ''}>
          {c.method ? `${PAYMENT_TYPE_LABEL[c.method.type]} · ${identOf(c.method)}` : '결제 수단 없음'}
        </span>
        <span className={`flex items-center gap-1.5 text-ui ${st.text} whitespace-nowrap`}><span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.label}</span>
      </div>
      {/* 아랫줄 — 편집 3개 + 이유 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-ui">
        <label className="flex items-center gap-1.5 text-x-secondary">분류
          <select className={`${FIELD} ${!edit.category ? 'border-red-400' : ''}`} value={edit.category ?? ''} onChange={(e) => onEdit({ ...edit, category: e.target.value || null })}>
            <option value="">골라 주세요</option>
            {categories.map((k) => <option key={k.id} value={k.sendAs}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-x-secondary">마감
          <input type="date" className={FIELD} value={edit.deadlineOn} onChange={(e) => onEdit({ ...edit, deadlineOn: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 text-x-secondary min-w-0">참고
          <input type="url" className={`${FIELD} w-[260px]`} placeholder="게시물 링크(선택)" value={edit.referenceUrl} onChange={(e) => onEdit({ ...edit, referenceUrl: e.target.value })} />
          {edit.referenceUrl && <a href={edit.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">열기</a>}
        </label>
        {issues.map((i) => (
          <span key={i.code} className={i.level === 'blocked' ? 'text-red-700' : 'text-amber-700'}>
            {i.text}
            {i.code === 'no-payment-method' && <> · <Link href={`/influencers?tab=deal&handle=${encodeURIComponent(c.influencerHandle)}`} className="underline">프로필에서 등록 →</Link></>}
            {i.code === 'no-influencer' && <> · <Link href="/influencers" className="underline">명부 →</Link></>}
          </span>
        ))}
        {failure && <span role="alert" className="text-red-700 font-medium">{failure}</span>}
      </div>
    </li>
  );
}
function identOf(m: NonNullable<SettlementCandidate['method']>): string {
  if (m.type === 'paypal') return m.email ?? (m.paypalId ? `paypal.me/${m.paypalId}` : '');
  if (m.type === 'paypay') return m.identifier ?? '미입력';
  return `${m.bank ?? ''} ${m.account ?? ''}`.trim();
}
```
(`/influencers?tab=deal&handle=…` — 명부 페이지가 `?i=<id>`로 프로필을 고른다면 핸들 파라미터는 없다. 그 경우 링크를 `/influencers`로만 두고, 프로필 선택은 사용자가 한다 — 새 파라미터를 추가하지 않는다.)

- [ ] **Step 7: 확인 창**

```tsx
// src/app/settlement/CreateConfirmDialog.tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { SettlementCandidate } from '@/lib/settlementCalc';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import type { RowEdit } from './CandidateRow';

export function CreateConfirmDialog({ items, edits, onConfirm, onClose }: {
  items: SettlementCandidate[]; edits: Record<string, RowEdit>; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const totals: Record<string, number> = {};
  for (const c of items) if (c.money) totals[c.money.payoutCurrency] = (totals[c.money.payoutCurrency] ?? 0) + c.money.amountGross;
  const deadlines = [...new Set(items.map((c) => edits[c.taskId].deadlineOn))];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="결제 요청 만들기" className="w-full max-w-[560px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold">결제 요청 {items.length}건을 만들어요</h2>
        <p className="mt-1 text-ui text-x-secondary tabular-nums">
          합계 {Object.entries(totals).map(([cur, v]) => formatMoney(v, cur as 'KRW' | 'JPY')).join(' / ')} · 마감 {deadlines.join(', ')}
        </p>
        <ul className="mt-3 max-h-[320px] overflow-y-auto divide-y divide-x-border text-ui">
          {items.map((c) => (
            <li key={c.taskId} className="flex items-center gap-3 py-2">
              <span className="font-medium">@{c.influencerHandle}</span>
              <span className="text-x-secondary">{TASK_TYPE_LABEL[c.taskType]}</span>
              <span className="ml-auto tabular-nums">{c.money ? formatMoney(c.money.amountGross, c.money.payoutCurrency) : '—'}</span>
              <span className="text-x-muted w-[72px]">{c.method ? PAYMENT_TYPE_LABEL[c.method.type] : ''}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-ui text-x-muted">만든 뒤에는 값이 고정돼요 — 결제 수단이나 비용이 바뀌어도 이 요청은 그대로예요. 잘못 만들면 요청 내역에서 사유를 적고 취소해요.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{busy ? '만드는 중…' : '만들기'}</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: 빌드로 확인 (화면 하네스 없음)**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "src/app/settlement|Sidebar" | head; npx eslint src/app/settlement src/components/Sidebar.tsx`
Expected: 오류 0. 그 다음 `npm run build 2>&1 | tail -5` → 성공. (실제 화면은 koo QA — `npm run build && npx next start -p 3001`, `http://127.0.0.1:3001/settlement`.)

- [ ] **Step 9: Commit**

```bash
git add src/app/settlement src/components/Sidebar.tsx
git commit -m "feat(settlement): /settlement 페이지 — 탭·필터·검토 대기 두 줄 행(읽기 6·편집 3)·신호등·일괄 선택·확인 창 + 사이드바 '정산'

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 8: 화면 ② — 요청 내역(펼침·취소)

**Files:**
- Create/Replace: `src/app/settlement/RequestList.tsx`, `src/app/settlement/RequestRow.tsx`, `src/app/settlement/CancelDialog.tsx`

**Interfaces:**
- Consumes: `fetchRequests`·`cancelRequestApi` (Task 6); `PaymentRequestRow`·`RequestStatus`·`RequestFilter` (Task 5); `describeSnapshot` (Task 3); `formatMoney`; `kstMonthDay` `@/lib/datetime`; `Button`; `useToast`.
- Produces: `RequestList({ focusTaskId })` — `?task=` 가 있으면 그 작업의 요청을 펼친 채로 시작(캠페인 배지 클릭 진입, Task 10).

- [ ] **Step 1: 목록**

```tsx
// src/app/settlement/RequestList.tsx
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/lib/toastContext';
import { fetchRequests, cancelRequestApi } from '@/lib/settlementApi';
import type { PaymentRequestRow, RequestStatus } from '@/lib/settlementStore';
import { RequestRow } from './RequestRow';
import { CancelDialog } from './CancelDialog';

const SEL = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-ui';

export function RequestList({ focusTaskId }: { focusTaskId: string | null }) {
  const { show } = useToast();
  const [rows, setRows] = useState<PaymentRequestRow[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<{ clientId: string; campaignId: string; status: '' | RequestStatus; from: string; to: string }>({ clientId: '', campaignId: '', status: '', from: '', to: '' });
  const [open, setOpen] = useState<string | null>(null);        // 펼친 요청 id
  const [cancelling, setCancelling] = useState<PaymentRequestRow | null>(null);

  const load = useCallback(async () => {
    const r = await fetchRequests({
      clientId: filter.clientId || undefined, campaignId: filter.campaignId || undefined,
      status: filter.status || undefined, from: filter.from || undefined, to: filter.to || undefined,
    });
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setRows(r.data);
    // 배지에서 들어왔으면 그 작업의 활성 요청(없으면 최신)을 펼친다
    if (focusTaskId && open === null) {
      const hit = r.data.find((x) => x.taskId === focusTaskId && x.status === 'requested') ?? r.data.find((x) => x.taskId === focusTaskId);
      if (hit) setOpen(hit.id);
    }
  }, [filter, focusTaskId, open]);
  useEffect(() => { void load(); }, [load]);

  const clients = useMemo(() => uniq((rows ?? []).map((r) => [r.clientId ?? '', r.clientName] as const)), [rows]);
  const campaigns = useMemo(() => uniq((rows ?? []).filter((r) => !filter.clientId || r.clientId === filter.clientId).map((r) => [r.campaignId ?? '', r.campaignName] as const)), [rows, filter.clientId]);

  async function doCancel(reason: string): Promise<string | null> {
    if (!cancelling) return null;
    const r = await cancelRequestApi(cancelling.id, reason);
    if (!r.ok) return r.error;
    setCancelling(null); show('취소했어요');
    await load();
    return null;
  }

  if (err) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!rows) return <p className="text-ui text-x-muted">불러오는 중…</p>;
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <select className={SEL} value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value, campaignId: '' })} aria-label="클라이언트">
          <option value="">클라이언트 전체</option>{clients.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select className={SEL} value={filter.campaignId} onChange={(e) => setFilter({ ...filter, campaignId: e.target.value })} aria-label="캠페인">
          <option value="">캠페인 전체</option>{campaigns.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select className={SEL} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as '' | RequestStatus })} aria-label="상태">
          <option value="">상태 전체</option><option value="requested">요청됨</option><option value="cancelled">취소됨</option>
        </select>
        <label className="flex items-center gap-1 text-ui text-x-secondary">기간
          <input type="date" className={SEL} value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} aria-label="시작일" />
          ~
          <input type="date" className={SEL} value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} aria-label="종료일" />
        </label>
      </div>
      <h2 className="mt-4 text-[16px] font-semibold">요청 내역 {rows.length}</h2>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-x-border p-8 text-center text-ui text-x-muted">아직 만든 요청이 없어요 — 검토 대기에서 골라 만들어요</p>
      ) : (
        <ul className="mt-3 divide-y divide-x-border rounded-xl border border-x-border bg-white">
          {rows.map((r) => (
            <RequestRow key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onCancel={() => setCancelling(r)} />
          ))}
        </ul>
      )}
      {cancelling && <CancelDialog target={cancelling} onConfirm={doCancel} onClose={() => setCancelling(null)} />}
    </section>
  );
}
function uniq<T extends readonly [string, string]>(pairs: T[]): T[] {
  const m = new Map<string, T>(); for (const p of pairs) if (!m.has(p[0])) m.set(p[0], p); return [...m.values()];
}
```

- [ ] **Step 2: 행 + 펼침(11항목)**

```tsx
// src/app/settlement/RequestRow.tsx
'use client';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { describeSnapshot } from '@/lib/settlementCalc';
import { kstMonthDay } from '@/lib/datetime';

export function RequestRow({ r, open, onToggle, onCancel }: { r: PaymentRequestRow; open: boolean; onToggle: () => void; onCancel: () => void }) {
  const cancelled = r.status === 'cancelled';
  const costAmount = r.costCurrency === 'KRW' ? r.amountKrw : Math.round(r.amountKrw / r.rateKrwPerJpy);
  const base = r.costCurrency === r.payoutCurrency ? formatMoney(r.amountNet, r.payoutCurrency) : `${formatMoney(costAmount, r.costCurrency)} → ${formatMoney(r.amountNet, r.payoutCurrency)}`;
  return (
    <li className="px-4 py-3" style={{ minHeight: 76 }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left text-[15px]">
        <span className="font-semibold">@{r.influencerHandle}</span>
        <span className="rounded-full border border-x-border px-2 py-0.5 text-ui">{TASK_TYPE_LABEL[r.taskType]}</span>
        <span className="text-x-secondary truncate">{r.clientName} · {r.campaignName}</span>
        <span className="ml-auto tabular-nums font-medium whitespace-nowrap">{base}{r.feeAmount > 0 && <span className="ml-1 text-x-muted font-normal">+ {r.feeAmount.toLocaleString('ko-KR')}</span>}</span>
        <span className="text-ui text-x-secondary whitespace-nowrap">{PAYMENT_TYPE_LABEL[r.paymentMethod.type]}</span>
        <span className={`rounded-full px-2 py-0.5 text-ui whitespace-nowrap ${cancelled ? 'bg-x-bg text-x-secondary' : 'bg-x-blue/10 text-x-blue-text'}`}>
          {cancelled ? `취소됨 ${kstMonthDay(r.cancelledAt)}` : `요청됨 ${kstMonthDay(r.createdAt)}`}
        </span>
      </button>
      <div className="mt-1 pl-0 text-ui text-x-muted">마감 {r.deadlineOn} · 요청자 {r.requesterName}</div>
      {open && (
        <div className="mt-3 rounded-xl bg-x-bg p-4 text-ui">
          <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5">
            <Item k="요청자" v={r.requesterName} />
            <Item k="클리닉" v={r.clientName} />
            <Item k="분류" v={r.category} sub={r.categoryDefault && r.categoryDefault !== r.category ? `미리 채운 값: ${r.categoryDefault}` : undefined} />
            <Item k="항목" v={r.itemText} />
            <Item k="목적" v={r.purposeText} />
            <Item k="금액" v={`${formatMoney(r.amountGross, r.payoutCurrency)}${r.feeAmount > 0 ? ` (${r.amountNet.toLocaleString('ko-KR')} + ${r.feeAmount.toLocaleString('ko-KR')} 수수료)` : ''}`}
                  sub={`원화 ${formatMoney(r.amountKrw, 'KRW')} · 환율 ${r.rateKrwPerJpy}원 = 1엔`} />
            <Item k="데드라인" v={r.deadlineOn} />
            <Item k="결제수단" v={describeSnapshot(r.paymentMethod)} />
            <Item k="참고자료" v={r.referenceUrl ? <a href={r.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline break-all">{r.referenceUrl}</a> : '—'} />
            <Item k="메모" v={r.note || '—'} />
          </dl>
          <div className="mt-3 flex items-center justify-between text-x-muted">
            <span>만든 사람 {r.requesterName} · {new Date(r.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              {cancelled && <> · <span className="text-x-secondary">취소 · {r.cancelledByName} · {r.cancelledAt ? new Date(r.cancelledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''} · {r.cancelReason}</span></>}
            </span>
            {!cancelled && <Button onClick={onCancel}>취소</Button>}
          </div>
        </div>
      )}
    </li>
  );
}
function Item({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (<><dt className="text-x-secondary">{k}</dt><dd className="min-w-0">{v}{sub && <div className="text-x-muted">{sub}</div>}</dd></>);
}
```

- [ ] **Step 3: 취소 다이얼로그**

```tsx
// src/app/settlement/CancelDialog.tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { formatMoney } from '@/lib/influencerPricing';

export function CancelDialog({ target, onConfirm, onClose }: { target: PaymentRequestRow; onConfirm: (reason: string) => Promise<string | null>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    const r = reason.trim();
    if (!r) { setErr('취소 사유를 적어 주세요'); return; }
    if (r.length > 200) { setErr('사유는 200자까지예요'); return; }
    setBusy(true);
    const e = await onConfirm(r);
    setBusy(false);
    if (e) setErr(e);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="요청 취소" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold">이 요청을 취소할까요?</h2>
        <p className="mt-1 text-ui text-x-secondary">@{target.influencerHandle} · {formatMoney(target.amountGross, target.payoutCurrency)}</p>
        <label className="mt-3 block text-ui text-x-secondary">사유 <span className="text-red-600">필수</span>
          <textarea className="mt-1 w-full rounded-lg border border-x-border p-2 text-ui" rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} placeholder="예: 금액 착오 — 3,000엔이 아니라 5,000엔" />
        </label>
        <p className="mt-2 text-ui text-x-muted">취소해도 기록은 남아요(누가·언제·왜). 이 작업은 다시 검토 대기에 나타나요.</p>
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>닫기</Button>
          <Button variant="primary" onClick={go} disabled={busy}>{busy ? '취소하는 중…' : '취소 확정'}</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 타입·린트·빌드**

Run: `npx tsc --noEmit -p . 2>&1 | grep "src/app/settlement" | head; npx eslint src/app/settlement && npm run build 2>&1 | tail -3`
Expected: 오류 0, 빌드 성공.

- [ ] **Step 5: Commit**

```bash
git add src/app/settlement
git commit -m "feat(settlement): 요청 내역 — 필터·상태 배지·행 펼침(양식 11항목·원화/환율)·사유 필수 취소 다이얼로그

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 화면 ③ — 설정 탭

**Files:**
- Replace: `src/app/settlement/SettingsTab.tsx`

**Interfaces:**
- Consumes: `fetchSettlementSettings`·`saveSettlementSettingsApi` (Task 6); `SettlementSettings`·`SettlementCategory`·`sanitizeSettlementSettings` (Task 2); `TASK_TYPES`·`TASK_TYPE_LABEL`; `Button`; `useToast`.

- [ ] **Step 1: 구현**

```tsx
// src/app/settlement/SettingsTab.tsx
'use client';
import { useEffect, useState } from 'react';
import { Button, PANEL, PANEL_TITLE } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { fetchSettlementSettings, saveSettlementSettingsApi } from '@/lib/settlementApi';
import { sanitizeSettlementSettings, type SettlementSettings, type SettlementCategory } from '@/lib/settlementSettings';
import type { SettlementVersionRow } from '@/lib/settlementStore';
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { kstMonthDay } from '@/lib/datetime';

const FIELD = 'rounded-lg border border-x-border bg-white px-2 py-1 text-ui w-full';

export function SettingsTab() {
  const { show } = useToast();
  const [s, setS] = useState<SettlementSettings | null>(null);
  const [versions, setVersions] = useState<SettlementVersionRow[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { (async () => {
    const r = await fetchSettlementSettings();
    if (!r.ok) { setErr(r.error); return; }
    setS(r.data.settings); setVersions(r.data.versions);
  })(); }, []);

  if (err && !s) return <p role="alert" className="text-ui text-red-700">{err}</p>;
  if (!s) return <p className="text-ui text-x-muted">불러오는 중…</p>;

  const patchCat = (id: string, p: Partial<SettlementCategory>) => setS({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  // 한 유형은 한 분류에만 — 다른 분류에 있던 체크는 자동 해제(§4-3)
  const toggleDefault = (id: string, t: TaskType, on: boolean) => setS({
    ...s, categories: s.categories.map((c) => c.id === id
      ? { ...c, defaultFor: on ? [...c.defaultFor.filter((x) => x !== t), t] : c.defaultFor.filter((x) => x !== t) }
      : { ...c, defaultFor: on ? c.defaultFor.filter((x) => x !== t) : c.defaultFor }),
  });
  const add = () => setS({ ...s, categories: [...s.categories, { id: crypto.randomUUID(), label: '', sendAs: '', hidden: false, defaultFor: [] }] });

  async function save() {
    const clean = sanitizeSettlementSettings(s);
    if (typeof clean === 'string') { setErr(clean); return; }
    setBusy(true);
    const r = await saveSettlementSettingsApi(clean);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setErr(''); setS(r.data.settings); show('설정을 저장했어요');
    const v = await fetchSettlementSettings(); if (v.ok) setVersions(v.data.versions);
  }

  return (
    <div className="space-y-5">
      <section className={PANEL}>
        <h2 className={PANEL_TITLE}>분류</h2>
        <p className="mt-1 text-ui text-x-muted">요청의 '분류' 칸에 고를 수 있는 목록이에요. 숨기면 새 요청에서만 사라지고, 이미 만든 요청은 그대로예요.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-ui">
            <thead className="text-left text-x-secondary">
              <tr><th className="py-2 pr-3">표시명</th><th className="py-2 pr-3">정산 쪽 이름</th><th className="py-2 pr-3">기본값으로 쓰는 유형</th><th className="py-2 pr-3">숨김</th></tr>
            </thead>
            <tbody>
              {s.categories.map((c) => (
                <tr key={c.id} className={`border-t border-x-border ${c.hidden ? 'text-x-muted' : ''}`}>
                  <td className="py-2 pr-3 min-w-[180px]"><input className={FIELD} value={c.label} onChange={(e) => patchCat(c.id, { label: e.target.value })} aria-label="표시명" /></td>
                  <td className="py-2 pr-3 min-w-[280px]"><input className={FIELD} value={c.sendAs} onChange={(e) => patchCat(c.id, { sendAs: e.target.value })} aria-label="정산 쪽 이름" /></td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {TASK_TYPES.map((t) => (
                      <label key={t} className="mr-3 inline-flex items-center gap-1">
                        <input type="checkbox" checked={c.defaultFor.includes(t)} onChange={(e) => toggleDefault(c.id, t, e.target.checked)} />{TASK_TYPE_LABEL[t]}
                      </label>
                    ))}
                  </td>
                  <td className="py-2 pr-3"><input type="checkbox" checked={c.hidden} onChange={(e) => patchCat(c.id, { hidden: e.target.checked })} aria-label="숨김" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button className="mt-3" onClick={add}>+ 분류 추가</Button>
        <p className="mt-2 text-ui text-x-muted">인용RT는 기본값을 비워 두면 담당자가 마지막에 고른 분류로 미리 채워져요.</p>
      </section>
      <section className={PANEL}>
        <h2 className={PANEL_TITLE}>환율</h2>
        <label className="mt-2 flex items-center gap-2 text-ui">
          <input type="number" min={1} step={1} className="w-24 rounded-lg border border-x-border px-2 py-1 text-ui tabular-nums" value={s.rateKrwPerJpy}
                 onChange={(e) => setS({ ...s, rateKrwPerJpy: Number(e.target.value) })} aria-label="환율" />
          원 = 1엔
        </label>
        <p className="mt-2 text-ui text-x-muted">바꿔도 이미 만든 요청은 안 바뀌어요 — 만든 시점 값이 저장돼 있어요.</p>
      </section>
      {err && <p role="alert" className="text-ui text-red-700">{err}</p>}
      <div className="flex items-center justify-between">
        <span className="text-ui text-x-muted">최근 변경: {versions.length ? versions.map((v) => `${kstMonthDay(v.createdAt)} ${v.memberName ?? '—'}`).join(' · ') : '없음'}</span>
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장'}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입·린트·빌드**

Run: `npx tsc --noEmit -p . 2>&1 | grep "src/app/settlement" | head; npx eslint src/app/settlement && npm run build 2>&1 | tail -3`
Expected: 오류 0, 빌드 성공.

- [ ] **Step 3: Commit**

```bash
git add src/app/settlement/SettingsTab.tsx
git commit -m "feat(settlement): 설정 탭 — 분류 목록(표시명·정산 쪽 이름·유형별 기본값·숨김·추가)·환율, 버전 행 저장·최근 변경

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
### Task 10: 캠페인 쪽 — 작업 표 배지 + 삭제 보호

**Files:**
- Modify: `src/lib/campaignTaskStore.ts` (`countTasksForCampaignDelete`에 `activeRequests`, `hasActiveRequest(sql, taskId)` 추가), `src/lib/campaignStore.ts` (`CampaignTaskItem.settlement`, `getCampaignDetail`에서 채움, `deleteInfo.activeRequests`), `src/app/campaigns/TaskTable.tsx:171`, `src/app/campaigns/CampaignHeader.tsx:130-133`, `src/app/api/campaigns/[id]/route.ts` DELETE, `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts` DELETE, `src/lib/campaignApi.ts`(deleteCampaignApi 반환 타입)
- Test: `src/lib/campaignStore.test.ts`(기존 파일에 1 테스트 추가)

**Interfaces:**
- Consumes: `settlementByTaskIds` (Task 5).
- Produces: `CampaignTaskItem.settlement: { status: 'requested' | 'cancelled'; createdAt: string } | null`; `deleteInfo.activeRequests: number`; `hasActiveRequest(sql, taskId): Promise<boolean>`.

- [ ] **Step 1: 실패하는 테스트 (campaignStore.test.ts 끝에 추가)**

```ts
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';
import { createRequests, listCandidates } from './settlementStore.ts';
import { SETTLEMENT_DEFAULTS } from './settlementSettings.ts';
import { hasActiveRequest } from './campaignTaskStore.ts';

test('정산 배지·삭제 보호 — 활성 요청이 있으면 settlement 채워지고 activeRequests 1', async () => {
  const c = await createClient(sql, P + '클라S');
  const camp = await createCampaign(sql, base(c.id, c.name, 's'));
  const h = P + '_stl';
  const { row: inf } = await createInfluencer(sql, { handle: h, createdBy: null });
  await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'paypal', holder: 'K', currency: 'JPY', email: 'k@x.com' }, makeDefault: true }, null);
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: h, cost: { amount: 10000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-09-01', postedSource: 'manual' });
  const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${P + '멤버S'}, '#000') returning id`;
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-09-01')).find((x) => x.taskId === t.id)!;
  await createRequests(sql, [{ taskId: t.id, category: cand.categoryDefault!, deadlineOn: cand.deadlineDefault, referenceUrl: null, expected: { amountGross: cand.money!.amountGross, payoutCurrency: cand.money!.payoutCurrency, paymentMethodId: cand.method!.id } }], { id: m.id, name: P + '멤버S' });
  const d = (await getCampaignDetail(sql, camp.id, '2026-09-01'))!;
  assert.equal(d.tasks.find((x) => x.id === t.id)!.settlement?.status, 'requested');
  assert.equal(d.deleteInfo.activeRequests, 1);
  assert.equal(await hasActiveRequest(sql, t.id), true);
  // 정리(after는 payment_request를 모른다) — 요청·인플·멤버
  await sql`delete from payment_request where task_id = ${t.id}`;
  await sql`delete from influencer_log where influencer_id = ${inf.id}`; await sql`delete from influencer where id = ${inf.id}`;
  await sql`delete from member where id = ${m.id}`;
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts`
Expected: 새 테스트 FAIL(`hasActiveRequest` 없음 / `settlement` undefined).

- [ ] **Step 3: 스토어 구현**

`campaignTaskStore.ts`:
```ts
// 정산 보호(정산 스펙 §4-4) — 활성 요청이 붙은 작업은 지우지 않는다
export async function hasActiveRequest(sql: postgres.Sql, taskId: string): Promise<boolean> {
  if (!isUuidLike(taskId)) return false;
  const r = await sql<Array<{ n: string | number }>>`select count(*) as n from payment_request where task_id = ${taskId} and status = 'requested'`;
  return Number(r[0].n) > 0;
}
export async function countTasksForCampaignDelete(sql: postgres.Sql, campaignId: string): Promise<{ taskCount: number; detachedTargets: number; activeRequests: number }> {
  const [r] = await sql<Array<{ task_count: string | number; detached: string | number; active: string | number }>>`
    select (select count(*) from campaign_task where campaign_id = ${campaignId}) as task_count,
           (select count(*) from campaign_task x join campaign_task y on y.id = x.target_task_id
             where y.campaign_id = ${campaignId} and x.campaign_id <> ${campaignId}) as detached,
           (select count(*) from payment_request r join campaign_task t on t.id = r.task_id
             where t.campaign_id = ${campaignId} and r.status = 'requested') as active`;
  return { taskCount: Number(r.task_count), detachedTargets: Number(r.detached), activeRequests: Number(r.active) };
}
```
`campaignStore.ts`:
- `CampaignTaskItem`에 `settlement: { status: 'requested' | 'cancelled'; createdAt: string } | null;` 추가.
- `CampaignDetail.deleteInfo` 타입을 `{ taskCount: number; detachedTargets: number; activeRequests: number }`로.
- `getCampaignDetail`에서 `const badges = await settlementByTaskIds(sql, tasks.map((t) => t.id));` 후 items 매핑에 `settlement: badges.get(t.id) ?? null,` 추가. import는 `./campaignTaskStore.ts`에서(Task 5가 거기 두었다 — settlementStore를 import하면 influencerStore→campaignStore 경로로 순환).
- `deleteCampaign`: `activeRequests > 0`이면 삭제하지 않고 `{ deleted: false, ...info }`를 돌려준다.

- [ ] **Step 4: 라우트·화면**

`src/app/api/campaigns/[id]/tasks/[taskId]/route.ts` DELETE — `deleteTask` 앞에:
```ts
  if (await hasActiveRequest(sql, taskId)) {
    return NextResponse.json({ error: '정산 요청된 작업이에요 — 먼저 정산에서 요청을 취소해 주세요' }, { status: 409 });
  }
```
`src/app/api/campaigns/[id]/route.ts` DELETE — `deleteCampaign` 결과가 `deleted:false`이고 `activeRequests > 0`이면 409 `정산 요청된 작업이 ${n}건 있어요 — 먼저 정산에서 취소해 주세요`.

`src/app/campaigns/CampaignHeader.tsx` 삭제 확인(131-132): `deleteInfo.activeRequests > 0`이면 `window.confirm` 대신 `window.alert('정산 요청된 작업이 N건 있어요 — 먼저 정산에서 취소해 주세요')` 후 return. props 타입 `deleteInfo`에 `activeRequests: number` 추가. `campaignApi.deleteCampaignApi` 반환 타입에도 `activeRequests: number`.

`src/app/campaigns/TaskTable.tsx:171` 빈 자리에:
```tsx
                        {t.settlement && (
                          <Link href={`/settlement?tab=requests&task=${t.id}`} className={`rounded-full px-2 py-0.5 text-ui whitespace-nowrap ${t.settlement.status === 'requested' ? 'bg-x-blue/10 text-x-blue-text' : 'bg-x-bg text-x-secondary'}`}
                                title={t.settlement.status === 'requested' ? '정산 요청됨 — 클릭하면 요청 내역으로' : '마지막 요청이 취소됨'}>
                            {t.settlement.status === 'requested' ? `정산 요청됨 ${kstMonthDay(t.settlement.createdAt)}` : '취소됨'}
                          </Link>
                        )}
```
(`Link`·`kstMonthDay` import가 없으면 추가. 행 삭제 메뉴 `onDelete`는 그대로 — 서버 409 문구가 토스트로 보인다.)

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts src/lib/settlementStore.test.ts && npx tsc --noEmit -p . 2>&1 | grep -E "campaign|settlement" | head`
Expected: 전부 pass, 타입 오류 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/campaignTaskStore.ts src/lib/campaignStore.ts src/lib/campaignStore.test.ts src/lib/settlementStore.ts src/lib/campaignApi.ts src/app/campaigns src/app/api/campaigns
git commit -m "feat(settlement): 캠페인 작업 표에 정산 배지(요청됨/취소됨→내역 링크) + 활성 요청 있는 작업·캠페인 삭제 보호(409)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 인플루언서 타임라인 — 이벤트 2종 문구

**Files:**
- Modify: `src/app/influencers/Timeline.tsx` (이벤트 switch 두 곳 — 단건 문구 `~41-60` 부근, 묶음 라벨 `~71-75`)

**Interfaces:**
- Consumes: `PaymentLogPayload` (Task 5, `@/lib/influencerStore`), `formatMoney`, `TASK_TYPE_LABEL` `@/lib/campaignJudgment`.

- [ ] **Step 1: 구현**

단건 문구 switch에 두 case 추가(`payment_method_changed` case 뒤):
```tsx
    case 'payment_requested': {
      const p = l.payload as PaymentLogPayload | null;
      if (!p) return <>정산 요청</>;
      return <>정산 요청 · {formatMoney(p.amountGross, p.currency)} <span className="text-x-muted">({TASK_TYPE_LABEL[p.taskType]})</span></>;
    }
    case 'payment_cancelled': {
      const p = l.payload as PaymentLogPayload | null;
      if (!p) return <>정산 요청 취소</>;
      return <>정산 요청 취소 · {formatMoney(p.amountGross, p.currency)}{p.reason ? <> — {p.reason}</> : null}</>;
    }
```
묶음 라벨 switch에:
```ts
    case 'payment_requested': return `정산 요청 ${n}건`;
    case 'payment_cancelled': return `정산 요청 취소 ${n}건`;
```
import 추가: `import type { PaymentLogPayload } from '@/lib/influencerStore';`, `import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';`.

- [ ] **Step 2: 확인**

Run: `npx tsc --noEmit -p . 2>&1 | grep Timeline; npx eslint src/app/influencers/Timeline.tsx`
Expected: 출력 없음.

- [ ] **Step 3: Commit**

```bash
git add src/app/influencers/Timeline.tsx
git commit -m "feat(influencer): 활동 기록에 정산 요청·취소 한 줄(금액·유형·사유)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: 업데이트 소식 + 전체 검증

**Files:**
- Modify: `src/content/updates.ts` (맨 위 항목), `docs/superpowers/specs/2026-08-28-settlement-page-design.md`(상태 줄)

- [ ] **Step 1: 업데이트 항목 (UPDATES 배열 맨 앞)**

```ts
  {
    date: '2026-08-29',
    type: '새 기능',
    title: '정산 페이지가 생겼어요 — 게시 확인된 작업을 골라 결제 요청을 한 번에 만들 수 있어요',
    summary: '캠페인에서 게시 확인된 작업이 정산 > 검토 대기에 자동으로 모여요. 금액(원가 → 지급액 + 수수료)·결제 수단·분류를 확인하고 여러 건을 골라 [요청 만들기]를 누르면 결제 요청이 저장돼요. 지금은 저장과 확인까지이고, 정산 프로덕트로 보내는 연결은 다음에 붙어요.',
    bullets: [
      '금액은 원화 비용을 인플루언서가 받는 통화로 바꿔(10원 = 1엔) 보여주고, 송금 수수료를 우리가 부담하는 분은 따로 얹어서 실제 보낼 금액을 계산해요 — 화면·확인 창·저장이 같은 계산을 써요',
      '결제 수단이 없거나 분류가 비어 있으면 못 보내요(빨간불). 참고 링크가 없거나 게시가 내려간 건은 노란불로 알려만 주고 보낼 수 있어요',
      '분류는 미리 채워져요 — RT는 프로모션, 투고는 캠페인 종류에 따라, 인용RT는 마지막에 고른 값으로. 설정 탭에서 분류 목록과 기본값·환율을 바꿀 수 있어요',
      '요청을 만든 뒤에는 값이 고정돼요. 잘못 만들면 요청 내역에서 사유를 적고 취소해요 — 기록은 남고 그 작업은 다시 검토 대기에 나타나요',
      '만드는 사이 금액이나 결제 수단이 바뀌면 저장하지 않고 다시 확인하라고 알려요',
      '캠페인 작업 표의 비용 옆에 "정산 요청됨" 배지가 붙고, 요청된 작업과 그 캠페인은 지울 수 없어요(먼저 취소)',
      '인플루언서 활동 기록에 정산 요청·취소가 한 줄씩 남아요',
    ],
    link: { label: '정산', href: '/settlement' },
  },
```

- [ ] **Step 2: 업데이트 형식 테스트**

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: pass.

- [ ] **Step 3: 전체 테스트·린트·빌드**

Run: `npm test 2>&1 | tail -8` (≈4분)
Expected: `fail 0`.
Run: `npx eslint 2>&1 | tail -3 && npm run build 2>&1 | tail -3`
Expected: 린트 기준선 초과 없음(새 경고 0), 빌드 성공.

- [ ] **Step 4: 스펙 상태 줄 갱신**

`docs/superpowers/specs/2026-08-28-settlement-page-design.md` 3행 `상태: 설계 확정, 구현 전` → `상태: 구현 완료(브랜치), koo 화면 QA 대기`.

- [ ] **Step 5: Commit**

```bash
git add src/content/updates.ts docs/superpowers/specs/2026-08-28-settlement-page-design.md
git commit -m "docs(updates): 정산 페이지 새 기능 항목 + 스펙 상태 갱신

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: koo 화면 QA 준비**

Run: `npm run build && npx next start -p 3001` (백그라운드) → `http://127.0.0.1:3001/settlement`. 체크리스트(스펙 §7 화면): 신호등 3색 각 1건 · 만들기 → 요청 내역 이동 · 값 바뀐 뒤 만들기 → 튕김 문구 · 취소 → 검토 대기 복귀 · 캠페인 배지·클릭 이동 · 설정 저장 후 기본값 반영 · 빈 상태 · 사이드바 위치.
