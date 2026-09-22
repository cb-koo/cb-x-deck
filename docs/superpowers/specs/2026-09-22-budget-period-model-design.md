# 클라이언트 예산 기간 모델(v2 1.5) — 설계 스펙

작성: 2026-09-22 · 브랜치 `cb-koo/budget-period-model` · 상태: 설계 승인(koo 브레인스토밍 09-22) — 구현 계획 작성 전
선행: 월 단위 예산 스펙(`2026-08-27-client-monthly-budget-design.md`) — 이 문서는 그걸 완전히 대체한다(폐기 아님, §9 두 컬럼이 남아있는 동안 참고 자료로 유지).
근거: `docs/research/budget-period-boundary-research-20260922.md` — 경계를 걸치는 비용의 귀속 방식에 대한 비교 서비스·회계 원칙 조사.

## 0. 한 줄 정의

**클라이언트마다 "월 단위 예산" 대신 시작일·종료일·금액으로 이루어진 "예산 기간"을 자유롭게 여러 개 만든다.** 캠페인 비용은 지금처럼 시작일이 속한 기간 하나에 전액 잡히고(안 나눔), 그 기간의 예산과 대조해 잔액·초과를 보여준다. 기간을 넘어가는 캠페인 때문에 초과된 경우엔 그 원인을 배지로 설명하되, 잔액 계산 자체는 건드리지 않는다.

## 1. 목적과 배경

- 기존(037) 모델은 "기본 월 예산 + 예외 달"로, 예산이 항상 달력 월 단위였다. 실제로는 클라이언트 계약이 월 단위이긴 하지만, **캠페인이 월말~월초를 걸치는 경우** 시작 달에 전액이 잡혀 그 달이 실제보다 과하게 초과된 것처럼 보이는 문제가 있었고, 이걸 계기로 기간을 날짜 단위로 자유롭게 정의하는 모델로 전환하기로 했다(09-18 결정, v2 1.5).
- 목표는 두 가지를 동시에 만족하는 것: ① 클라이언트와 실제로 합의한 예산 상한(계약)을 추적하는 것, ② 그 안에서 소진 속도를 체크하는 것. 후자는 이번 스펙에서 기간을 잘게 쪼개는 방식이 아니라 향후 진행률 표시(§9 백로그)로 별도 해결하기로 했다 — 이번 스펙은 ①에 집중한다.
- 성공 기준: 클라이언트 상세에서 임의의 날짜 범위로 예산 기간을 만들고 고칠 수 있고, 그 기간에 시작한 캠페인 비용과 대조한 잔액이 보인다. 캠페인 상세에서도 자신이 속한 기간의 예산 카드가 보인다.

## 2. 결정 사항 (브레인스토밍 09-22, koo)

| 질문 | 결정 | 이유 |
|---|---|---|
| 기존 월 단위 구조를 어떻게 하나 | **완전 대체** | 기간 개념이 새로 생기는 거라 병행하면 로직이 두 배로 복잡해짐 |
| "끝없이 적용되는 기본 예산" 개념 | **없앤다 — 모든 기간은 시작일·종료일이 항상 필수** | 기본값을 바꿀 때마다 이전 기간을 닫고 새 기간을 여는 방식으로 항상 갱신 |
| 기간끼리 겹침·빈틈 | **겹침 금지(제약으로 강제), 빈틈(예산 미설정 구간)은 허용** | 겹치면 어느 예산을 봐야 할지 모호해짐. 빈틈은 기존 "미설정" 상태와 같은 의미라 문제 없음 |
| 기존에 만든 기간 수정·삭제 | **과거·현재 구분 없이 자유롭게 수정·삭제** | 입력 실수를 고치는 흔한 용도. 감사 추적성보다 단순함 우선 |
| 기존 월별 예산 데이터 이관 | **마이그레이션 없음 — koo가 배포 후 새 화면에서 직접 재입력** | 데이터가 많지 않고, 기간 개념 자체가 새로 생기는 거라 자동 변환 규칙을 만드는 비용이 더 큼 |
| 기간을 걸치는 캠페인의 비용 귀속 | **시작일이 속한 기간에 전액(안 나눔, 안 프로레이션)** — 기존 월 단위 규칙 그대로 유지 | 리서치(`budget-period-boundary-research-20260922.md`) 결과 회계 원칙(GAAP ASC 720-35, 약정원가)·Stripe 원자적 귀속 옵션과 정합. Google Ads식 일할 계산은 실사례 조사 결과 이 도메인(캠페인=인플루언서 정액 계약)엔 안 맞음 |
| 기간을 걸쳐서 초과가 난 경우 | **잔액은 그대로 두고, 원인 배지만 표시**(다음 기간까지 이어지는 캠페인이 원인일 때만) — "다음 기간과 합산해서 실질 잔액 계산" 안 함 | 리서치 결과 "초과분을 다음 기간과 자동 합산"하는 실사례를 못 찾음(가장 가까운 Productive.io도 보조 설명일 뿐 숫자는 안 건드림). 정직한 원자 계산 + 원인 설명이 실무 전례에 부합 |
| 월말~월초 겹치는 주 문제 | **기간 경계를 koo가 직접 조정해서 피할 수 있다** | 기간이 더 이상 달력 월에 묶이지 않으므로, 캠페인 경계에 맞춰 기간 종료일을 옮기는 것으로 대부분 해결 가능. 배지는 안 옮긴 경우의 보조 설명 |

## 3. 데이터 모델 — 마이그레이션 `058_client_budget_period.sql`

main은 057까지(머지 시 다른 활성 브랜치와 번호 충돌 확인). 겹침 방지에 `daterange` exclusion constraint를 쓰므로 `btree_gist`가 필요하다(신규 테이블이라 기존 행 걱정 없이 바로 추가 가능 — AGENTS.md "칸 추가" 케이스, 1번 머지).

```sql
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

- `amount_krw`: 원화 정수(0 이상). 기존과 같이 예산은 원화 하나, 엔화 집행만 1엔=10원 환산(§4, `JPY_TO_KRW` 유지).
- 겹침은 DB가 막는다(같은 `client_id`에서 날짜 범위가 하루라도 겹치면 insert/update 실패, `23P01 exclusion_violation`). API가 이 값을 잡아 사용자 문구로 바꾼다(§5-3).
- **기존 `client.monthly_budget` / `client.budget_overrides` 컬럼은 이번 마이그레이션에서 건드리지 않는다.** 코드가 더 이상 읽지도 쓰지도 않게만 하고(§5-1), 컬럼 삭제는 별도 마이그레이션·별도 머지로 나중에(§9).

## 4. 계산 모듈 `src/lib/clientBudget.ts` — 전면 교체

월 전용 유틸(`MONTH_RE`, `isMonthKey`, `monthOf`, `addMonths`, `budgetOverridesOf`, `BudgetClient`, `MonthRow`, `CampaignMonthBudget`, `budgetForMonth`, `budgetRows`, `campaignMonthBudget`, `monthLabel`, `monthShort`)를 기간 버전으로 교체한다. `JPY_TO_KRW`, `toKrw`, `remainingOf`, `parseBudgetAmount`, `BUDGET_AMOUNT_MESSAGE`는 그대로 재사용(귀속 단위만 바뀌고 환산·검증 규칙은 안 바뀜).

```ts
export interface BudgetPeriod { id: string; startsOn: string; endsOn: string; amountKrw: number }
export type BudgetSource = 'period' | 'none';

// 캠페인이 속한 기간 찾기 — 겹침이 없으므로 항상 최대 1개
export function periodFor(periods: BudgetPeriod[], dateOnly: string): BudgetPeriod | null {
  return periods.find(p => p.startsOn <= dateOnly && dateOnly <= p.endsOn) ?? null;
}

// 기간에 귀속된 캠페인 중 이 기간 종료일 뒤까지 이어지는 것들 — 초과 원인 배지용
export interface SpanningCampaign { id: string; endsOn: string }
export interface OverageBadge { latestEndsOn: string; count: number }
export function overageBadge(period: BudgetPeriod, remaining: number | null, spanning: SpanningCampaign[]): OverageBadge | null {
  if (remaining === null || remaining >= 0 || spanning.length === 0) return null;
  const latestEndsOn = spanning.reduce((max, c) => (c.endsOn > max ? c.endsOn : max), spanning[0].endsOn);
  return { latestEndsOn, count: spanning.length };
}

export interface PeriodRow {
  period: BudgetPeriod;
  spentKrw: number; jpyIncluded: number; campaignCount: number;
  remaining: number;                     // amountKrw - spentKrw
  spentWithFeeKrw: number; feeKrw: number; feeUnknown: number;
  badge: OverageBadge | null;            // '단가' 기준으로 계산(수수료 포함 토글은 화면에서 remainingOf로 재계산, badge는 안 바뀜)
}
export function periodRow(period: BudgetPeriod, spend: PeriodSpendForBudget, spanning: SpanningCampaign[]): PeriodRow {
  const { krw, jpyIncluded } = toKrw(spend.total);
  const remaining = period.amountKrw - krw;
  return {
    period, spentKrw: krw, jpyIncluded, campaignCount: spend.campaignCount,
    remaining, spentWithFeeKrw: krw + spend.feeKrw, feeKrw: spend.feeKrw, feeUnknown: spend.feeUnknown,
    badge: overageBadge(period, remaining, spanning),
  };
}

// 캠페인 상세 카드용
export interface CampaignPeriodBudget {
  period: BudgetPeriod | null; source: BudgetSource;
  othersKrw: number; campaignCount: number; badge: OverageBadge | null;
}

export function periodLabel(p: BudgetPeriod): string {   // '2026년 9월 1일 ~ 9월 30일' 형태, 같은 해는 뒤 연도 생략
  /* 구현은 계획 단계에서 — formatDateKo 재사용 */
}
export function budgetTipText(): string {
  return `캠페인은 시작일이 속한 기간에 전액 잡혀요 · 캠페인에 넣은 콘텐츠 비용만 집계해요 · `
    + `엔화는 1엔 = ${JPY_TO_KRW}원으로 환산해요 · 수수료 포함은 인플루언서별 송금 수수료를 얹은 예상 금액이에요 · `
    + `기간을 넘어가는 캠페인 때문에 초과되면 그 이유를 표시해요(잔액 계산에는 반영하지 않아요)`;
}
```

`PeriodSpendForBudget`은 기존 `MonthSpend`와 동일한 모양(`{ total: MoneyByCurrency; campaignCount: number; feeKrw: number; feeUnknown: number }`) — 이름만 바뀐다.

## 5. 저장소·API

### 5-1. `clientStore.ts`

- `ClientRow`에서 `monthlyBudget`/`budgetOverrides` 필드와 `updateClient`의 `monthlyBudget` 패치, `setBudgetOverride`, `getClientBudget`을 **더 이상 쓰지 않는다**(코드에서 삭제 — 컬럼 자체는 §3대로 유지). `updateClient` select/patch에서 해당 컬럼을 완전히 뺀다.
- 신설 `budgetPeriodStore.ts`(또는 `clientStore.ts` 내 신규 섹션 — 계획 단계에서 파일 분리 여부 결정):
  - `listBudgetPeriods(sql, clientId) → BudgetPeriod[]` (startsOn desc)
  - `createBudgetPeriod(sql, clientId, { startsOn, endsOn, amountKrw }) → BudgetPeriod` — insert, exclusion 위반 시 `{ ok: false, conflict: { startsOn, endsOn } }`(겹치는 기존 기간을 먼저 조회해 사용자에게 알려줄 수 있게 사전 체크 후 insert)
  - `updateBudgetPeriod(sql, periodId, patch) → BudgetPeriod | conflict`
  - `deleteBudgetPeriod(sql, periodId) → void`

### 5-2. `campaignStore.ts`

- `spendByMonth` → `spendByPeriods(sql, clientId, periods: { id, startsOn, endsOn }[]) → Map<periodId, PeriodSpendForBudget & { spanning: SpanningCampaign[] }>`: 기존 `to_char(starts_on,'YYYY-MM')` group by 대신, 각 기간의 `[startsOn, endsOn]` 범위에 `starts_on`이 속하는 캠페인으로 그룹핑(겹침이 없으므로 캠페인 하나는 최대 한 기간에만 잡힘). `spanning`은 그 그룹 안에서 `ends_on > 기간.endsOn`인 캠페인들의 `{id, endsOn}`.
- `getCampaignDetail`(289~298행 부근)의 `monthOf(campaign.startsOn)` → `periodFor(periods, campaign.startsOn)`로 교체, `campaignMonthBudget` → 기간 버전으로 교체.

### 5-3. 라우트

| 라우트 | 변경 |
|---|---|
| `GET /api/clients/[id]/budget-periods` (신설, 기존 `GET .../budget` 대체) | `{ rows: PeriodRow[] }` |
| `POST /api/clients/[id]/budget-periods` (신설) | body `{ startsOn, endsOn, amountKrw }`. 검증: 날짜 형식·`endsOn >= startsOn`·`amountKrw` 0 이상 정수. 겹침이면 409 `{ error: '이미 있는 기간(2026-08-15~2026-09-15)과 겹쳐요' }` |
| `PUT /api/clients/[id]/budget-periods/[periodId]` (신설) | 같은 검증, 자기 자신은 겹침 체크에서 제외 |
| `DELETE /api/clients/[id]/budget-periods/[periodId]` (신설) | 204. 캠페인은 안 지워짐 — 그 구간이 다시 "미설정"이 될 뿐 |
| `PUT /api/clients/[id]/budget/[month]` | **삭제**(월 단위 예외 편집 라우트 폐기) |
| `PATCH /api/clients/[id]` | body에서 `monthlyBudget` 처리 제거 |
| `GET /api/campaigns/[id]` | `budget` 필드를 `CampaignPeriodBudget`(§4) 모양으로 교체 |

## 6. 화면

### 6-1. 클라이언트 상세 — `BudgetPanel.tsx` 전면 재작성 (파일 위치·자리는 그대로: 기본 정보 → 시술 다음 세 번째 패널)

`DefaultBudgetEditor` + 월별 표를 없애고, 기간 목록 표 + 추가/편집 폼으로 바꾼다.

```
┌ 예산 기간 ──────────────────────────────────────────────────────┐
│ 시작한 캠페인은 시작일이 속한 기간의 예산과 대조해요.               ⓘ  [+ 새 기간 추가] │
│  기간                예산            지출                    잔액             │
│  9/1 ~ 9/30      5,000,000원   3,200,000원 · 캠페인 4개   1,800,000원 남음    │
│  8/15 ~ 8/31     2,500,000원   2,850,000원 · 캠페인 3개   350,000원 초과      │  ← 빨강
│                                                          9/4까지 이어지는 캠페인 1개 때문 │  ← 배지, 초과+걸침일 때만
│  (8/1 ~ 8/14는 예산 미설정 구간)                                              │
└─────────────────────────────────────────────────────────────────┘
```

- **행 하나 = 한 줄**(koo 표 선호). 최신 기간이 위. 빈 구간은 행으로 안 그리고, 필요하면 옅은 안내 한 줄만("이 사이는 예산 미설정" 같은 문구, 클릭 대상 아님 — 계획 단계에서 실제로 넣을지 결정, 최소는 표 자체만).
- **[+ 새 기간 추가]** → 인라인 폼(시작일·종료일·금액 3칸 + 저장/취소), 저장 시 겹침이면 그 자리에 오류 문구.
- **기간 행 클릭** → 그 줄이 인라인 편집(시작일·종료일·금액 수정) + "삭제" 버튼. 편집도 겹침 규칙 동일 적용.
- **지출 기준 토글(단가/수수료 포함)** 기존 그대로 유지.
- ⓘ 문구는 `budgetTipText()`(§4).
- 기간이 하나도 없으면: "아직 설정한 예산 기간이 없어요" 빈 상태 + 추가 버튼 강조.

### 6-2. 캠페인 상세 요약 카드 (`SummaryCards.tsx`)

라벨 "N월 예산 잔액" → **"예산 기간 잔액"**, 보조줄이 "3,000,000원 중 1,850,000원 사용 · 캠페인 2개"에서 기간 날짜를 덧붙임: "9/1~9/30 예산 5,000,000원 중 …". 초과 시 배지 문구를 보조줄 아래에 한 줄 추가(§4 `badge`). 예산 미설정(`source: 'none'`)이면 기존과 동일하게 "—" + 클라이언트 설정 딥링크.

## 7. 경계·오류

- 캠페인 시작일이 어느 기간에도 속하지 않으면(빈틈 구간) `source: 'none'` — 기존 "미설정"과 동일하게 처리.
- 초과 배지는 **그 기간이 실제로 마이너스이고, 다음 기간까지 이어지는 캠페인이 하나라도 있을 때** 뜬다. 그 캠페인들의 비용이 실제로 초과분을 얼마나 설명하는지(정확한 인과 비율)는 계산하지 않는다 — "존재하면 원인일 수 있다"는 근사치 표시다. 정상 범위 안이면 걸치는 캠페인이 있어도 아무 표시 안 함(정상 상황에 불필요한 설명 안 붙임).
- 배지 대상 캠페인이 여러 개면 "N개 캠페인이 기간을 넘어가요, 가장 늦게는 M/D까지" 식으로 개수와 가장 늦은 종료일만 보여준다(전부 나열 안 함).
- 기간 삭제 시 캠페인은 지워지지 않는다 — 그 캠페인의 귀속만 다시 계산되어 `source: 'none'`이 될 수 있다.
- 기간 수정으로 시작일·종료일이 바뀌면 그 즉시 캠페인 귀속이 재계산된다(저장 안 하는 값이므로 별도 배치 불필요).
- 겹치는 기간 저장 시도는 API가 사전 체크로 막고, 레이스 컨디션은 DB exclusion constraint가 최종 방어.
- 클라이언트 삭제 시 `client_budget_period`도 cascade 삭제.
- 금액은 0 이상 정수만(기존 규칙 동일).

## 8. 테스트

- **순수(`clientBudget.test.ts`)**: `periodFor`(경계값 — 시작일=기간 시작일, 종료일=기간 종료일, 빈틈 구간), `overageBadge`(정상 범위면 null · 마이너스인데 걸치는 캠페인 없으면 null · 마이너스+걸침 있으면 latestEndsOn·count 정확성 · 걸치는 캠페인 여러 개일 때 가장 늦은 날짜 선택), `periodRow` 계산, `toKrw`/`remainingOf`/`parseBudgetAmount`는 기존 테스트 그대로 승계.
- **스토어(실 DB)**: `createBudgetPeriod` 겹침 시 충돌 반환, 겹치지 않는 인접 기간(빈틈 없이 붙은 경우)은 통과, `updateBudgetPeriod` 자기 자신 제외하고 겹침 체크, `deleteBudgetPeriod` 후 해당 구간 캠페인 `source: 'none'`, `spendByPeriods` — 엔화 분리·미사용 원고 제외·수수료 합산 등 기존 `spendByMonth` 테스트 항목 승계 + `spanning` 계산 검증.
- **라우트 검증**: 날짜 형식, `endsOn >= startsOn`, 금액 규칙, 겹침 409.
- 화면은 하네스 없음 — koo QA(로컬 build+start 3001 또는 프리뷰).

## 9. 배포 순서 (AGENTS.md 마이그레이션 규칙)

1. **1차 머지**: 마이그레이션 058(`client_budget_period` 테이블 추가만 — 기존 컬럼 안 건드림) + 새 API·화면 배포. 이 시점부터 코드는 `client.monthly_budget`/`budget_overrides`를 전혀 읽지도 쓰지도 않는다(§5-1). 배포 직후 클라이언트별 예산은 전부 "미설정" 상태 — koo가 새 화면에서 기간을 다시 입력해야 한다.
2. **2차 머지(별도, 나중)**: koo가 필요한 클라이언트에 기간을 다 옮겨 입력한 걸 확인한 뒤, `client.monthly_budget`/`budget_overrides` 컬럼을 `drop column`하는 마이그레이션을 올린다(칸 삭제 2번 머지 규칙). 이 티켓은 §11에 백로그로 남긴다.

## 10. 범위 밖 (백로그)

기간 자동 이관 도구 · 배지 클릭 시 걸치는 캠페인 상세 팝오버 · 캠페인 목록/만들기 모달의 예산 표시 · 예산 초과 Slack 알림 · 기간 안 소진 속도(진행률) 표시 · 기간 변경 이력 · 연/분기 요약 · **`client.monthly_budget`/`budget_overrides` 컬럼 삭제 마이그레이션(§9 2차 머지)**.

## 11. 머지 체크

- `src/content/updates.ts` 맨 위에 `개선` 1건(배포 직전에 작성): "예산을 월 단위 대신 원하는 기간으로 자유롭게 나눠서 관리할 수 있어요" — 기존 월별 예산 화면이 기간 목록으로 바뀐 점, 재입력이 필요하다는 점(쓰던 방식이 바뀜 — 반드시 알림)을 불릿으로. `link: { ws }`에 클라이언트 상세로.
- 마이그레이션 번호 058이 다른 활성 브랜치와 충돌하는지 머지 시 확인.
- 2차 머지(컬럼 삭제) 티켓을 진행 레저/백로그에 등록.
