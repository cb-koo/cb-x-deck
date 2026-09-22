# 클라이언트 예산 기간 모델(v2 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클라이언트 월 단위 예산(037: `monthly_budget`+`budget_overrides`)을 시작일·종료일·금액으로 이루어진 자유 "예산 기간"(`client_budget_period` 테이블)으로 완전히 대체한다.

**Architecture:** 새 테이블(겹침은 daterange exclusion constraint로 DB가 막는다) + 새 저장소(`budgetPeriodStore.ts`) + 순수 계산 모듈 전면 교체(`clientBudget.ts`) + 캠페인 귀속 로직 교체(`campaignStore.ts`) + REST 라우트 교체 + 화면 3곳(클라이언트 상세 패널, 캠페인 요약 카드, 캠페인 플로우 카드) 교체.

**Tech Stack:** Next.js App Router, `postgres` (postgres.js), `node:test`, TypeScript.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-09-22-budget-period-model-design.md` — 모든 태스크가 이 문서의 결정 사항을 따른다.
- 마이그레이션은 **추가만** 한다 — 이번 브랜치에서 `client.monthly_budget`/`budget_overrides` 컬럼을 **삭제하지 않는다**(코드가 안 쓰게만 한다). 컬럼 삭제는 스펙 §9의 별도 2차 머지 — 이 계획의 범위 밖.
- 캠페인 비용 귀속은 **시작일이 속한 기간에 전액**(안 나눔). 초과 배지는 **그 기간이 마이너스이고 다음 기간까지 이어지는 캠페인이 있을 때만** 뜬다(스펙 §4, §7).
- 테스트는 연습용 DB에서만: `npm test`(`.env.staging` 자동 사용, `testGuard`가 운영 DB를 막는다). 단일 파일 실행은 `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test <file>`.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`를 붙인다.
- 모든 사용자 대면 문구는 한국어, 내부 개념어(기간 경계·exclusion constraint 등)를 화면 문구에 그대로 쓰지 않는다(AGENTS.md UX 원칙).

---

### Task 1: 마이그레이션 — `client_budget_period` 테이블

**Files:**
- Create: `migrations/058_client_budget_period.sql`

**Interfaces:**
- Produces: 테이블 `client_budget_period(id, client_id, starts_on, ends_on, amount_krw, created_at, updated_at)` — 이후 모든 태스크가 이 스키마를 전제한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 058: 클라이언트 예산 기간 (스펙 2026-09-22-budget-period-model-design §3)
-- 037의 월 단위 예산(monthly_budget/budget_overrides)을 완전히 대체한다. 이번 마이그레이션은 새 테이블만
-- 추가하고 037 컬럼은 건드리지 않는다(컬럼 삭제는 별도 2차 머지, §9). 겹침 방지에 daterange exclusion
-- constraint를 쓰므로 btree_gist가 필요하다. main은 057까지 — 머지 시 다른 활성 브랜치와 번호 충돌 확인.
create extension if not exists btree_gist;

create table if not exists client_budget_period (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  amount_krw int not null check (amount_krw >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_budget_period_range_check check (ends_on >= starts_on),
  constraint client_budget_period_no_overlap
    exclude using gist (client_id with =, daterange(starts_on, ends_on, '[]') with &&)
);
create index if not exists client_budget_period_client_idx on client_budget_period (client_id, starts_on desc);
```

- [ ] **Step 2: 스테이징 DB에 적용**

Run: `bash scripts/apply-migrations.sh .env.staging`
Expected: 마지막 줄에 `== applying migrations/058_client_budget_period.sql` 다음 `== done` — 오류 없음.

- [ ] **Step 3: 겹침 제약이 실제로 막는지 수동 확인**

Run:
```bash
node --import tsx --env-file-if-exists=.env.staging -e "
import { getSql } from './src/lib/db.ts';
const sql = getSql();
const c = await sql\`insert into client (name) values ('plan-058-check') returning id\`;
await sql\`insert into client_budget_period (client_id, starts_on, ends_on, amount_krw) values (\${c[0].id}, '2026-08-01', '2026-08-31', 1000)\`;
try {
  await sql\`insert into client_budget_period (client_id, starts_on, ends_on, amount_krw) values (\${c[0].id}, '2026-08-15', '2026-09-15', 1000)\`;
  console.log('FAIL: 겹침이 통과됨');
} catch (e) { console.log('OK: 겹침 거부됨 —', e.code); }
await sql\`delete from client where id = \${c[0].id}\`;
await sql.end();
"
```
Expected: `OK: 겹침 거부됨 — 23P01`

- [ ] **Step 4: 커밋**

```bash
git add migrations/058_client_budget_period.sql
git commit -m "$(cat <<'EOF'
feat(db): 클라이언트 예산 기간 테이블 추가

월 단위 예산을 시작일·종료일·금액 기반 기간으로 대체하기 위한 첫 단계.
같은 클라이언트에서 날짜가 겹치는 기간은 DB가 exclusion constraint로 막는다.
기존 monthly_budget/budget_overrides 컬럼은 이번 마이그레이션에서 건드리지 않는다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `clientBudget.ts` 전면 교체 — 순수 계산 모듈

**Files:**
- Modify: `src/lib/clientBudget.ts` (전체 교체)
- Modify: `src/lib/clientBudget.test.ts` (전체 교체)

**Interfaces:**
- Consumes: `parseAmount`, `formatAmount`, `type MoneyByCurrency`, `type Parsed` (`./campaignCost.ts`), `isDateOnlyString` (`./campaignJudgment.ts`)
- Produces (이후 태스크가 그대로 쓴다):
  - `interface BudgetPeriod { id: string; startsOn: string; endsOn: string; amountKrw: number }`
  - `type BudgetSource = 'period' | 'none'`
  - `interface PeriodSpend { total: MoneyByCurrency; campaignCount: number; feeKrw: number; feeUnknown: number }`
  - `interface SpanningCampaign { id: string; endsOn: string }`
  - `interface OverageBadge { latestEndsOn: string; count: number }`
  - `interface PeriodRow { period: BudgetPeriod; spentKrw: number; jpyIncluded: number; campaignCount: number; remaining: number; spentWithFeeKrw: number; feeKrw: number; feeUnknown: number; badge: OverageBadge | null }`
  - `interface CampaignPeriodBudget { period: BudgetPeriod | null; source: BudgetSource; othersKrw: number; campaignCount: number; badge: OverageBadge | null }`
  - `interface BudgetPeriodInput { startsOn: string; endsOn: string; amountKrw: number }`
  - `JPY_TO_KRW`, `toKrw()`, `remainingOf()`, `periodFor()`, `overageBadge()`, `periodRow()`, `campaignPeriodBudget()`, `periodLabel()`, `budgetTipText()`, `badgeText()`, `budgetJudgment()`, `parseBudgetAmount()`, `parseBudgetPeriodInput()`

- [ ] **Step 1: 실패하는 테스트부터 — `clientBudget.test.ts` 전체 교체**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JPY_TO_KRW, BUDGET_AMOUNT_MESSAGE, PERIOD_DATE_MESSAGE, PERIOD_ORDER_MESSAGE,
  toKrw, remainingOf, periodFor, overageBadge, periodRow, campaignPeriodBudget,
  periodLabel, budgetTipText, badgeText, budgetJudgment, parseBudgetAmount, parseBudgetPeriodInput,
  type BudgetPeriod, type PeriodSpend, type SpanningCampaign,
} from './clientBudget.ts';

const period = (id: string, startsOn: string, endsOn: string, amountKrw: number): BudgetPeriod =>
  ({ id, startsOn, endsOn, amountKrw });
const spend = (over: Partial<PeriodSpend> = {}): PeriodSpend =>
  ({ total: {}, campaignCount: 0, feeKrw: 0, feeUnknown: 0, ...over });

test('1) toKrw — 엔화는 1엔=JPY_TO_KRW원으로 환산해 합산, 엔화 원금은 따로 알려준다', () => {
  assert.equal(JPY_TO_KRW, 10);
  assert.deepEqual(toKrw({}), { krw: 0, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ KRW: 300_000 }), { krw: 300_000, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ JPY: 95_000 }), { krw: 950_000, jpyIncluded: 95_000 });
  assert.deepEqual(toKrw({ KRW: 300_000, JPY: 95_000 }), { krw: 1_250_000, jpyIncluded: 95_000 });
});

test('2) remainingOf — 예산 - 지출', () => {
  assert.equal(remainingOf(3_000_000, 1_200_000), 1_800_000);
  assert.equal(remainingOf(2_500_000, 2_850_000), -350_000);
});

test('3) periodFor — 경계값(시작일·종료일 포함), 겹침 없음 전제라 최대 1개, 빈틈이면 null', () => {
  const periods = [period('a', '2026-08-01', '2026-08-31', 1), period('b', '2026-09-01', '2026-09-30', 2)];
  assert.equal(periodFor(periods, '2026-08-01')!.id, 'a');   // 시작일 포함
  assert.equal(periodFor(periods, '2026-08-31')!.id, 'a');   // 종료일 포함
  assert.equal(periodFor(periods, '2026-09-01')!.id, 'b');
  assert.equal(periodFor(periods, '2026-07-31'), null);      // 빈틈(첫 기간 이전)
  assert.equal(periodFor([], '2026-08-01'), null);
});

test('4) overageBadge — 정상 범위면 null, 마이너스인데 걸치는 캠페인 없으면 null, 있으면 count·가장 늦은 종료일', () => {
  assert.equal(overageBadge(100, []), null);                                  // 정상
  assert.equal(overageBadge(-100, []), null);                                 // 마이너스지만 걸치는 캠페인 없음
  const spanning: SpanningCampaign[] = [{ id: 'x', endsOn: '2026-09-04' }, { id: 'y', endsOn: '2026-09-02' }];
  assert.deepEqual(overageBadge(-100, spanning), { latestEndsOn: '2026-09-04', count: 2 });  // 가장 늦은 날짜 선택
  assert.deepEqual(overageBadge(-1, [{ id: 'z', endsOn: '2026-09-04' }]), { latestEndsOn: '2026-09-04', count: 1 });
});

test('5) periodRow — 계산·초과 배지 결합', () => {
  const p = period('p1', '2026-08-01', '2026-08-31', 2_500_000);
  const row = periodRow(p, spend({ total: { KRW: 1_900_000, JPY: 95_000 }, campaignCount: 3, feeKrw: 53_000, feeUnknown: 2 }),
                         [{ id: 'aug2', endsOn: '2026-09-06' }]);
  assert.equal(row.spentKrw, 2_850_000);
  assert.equal(row.jpyIncluded, 95_000);
  assert.equal(row.campaignCount, 3);
  assert.equal(row.remaining, -350_000);
  assert.equal(row.spentWithFeeKrw, 2_903_000);
  assert.equal(row.feeKrw, 53_000);
  assert.equal(row.feeUnknown, 2);
  assert.deepEqual(row.badge, { latestEndsOn: '2026-09-06', count: 1 });
  // 정상 범위(초과 없음)면 걸치는 캠페인이 있어도 배지 없음
  const normal = periodRow(period('p2', '2026-09-01', '2026-09-30', 5_000_000), spend({ total: { KRW: 3_200_000 }, campaignCount: 4 }), [{ id: 'z', endsOn: '2026-10-04' }]);
  assert.equal(normal.badge, null);
});

test('6) campaignPeriodBudget — 기간 없으면 source none, 있으면 othersKrw·배지', () => {
  const none = campaignPeriodBudget(null, undefined, [], 0);
  assert.deepEqual(none, { period: null, source: 'none', othersKrw: 0, campaignCount: 0, badge: null });

  const p = period('p1', '2026-08-01', '2026-08-31', 3_000_000);
  const b = campaignPeriodBudget(p, spend({ total: { KRW: 1_850_000 }, campaignCount: 2 }), [], 1_200_000);
  assert.deepEqual(b, { period: p, source: 'period', othersKrw: 650_000, campaignCount: 2, badge: null });

  // 이 기간이 마이너스이고 걸치는 캠페인이 있으면 카드에도 같은 배지가 뜬다(기간 전체 상태)
  const over = campaignPeriodBudget(period('p2', '2026-08-01', '2026-08-31', 1_000_000),
    spend({ total: { KRW: 1_200_000 }, campaignCount: 1 }), [{ id: 'x', endsOn: '2026-09-04' }], 1_200_000);
  assert.deepEqual(over.badge, { latestEndsOn: '2026-09-04', count: 1 });
});

test('7) periodLabel·budgetTipText·badgeText', () => {
  assert.equal(periodLabel(period('p', '2026-09-01', '2026-09-30', 1)), '9/1 ~ 9/30');
  assert.ok(budgetTipText().includes(`1엔 = ${JPY_TO_KRW}원`));
  assert.ok(budgetTipText().includes('시작일이 속한 기간'));
  assert.equal(badgeText({ latestEndsOn: '2026-09-04', count: 1 }), '9/4까지 이어지는 캠페인 때문에 초과됐어요');
  assert.equal(badgeText({ latestEndsOn: '2026-09-04', count: 3 }), '3개 캠페인이 기간을 넘어가요 · 가장 늦게는 9/4까지');
});

test('8) budgetJudgment — 남음/초과 문구', () => {
  assert.equal(budgetJudgment(1_800_000), '1,800,000원 남음');
  assert.equal(budgetJudgment(-350_000), '350,000원 초과');
  assert.equal(budgetJudgment(0), '0원 남음');
});

test('9) parseBudgetAmount — 0 이상 정수·콤마 문자열만, null/빈 문자열/음수/소수는 거부(기간은 항상 금액 필수)', () => {
  assert.deepEqual(parseBudgetAmount('3,000,000'), { ok: true, value: 3_000_000 });
  assert.deepEqual(parseBudgetAmount(0), { ok: true, value: 0 });
  assert.deepEqual(parseBudgetAmount(null), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(''), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(-1), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(1.5), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
});

test('10) parseBudgetPeriodInput — 날짜 형식·순서·금액 검증', () => {
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 5_000_000 }),
    { ok: true, value: { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 5_000_000 } });
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-40', endsOn: '2026-09-30', amountKrw: 1 }),
    { ok: false, message: PERIOD_DATE_MESSAGE });
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-30', endsOn: '2026-09-01', amountKrw: 1 }),
    { ok: false, message: PERIOD_ORDER_MESSAGE });
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-01', endsOn: '2026-09-01', amountKrw: 1 }).ok, true);  // 하루짜리 허용
  assert.deepEqual(parseBudgetPeriodInput({ startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: -1 }),
    { ok: false, message: BUDGET_AMOUNT_MESSAGE });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --test src/lib/clientBudget.test.ts 2>&1 | tail -15`
Expected: 모듈이 없는 export를 import하려다 실패(`SyntaxError` 또는 `is not a function`).

- [ ] **Step 3: `clientBudget.ts` 전체 교체(구현)**

```ts
// 클라이언트 예산 기간의 순수 로직 — 환율 상수, 원화 환산, 기간 찾기, 초과 배지, 표 행, 입력 검증.
// 서버(스토어·라우트)와 화면(BudgetPanel·SummaryCards·FlowCards)이 같은 함수를 쓴다(스펙 2026-09-22 §4).
// 037의 월 단위 모델(기본 예산+예외 달)을 완전히 대체한다 — 이 파일에 '기본값' 개념은 없다.
import { parseAmount, formatAmount, type MoneyByCurrency, type Parsed } from './campaignCost.ts';
import { isDateOnlyString } from './campaignJudgment.ts';

// 환율 — 참고 환산(koo 결정 08-27: 1엔 = 10원 고정, 09-22 유지). 바꿀 자리는 여기 한 곳.
export const JPY_TO_KRW = 10;

export const BUDGET_AMOUNT_MESSAGE = '예산은 0 이상 숫자로 입력해 주세요';
export const PERIOD_DATE_MESSAGE = '기간은 YYYY-MM-DD 날짜로 입력해 주세요';
export const PERIOD_ORDER_MESSAGE = '종료일이 시작일보다 앞이에요';

export interface BudgetPeriod { id: string; startsOn: string; endsOn: string; amountKrw: number }
export type BudgetSource = 'period' | 'none';

export interface PeriodSpend { total: MoneyByCurrency; campaignCount: number; feeKrw: number; feeUnknown: number }
// 기간에 귀속된 캠페인 중 이 기간 종료일 뒤까지 이어지는 것들 — 초과 원인 배지용(스펙 §4, §7)
export interface SpanningCampaign { id: string; endsOn: string }

export function toKrw(total: MoneyByCurrency): { krw: number; jpyIncluded: number } {
  const jpy = total.JPY ?? 0;
  return { krw: (total.KRW ?? 0) + jpy * JPY_TO_KRW, jpyIncluded: jpy };
}

export function remainingOf(amountKrw: number, spentKrw: number): number {
  return amountKrw - spentKrw;
}

// 캠페인이 속한 기간 찾기 — 겹침이 없으므로(DB exclusion constraint) 항상 최대 1개
export function periodFor(periods: BudgetPeriod[], dateOnly: string): BudgetPeriod | null {
  return periods.find((p) => p.startsOn <= dateOnly && dateOnly <= p.endsOn) ?? null;
}

export interface OverageBadge { latestEndsOn: string; count: number }
// 배지는 '존재하면 원인일 수 있다'는 근사치다 — 얼마나 설명하는지(정확한 인과 비율)는 계산하지 않는다(스펙 §7).
export function overageBadge(remaining: number, spanning: SpanningCampaign[]): OverageBadge | null {
  if (remaining >= 0 || spanning.length === 0) return null;
  const latestEndsOn = spanning.reduce((max, c) => (c.endsOn > max ? c.endsOn : max), spanning[0].endsOn);
  return { latestEndsOn, count: spanning.length };
}

export interface PeriodRow {
  period: BudgetPeriod;
  spentKrw: number; jpyIncluded: number; campaignCount: number;
  remaining: number;                     // amountKrw - spentKrw(단가 기준)
  // 지출 기준 토글 — 단가(spentKrw)는 그대로 두고, 수수료 포함 값은 화면이 remainingOf(amountKrw, spentWithFeeKrw)로 다시 낸다
  spentWithFeeKrw: number; feeKrw: number; feeUnknown: number;
  badge: OverageBadge | null;            // 단가 기준 remaining으로 계산 — 토글해도 안 바뀐다
}
export function periodRow(period: BudgetPeriod, spend: PeriodSpend, spanning: SpanningCampaign[]): PeriodRow {
  const { krw, jpyIncluded } = toKrw(spend.total);
  const remaining = remainingOf(period.amountKrw, krw);
  return {
    period, spentKrw: krw, jpyIncluded, campaignCount: spend.campaignCount,
    remaining, spentWithFeeKrw: krw + spend.feeKrw, feeKrw: spend.feeKrw, feeUnknown: spend.feeUnknown,
    badge: overageBadge(remaining, spanning),
  };
}

// 캠페인 상세 카드용 — othersKrw는 이 기간 합계 − 이 캠페인 몫(같은 totalsFor). period가 null이면 '미설정'(source: none).
export interface CampaignPeriodBudget {
  period: BudgetPeriod | null; source: BudgetSource;
  othersKrw: number; campaignCount: number; badge: OverageBadge | null;   // badge는 이 기간 전체 상태(이 캠페인만의 것이 아니다)
}
export function campaignPeriodBudget(
  period: BudgetPeriod | null, spend: PeriodSpend | undefined, spanning: SpanningCampaign[], thisCampaignKrw: number,
): CampaignPeriodBudget {
  if (period === null) return { period: null, source: 'none', othersKrw: 0, campaignCount: 0, badge: null };
  const { krw } = toKrw(spend?.total ?? {});
  const remaining = remainingOf(period.amountKrw, krw);
  return {
    period, source: 'period', othersKrw: Math.max(0, krw - thisCampaignKrw),
    campaignCount: spend?.campaignCount ?? 0, badge: overageBadge(remaining, spanning),
  };
}

// 'M/D' — 시간대 시프트 없음('YYYY-MM-DD' 문자열 슬라이스만, datetime.ts date-only 계열과 같은 태도)
function shortDate(d: string): string { return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; }
export function periodLabel(p: BudgetPeriod): string { return `${shortDate(p.startsOn)} ~ ${shortDate(p.endsOn)}`; }

export function badgeText(badge: OverageBadge): string {
  return badge.count === 1
    ? `${shortDate(badge.latestEndsOn)}까지 이어지는 캠페인 때문에 초과됐어요`
    : `${badge.count}개 캠페인이 기간을 넘어가요 · 가장 늦게는 ${shortDate(badge.latestEndsOn)}까지`;
}

// 표·카드 ⓘ 공용 — 귀속 규칙·집계 범위·환율·배지 규칙을 한 문장씩(스펙 §6)
export function budgetTipText(): string {
  return `캠페인은 시작일이 속한 기간에 전액 잡혀요 · 캠페인에 넣은 콘텐츠 비용만 집계해요 · `
    + `엔화는 1엔 = ${JPY_TO_KRW}원으로 환산해요 · 수수료 포함은 인플루언서별 송금 수수료를 얹은 예상 금액이에요 · `
    + `기간을 넘어가는 캠페인 때문에 초과되면 그 이유를 표시해요(잔액 계산에는 반영하지 않아요)`;
}

export function budgetJudgment(remaining: number): string {
  return remaining < 0 ? `${formatAmount(-remaining, 'KRW')} 초과` : `${formatAmount(remaining, 'KRW')} 남음`;
}

// 예산 입력 검증 — 0 이상 정수만(콤마 허용, 단가 검증과 동일 규칙). 기간은 항상 금액이 있어야 하므로
// null·빈 문자열도 거부한다(037의 '미설정 허용'과 다른 점 — 스펙 §2).
export function parseBudgetAmount(v: unknown): Parsed<number> {
  const n = parseAmount(v);
  return n === null ? { ok: false, message: BUDGET_AMOUNT_MESSAGE } : { ok: true, value: n };
}

export interface BudgetPeriodInput { startsOn: string; endsOn: string; amountKrw: number }
function parseDateOnly(v: unknown): Parsed<string> {
  return isDateOnlyString(v) ? { ok: true, value: v } : { ok: false, message: PERIOD_DATE_MESSAGE };
}
export function parseBudgetPeriodInput(body: unknown): Parsed<BudgetPeriodInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const startsOn = parseDateOnly(b.startsOn); if (!startsOn.ok) return startsOn;
  const endsOn = parseDateOnly(b.endsOn);     if (!endsOn.ok) return endsOn;
  if (endsOn.value < startsOn.value) return { ok: false, message: PERIOD_ORDER_MESSAGE };
  const amount = parseBudgetAmount(b.amountKrw); if (!amount.ok) return amount;
  return { ok: true, value: { startsOn: startsOn.value, endsOn: endsOn.value, amountKrw: amount.value } };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `node --import tsx --test src/lib/clientBudget.test.ts 2>&1 | tail -5`
Expected: `# pass 10` `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/clientBudget.ts src/lib/clientBudget.test.ts
git commit -m "$(cat <<'EOF'
feat(budget): 기간 기반 예산 계산 모듈로 clientBudget.ts 전면 교체

월 단위(기본+예외) 계산을 기간(시작일·종료일·금액) 계산으로 바꾼다.
periodFor로 캠페인이 속한 기간을 찾고, overageBadge로 기간 경계를 넘는
캠페인 때문에 생긴 초과만 원인 배지로 표시한다(잔액 계산은 그대로 둠).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `budgetPeriodStore.ts` — 새 저장소

**Files:**
- Create: `src/lib/budgetPeriodStore.ts`
- Create: `src/lib/budgetPeriodStore.test.ts`

**Interfaces:**
- Consumes: `type BudgetPeriod`, `type BudgetPeriodInput` (`./clientBudget.ts`), `getSql` (`./db.ts`)
- Produces (Task 5·6이 그대로 쓴다):
  - `type BudgetPeriodResult = { ok: true; period: BudgetPeriod } | { ok: false; conflict: { startsOn: string; endsOn: string } }`
  - `listBudgetPeriods(sql, clientId): Promise<BudgetPeriod[]>` (startsOn desc)
  - `createBudgetPeriod(sql, clientId, input: BudgetPeriodInput): Promise<BudgetPeriodResult>`
  - `updateBudgetPeriod(sql, id, clientId, input: BudgetPeriodInput): Promise<BudgetPeriodResult | null>` (null = 그 id·clientId 조합 없음)
  - `deleteBudgetPeriod(sql, id, clientId): Promise<void>`

- [ ] **Step 1: 실패하는 테스트부터 — `budgetPeriodStore.test.ts` 작성**

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { listBudgetPeriods, createBudgetPeriod, updateBudgetPeriod, deleteBudgetPeriod } from './budgetPeriodStore.ts';

const sql = getSql();
const P = 'test-bp-' + process.pid + '-';

after(async () => {
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('createBudgetPeriod — 저장·조회 왕복, 최신 startsOn이 위', async () => {
  const c = await createClient(sql, P + '기간클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 2_500_000 });
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 5_000_000 });
  const rows = await listBudgetPeriods(sql, c.id);
  assert.deepEqual(rows.map((r) => r.startsOn), ['2026-09-01', '2026-08-01']);
  assert.equal(rows[0].amountKrw, 5_000_000);
});

test('createBudgetPeriod — 겹치면 conflict, 인접(빈틈 없이 붙은)은 통과', async () => {
  const c = await createClient(sql, P + '겹침클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const overlap = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-15', endsOn: '2026-09-15', amountKrw: 1 });
  assert.equal(overlap.ok, false);
  if (!overlap.ok) assert.deepEqual(overlap.conflict, { startsOn: '2026-08-01', endsOn: '2026-08-31' });

  // 인접(8/31 종료 다음 날인 9/1 시작)은 겹치지 않는다
  const adjacent = await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 1 });
  assert.equal(adjacent.ok, true);

  // 같은 날 하루라도 겹치면 거부 — 8/31에 이미 있는데 8/31~9/5는 겹침
  const sameDay = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-31', endsOn: '2026-09-05', amountKrw: 1 });
  assert.equal(sameDay.ok, false);
});

test('updateBudgetPeriod — 자유 수정(자기 자신은 겹침 체크에서 제외), 없는 id는 null', async () => {
  const c = await createClient(sql, P + '수정클라');
  const a = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const b = await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 1 });
  if (!a.ok || !b.ok) throw new Error('setup failed');

  // 자기 자신의 날짜를 그대로 넣어도(자기 자신과 겹침) 통과해야 한다
  const same = await updateBudgetPeriod(sql, a.period.id, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 999 });
  assert.equal(same!.ok, true);

  // 다른 기간(b)과 겹치게 고치면 거부
  const clash = await updateBudgetPeriod(sql, a.period.id, c.id, { startsOn: '2026-08-01', endsOn: '2026-09-15', amountKrw: 1 });
  assert.equal(clash!.ok, false);

  // 없는 id·클라이언트 불일치는 null(404 처리용)
  assert.equal(await updateBudgetPeriod(sql, '00000000-0000-0000-0000-000000000000', c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 }), null);
  const other = await createClient(sql, P + '남의클라');
  assert.equal(await updateBudgetPeriod(sql, a.period.id, other.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 }), null);
});

test('deleteBudgetPeriod — 삭제 후 목록에서 사라짐, 클라이언트 삭제 시 cascade', async () => {
  const c = await createClient(sql, P + '삭제클라');
  const a = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  if (!a.ok) throw new Error('setup failed');
  await deleteBudgetPeriod(sql, a.period.id, c.id);
  assert.deepEqual(await listBudgetPeriods(sql, c.id), []);

  const c2 = await createClient(sql, P + '캐스케이드클라');
  await createBudgetPeriod(sql, c2.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  await deleteClient(sql, c2.id);
  assert.deepEqual(await listBudgetPeriods(sql, c2.id), []);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/budgetPeriodStore.test.ts 2>&1 | tail -15`
Expected: `Cannot find module './budgetPeriodStore.ts'` 류 오류.

- [ ] **Step 3: `budgetPeriodStore.ts` 구현**

```ts
// 클라이언트 예산 기간 저장소 — 겹침은 DB exclusion constraint(058)가 막고, 이 파일은 사용자에게 보여줄
// 겹치는 기간 정보를 사전 조회해 사람이 읽을 오류로 바꾼다(레이스는 constraint가 최종 방어, 스펙 §7).
import type postgres from 'postgres';
import type { BudgetPeriod, BudgetPeriodInput } from './clientBudget.ts';

type Row = { id: string; starts_on: string; ends_on: string; amount_krw: number };
const toPeriod = (r: Row): BudgetPeriod => ({ id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, amountKrw: r.amount_krw });
const COLS = (sql: postgres.Sql) => sql`
  id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, amount_krw`;

export async function listBudgetPeriods(sql: postgres.Sql, clientId: string): Promise<BudgetPeriod[]> {
  const rows = await sql<Row[]>`
    select ${COLS(sql)} from client_budget_period where client_id = ${clientId} order by starts_on desc`;
  return rows.map(toPeriod);
}

export type BudgetPeriodResult =
  | { ok: true; period: BudgetPeriod }
  | { ok: false; conflict: { startsOn: string; endsOn: string } };

async function findOverlap(
  sql: postgres.Sql, clientId: string, startsOn: string, endsOn: string, excludeId?: string,
): Promise<{ startsOn: string; endsOn: string } | null> {
  const rows = await sql<Array<{ starts_on: string; ends_on: string }>>`
    select to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from client_budget_period
     where client_id = ${clientId}
       and daterange(starts_on, ends_on, '[]') && daterange(${startsOn}::date, ${endsOn}::date, '[]')
       ${excludeId ? sql`and id <> ${excludeId}` : sql``}
     limit 1`;
  return rows.length ? rows[0] : null;
}

export async function createBudgetPeriod(
  sql: postgres.Sql, clientId: string, input: BudgetPeriodInput,
): Promise<BudgetPeriodResult> {
  const conflict = await findOverlap(sql, clientId, input.startsOn, input.endsOn);
  if (conflict) return { ok: false, conflict };
  try {
    const rows = await sql<Row[]>`
      insert into client_budget_period (client_id, starts_on, ends_on, amount_krw)
      values (${clientId}, ${input.startsOn}::date, ${input.endsOn}::date, ${input.amountKrw})
      returning ${COLS(sql)}`;
    return { ok: true, period: toPeriod(rows[0]) };
  } catch (e) {
    if ((e as { code?: string }).code === '23P01') {   // exclusion_violation — 동시 요청 레이스
      const raced = await findOverlap(sql, clientId, input.startsOn, input.endsOn);
      return { ok: false, conflict: raced ?? { startsOn: input.startsOn, endsOn: input.endsOn } };
    }
    throw e;
  }
}

export async function updateBudgetPeriod(
  sql: postgres.Sql, id: string, clientId: string, input: BudgetPeriodInput,
): Promise<BudgetPeriodResult | null> {
  const conflict = await findOverlap(sql, clientId, input.startsOn, input.endsOn, id);
  if (conflict) return { ok: false, conflict };
  try {
    const rows = await sql<Row[]>`
      update client_budget_period set
        starts_on = ${input.startsOn}::date, ends_on = ${input.endsOn}::date,
        amount_krw = ${input.amountKrw}, updated_at = now()
      where id = ${id} and client_id = ${clientId}
      returning ${COLS(sql)}`;
    return rows.length ? { ok: true, period: toPeriod(rows[0]) } : null;
  } catch (e) {
    if ((e as { code?: string }).code === '23P01') {
      const raced = await findOverlap(sql, clientId, input.startsOn, input.endsOn, id);
      return { ok: false, conflict: raced ?? { startsOn: input.startsOn, endsOn: input.endsOn } };
    }
    throw e;
  }
}

export async function deleteBudgetPeriod(sql: postgres.Sql, id: string, clientId: string): Promise<void> {
  await sql`delete from client_budget_period where id = ${id} and client_id = ${clientId}`;
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/budgetPeriodStore.test.ts 2>&1 | tail -10`
Expected: `# pass 4` `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/budgetPeriodStore.ts src/lib/budgetPeriodStore.test.ts
git commit -m "$(cat <<'EOF'
feat(budget): 예산 기간 CRUD 저장소(budgetPeriodStore) 추가

겹치는 기간은 사전 조회로 사람이 읽을 오류를 만들고, 레이스는
058의 exclusion constraint(23P01)를 잡아 같은 방식으로 처리한다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `clientStore.ts` — 월 단위 예산 코드 제거

**Files:**
- Modify: `src/lib/clientStore.ts`
- Modify: `src/lib/clientStore.test.ts`
- Modify: `src/lib/clientSummary.test.ts`

**Interfaces:**
- Produces: `ClientRow`에서 `monthlyBudget`/`budgetOverrides` 필드 제거(다른 필드는 그대로) — Task 5·7이 이 축소된 `ClientRow`를 쓴다.

- [ ] **Step 1: 실패하는 테스트로 만들기 — `clientStore.test.ts`에서 월 예산 테스트 통째로 삭제**

`src/lib/clientStore.test.ts`에서 아래 import와 테스트를 지운다:

```ts
// 삭제할 import 조각 (5-7행)
  createProcedure, updateProcedure, deleteProcedure, setBudgetOverride, getClientBudget,
```
→
```ts
  createProcedure, updateProcedure, deleteProcedure,
```

그리고 115~161행의 `test('월 예산: 기본값 설정·null=지움·예외 달 설정/삭제·updated_at 갱신', ...)` 테스트 전체(115행부터 161행까지, 다음 빈 줄 포함)를 삭제한다.

- [ ] **Step 2: `clientSummary.test.ts` 픽스처에서 두 필드 제거**

`clientSummary.test.ts`의 fixture 줄에서:
```ts
updatedAt: '2026-08-09T00:00:00.000Z', landingUrl: '', nameEn: '', monthlyBudget: null, budgetOverrides: {}, clinicCode: null, ...over };
```
→
```ts
updatedAt: '2026-08-09T00:00:00.000Z', landingUrl: '', nameEn: '', clinicCode: null, ...over };
```

- [ ] **Step 3: 테스트 실행 — 컴파일 에러로 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/clientStore.test.ts 2>&1 | tail -15`
Expected: `setBudgetOverride`/`getClientBudget`를 아직 clientStore.ts가 export하고 있어 이 시점엔 오히려 그대로 통과할 수 있다 — 그건 정상이다(다음 스텝에서 clientStore.ts를 고치면 두 심볼이 없어져 위 파일들의 참조가 실제로 사라졌는지가 핵심 검증이다). 이 스텝은 "지운 테스트가 더 이상 참조되지 않는다"만 확인하면 된다: `grep -n "setBudgetOverride\|getClientBudget\|monthlyBudget\|budgetOverrides" src/lib/clientStore.test.ts src/lib/clientSummary.test.ts` → 아무 것도 안 나와야 한다.

- [ ] **Step 4: `clientStore.ts`에서 월 단위 예산 코드 제거**

import 줄 교체:
```ts
import type postgres from 'postgres';
import { budgetOverridesOf, type BudgetClient } from './clientBudget.ts';
```
→
```ts
import type postgres from 'postgres';
```

`ClientRow` 인터페이스 교체:
```ts
export interface ClientRow {
  id: string; name: string; info: string; bannedPhrases: string[]; position: number; updatedAt: string;
  landingUrl: string; nameEn: string;
  monthlyBudget: number | null;              // 기본 월 예산(원). null = 미설정 (스펙 2026-08-27 §3)
  budgetOverrides: Record<string, number>;   // {"YYYY-MM": 원} 예외 달만
  clinicCode: string | null;                 // 리포트 페이지 연결용 클리닉 코드(외부 리포트 API의 clinic_code). null = 연결 안 함
}
```
→
```ts
export interface ClientRow {
  id: string; name: string; info: string; bannedPhrases: string[]; position: number; updatedAt: string;
  landingUrl: string; nameEn: string;
  clinicCode: string | null;                 // 리포트 페이지 연결용 클리닉 코드(외부 리포트 API의 clinic_code). null = 연결 안 함
}
```

`CRow` 타입 교체:
```ts
type CRow = {
  id: string; name: string; info: string; banned_phrases: string[]; position: number; updated_at: Date;
  landing_url: string; name_en: string; monthly_budget: number | null; budget_overrides: unknown; clinic_code: string | null;
};
```
→
```ts
type CRow = {
  id: string; name: string; info: string; banned_phrases: string[]; position: number; updated_at: Date;
  landing_url: string; name_en: string; clinic_code: string | null;
};
```

`toClient` 교체:
```ts
const toClient = (r: CRow): ClientRow =>
  ({ id: r.id, name: r.name, info: r.info, bannedPhrases: r.banned_phrases, position: r.position,
     updatedAt: toIsoOrEmpty(r.updated_at), landingUrl: r.landing_url, nameEn: r.name_en,
     monthlyBudget: r.monthly_budget, budgetOverrides: budgetOverridesOf(r.budget_overrides), clinicCode: r.clinic_code });
```
→
```ts
const toClient = (r: CRow): ClientRow =>
  ({ id: r.id, name: r.name, info: r.info, bannedPhrases: r.banned_phrases, position: r.position,
     updatedAt: toIsoOrEmpty(r.updated_at), landingUrl: r.landing_url, nameEn: r.name_en, clinicCode: r.clinic_code });
```

`CLIENT_COLS` 교체:
```ts
const CLIENT_COLS = (sql: postgres.Sql) => sql`
  id, name, info, banned_phrases, position, updated_at, landing_url, name_en, monthly_budget, budget_overrides, clinic_code`;
```
→
```ts
const CLIENT_COLS = (sql: postgres.Sql) => sql`
  id, name, info, banned_phrases, position, updated_at, landing_url, name_en, clinic_code`;
```

`updateClient` 교체:
```ts
export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; monthlyBudget?: number | null; clinicCode?: string | null },
): Promise<void> {
  await sql`update client set
      name = coalesce(${patch.name ?? null}, name),
      info = coalesce(${patch.info ?? null}, info),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases),
      landing_url = coalesce(${patch.landingUrl ?? null}, landing_url),
      name_en = coalesce(${patch.nameEn ?? null}, name_en),
      -- coalesce는 "null이면 유지"라 예산 지움을 표현할 수 없다 — undefined=유지 · null=지움 · 숫자=설정 (draftStore.influencer_handle 규칙)
      monthly_budget = case when ${patch.monthlyBudget !== undefined} then ${patch.monthlyBudget ?? null}::int else monthly_budget end,
      updated_at = now()
    where id = ${id}`;
  // clinic_code는 "null로 되돌리기"를 표현해야 해서 coalesce 패턴을 못 쓴다 — undefined(미지정)일 때만 건드리지 않는다.
  if (patch.clinicCode !== undefined) {
    await sql`update client set clinic_code = ${patch.clinicCode} where id = ${id}`;
  }
}
```
→
```ts
export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; clinicCode?: string | null },
): Promise<void> {
  await sql`update client set
      name = coalesce(${patch.name ?? null}, name),
      info = coalesce(${patch.info ?? null}, info),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases),
      landing_url = coalesce(${patch.landingUrl ?? null}, landing_url),
      name_en = coalesce(${patch.nameEn ?? null}, name_en),
      updated_at = now()
    where id = ${id}`;
  // clinic_code는 "null로 되돌리기"를 표현해야 해서 coalesce 패턴을 못 쓴다 — undefined(미지정)일 때만 건드리지 않는다.
  if (patch.clinicCode !== undefined) {
    await sql`update client set clinic_code = ${patch.clinicCode} where id = ${id}`;
  }
}
```

아래 두 함수를 통째로 삭제한다(`setBudgetOverride`, `getClientBudget` — 주석 포함):
```ts
// 예외 달 설정/삭제 — 한 문장의 jsonb 연산이라 두 사람이 다른 달을 동시에 고쳐도 서로 덮지 않는다.
// null = 그 달 예외 삭제(기본값으로 돌아감). 없는 달을 지워도 오류 없음.
export async function setBudgetOverride(sql: postgres.Sql, id: string, month: string, amount: number | null): Promise<void> {
  if (amount === null) {
    await sql`update client set budget_overrides = budget_overrides - ${month}::text, updated_at = now() where id = ${id}`;
  } else {
    await sql`update client set budget_overrides = budget_overrides || jsonb_build_object(${month}::text, ${amount}::int),
                                updated_at = now() where id = ${id}`;
  }
}

// 캠페인 상세가 쓰는 가벼운 조회 — 시술까지 끌어오지 않는다
export async function getClientBudget(sql: postgres.Sql, id: string): Promise<BudgetClient | null> {
  const rows = await sql<Array<{ monthly_budget: number | null; budget_overrides: unknown }>>`
    select monthly_budget, budget_overrides from client where id = ${id}`;
  if (rows.length === 0) return null;
  return { monthlyBudget: rows[0].monthly_budget, budgetOverrides: budgetOverridesOf(rows[0].budget_overrides) };
}
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/clientStore.test.ts src/lib/clientSummary.test.ts 2>&1 | tail -10`
Expected: `# fail 0` (이 시점에 `campaignStore.ts`/`campaignStore.test.ts`는 아직 `getClientBudget`을 참조하므로 **전체 타입체크(`npx tsc --noEmit`)는 Task 5까지는 실패해도 정상** — 이 태스크는 clientStore 관련 테스트만 통과시킨다.)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/clientStore.ts src/lib/clientStore.test.ts src/lib/clientSummary.test.ts
git commit -m "$(cat <<'EOF'
refactor(client): monthly_budget/budget_overrides 코드 제거

컬럼 자체는 2차 머지 전까지 DB에 남지만, 코드는 더 이상 읽지도 쓰지도
않는다(마이그레이션 순서 규칙 — AGENTS.md). ClientRow에서 두 필드,
clientStore.ts에서 setBudgetOverride·getClientBudget 삭제.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `campaignStore.ts` — 기간 기반 귀속으로 교체

**Files:**
- Modify: `src/lib/campaignStore.ts`
- Modify: `src/lib/campaignStore.test.ts`

**Interfaces:**
- Consumes: `listBudgetPeriods` (Task 3), `periodFor`·`campaignPeriodBudget`·`toKrw`·`JPY_TO_KRW`·`type PeriodSpend`·`type SpanningCampaign`·`type CampaignPeriodBudget` (Task 2)
- Produces: `spendByPeriods(sql, clientId, periods): Promise<Map<string, PeriodSpend & { spanning: SpanningCampaign[] }>>`, `CampaignDetail.budget: CampaignPeriodBudget | null` — Task 6(라우트)·8·9(화면)이 이 타입을 쓴다.

- [ ] **Step 1: 실패하는 테스트부터 — `campaignStore.test.ts`의 12·12-1·13번 테스트 교체**

202~229행의 테스트 `'12) spendByMonth — …'`를 아래로 교체:

```ts
test('12) spendByPeriods — 시작일이 속한 기간으로 묶고 totalsFor와 같은 정의, 기간 종료일 넘는 캠페인은 spanning', async () => {
  const c = await createClient(sql, P + '예산클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 1 });
  const periods = await listBudgetPeriods(sql, c.id);
  const aug = periods.find((p) => p.startsOn === '2026-08-01')!;
  const sep = periods.find((p) => p.startsOn === '2026-09-01')!;

  const aug1 = await createCampaign(sql, { ...base(c.id, c.name, 'm1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const aug2 = await createCampaign(sql, { ...base(c.id, c.name, 'm2'), startsOn: '2026-08-31', endsOn: '2026-09-06' }); // 8월 기간을 넘어 9월까지
  await createCampaign(sql, { ...base(c.id, c.name, 'm3'), startsOn: '2026-09-01', endsOn: '2026-09-07' });
  await createTasks(sql, aug1.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 300_000, currency: 'KRW' } }] });
  const [skip] = await createTasks(sql, aug1.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 777_777, currency: 'KRW' } }] });
  await updateDraft(sql, await mkDraft(c.id, c.name, skip.id), { status: 'unused' });
  const [cancTask] = await createTasks(sql, aug1.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 999_999, currency: 'KRW' } }] });
  await sql`update campaign_task set cancelled_at = '2026-08-30', cancel_reason = 'declined' where id = ${cancTask.id}`;
  await createTasks(sql, aug2.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: { amount: 95_000, currency: 'JPY' } }] });
  await upsertInfluencerCost(sql, aug1.id, 'hana', { extraCosts: [{ label: '교통비', amount: 20_000, currency: 'KRW' }] });

  const all = await spendByPeriods(sql, c.id, periods);
  const augSpend = all.get(aug.id)!;
  assert.deepEqual(augSpend.total, { KRW: 1_097_777, JPY: 95_000 });
  assert.equal(augSpend.campaignCount, 2);              // aug1 + aug2(시작일이 8/31이라 8월 기간에 귀속)
  assert.deepEqual(augSpend.spanning, [{ id: aug2.id, endsOn: '2026-09-06' }]);   // aug2는 9월까지 이어짐
  const sepSpend = all.get(sep.id)!;
  assert.deepEqual(sepSpend.total, {});
  assert.equal(sepSpend.campaignCount, 1);              // m3만(aug2는 8월 기간 몫)
  assert.deepEqual(sepSpend.spanning, []);

  // 다른 클라이언트의 캠페인은 섞이지 않는다
  const other = await createClient(sql, P + '남의클라');
  await createCampaign(sql, { ...base(other.id, other.name, 'm4'), startsOn: '2026-08-10', endsOn: '2026-08-16' });
  assert.equal((await spendByPeriods(sql, c.id, periods)).get(aug.id)!.campaignCount, 2);
});

test('12-1) spendByPeriods — feeKrw·feeUnknown(인플 부담 0 · CB 비율 5% · CB 고정 ¥165 · 결제 수단 없음)', async () => {
  const c = await createClient(sql, P + '수수료클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const period = (await listBudgetPeriods(sql, c.id))[0];
  const camp = await createCampaign(sql, { ...base(c.id, c.name, 'fee'), startsOn: '2026-08-12', endsOn: '2026-08-18' });

  const bank = (fee?: { mode: 'grossUp'; percent: number } | { mode: 'fixed'; amount: number }) =>
    ({ kind: 'add' as const, input: { type: 'bank' as const, holder: 'K', currency: 'JPY' as const, bank: 'b', account: '1', ...(fee ? { fee } : {}) }, makeDefault: true });

  const { row: selfPay } = await createInfluencer(sql, { handle: P + '_self', createdBy: null });
  await updatePaymentMethods(sql, selfPay.id, bank(), null);
  const { row: grossUp } = await createInfluencer(sql, { handle: P + '_gross', createdBy: null });
  await updatePaymentMethods(sql, grossUp.id, bank({ mode: 'grossUp', percent: 5 }), null);
  const { row: fixed } = await createInfluencer(sql, { handle: P + '_fixed', createdBy: null });
  await updatePaymentMethods(sql, fixed.id, bank({ mode: 'fixed', amount: 165 }), null);
  const { row: noMethod } = await createInfluencer(sql, { handle: P + '_none', createdBy: null });

  await createTasks(sql, camp.id, { ...tin, type: 'post', items: [
    { handle: selfPay.handle, cost: { amount: 10_000, currency: 'JPY' } },
    { handle: grossUp.handle, cost: { amount: 10_000, currency: 'JPY' } },
    { handle: fixed.handle, cost: { amount: 10_000, currency: 'JPY' } },
    { handle: noMethod.handle, cost: { amount: 10_000, currency: 'JPY' } },
  ] });
  await upsertInfluencerCost(sql, camp.id, selfPay.handle, { extraCosts: [{ label: '교통비', amount: 1_000, currency: 'JPY' }] });

  const spend = (await spendByPeriods(sql, c.id, [period])).get(period.id)!;
  assert.deepEqual(spend.total, { JPY: 41_000 });
  assert.equal(spend.feeKrw, 5_260 + 1_650);
  assert.equal(spend.feeUnknown, 1);
});

test('13) getCampaignDetail.budget — 기간에 귀속·othersKrw는 같은 기간 다른 캠페인 몫·클라 없으면 null·기간 밖이면 source none', async () => {
  const c = await createClient(sql, P + '예산클라2');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 2_500_000 });
  const a = await createCampaign(sql, { ...base(c.id, c.name, 'b1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const b = await createCampaign(sql, { ...base(c.id, c.name, 'b2'), startsOn: '2026-08-17', endsOn: '2026-08-23' });
  await createTasks(sql, a.id, { ...tin, type: 'post', items: [{ handle: 'hana', cost: { amount: 1_200_000, currency: 'KRW' } }] });
  await createTasks(sql, b.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: { amount: 65_000, currency: 'JPY' } }] });   // 650,000원

  const detA = (await getCampaignDetail(sql, a.id, T))!;
  assert.equal(detA.budget!.period!.amountKrw, 2_500_000);
  assert.equal(detA.budget!.source, 'period');
  assert.equal(detA.budget!.othersKrw, 650_000);
  assert.equal(detA.budget!.campaignCount, 2);
  const detB = (await getCampaignDetail(sql, b.id, T))!;
  assert.equal(detB.budget!.othersKrw, 1_200_000);

  // 9월은 기간이 없으므로 source none
  const s = await createCampaign(sql, { ...base(c.id, c.name, 'b3'), startsOn: '2026-09-07', endsOn: '2026-09-13' });
  const detS = (await getCampaignDetail(sql, s.id, T))!;
  assert.deepEqual(detS.budget, { period: null, source: 'none', othersKrw: 0, campaignCount: 0, badge: null });

  // 클라이언트를 지우면(client_id set null) budget은 null
  await deleteClient(sql, c.id);
  assert.equal((await getCampaignDetail(sql, a.id, T))!.budget, null);
});
```

`campaignStore.test.ts` 상단 import 줄을 수정한다. `setBudgetOverride`는 Task 4에서 clientStore.ts가 더 이상 export하지 않는다. `updateClient`도 이 파일에서 옛 테스트 13(263행, `updateClient(sql, c.id, { monthlyBudget: 3_000_000 })`) 한 곳에서만 쓰였는데 그 테스트를 아래에서 통째로 교체하므로 이 시점부터 미사용이 된다 — 같이 지운다(안 지우면 미사용 import로 린트가 걸린다). 새 저장소 import를 추가한다:
```ts
import { createClient, deleteClient, updateClient, setBudgetOverride } from './clientStore.ts';
```
→
```ts
import { createClient, deleteClient } from './clientStore.ts';
import { createBudgetPeriod, listBudgetPeriods } from './budgetPeriodStore.ts';
```
그리고 `spendByMonth` import를 `spendByPeriods`로 바꾼다:
```ts
  getCampaignDetail, upsertInfluencerCost, listInfluencerCampaigns, spendByMonth,
```
→
```ts
  getCampaignDetail, upsertInfluencerCost, listInfluencerCampaigns, spendByPeriods,
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignStore.test.ts 2>&1 | tail -20`
Expected: `spendByPeriods is not a function` 류 오류(campaignStore.ts가 아직 옛 이름을 export).

- [ ] **Step 3: `campaignStore.ts` 수정**

import 줄 교체:
```ts
import { getClientBudget } from './clientStore.ts';
import { campaignMonthBudget, monthOf, toKrw, JPY_TO_KRW, type MonthSpend, type CampaignMonthBudget } from './clientBudget.ts';
```
→
```ts
import { listBudgetPeriods } from './budgetPeriodStore.ts';
import {
  campaignPeriodBudget, periodFor, toKrw, JPY_TO_KRW, type PeriodSpend, type SpanningCampaign, type CampaignPeriodBudget,
} from './clientBudget.ts';
```

`CampaignDetail` 인터페이스의 budget 필드 타입·주석 교체:
```ts
  budget: CampaignMonthBudget | null;  // 이 캠페인이 속한 달의 클라이언트 예산(스펙 2026-08-27 §5-3). 클라 없으면 null
```
→
```ts
  budget: CampaignPeriodBudget | null;  // 이 캠페인이 속한 기간의 클라이언트 예산(스펙 2026-09-22 §5-2). 클라 없으면 null
```

`spendByMonth` 함수 전체를 아래로 교체:
```ts
// 클라이언트 × 달 집행(스펙 2026-08-27 §3) — 캠페인 starts_on의 달로 묶는다. 합산은 totalsFor를 그대로 써서
// 캠페인 카드 합계와 예산 표가 항상 같은 숫자를 말한다. 캠페인 수는 비용 0인 캠페인도 센다.
// months를 주면 그 달만(캠페인 상세는 한 달), 없으면 전부(클라이언트 상세 표).
export async function spendByMonth(sql: postgres.Sql, clientId: string, months?: string[]): Promise<Map<string, MonthSpend>> {
  const camps = await sql<Array<{ id: string; month: string }>>`
    select id, to_char(starts_on, 'YYYY-MM') as month from campaign
     where client_id = ${clientId}
       ${months ? sql`and to_char(starts_on, 'YYYY-MM') = any(${months}::text[])` : sql``}`;
  const totals = await totalsFor(sql, camps.map((c) => c.id));
  const out = new Map<string, MonthSpend>();
  for (const c of camps) {
    const cur = out.get(c.month) ?? { total: {}, campaignCount: 0, feeKrw: 0, feeUnknown: 0 };
    const t = totals.get(c.id);
    out.set(c.month, {
      total: mergeMoney(cur.total, t?.money ?? {}),
      campaignCount: cur.campaignCount + 1,
      feeKrw: cur.feeKrw + (t?.feeKrw ?? 0),
      feeUnknown: cur.feeUnknown + (t?.feeUnknown ?? 0),
    });
  }
  return out;
}
```
→
```ts
// 클라이언트 × 예산 기간 집행(스펙 2026-09-22 §5-2) — 캠페인 starts_on이 그 기간 안에 있으면 전액 귀속.
// 합산은 totalsFor를 그대로 써서 캠페인 카드 합계와 예산 표가 항상 같은 숫자를 말한다.
// spanning: 그 기간에 귀속됐지만 ends_on이 기간 종료일 뒤까지 이어지는 캠페인(초과 원인 배지용, §4).
export async function spendByPeriods(
  sql: postgres.Sql, clientId: string, periods: Array<{ id: string; startsOn: string; endsOn: string }>,
): Promise<Map<string, PeriodSpend & { spanning: SpanningCampaign[] }>> {
  const camps = await sql<Array<{ id: string; starts_on: string; ends_on: string }>>`
    select id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from campaign where client_id = ${clientId}`;
  const totals = await totalsFor(sql, camps.map((c) => c.id));
  const out = new Map<string, PeriodSpend & { spanning: SpanningCampaign[] }>();
  for (const period of periods) {
    let cur: PeriodSpend = { total: {}, campaignCount: 0, feeKrw: 0, feeUnknown: 0 };
    const spanning: SpanningCampaign[] = [];
    for (const c of camps) {
      if (c.starts_on < period.startsOn || c.starts_on > period.endsOn) continue;
      const t = totals.get(c.id);
      cur = {
        total: mergeMoney(cur.total, t?.money ?? {}),
        campaignCount: cur.campaignCount + 1,
        feeKrw: cur.feeKrw + (t?.feeKrw ?? 0),
        feeUnknown: cur.feeUnknown + (t?.feeUnknown ?? 0),
      };
      if (c.ends_on > period.endsOn) spanning.push({ id: c.id, endsOn: c.ends_on });
    }
    out.set(period.id, { ...cur, spanning });
  }
  return out;
}
```

`getCampaignDetail` 안의 예산 계산 블록 교체:
```ts
  // 이 달 예산(§5-3) — 클라이언트 없는 캠페인은 null. othersKrw = 같은 달 합계 − 이 캠페인 몫(campaign.total은 같은 totalsFor)
  let budget: CampaignMonthBudget | null = null;
  if (campaign.clientId) {
    const client = await getClientBudget(sql, campaign.clientId);
    if (client) {
      const month = monthOf(campaign.startsOn);
      const spend = (await spendByMonth(sql, campaign.clientId, [month])).get(month);
      budget = campaignMonthBudget(client, month, spend, toKrw(campaign.total).krw);
    }
  }
```
→
```ts
  // 이 기간 예산(스펙 §5-2) — 클라이언트 없는 캠페인은 null. othersKrw = 같은 기간 합계 − 이 캠페인 몫(campaign.total은 같은 totalsFor)
  let budget: CampaignPeriodBudget | null = null;
  if (campaign.clientId) {
    const periods = await listBudgetPeriods(sql, campaign.clientId);
    const period = periodFor(periods, campaign.startsOn);
    const spend = period ? (await spendByPeriods(sql, campaign.clientId, [period])).get(period.id) : undefined;
    budget = campaignPeriodBudget(period, spend, spend?.spanning ?? [], toKrw(campaign.total).krw);
  }
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/campaignStore.test.ts 2>&1 | tail -15`
Expected: `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/campaignStore.ts src/lib/campaignStore.test.ts
git commit -m "$(cat <<'EOF'
refactor(campaign): 예산 귀속을 월 대신 기간(client_budget_period)으로

spendByMonth → spendByPeriods(시작일이 속한 기간에 전액, 기간을 넘는
캠페인은 spanning으로 표시). getCampaignDetail.budget이 기간 기반
CampaignPeriodBudget을 돌려준다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: API 라우트 — 예산 기간 CRUD

**Files:**
- Create: `src/app/api/clients/[id]/budget-periods/route.ts`
- Create: `src/app/api/clients/[id]/budget-periods/[periodId]/route.ts`
- Delete: `src/app/api/clients/[id]/budget/route.ts`
- Delete: `src/app/api/clients/[id]/budget/[month]/route.ts`
- Modify: `src/app/api/clients/[id]/route.ts`

**Interfaces:**
- Consumes: `listBudgetPeriods`·`createBudgetPeriod`·`updateBudgetPeriod`·`deleteBudgetPeriod` (Task 3), `spendByPeriods` (Task 5), `periodRow`·`parseBudgetPeriodInput` (Task 2)
- Produces: `GET/POST /api/clients/[id]/budget-periods`, `PUT/DELETE /api/clients/[id]/budget-periods/[periodId]` — Task 7(BudgetPanel.tsx)이 그대로 호출한다.

- [ ] **Step 1: 옛 라우트 삭제**

```bash
rm -r "src/app/api/clients/[id]/budget"
```
(`route.ts`와 `[month]/route.ts`를 담은 `budget` 디렉터리 전체를 지운다 — 새 디렉터리는 `budget-periods`로 이름부터 다르다.)

- [ ] **Step 2: 새 라우트 작성 — `budget-periods/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listBudgetPeriods, createBudgetPeriod } from '@/lib/budgetPeriodStore';
import { spendByPeriods } from '@/lib/campaignStore';
import { periodRow, parseBudgetPeriodInput } from '@/lib/clientBudget';

// 클라이언트 상세 '예산 기간' 패널의 표(스펙 2026-09-22 §5-3). 집행은 저장하지 않고 매번 계산.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const sql = getSql();
  const periods = await listBudgetPeriods(sql, id);
  const spend = await spendByPeriods(sql, id, periods);
  const rows = periods.map((p) => {
    const s = spend.get(p.id) ?? { total: {}, campaignCount: 0, feeKrw: 0, feeUnknown: 0, spanning: [] };
    return periodRow(p, s, s.spanning);
  });
  return NextResponse.json({ rows });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const parsed = parseBudgetPeriodInput(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  try {
    const result = await createBudgetPeriod(sql, id, parsed.value);
    if (!result.ok) {
      return NextResponse.json(
        { error: `이미 있는 기간(${result.conflict.startsOn}~${result.conflict.endsOn})과 겹쳐요` }, { status: 409 });
    }
    return NextResponse.json(result.period, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === '23503') return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
    throw e;
  }
}
```

- [ ] **Step 3: 새 라우트 작성 — `budget-periods/[periodId]/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { updateBudgetPeriod, deleteBudgetPeriod } from '@/lib/budgetPeriodStore';
import { parseBudgetPeriodInput } from '@/lib/clientBudget';

const NOT_FOUND = () => NextResponse.json({ error: '기간을 찾을 수 없어요 — 새로고침해 주세요' }, { status: 404 });

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; periodId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, periodId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(periodId)) return NOT_FOUND();
  const parsed = parseBudgetPeriodInput(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const result = await updateBudgetPeriod(getSql(), periodId, id, parsed.value);
  if (result === null) return NOT_FOUND();
  if (!result.ok) {
    return NextResponse.json(
      { error: `이미 있는 기간(${result.conflict.startsOn}~${result.conflict.endsOn})과 겹쳐요` }, { status: 409 });
  }
  return NextResponse.json(result.period);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; periodId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, periodId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(periodId)) return NOT_FOUND();
  await deleteBudgetPeriod(getSql(), periodId, id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: `clients/[id]/route.ts`에서 `monthlyBudget` 처리 제거**

```ts
import { getClientWithProcedures, updateClient, deleteClient } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { checkLandingUrl, landingUrlMessage } from '@/lib/trackingLink';
import { parseBudgetAmount } from '@/lib/clientBudget';
```
→
```ts
import { getClientWithProcedures, updateClient, deleteClient } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { checkLandingUrl, landingUrlMessage } from '@/lib/trackingLink';
```

```ts
  const { monthlyBudget: rawBudget, ...rest } = (await req.json().catch(() => ({}))) as {
    name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; monthlyBudget?: unknown; clinicCode?: string | null;
  };
```
→
```ts
  const rest = (await req.json().catch(() => ({}))) as {
    name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; clinicCode?: string | null;
  };
```

```ts
  // 예산: undefined = 건드리지 않음 · null/'' = 미설정 · 숫자(콤마 문자열 허용) = 설정. 0 이상 정수만(비용 금액 규칙과 동일)
  let monthlyBudget: number | null | undefined;
  if (rawBudget !== undefined) {
    const parsed = parseBudgetAmount(rawBudget);
    if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
    monthlyBudget = parsed.value;
  }
  try {
    await updateClient(getSql(), id, { ...rest, monthlyBudget });
  } catch (e) {
```
→
```ts
  try {
    await updateClient(getSql(), id, rest);
  } catch (e) {
```

- [ ] **Step 5: 수동 확인 — 타입체크(다음 태스크에서 화면까지 고쳐야 완전히 통과하지만, 이 라우트 파일들 자체는 지금 깨끗해야 한다)**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "budget-periods|clients/\[id\]/route" || echo "OK: 관련 오류 없음"`
Expected: `OK: 관련 오류 없음` (다른 파일의 오류는 이 태스크 범위가 아니다 — Task 7~9에서 해소된다)

- [ ] **Step 6: 커밋**

```bash
git add -A src/app/api/clients
git commit -m "$(cat <<'EOF'
feat(api): 예산 기간 CRUD 라우트로 교체

GET/POST /api/clients/[id]/budget-periods, PUT/DELETE .../[periodId]를
새로 추가하고 옛 월 단위 예산 라우트(budget/route.ts, budget/[month])를
삭제한다. PATCH /api/clients/[id]에서 monthlyBudget 처리를 뺀다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `BudgetPanel.tsx` 전면 재작성 + `ClientDetail.tsx` 연결

**Files:**
- Modify: `src/app/clients/BudgetPanel.tsx` (전체 교체)
- Modify: `src/app/clients/ClientDetail.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/clients/[id]/budget-periods`, `PUT/DELETE /api/clients/[id]/budget-periods/[periodId]` (Task 6), `type PeriodRow`, `periodLabel`, `budgetJudgment`, `budgetTipText`, `badgeText`, `remainingOf`, `JPY_TO_KRW` (Task 2)
- Produces: `BudgetPanel({ client, onChanged })` — `register` prop 제거(더 이상 일괄 저장 대상 아님, 즉시 저장 패턴으로 바뀜).

- [ ] **Step 1: `BudgetPanel.tsx` 전체 교체**

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button, PANEL_SPLIT, PANEL_TITLE } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';
import { formatAmount, parseAmount } from '@/lib/campaignCost';
import {
  budgetJudgment, budgetTipText, badgeText, periodLabel, remainingOf, JPY_TO_KRW, type PeriodRow,
} from '@/lib/clientBudget';
import type { ClientRow } from '@/lib/clientStore';

// 예산 기간 패널(스펙 2026-09-22 §6-1) — 기간 목록 표 + 인라인 추가/편집. 037의 '기본값+월별 표'를 대체한다.
// 모든 변경(추가·수정·삭제)은 즉시 저장 — 시술 카드와 같은 패턴(register 일괄 저장 대상 아님).

async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}

type SpendBasis = 'unit' | 'withFee';
const BASIS_LABEL: Record<SpendBasis, string> = { unit: '단가', withFee: '수수료 포함' };
const DATE_INPUT = 'rounded-md border border-x-border-strong p-1.5 text-ui outline-none focus:border-x-blue';
const AMOUNT_INPUT = 'w-32 rounded-md border border-x-border-strong p-1.5 text-right text-ui tabular-nums outline-none focus:border-x-blue';

export function BudgetPanel({ client, onChanged }: { client: ClientRow; onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<PeriodRow[] | null>(null);
  const [rowsErr, setRowsErr] = useState(false);
  const [basis, setBasis] = useState<SpendBasis>('unit');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setRowsErr(false);
    try {
      const r = await apiFetch(`/api/clients/${client.id}/budget-periods`);
      if (!r.ok) throw new Error(String(r.status));
      setRows(((await r.json()) as { rows: PeriodRow[] }).rows);
    } catch {
      setRowsErr(true);
    }
  }, [client.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 표 데이터 최초 로드(기존 코드베이스 관례)
  useEffect(() => { void loadRows(); }, [loadRows]);

  async function refresh() { await onChanged(); await loadRows(); }

  return (
    <div className={PANEL_SPLIT}>
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className={PANEL_TITLE}>예산 기간</h2>
          <p className="text-caption text-x-muted">시작한 캠페인은 시작일이 속한 기간의 예산과 대조해요.</p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)} disabled={adding}>+ 새 기간 추가</Button>
      </div>
      <div className="border-t border-x-border px-5 py-5">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-ui font-bold">기간별 예산과 지출</span>
          <InfoTip text={budgetTipText()} label="집계 방식 설명 보기" />
        </div>
        <div className="mb-3 flex items-center gap-2">
          <span className="text-ui text-x-secondary">지출 기준</span>
          <div role="group" aria-label="지출 기준" className="inline-flex rounded-full border border-x-border-strong p-0.5">
            {(['unit', 'withFee'] as const).map((b) => (
              <button key={b} type="button" onClick={() => setBasis(b)} aria-pressed={basis === b}
                      className={`h-7 rounded-full px-3 text-ui ${
                        basis === b ? 'bg-x-text font-bold text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                {BASIS_LABEL[b]}
              </button>
            ))}
          </div>
        </div>
        {rowsErr ? (
          <div className="flex items-center gap-2 text-ui text-red-500">
            <span>예산 정보를 불러오지 못했어요</span>
            <Button onClick={() => void loadRows()}>다시 시도</Button>
          </div>
        ) : rows === null ? (
          <p className="text-ui text-x-muted">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-content">
              <thead>
                <tr className="text-left text-x-secondary">
                  <th className="py-2 pr-4 font-bold">기간</th>
                  <th className="py-2 pr-4 font-bold">예산</th>
                  <th className="py-2 pr-4 font-bold">지출</th>
                  <th className="py-2 font-bold">잔액</th>
                </tr>
              </thead>
              <tbody>
                {adding && (
                  <AddPeriodRow clientId={client.id}
                                onDone={async (ok) => { setAdding(false); if (ok) await refresh(); }} />
                )}
                {rows.map((r) => (
                  <PeriodRowView key={r.period.id} clientId={client.id} row={r} basis={basis}
                                 editing={editingId === r.period.id}
                                 onEdit={() => setEditingId(r.period.id)} onClose={() => setEditingId(null)}
                                 onChanged={refresh} />
                ))}
                {rows.length === 0 && !adding && (
                  <tr><td colSpan={4} className="py-6 text-center text-ui text-x-muted">아직 설정한 예산 기간이 없어요</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AddPeriodRow({ clientId, onDone }: { clientId: string; onDone: (ok: boolean) => Promise<void> }) {
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState('');
  const busy = useRef(false);

  async function save() {
    if (busy.current) return;
    if (!startsOn || !endsOn) { setErr('시작일·종료일을 입력해 주세요'); return; }
    const n = parseAmount(amount);
    if (n === null) { setErr('예산은 0 이상 숫자로 입력해 주세요'); return; }
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget-periods`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsOn, endsOn, amountKrw: n }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      await onDone(true);
    } finally { busy.current = false; }
  }

  return (
    <tr className="border-t border-x-border align-top bg-x-surface">
      <td className="py-3.5 pr-4">
        <div className="flex items-center gap-1.5">
          <input type="date" autoFocus value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-label="시작일" className={DATE_INPUT} />
          <span className="text-x-secondary">~</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label="종료일" className={DATE_INPUT} />
        </div>
      </td>
      <td className="py-3.5 pr-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input value={amount} inputMode="numeric" autoComplete="off" placeholder="예: 5,000,000" aria-label="예산"
                   onChange={(e) => setAmount(e.target.value)} className={AMOUNT_INPUT} />
            <span>원</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={save}>저장</Button>
            <Button variant="ghost" onClick={() => void onDone(false)}>취소</Button>
          </div>
          {err && <p className="text-caption text-red-500">{err}</p>}
        </div>
      </td>
      <td className="py-3.5 pr-4 text-x-muted">—</td>
      <td className="py-3.5 text-x-muted">—</td>
    </tr>
  );
}

function PeriodRowView({ clientId, row, basis, editing, onEdit, onClose, onChanged }: {
  clientId: string; row: PeriodRow; basis: SpendBasis; editing: boolean;
  onEdit: () => void; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const { period } = row;
  const [startsOn, setStartsOn] = useState(period.startsOn);
  const [endsOn, setEndsOn] = useState(period.endsOn);
  const [amount, setAmount] = useState(String(period.amountKrw));
  const [err, setErr] = useState('');
  const busy = useRef(false);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !wasEditing.current) {
      setStartsOn(period.startsOn); setEndsOn(period.endsOn); setAmount(String(period.amountKrw)); setErr('');
    }
    wasEditing.current = editing;
  }, [editing, period.startsOn, period.endsOn, period.amountKrw]);

  async function save() {
    if (busy.current) return;
    const n = parseAmount(amount);
    if (n === null) { setErr('예산은 0 이상 숫자로 입력해 주세요'); return; }
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget-periods/${period.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsOn, endsOn, amountKrw: n }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onClose(); await onChanged();
    } finally { busy.current = false; }
  }
  async function remove() {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget-periods/${period.id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onClose(); await onChanged();
    } finally { busy.current = false; }
  }

  const spentKrw = basis === 'unit' ? row.spentKrw : row.spentWithFeeKrw;
  const remaining = basis === 'unit' ? row.remaining : remainingOf(period.amountKrw, row.spentWithFeeKrw);
  const over = remaining < 0;

  return (
    <tr className="border-t border-x-border align-top">
      <td className="py-3.5 pr-4">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <input type="date" autoFocus value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-label="시작일" className={DATE_INPUT} />
            <span className="text-x-secondary">~</span>
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label="종료일" className={DATE_INPUT} />
          </div>
        ) : (
          <button onClick={onEdit} className="text-left hover:text-x-blue-text">{periodLabel(period)} <span className="text-ui text-x-muted">고치기</span></button>
        )}
      </td>
      <td className="py-3.5 pr-4">
        {editing ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input value={amount} inputMode="numeric" autoComplete="off" aria-label="예산"
                     onChange={(e) => setAmount(e.target.value)} className={AMOUNT_INPUT} />
              <span>원</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={save}>저장</Button>
              <Button variant="ghost" onClick={onClose}>취소</Button>
              <button onClick={remove} className="text-caption text-x-secondary hover:text-red-500">삭제</button>
            </div>
            {err && <p className="text-caption text-red-500">{err}</p>}
          </div>
        ) : (
          <span className="tabular-nums">{formatAmount(period.amountKrw, 'KRW')}</span>
        )}
      </td>
      <td className="py-3.5 pr-4 tabular-nums">
        {formatAmount(spentKrw, 'KRW')}
        <span className="ml-1.5 text-x-muted">· {row.campaignCount === 0 ? '캠페인 없음' : `캠페인 ${row.campaignCount}개`}</span>
        {row.jpyIncluded > 0 && (
          <p className="text-ui text-x-muted">엔화 {formatAmount(row.jpyIncluded, 'JPY')} 포함({formatAmount(row.jpyIncluded * JPY_TO_KRW, 'KRW')}으로 환산)</p>
        )}
        {basis === 'withFee' && (row.feeKrw > 0 || row.feeUnknown > 0) && (
          <p className="text-ui text-x-muted">
            송금 수수료 {formatAmount(row.feeKrw, 'KRW')} 포함
            {row.feeUnknown > 0 && ` · 수수료 미확인 ${row.feeUnknown}건은 단가만 넣었어요`}
          </p>
        )}
      </td>
      <td className={`py-3.5 tabular-nums ${over ? 'font-bold text-red-700' : ''}`}>
        {budgetJudgment(remaining)}
        {row.badge && <p className="text-ui font-normal text-x-secondary">{badgeText(row.badge)}</p>}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: `ClientDetail.tsx` 호출부 수정**

```ts
      <BudgetPanel client={client} register={register} onChanged={onChanged} />
```
→
```ts
      <BudgetPanel client={client} onChanged={onChanged} />
```

- [ ] **Step 3: 타입체크**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "BudgetPanel|ClientDetail" || echo "OK: 관련 오류 없음"`
Expected: `OK: 관련 오류 없음`

- [ ] **Step 4: 로컬 화면 확인**

Run: `npm run build && npm run start -- -p 3001` (백그라운드), 그 다음 `127.0.0.1:3001/clients`에서 클라이언트 하나를 열어 "예산 기간" 패널을 확인:
- "+ 새 기간 추가" → 시작일·종료일·금액 입력 → 저장 → 표에 한 줄 추가
- 겹치는 기간을 추가하면 409 오류 문구가 폼 아래 뜨는지
- 기존 기간을 눌러 인라인 편집 → 금액 수정 → 저장 → 반영
- 삭제 버튼으로 기간 삭제 → 표에서 사라짐
Expected: 위 흐름이 오류 없이 동작. (koo가 실제로 화면에서 최종 확인 — 이 단계는 개발자 자가 확인용)

- [ ] **Step 5: 커밋**

```bash
git add src/app/clients/BudgetPanel.tsx src/app/clients/ClientDetail.tsx
git commit -m "$(cat <<'EOF'
feat(client): 예산 기간 관리 화면으로 BudgetPanel 전면 재작성

월 단위 표 + 기본값 입력을 기간 목록 표(추가·인라인 수정·삭제)로 바꾼다.
모든 변경이 즉시 저장이라 register(일괄 저장) 대상에서 뺐다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `SummaryCards.tsx` — 캠페인 요약 카드

**Files:**
- Modify: `src/app/campaigns/SummaryCards.tsx`

**Interfaces:**
- Consumes: `type CampaignPeriodBudget`, `periodLabel`, `badgeText`, `toKrw`, `remainingOf`, `budgetTipText` (Task 2)

- [ ] **Step 1: import·타입·렌더 교체**

```ts
import { toKrw, remainingOf, monthShort, budgetTipText, type CampaignMonthBudget } from '@/lib/clientBudget';
```
→
```ts
import { toKrw, remainingOf, periodLabel, badgeText, budgetTipText, type CampaignPeriodBudget } from '@/lib/clientBudget';
```

```ts
export function SummaryCards({ summary, perf, total, budget, clientId }: {
  summary: TaskSummary; perf: PerfSummary; total: MoneyByCurrency;
  budget: CampaignMonthBudget | null;   // 이 달 클라이언트 예산(서버). 클라 없는 캠페인은 null → 4칸 유지
  clientId: string | null;
}) {
  const money = moneyParts(total);
  // 잔액 = 예산 − (다른 캠페인 몫 + 이 캠페인 합계 환산). 이 캠페인 몫을 화면의 total에서 더해야
  // 비용 셀을 고친 순간 '비용 합계' 칸과 같은 박자로 움직인다(스펙 §6-2, UX 원칙 4).
  const spentKrw = budget ? budget.othersKrw + toKrw(total).krw : 0;
  const remaining = budget ? remainingOf(budget.amount, spentKrw) : null;
```
→
```ts
export function SummaryCards({ summary, perf, total, budget, clientId }: {
  summary: TaskSummary; perf: PerfSummary; total: MoneyByCurrency;
  budget: CampaignPeriodBudget | null;   // 이 캠페인이 속한 기간의 클라이언트 예산(서버). 클라 없는 캠페인은 null → 4칸 유지
  clientId: string | null;
}) {
  const money = moneyParts(total);
  // 잔액 = 예산 − (다른 캠페인 몫 + 이 캠페인 합계 환산). 이 캠페인 몫을 화면의 total에서 더해야
  // 비용 셀을 고친 순간 '비용 합계' 칸과 같은 박자로 움직인다(스펙 §6-2, UX 원칙 4).
  const spentKrw = budget ? budget.othersKrw + toKrw(total).krw : 0;
  const remaining = budget?.period ? remainingOf(budget.period.amountKrw, spentKrw) : null;
```

```tsx
      {budget && (budget.amount === null ? (
        <Card value="—" label="월 예산"
              sub={clientId
                ? <>미설정 — <Link href={`/clients?client=${clientId}`} className="text-x-blue-text hover:underline">클라이언트 설정에서 입력</Link></>
                : '미설정'} />
      ) : (
        <Card alert={remaining !== null && remaining < 0}
              value={remaining !== null && remaining < 0 ? `−${formatAmount(-remaining, 'KRW')}` : formatAmount(remaining ?? 0, 'KRW')}
              label={`${monthShort(budget.month)} 예산 잔액`}
              sub={`${formatAmount(budget.amount, 'KRW')} 중 ${formatAmount(spentKrw, 'KRW')} 사용 · 캠페인 ${budget.campaignCount}개`}
              tip={`클라이언트의 ${monthShort(budget.month)}에 시작한 캠페인 비용을 전부 합쳐 예산과 대조해요. ${budgetTipText()}`} />
      ))}
```
→
```tsx
      {budget && (budget.period === null ? (
        <Card value="—" label="예산 기간"
              sub={clientId
                ? <>미설정 — <Link href={`/clients?client=${clientId}`} className="text-x-blue-text hover:underline">클라이언트 설정에서 입력</Link></>
                : '미설정'} />
      ) : (
        <Card alert={remaining !== null && remaining < 0}
              value={remaining !== null && remaining < 0 ? `−${formatAmount(-remaining, 'KRW')}` : formatAmount(remaining ?? 0, 'KRW')}
              label="예산 기간 잔액"
              sub={<>
                {periodLabel(budget.period)} 예산 {formatAmount(budget.period.amountKrw, 'KRW')} 중 {formatAmount(spentKrw, 'KRW')} 사용 · 캠페인 {budget.campaignCount}개
                {budget.badge && <><br />{badgeText(budget.badge)}</>}
              </>}
              tip={`클라이언트의 ${periodLabel(budget.period)} 기간에 시작한 캠페인 비용을 전부 합쳐 예산과 대조해요. ${budgetTipText()}`} />
      ))}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit -p . 2>&1 | grep -i "SummaryCards" || echo "OK: 관련 오류 없음"`
Expected: `OK: 관련 오류 없음`

- [ ] **Step 3: 커밋**

```bash
git add src/app/campaigns/SummaryCards.tsx
git commit -m "$(cat <<'EOF'
refactor(campaign): 요약 카드의 '월 예산' → '예산 기간'

CampaignPeriodBudget을 받아 기간 날짜·초과 원인 배지를 함께 보여준다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `FlowCards.tsx` / `FlowDetail.tsx` / `CampaignDetail.tsx` — 나머지 소비처

**Files:**
- Modify: `src/app/campaigns/flow/FlowCards.tsx`
- Modify: `src/app/campaigns/flow/FlowDetail.tsx`
- Modify: `src/app/campaigns/CampaignDetail.tsx`

**Interfaces:**
- Consumes: `type CampaignPeriodBudget`, `periodLabel` (Task 2)

- [ ] **Step 1: `FlowCards.tsx` 수정**

```ts
import { toKrw, monthShort, type CampaignMonthBudget } from '@/lib/clientBudget';
```
→
```ts
import { toKrw, periodLabel, type CampaignPeriodBudget } from '@/lib/clientBudget';
```

```ts
  budget: CampaignMonthBudget | null;   // 클라이언트가 없거나 예산 미설정이면 null이 아니라 amount만 null로 온다(clientBudget.ts)
```
→
```ts
  budget: CampaignPeriodBudget | null;   // 클라이언트가 없거나 예산 기간 미설정이면 null이 아니라 period만 null로 온다(clientBudget.ts)
```

```ts
  const amount = budget?.amount ?? null;
```
→
```ts
  const amount = budget?.period ? budget.period.amountKrw : null;
```

```ts
  const budgetTip = hasBudgetBar
    ? `${monthShort(budget!.month)} 예산 ${formatAmount(amount!, 'KRW')} · 회색은 이달 다른 캠페인 계획 ${formatAmount(budget!.othersKrw, 'KRW')} · 인플별 추가 비용은 계획에 포함 · 송금 수수료 미포함`
    : undefined;
```
→
```ts
  const budgetTip = hasBudgetBar
    ? `${periodLabel(budget!.period!)} 예산 ${formatAmount(amount!, 'KRW')} · 회색은 기간 내 다른 캠페인 계획 ${formatAmount(budget!.othersKrw, 'KRW')} · 인플별 추가 비용은 계획에 포함 · 송금 수수료 미포함`
    : undefined;
```

```ts
              {amount !== null
                ? `${monthShort(budget!.month)} 예산`
                : (clientId
```
→
```ts
              {amount !== null
                ? `${periodLabel(budget!.period!)} 예산`
                : (clientId
```

- [ ] **Step 2: `FlowDetail.tsx` 타입 교체**

```ts
import type { CampaignMonthBudget } from '@/lib/clientBudget';
```
→
```ts
import type { CampaignPeriodBudget } from '@/lib/clientBudget';
```

```ts
  budget: CampaignMonthBudget | null;   // 이 달 클라이언트 예산(서버 판정) — 카드의 '월 예산 잔액'(Task 11)
```
→
```ts
  budget: CampaignPeriodBudget | null;   // 이 기간 클라이언트 예산(서버 판정) — 카드의 '예산 기간 잔액'
```

- [ ] **Step 3: `CampaignDetail.tsx` 타입 교체**

```ts
import type { CampaignMonthBudget } from '@/lib/clientBudget';
```
→
```ts
import type { CampaignPeriodBudget } from '@/lib/clientBudget';
```

```ts
  budget: CampaignMonthBudget | null;   // 이 달 클라이언트 예산(서버 판정) — 요약 칸의 '월 예산 잔액'
```
→
```ts
  budget: CampaignPeriodBudget | null;   // 이 기간 클라이언트 예산(서버 판정) — 요약 칸의 '예산 기간 잔액'
```

- [ ] **Step 4: 타입체크 — 전체**

Run: `npx tsc --noEmit -p . 2>&1 | tail -30`
Expected: 아무 출력 없음(오류 0건). `clientBudget`/`CampaignMonthBudget`/`monthlyBudget`/`budgetOverrides` 관련 오류가 하나도 없어야 한다.

- [ ] **Step 5: 남은 참조 스캔**

Run: `grep -rln "CampaignMonthBudget\|MonthRow\|monthOf(\|budgetForMonth\|spendByMonth\|monthlyBudget\|budgetOverrides\|setBudgetOverride\|getClientBudget\b\|BudgetClient\b" --include="*.ts" --include="*.tsx" src | grep -v ".test.ts"`
Expected: 아무 출력 없음(옛 이름의 실사용 코드가 하나도 남지 않아야 한다 — 마이그레이션 파일 037/058의 SQL 주석은 grep 대상에서 자연히 빠진다).

- [ ] **Step 6: 커밋**

```bash
git add src/app/campaigns/flow/FlowCards.tsx src/app/campaigns/flow/FlowDetail.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "$(cat <<'EOF'
refactor(campaign): 플로우 카드·상세의 예산 타입을 CampaignPeriodBudget으로

FlowCards의 예산 막대·툴팁 문구도 월 대신 기간 라벨(periodLabel)을 쓴다.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 전체 검증 + 업데이트 소식

**Files:**
- Modify: `src/content/updates.ts`

**Interfaces:**
- Consumes: 전체(회귀 없음 확인)

- [ ] **Step 1: 린트**

Run: `npm run lint 2>&1 | tail -30`
Expected: 이 브랜치에서 새로 건드린 파일에 새 오류가 없음(기존 린트 기준선 24개는 그대로 — 늘어나지 않았는지만 확인).

- [ ] **Step 2: 전체 테스트**

Run: `npm test 2>&1 | tail -40`
Expected: `# fail 0`. (약 4분 소요 — 실 DB(스테이징) 기준)

- [ ] **Step 3: 타입체크 최종 확인**

Run: `npx tsc --noEmit -p . 2>&1 | tail -10`
Expected: 아무 출력 없음.

- [ ] **Step 4: `updates.ts`에 배포 소식 추가**

`src/content/updates.ts`의 `UPDATES` 배열 맨 앞(15행, 첫 원소 바로 앞)에 아래 원소를 추가한다. 날짜는 실제 머지일로 바꾼다(예시는 09-22):

```ts
  {
    date: '2026-09-22', type: '개선',
    title: '예산을 원하는 기간으로 나눠서 관리할 수 있어요',
    summary: '지금까지는 클라이언트 예산을 달 단위로만 정할 수 있었어요. 이제 시작일·종료일을 직접 정해서 원하는 기간만큼 예산을 나눠 관리할 수 있어요 — 꼭 한 달 단위가 아니어도 돼요.',
    bullets: [
      '쓰던 방식이 바뀐 것: 기존 "기본 월 예산 + 예외 달" 화면이 없어지고 기간 목록으로 바뀌었어요. 예전에 넣어둔 예산은 자동으로 옮겨지지 않으니 클라이언트 상세에서 다시 입력해 주세요',
      '캠페인이 두 기간에 걸치면 시작일이 속한 기간에 비용이 전부 잡혀요. 그것 때문에 그 기간이 초과되면 원인(다음 기간까지 이어지는 캠페인)을 함께 보여줘요',
    ],
    link: { label: '클라이언트', href: '/clients' },
  },

Run: `node --import tsx --test src/lib/updates.test.ts 2>&1 | tail -5`
Expected: `# fail 0` (날짜 형식·빈 문자열 검증 통과).

- [ ] **Step 5: 최종 커밋**

```bash
git add src/content/updates.ts
git commit -m "$(cat <<'EOF'
docs(updates): 예산 기간 모델 배포 소식 추가

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## 이 계획의 범위 밖 (스펙 §9·§10 그대로)

- `client.monthly_budget`/`budget_overrides` 컬럼 `drop column`(2차 머지, koo가 재입력 확인 후 별도 진행)
- 기간 자동 이관 도구, 배지 클릭 시 걸치는 캠페인 상세 팝오버, 캠페인 목록/만들기 모달의 예산 표시, 예산 초과 Slack 알림, 기간 안 소진 속도(진행률) 표시, 기간 변경 이력, 연/분기 요약
