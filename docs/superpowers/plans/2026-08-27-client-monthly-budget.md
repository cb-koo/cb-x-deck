# 클라이언트 월 마케팅 예산 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클라이언트마다 기본 월 예산(원)과 달별 예외를 저장하고, 그 달에 시작한 캠페인 비용(엔화는 1엔=10원 환산)과 대조해 클라이언트 상세 표와 캠페인 요약 카드에 잔액·초과를 보여준다.

**Architecture:** `client` 테이블에 `monthly_budget int` + `budget_overrides jsonb` 두 컬럼(스펙 §3). 집행은 저장하지 않고 기존 `campaignStore.totalsFor`를 재사용해 캠페인 `starts_on`의 달로 묶는다(`spendByMonth`). 환산·귀속·행 생성·문구는 순수 모듈 `src/lib/clientBudget.ts` 한 곳에 두고 서버(라우트)와 화면이 같은 함수를 쓴다. 화면은 클라이언트 상세의 세 번째 패널(`BudgetPanel.tsx`, 새 파일)과 캠페인 요약 5번째 칸.

**Tech Stack:** Next.js(App Router, `node_modules/next/dist/docs/` 확인) · postgres.js(`sql` 태그) · node:test + tsx · Tailwind 토큰(`text-x-*`) · 스펙: `docs/superpowers/specs/2026-08-27-client-monthly-budget-design.md`

## Global Constraints

- 마이그레이션 번호 **037** (`migrations/037_client_budget.sql`). 모든 문장 재실행 안전(`if not exists`).
- 환율 상수 **`JPY_TO_KRW = 10`** — `src/lib/clientBudget.ts` 한 곳. 화면 문구는 이 상수로 만든다(문자열에 10을 직접 쓰지 않는다).
- 귀속 달 = 캠페인 `starts_on` 앞 7자(`YYYY-MM`). 서울 날짜 문자열(to_char)이라 시간대 변환 금지.
- 집행 정의 = 기존 `totalsFor`(미사용 원고 제외 콘텐츠 비용 + `campaign_influencer_cost.extra_costs`). 새 합산 SQL을 따로 쓰지 않는다.
- 금액 검증은 `campaignCost.parseAmount`(0 이상 안전 정수, 콤마 문자열 허용) 재사용. 오류 문구 `예산은 0 이상 숫자로 입력해 주세요`.
- 달 형식 검증 `/^\d{4}-(0[1-9]|1[0-2])$/`. 오류 문구 `달 형식이 올바르지 않아요 (예: 2026-09)`.
- 초과는 차단하지 않는다 — 표시만(`text-red-700`, 배경색 없음).
- "오늘"은 `kstToday()`(`src/lib/datetime.ts`).
- UX 원칙(AGENTS.md): 라벨은 이득을 사용자 말로, 값 옆에 판단 문구, 내부 용어 노출 금지. 가독성: 본문 14~15px(`text-ui`), 표 행 44px+.
- 저장소 함수는 `sql: postgres.Sql`을 첫 인자로 받는다. jsonb는 읽을 때 검증 통과분만 쓴다.
- 커밋 메시지 한국어, 접두 `feat(budget):` / `test(budget):` / `docs(updates):`. 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **DB 테스트 사전 조건**: 워크트리에 `.env`가 없으면 `vercel link` 후 `.vercel/project.json`이 `cb-x-deck`인지 확인하고 `vercel env pull .env --environment=production`. 단일 파일 실행: `node --import tsx --env-file-if-exists=.env --test src/lib/<file>.test.ts`. 마이그레이션 적용: `bash scripts/apply-migrations.sh`(전 파일 재적용 — 재실행 안전 전제).
- 순수 함수 테스트는 DB 없이 돈다: `node --import tsx --test src/lib/clientBudget.test.ts`.

---

## 파일 구조

| 파일 | 역할 | 작업 |
|---|---|---|
| `migrations/037_client_budget.sql` | 컬럼 2개 | 신규 (Task 1) |
| `src/lib/clientBudget.ts` | 환율 상수·환산·귀속·행 생성·문구·검증 (순수) | 신규 (Task 2) |
| `src/lib/clientBudget.test.ts` | 위 순수 테스트 | 신규 (Task 2) |
| `src/lib/clientStore.ts` | `ClientRow` 필드 2개, `updateClient.monthlyBudget`, `setBudgetOverride`, `getClientBudget` | 수정 (Task 1) |
| `src/lib/clientStore.test.ts` | 예산 저장 테스트 | 수정 (Task 1) |
| `src/lib/campaignStore.ts` | `spendByMonth`, `getCampaignDetail.budget` | 수정 (Task 3) |
| `src/lib/campaignStore.test.ts` | 달별 집행·상세 budget 테스트 | 수정 (Task 3) |
| `src/app/api/clients/[id]/route.ts` | PATCH `monthlyBudget` 검증 | 수정 (Task 4) |
| `src/app/api/clients/[id]/budget/route.ts` | GET 월별 표 | 신규 (Task 4) |
| `src/app/api/clients/[id]/budget/[month]/route.ts` | PUT 예외 설정/삭제 | 신규 (Task 4) |
| `src/app/clients/BudgetPanel.tsx` | 클라 상세 세 번째 패널 | 신규 (Task 5) |
| `src/app/clients/ClientDetail.tsx` | 패널 배치 | 수정 (Task 5) |
| `src/app/campaigns/SummaryCards.tsx` | 5번째 칸 | 수정 (Task 6) |
| `src/app/campaigns/CampaignDetail.tsx` | `budget` 상태 전달 | 수정 (Task 6) |
| `src/content/updates.ts` | 소식 1건 | 수정 (Task 7) |

---

### Task 1: 마이그레이션 037 + `clientStore` 예산 필드·함수

**Files:**
- Create: `migrations/037_client_budget.sql`
- Modify: `src/lib/clientStore.ts`
- Test: `src/lib/clientStore.test.ts`

**Interfaces:**
- Produces: `ClientRow.monthlyBudget: number | null`, `ClientRow.budgetOverrides: Record<string, number>`; `updateClient(sql, id, { monthlyBudget?: number | null })`; `setBudgetOverride(sql, id, month, amount: number | null): Promise<void>`; `getClientBudget(sql, id): Promise<BudgetClient | null>` where `BudgetClient = { monthlyBudget: number | null; budgetOverrides: Record<string, number> }`.
- Note: `budgetOverridesOf(v: unknown)` 검증 함수는 Task 2의 `clientBudget.ts`에 두지만 Task 1이 먼저 필요하므로 **Task 1에서 `clientBudget.ts`를 이 함수와 `BudgetClient` 타입만으로 먼저 만든다**. Task 2가 나머지를 채운다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 037: 클라이언트 월 마케팅 예산 (스펙 2026-08-27-client-monthly-budget-design §3)
-- 036은 정산 결제 수단 브랜치(cb-koo/influencer-profile)가 쓴다 → 037. apply-migrations.sh가 전 파일을 재적용하므로 재실행 안전.
-- 예산은 저장하고 집행·잔액은 계산한다(캠페인 스펙 §0). 예외 달만 jsonb에 — 기본값을 바꿔도 예외로 적은 달은 안 움직인다.
alter table client add column if not exists monthly_budget int;                          -- 기본 월 예산(원). null = 미설정
alter table client add column if not exists budget_overrides jsonb not null default '{}'; -- {"YYYY-MM": int} 예외 달만
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `bash scripts/apply-migrations.sh 2>&1 | tail -3`
Expected: `== applying migrations/037_client_budget.sql` 뒤 `== done` (오류 없음)

- [ ] **Step 3: `clientBudget.ts` 최소 생성 (타입 + jsonb 검증)**

`src/lib/clientBudget.ts`:

```ts
// 클라이언트 월 마케팅 예산의 순수 로직 — 환율 상수, 원화 환산, 귀속 달, 표 행, 문구, 입력 검증.
// 서버(라우트·스토어)와 화면(BudgetPanel·SummaryCards)이 같은 함수를 쓴다(스펙 2026-08-27 §4).
import { parseAmount } from './campaignCost.ts';

export interface BudgetClient { monthlyBudget: number | null; budgetOverrides: Record<string, number> }

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && MONTH_RE.test(v);
}

// jsonb 모양은 보증되지 않는다 — 키 형식·정수 검증을 통과한 항목만 남긴다(draftStore.costOf와 같은 태도)
export function budgetOverridesOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!isMonthKey(k)) continue;
    const n = parseAmount(raw);
    if (n !== null) out[k] = n;
  }
  return out;
}
```

- [ ] **Step 4: 실패하는 스토어 테스트 추가**

`src/lib/clientStore.test.ts` 맨 아래에 추가하고 import 줄에 `setBudgetOverride, getClientBudget`를 더한다:

```ts
import {
  createClient, listClients, getClientWithProcedures, updateClient, deleteClient,
  createProcedure, updateProcedure, deleteProcedure, setBudgetOverride, getClientBudget,
} from './clientStore.ts';
```

```ts
test('월 예산: 기본값 설정·null=지움·예외 달 설정/삭제·updated_at 갱신', async () => {
  const c = await createClient(sql, P + '예산클리닉');
  assert.equal(c.monthlyBudget, null);          // 생성 직후 미설정
  assert.deepEqual(c.budgetOverrides, {});

  await updateClient(sql, c.id, { monthlyBudget: 3_000_000 });
  let got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.equal(got.monthlyBudget, 3_000_000);

  // 다른 필드만 패치하면 예산은 그대로(undefined = 건드리지 않음)
  await updateClient(sql, c.id, { info: '변경' });
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.equal(got.monthlyBudget, 3_000_000);

  // 예외 달 두 개 — 서로 덮지 않는다
  await setBudgetOverride(sql, c.id, '2026-08', 2_500_000);
  await setBudgetOverride(sql, c.id, '2026-09', 4_000_000);
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.deepEqual(got.budgetOverrides, { '2026-08': 2_500_000, '2026-09': 4_000_000 });

  // 예외 삭제(null) → 키가 사라진다. 없는 달을 지워도 오류 없음
  await setBudgetOverride(sql, c.id, '2026-08', null);
  await setBudgetOverride(sql, c.id, '2027-01', null);
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.deepEqual(got.budgetOverrides, { '2026-09': 4_000_000 });

  // 기본값 지움(null) — 예외는 남는다
  await updateClient(sql, c.id, { monthlyBudget: null });
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.equal(got.monthlyBudget, null);
  assert.deepEqual(got.budgetOverrides, { '2026-09': 4_000_000 });

  // getClientBudget — 캠페인 상세가 쓰는 가벼운 조회. 없는 id는 null
  assert.deepEqual(await getClientBudget(sql, c.id), { monthlyBudget: null, budgetOverrides: { '2026-09': 4_000_000 } });
  assert.equal(await getClientBudget(sql, '00000000-0000-0000-0000-000000000000'), null);

  // 예외 저장이 updated_at을 끌어올린다(시술 변경과 같은 격)
  await sql`update client set updated_at = now() - interval '1 hour' where id = ${c.id}`;
  await setBudgetOverride(sql, c.id, '2026-10', 1);
  const after = (await getClientWithProcedures(sql, c.id))!.client;
  assert.ok(Date.now() - new Date(after.updatedAt).getTime() < 60_000);

  // jsonb에 이상한 값이 섞여 있어도 읽기가 죽지 않고 검증 통과분만 남는다
  await sql`update client set budget_overrides = '{"2026-11": 5, "bad": 1, "2026-12": -3, "2026-13": 7}'::jsonb where id = ${c.id}`;
  got = (await getClientWithProcedures(sql, c.id))!.client;
  assert.deepEqual(got.budgetOverrides, { '2026-11': 5 });
});
```

- [ ] **Step 5: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/clientStore.test.ts 2>&1 | tail -15`
Expected: FAIL — `setBudgetOverride`/`getClientBudget` export 없음(또는 `monthlyBudget` undefined).

- [ ] **Step 6: `clientStore.ts` 구현**

파일 상단 import 추가:

```ts
import { budgetOverridesOf, type BudgetClient } from './clientBudget.ts';
```

`ClientRow`·`CRow`·`toClient`를 아래로 바꾼다:

```ts
export interface ClientRow {
  id: string; name: string; info: string; bannedPhrases: string[]; position: number; updatedAt: string;
  landingUrl: string; nameEn: string;
  monthlyBudget: number | null;              // 기본 월 예산(원). null = 미설정 (스펙 2026-08-27 §3)
  budgetOverrides: Record<string, number>;   // {"YYYY-MM": 원} 예외 달만
}
```

```ts
type CRow = {
  id: string; name: string; info: string; banned_phrases: string[]; position: number; updated_at: Date;
  landing_url: string; name_en: string; monthly_budget: number | null; budget_overrides: unknown;
};
```

```ts
const toClient = (r: CRow): ClientRow =>
  ({ id: r.id, name: r.name, info: r.info, bannedPhrases: r.banned_phrases, position: r.position,
     updatedAt: toIsoOrEmpty(r.updated_at), landingUrl: r.landing_url, nameEn: r.name_en,
     monthlyBudget: r.monthly_budget, budgetOverrides: budgetOverridesOf(r.budget_overrides) });
```

select 컬럼 목록이 세 곳(`createClient` returning, `listClients`, `getClientWithProcedures`)에 있다 — 상수로 뽑아 세 곳이 같은 목록을 쓰게 한다:

```ts
// 세 조회가 같은 컬럼을 읽는다 — 한 곳만 컬럼을 빠뜨리면 그 경로에서만 undefined가 나온다
const CLIENT_COLS = (sql: postgres.Sql) => sql`
  id, name, info, banned_phrases, position, updated_at, landing_url, name_en, monthly_budget, budget_overrides`;
```

`createClient`: `returning ${CLIENT_COLS(sql)}` · `listClients`: `select ${CLIENT_COLS(sql)} from client order by position, created_at` · `getClientWithProcedures`: `select ${CLIENT_COLS(sql)} from client where id = ${id}`.

`updateClient` 패치 타입에 `monthlyBudget?: number | null` 추가, update 문에 한 줄:

```ts
export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; monthlyBudget?: number | null },
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
}
```

새 함수 두 개(`deleteClient` 앞에):

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

- [ ] **Step 7: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/clientStore.test.ts 2>&1 | tail -8`
Expected: `# pass 4` (기존 3 + 새 1) `# fail 0`

- [ ] **Step 8: 타입 검사 후 커밋**

Run: `npx tsc --noEmit 2>&1 | head -20` — Expected: 출력 없음(오류 0). `ClientRow`를 만드는 다른 곳(테스트 픽스처 등)이 있으면 새 필드 누락으로 오류가 나온다 — 그 자리에 `monthlyBudget: null, budgetOverrides: {}`를 채운다.

```bash
git add migrations/037_client_budget.sql src/lib/clientStore.ts src/lib/clientStore.test.ts src/lib/clientBudget.ts
git commit -m "feat(budget): 클라이언트 월 예산 컬럼(037)·저장소 — 기본 예산 null=지움·예외 달 jsonb 설정/삭제

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 순수 모듈 `clientBudget.ts` — 환산·귀속·행·문구·검증

**Files:**
- Modify: `src/lib/clientBudget.ts` (Task 1이 만든 파일에 추가)
- Test: `src/lib/clientBudget.test.ts` (신규)

**Interfaces:**
- Consumes: `campaignCost.ts`의 `MoneyByCurrency`, `formatAmount(amount, 'KRW'|'JPY')`, `parseAmount`.
- Produces (Task 3~6이 쓴다):
  - `JPY_TO_KRW: 10`
  - `BUDGET_AMOUNT_MESSAGE`, `MONTH_MESSAGE`
  - `type BudgetSource = 'override' | 'default' | 'none'`
  - `interface MonthSpend { total: MoneyByCurrency; campaignCount: number }`
  - `interface MonthRow { month: string; budget: number | null; source: BudgetSource; spentKrw: number; jpyIncluded: number; campaignCount: number; remaining: number | null }`
  - `interface CampaignMonthBudget { month: string; amount: number | null; source: BudgetSource; othersKrw: number; campaignCount: number }` — 캠페인 상세용. `othersKrw` = 같은 달 **다른** 캠페인의 원화 환산 합(이 캠페인은 화면이 자기 합계를 더한다 — 비용을 고치면 잔액 칸도 즉시 움직이게)
  - `toKrw(total): { krw: number; jpyIncluded: number }`
  - `monthOf(dateOnly: string): string`
  - `addMonths(month: string, n: number): string`
  - `budgetForMonth(client: BudgetClient, month): { amount: number | null; source: BudgetSource }`
  - `budgetRows(client, spend: Map<string, MonthSpend>, today: string): MonthRow[]`
  - `campaignMonthBudget(client, month, spend: MonthSpend | undefined, thisCampaignKrw: number): CampaignMonthBudget`
  - `remainingOf(amount: number | null, spentKrw: number): number | null`
  - `budgetJudgment(budget: number | null, remaining: number | null): string`
  - `monthLabel(month): string` — `'2026-09' → '2026년 9월'`
  - `monthShort(month): string` — `'2026-09' → '9월'`
  - `budgetTipText(): string`
  - `parseBudgetAmount(v: unknown): { ok: true; value: number | null } | { ok: false; message: string }` — null 허용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/clientBudget.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JPY_TO_KRW, BUDGET_AMOUNT_MESSAGE, MONTH_MESSAGE, isMonthKey, budgetOverridesOf,
  toKrw, monthOf, addMonths, budgetForMonth, budgetRows, campaignMonthBudget, remainingOf,
  budgetJudgment, monthLabel, monthShort, budgetTipText, parseBudgetAmount, type MonthSpend,
} from './clientBudget.ts';

const client = (monthlyBudget: number | null, budgetOverrides: Record<string, number> = {}) => ({ monthlyBudget, budgetOverrides });

test('1) toKrw — 엔화는 1엔=JPY_TO_KRW원으로 환산해 합산, 엔화 원금은 따로 알려준다', () => {
  assert.equal(JPY_TO_KRW, 10);
  assert.deepEqual(toKrw({}), { krw: 0, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ KRW: 300_000 }), { krw: 300_000, jpyIncluded: 0 });
  assert.deepEqual(toKrw({ JPY: 95_000 }), { krw: 950_000, jpyIncluded: 95_000 });
  assert.deepEqual(toKrw({ KRW: 300_000, JPY: 95_000 }), { krw: 1_250_000, jpyIncluded: 95_000 });
});

test('2) monthOf·addMonths — 월 경계·연 경계에서 시간대 시프트 없음', () => {
  assert.equal(monthOf('2026-08-31'), '2026-08');
  assert.equal(monthOf('2026-09-01'), '2026-09');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-08', 0), '2026-08');
});

test('3) isMonthKey·budgetOverridesOf — 형식·정수 검증 통과분만', () => {
  assert.ok(isMonthKey('2026-09'));
  assert.ok(!isMonthKey('2026-13'));
  assert.ok(!isMonthKey('2026-9'));
  assert.ok(!isMonthKey('2026-09-01'));
  assert.deepEqual(budgetOverridesOf(null), {});
  assert.deepEqual(budgetOverridesOf([1]), {});
  assert.deepEqual(budgetOverridesOf({ '2026-09': 100, bad: 1, '2026-10': -1, '2026-11': 1.5 }), { '2026-09': 100 });
});

test('4) budgetForMonth — 예외 → 기본 → 미설정. 예외가 기본과 같은 금액이어도 override', () => {
  assert.deepEqual(budgetForMonth(client(3_000_000, { '2026-08': 2_500_000 }), '2026-08'), { amount: 2_500_000, source: 'override' });
  assert.deepEqual(budgetForMonth(client(3_000_000, { '2026-08': 3_000_000 }), '2026-08'), { amount: 3_000_000, source: 'override' });
  assert.deepEqual(budgetForMonth(client(3_000_000), '2026-09'), { amount: 3_000_000, source: 'default' });
  assert.deepEqual(budgetForMonth(client(null, { '2026-08': 1 }), '2026-09'), { amount: null, source: 'none' });
  assert.deepEqual(budgetForMonth(client(null, { '2026-08': 1 }), '2026-08'), { amount: 1, source: 'override' });
});

test('5) remainingOf·budgetJudgment — 남음/초과/미설정 문구', () => {
  assert.equal(remainingOf(null, 100), null);
  assert.equal(remainingOf(3_000_000, 1_200_000), 1_800_000);
  assert.equal(remainingOf(2_500_000, 2_850_000), -350_000);
  assert.equal(budgetJudgment(3_000_000, 1_800_000), '1,800,000원 남음');
  assert.equal(budgetJudgment(2_500_000, -350_000), '350,000원 초과');
  assert.equal(budgetJudgment(1_000_000, 0), '0원 남음');
  assert.equal(budgetJudgment(null, null), '예산을 설정하면 잔액이 보여요');
});

const spend = (entries: Array<[string, MonthSpend]>) => new Map(entries);

test('6) budgetRows — 캠페인 없으면 이번 달·다음 달 2행, 최신 위', () => {
  const rows = budgetRows(client(3_000_000), spend([]), '2026-08-27');
  assert.deepEqual(rows.map((r) => r.month), ['2026-09', '2026-08']);
  assert.deepEqual(rows[1], {
    month: '2026-08', budget: 3_000_000, source: 'default', spentKrw: 0, jpyIncluded: 0, campaignCount: 0, remaining: 3_000_000,
  });
});

test('7) budgetRows — 첫 캠페인 달부터 다음 달까지 빈 달도 채우고, 집행·예외·엔화가 행에 붙는다', () => {
  const rows = budgetRows(
    client(3_000_000, { '2026-08': 2_500_000 }),
    spend([
      ['2026-06', { total: { KRW: 100_000 }, campaignCount: 1 }],
      ['2026-08', { total: { KRW: 1_900_000, JPY: 95_000 }, campaignCount: 3 }],
    ]),
    '2026-08-27',
  );
  assert.deepEqual(rows.map((r) => r.month), ['2026-09', '2026-08', '2026-07', '2026-06']);
  const aug = rows[1];
  assert.equal(aug.budget, 2_500_000);
  assert.equal(aug.source, 'override');
  assert.equal(aug.spentKrw, 2_850_000);
  assert.equal(aug.jpyIncluded, 95_000);
  assert.equal(aug.campaignCount, 3);
  assert.equal(aug.remaining, -350_000);
  assert.equal(rows[2].campaignCount, 0);           // 7월은 캠페인 없음이지만 행은 있다
});

test('8) budgetRows — 12행 상한(최신 12개), 첫 캠페인이 미래여도 이번 달부터', () => {
  const many = budgetRows(client(1), spend([['2024-01', { total: {}, campaignCount: 1 }]]), '2026-08-27');
  assert.equal(many.length, 12);
  assert.equal(many[0].month, '2026-09');
  assert.equal(many[11].month, '2025-10');
  const future = budgetRows(client(1), spend([['2026-11', { total: {}, campaignCount: 1 }]]), '2026-08-27');
  // 미래 캠페인 달까지 포함 — 예정 캠페인의 예산도 봐야 한다
  assert.deepEqual(future.map((r) => r.month), ['2026-11', '2026-10', '2026-09', '2026-08']);
});

test('9) campaignMonthBudget — othersKrw는 같은 달 합계에서 이 캠페인 몫을 뺀 값', () => {
  const b = campaignMonthBudget(client(3_000_000), '2026-08', { total: { KRW: 1_850_000 }, campaignCount: 2 }, 1_200_000);
  assert.deepEqual(b, { month: '2026-08', amount: 3_000_000, source: 'default', othersKrw: 650_000, campaignCount: 2 });
  // 그 달에 집계가 없으면(이 캠페인이 아직 비용 0) 0
  assert.deepEqual(campaignMonthBudget(client(null), '2026-08', undefined, 0),
    { month: '2026-08', amount: null, source: 'none', othersKrw: 0, campaignCount: 0 });
});

test('10) 라벨·안내 문구 — 환율은 상수에서 나온다', () => {
  assert.equal(monthLabel('2026-09'), '2026년 9월');
  assert.equal(monthShort('2026-09'), '9월');
  assert.equal(monthShort('2026-12'), '12월');
  assert.ok(budgetTipText().includes(`1엔 = ${JPY_TO_KRW}원`));
  assert.ok(budgetTipText().includes('시작한 달'));
  assert.ok(budgetTipText().includes('캠페인에 넣은 콘텐츠'));
});

test('11) parseBudgetAmount — null 허용, 0 이상 정수, 콤마 문자열 허용', () => {
  assert.deepEqual(parseBudgetAmount(null), { ok: true, value: null });
  assert.deepEqual(parseBudgetAmount(''), { ok: true, value: null });   // 입력칸을 비우면 미설정
  assert.deepEqual(parseBudgetAmount('3,000,000'), { ok: true, value: 3_000_000 });
  assert.deepEqual(parseBudgetAmount(0), { ok: true, value: 0 });
  assert.deepEqual(parseBudgetAmount(-1), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount(1.5), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.deepEqual(parseBudgetAmount('abc'), { ok: false, message: BUDGET_AMOUNT_MESSAGE });
  assert.equal(MONTH_MESSAGE, '달 형식이 올바르지 않아요 (예: 2026-09)');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/clientBudget.test.ts 2>&1 | tail -5`
Expected: FAIL — `toKrw` 등 export 없음.

- [ ] **Step 3: 구현 — `clientBudget.ts`에 추가**

Task 1의 내용 아래에 이어서:

```ts
import { formatAmount, type MoneyByCurrency } from './campaignCost.ts';

// 환율 — 참고 환산(koo 결정 08-27: 1엔 = 10원 고정). 바꿀 자리는 여기 한 곳.
// 집행은 저장하지 않고 계산하므로 이 값을 바꾸면 지난 달 숫자도 새 환율로 다시 계산된다(스펙 §2).
// 그게 문제가 되면 월별 환율 스냅샷을 그때 넣는다.
export const JPY_TO_KRW = 10;

export const BUDGET_AMOUNT_MESSAGE = '예산은 0 이상 숫자로 입력해 주세요';
export const MONTH_MESSAGE = '달 형식이 올바르지 않아요 (예: 2026-09)';
const MAX_ROWS = 12;

export type BudgetSource = 'override' | 'default' | 'none';
export interface MonthSpend { total: MoneyByCurrency; campaignCount: number }
export interface MonthRow {
  month: string; budget: number | null; source: BudgetSource;
  spentKrw: number; jpyIncluded: number; campaignCount: number;
  remaining: number | null;   // budget - spentKrw. budget이 null이면 null
}
// 캠페인 상세 카드용 — othersKrw는 같은 달 '다른' 캠페인의 환산 합. 이 캠페인 몫은 화면이 자기 합계(campaignTotal)를
// 더한다 — 비용 셀을 고치면 비용 합계 칸과 잔액 칸이 같은 순간에 같은 숫자로 움직여야 한다(UX 원칙 4).
export interface CampaignMonthBudget {
  month: string; amount: number | null; source: BudgetSource; othersKrw: number; campaignCount: number;
}

export function toKrw(total: MoneyByCurrency): { krw: number; jpyIncluded: number } {
  const jpy = total.JPY ?? 0;
  return { krw: (total.KRW ?? 0) + jpy * JPY_TO_KRW, jpyIncluded: jpy };
}

// 'YYYY-MM-DD'(서울 날짜 문자열) → 'YYYY-MM'. Date로 바꾸지 않는다 — 바꾸면 UTC 자정 시프트로 달이 갈린다.
export function monthOf(dateOnly: string): string {
  return dateOnly.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

export function budgetForMonth(client: BudgetClient, month: string): { amount: number | null; source: BudgetSource } {
  const o = client.budgetOverrides[month];
  if (o !== undefined) return { amount: o, source: 'override' };
  if (client.monthlyBudget !== null) return { amount: client.monthlyBudget, source: 'default' };
  return { amount: null, source: 'none' };
}

export function remainingOf(amount: number | null, spentKrw: number): number | null {
  return amount === null ? null : amount - spentKrw;
}

// 범위: min(첫 캠페인 달, 이번 달) ~ max(마지막 캠페인 달, 다음 달). 최신 위, 최대 12행(스펙 §4).
// 캠페인이 없으면 이번 달·다음 달 2행. 빈 달도 행을 만든다 — 표에서 그 달 예산을 고칠 자리가 필요하다.
export function budgetRows(client: BudgetClient, spend: Map<string, MonthSpend>, today: string): MonthRow[] {
  const thisMonth = monthOf(today);
  const months = [...spend.keys()].sort();
  const first = months.length && months[0] < thisMonth ? months[0] : thisMonth;
  const nextMonth = addMonths(thisMonth, 1);
  const last = months.length && months[months.length - 1] > nextMonth ? months[months.length - 1] : nextMonth;
  const rows: MonthRow[] = [];
  for (let m = last; m >= first && rows.length < MAX_ROWS; m = addMonths(m, -1)) {
    const s = spend.get(m);
    const { amount, source } = budgetForMonth(client, m);
    const { krw, jpyIncluded } = toKrw(s?.total ?? {});
    rows.push({ month: m, budget: amount, source, spentKrw: krw, jpyIncluded, campaignCount: s?.campaignCount ?? 0,
                remaining: remainingOf(amount, krw) });
  }
  return rows;
}

export function campaignMonthBudget(
  client: BudgetClient, month: string, spend: MonthSpend | undefined, thisCampaignKrw: number,
): CampaignMonthBudget {
  const { amount, source } = budgetForMonth(client, month);
  const { krw } = toKrw(spend?.total ?? {});
  return { month, amount, source, othersKrw: Math.max(0, krw - thisCampaignKrw), campaignCount: spend?.campaignCount ?? 0 };
}

export function budgetJudgment(budget: number | null, remaining: number | null): string {
  if (budget === null || remaining === null) return '예산을 설정하면 잔액이 보여요';
  if (remaining < 0) return `${formatAmount(-remaining, 'KRW')} 초과`;
  return `${formatAmount(remaining, 'KRW')} 남음`;
}

export function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
}
export function monthShort(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

// 표·카드 ⓘ 공용 — 귀속 규칙·집계 범위·환율을 한 문장씩(스펙 §6-1, §7)
export function budgetTipText(): string {
  return `캠페인은 시작한 달에 잡혀요 · 캠페인에 넣은 콘텐츠 비용만 집계해요 · 엔화는 1엔 = ${JPY_TO_KRW}원으로 환산해요`;
}

// 예산 입력 검증 — null·빈 문자열은 '미설정'으로 허용, 그 외는 parseAmount(0 이상 안전 정수, 콤마 허용)
export function parseBudgetAmount(v: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (v === null || v === '' || v === undefined) return { ok: true, value: null };
  const n = parseAmount(v);
  return n === null ? { ok: false, message: BUDGET_AMOUNT_MESSAGE } : { ok: true, value: n };
}
```

(`import { parseAmount }`가 Task 1에 이미 있으므로 `formatAmount, type MoneyByCurrency`를 그 import 줄에 합친다: `import { parseAmount, formatAmount, type MoneyByCurrency } from './campaignCost.ts';`)

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/clientBudget.test.ts 2>&1 | tail -5`
Expected: `# pass 11` `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add src/lib/clientBudget.ts src/lib/clientBudget.test.ts
git commit -m "feat(budget): 월 예산 순수 모듈 — 1엔=10원 환산·시작 달 귀속·월별 행·잔액 문구·입력 검증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `campaignStore` — 달별 집행 `spendByMonth` + 상세 `budget`

**Files:**
- Modify: `src/lib/campaignStore.ts`
- Test: `src/lib/campaignStore.test.ts`

**Interfaces:**
- Consumes: Task 1 `getClientBudget`, Task 2 `MonthSpend`, `CampaignMonthBudget`, `campaignMonthBudget`, `monthOf`, `toKrw`.
- Produces: `spendByMonth(sql, clientId, months?: string[]): Promise<Map<string, MonthSpend>>`; `CampaignDetail.budget: CampaignMonthBudget | null`.

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/campaignStore.test.ts` import에 `spendByMonth` 추가, `clientStore` import에 `updateClient, setBudgetOverride` 추가. 파일 끝에:

```ts
test('12) spendByMonth — 시작 달로 묶고 totalsFor와 같은 정의(미사용 제외·추가 비용 포함·통화 분리), 비용 0 캠페인도 센다', async () => {
  const c = await createClient(sql, P + '예산클라');
  const aug1 = await createCampaign(sql, { ...base(c.id, c.name, 'm1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const aug2 = await createCampaign(sql, { ...base(c.id, c.name, 'm2'), startsOn: '2026-08-31', endsOn: '2026-09-06' }); // 월을 걸쳐도 8월
  const sep = await createCampaign(sql, { ...base(c.id, c.name, 'm3'), startsOn: '2026-09-01', endsOn: '2026-09-07' });
  const d1 = (await mkDraft(c.id, c.name, aug1.id)).id;
  const d2 = (await mkDraft(c.id, c.name, aug1.id)).id;
  const d3 = (await mkDraft(c.id, c.name, aug2.id)).id;
  await updateDraft(sql, d1, { cost: { type: 'post', amount: 300_000, currency: 'KRW' } });
  await updateDraft(sql, d2, { status: 'unused', cost: { type: 'post', amount: 777_777, currency: 'KRW' } }); // 제외
  await updateDraft(sql, d3, { cost: { type: 'post', amount: 95_000, currency: 'JPY' } });
  await upsertInfluencerCost(sql, aug1.id, 'hana', { extraCosts: [{ label: '교통비', amount: 20_000, currency: 'KRW' }] });

  const all = await spendByMonth(sql, c.id);
  assert.deepEqual(all.get('2026-08'), { total: { KRW: 320_000, JPY: 95_000 }, campaignCount: 2 });
  assert.deepEqual(all.get('2026-09'), { total: {}, campaignCount: 1 });   // 비용 없는 캠페인도 개수에 든다
  assert.equal(all.has('2026-07'), false);

  const only = await spendByMonth(sql, c.id, ['2026-09']);
  assert.deepEqual([...only.keys()], ['2026-09']);
  assert.equal(only.get('2026-09')!.campaignCount, 1);
  void sep;

  // 다른 클라이언트의 캠페인은 섞이지 않는다
  const other = await createClient(sql, P + '남의클라');
  await createCampaign(sql, { ...base(other.id, other.name, 'm4'), startsOn: '2026-08-10', endsOn: '2026-08-16' });
  assert.equal((await spendByMonth(sql, c.id)).get('2026-08')!.campaignCount, 2);
});

test('13) getCampaignDetail.budget — 예외 달 우선·othersKrw는 같은 달 다른 캠페인 몫·클라 없으면 null', async () => {
  const c = await createClient(sql, P + '예산클라2');
  await updateClient(sql, c.id, { monthlyBudget: 3_000_000 });
  await setBudgetOverride(sql, c.id, '2026-08', 2_500_000);
  const a = await createCampaign(sql, { ...base(c.id, c.name, 'b1'), startsOn: '2026-08-03', endsOn: '2026-08-09' });
  const b = await createCampaign(sql, { ...base(c.id, c.name, 'b2'), startsOn: '2026-08-17', endsOn: '2026-08-23' });
  const da = (await mkDraft(c.id, c.name, a.id)).id;
  const db = (await mkDraft(c.id, c.name, b.id)).id;
  await updateDraft(sql, da, { cost: { type: 'post', amount: 1_200_000, currency: 'KRW' } });
  await updateDraft(sql, db, { cost: { type: 'post', amount: 65_000, currency: 'JPY' } });   // 650,000원

  const detA = (await getCampaignDetail(sql, a.id, T))!;
  assert.deepEqual(detA.budget, { month: '2026-08', amount: 2_500_000, source: 'override', othersKrw: 650_000, campaignCount: 2 });
  const detB = (await getCampaignDetail(sql, b.id, T))!;
  assert.equal(detB.budget!.othersKrw, 1_200_000);

  // 9월 캠페인은 기본값
  const s = await createCampaign(sql, { ...base(c.id, c.name, 'b3'), startsOn: '2026-09-07', endsOn: '2026-09-13' });
  const detS = (await getCampaignDetail(sql, s.id, T))!;
  assert.deepEqual(detS.budget, { month: '2026-09', amount: 3_000_000, source: 'default', othersKrw: 0, campaignCount: 1 });

  // 클라이언트를 지우면(client_id set null) budget은 null
  await deleteClient(sql, c.id);
  assert.equal((await getCampaignDetail(sql, a.id, T))!.budget, null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts 2>&1 | grep -E "^# (pass|fail)|not ok"`
Expected: 12·13이 `not ok`(export 없음).

- [ ] **Step 3: 구현**

`campaignStore.ts` import 추가:

```ts
import { getClientBudget } from './clientStore.ts';
import { campaignMonthBudget, monthOf, toKrw, type MonthSpend, type CampaignMonthBudget } from './clientBudget.ts';
```

`CampaignDetail` 인터페이스에 필드 추가:

```ts
  budget: CampaignMonthBudget | null;   // 이 캠페인이 속한 달의 클라이언트 예산(스펙 2026-08-27 §5-3). 클라 없으면 null
```

`totalsFor` 아래에 새 함수:

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
    const cur = out.get(c.month) ?? { total: {}, campaignCount: 0 };
    out.set(c.month, { total: mergeMoney(cur.total, totals.get(c.id) ?? {}), campaignCount: cur.campaignCount + 1 });
  }
  return out;
}
```

`getCampaignDetail`의 return 직전에:

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

return 객체에 `budget,` 추가.

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 0`

- [ ] **Step 5: 타입 검사 + 커밋**

Run: `npx tsc --noEmit 2>&1 | head` — Expected: 출력 없음. (`CampaignDetail`을 만드는 픽스처가 있으면 `budget: null` 추가.)

```bash
git add src/lib/campaignStore.ts src/lib/campaignStore.test.ts
git commit -m "feat(budget): 달별 집행 spendByMonth(totalsFor 재사용) + 캠페인 상세에 그 달 예산 budget

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: API — PATCH 예산 검증, GET 월별 표, PUT 예외 달

**Files:**
- Modify: `src/app/api/clients/[id]/route.ts`
- Create: `src/app/api/clients/[id]/budget/route.ts`
- Create: `src/app/api/clients/[id]/budget/[month]/route.ts`

**Interfaces:**
- Consumes: Task 1 `updateClient`, `setBudgetOverride`, `getClientWithProcedures`; Task 2 `parseBudgetAmount`, `isMonthKey`, `MONTH_MESSAGE`, `budgetRows`; Task 3 `spendByMonth`; `kstToday`(`@/lib/datetime`).
- Produces: `PATCH /api/clients/[id]` body `monthlyBudget?: number | string | null` · `GET /api/clients/[id]/budget → { rows: MonthRow[] }` · `PUT /api/clients/[id]/budget/[month]` body `{ amount: number | string | null }` → 갱신된 `{ client, procedures }`.

라우트 하네스는 없다(메모리: 라우트/컴포넌트 테스트 없음) — 검증 로직은 Task 2의 순수 함수가 이미 테스트됐고, 라우트는 `tsc`·`lint`·수동 curl 없이 코드 리뷰로 확인한다.

- [ ] **Step 1: PATCH에 `monthlyBudget` 검증 추가**

`src/app/api/clients/[id]/route.ts` import 추가: `import { parseBudgetAmount } from '@/lib/clientBudget';`

body 타입에 `monthlyBudget?: unknown` 추가. `nameEn` 검증 블록 뒤, `await updateClient(...)` 앞에:

```ts
  // 예산: undefined = 건드리지 않음 · null/'' = 미설정 · 숫자(콤마 문자열 허용) = 설정. 0 이상 정수만(비용 금액 규칙과 동일)
  let monthlyBudget: number | null | undefined;
  if (body.monthlyBudget !== undefined) {
    const parsed = parseBudgetAmount(body.monthlyBudget);
    if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
    monthlyBudget = parsed.value;
  }
  await updateClient(getSql(), id, { ...body, monthlyBudget } as Parameters<typeof updateClient>[2]);
```

기존 `await updateClient(getSql(), id, body);` 줄은 위 줄로 대체한다. body 타입 선언을 아래로 바꾼다:

```ts
  const body = (await req.json().catch(() => ({}))) as {
    name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; monthlyBudget?: unknown;
  };
```

- [ ] **Step 2: GET 월별 표 라우트**

`src/app/api/clients/[id]/budget/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getClientBudget } from '@/lib/clientStore';
import { spendByMonth } from '@/lib/campaignStore';
import { budgetRows } from '@/lib/clientBudget';
import { kstToday } from '@/lib/datetime';

// 클라이언트 상세 '월 마케팅 예산' 패널의 표(스펙 2026-08-27 §5-3). 클라이언트 로드와 분리 — 상세 첫 화면을 느리게 하지
// 않고 패널이 자기 데이터를 따로 부른다. 집행은 저장하지 않고 매번 계산(캠페인 합계와 같은 totalsFor).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const sql = getSql();
  const client = await getClientBudget(sql, id);
  if (!client) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const spend = await spendByMonth(sql, id);
  return NextResponse.json({ rows: budgetRows(client, spend, kstToday()) });
}
```

- [ ] **Step 3: PUT 예외 달 라우트**

`src/app/api/clients/[id]/budget/[month]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getClientWithProcedures, setBudgetOverride } from '@/lib/clientStore';
import { isMonthKey, parseBudgetAmount, MONTH_MESSAGE } from '@/lib/clientBudget';

// 특정 달 예산 설정/되돌리기(스펙 2026-08-27 §5-3). body.amount: 숫자 = 그 달만 이 금액 · null = 예외 삭제(기본값으로).
// 응답은 갱신된 클라이언트(시술 포함) — 화면이 목록 행·패널을 한 번에 갱신한다.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; month: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, month } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  if (!isMonthKey(month)) return NextResponse.json({ error: MONTH_MESSAGE }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { amount?: unknown };
  const parsed = parseBudgetAmount(body.amount);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  await setBudgetOverride(sql, id, month, parsed.value);
  const row = await getClientWithProcedures(sql, id);
  if (!row) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}
```

- [ ] **Step 4: 타입·린트 확인**

Run: `npx tsc --noEmit 2>&1 | head; npm run lint 2>&1 | tail -3`
Expected: tsc 출력 없음. lint 경고 수는 기준선(24) 이하 — 새 파일에서 경고가 나면 고친다.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/clients/[id]/route.ts" "src/app/api/clients/[id]/budget"
git commit -m "feat(budget): 예산 API — PATCH monthlyBudget 검증·GET 월별 표·PUT 예외 달 설정/되돌리기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 클라이언트 상세 — `BudgetPanel` (세 번째 패널)

**Files:**
- Create: `src/app/clients/BudgetPanel.tsx`
- Modify: `src/app/clients/ClientDetail.tsx` (시술 패널 뒤에 배치, `Register` 타입 export)

**Interfaces:**
- Consumes: `ClientRow`(Task 1), `MonthRow`·`budgetJudgment`·`monthLabel`·`budgetTipText`·`formatAmount`(Task 2 / campaignCost), API(Task 4), `apiFetch`, `Button`, `InfoTip`.
- Produces: `<BudgetPanel client register onChanged />`. 기본 예산 편집기는 `register('budget', …)`로 상세의 미저장 확인·일괄 저장에 든다.

화면 구조(스펙 §6-1). 패널 = 시술 패널과 같은 `rounded-2xl border border-x-border-strong`. 표 행은 `py-3`(44px+). 예산 셀은 클릭 → 그 행이 편집 모드(입력 + 저장 + 취소 + 예외가 있으면 "기본값으로 되돌리기"). 포털 팝오버 대신 행 안 인라인 편집 — 표 안에서 overflow 문제가 없고 코드가 짧다.

- [ ] **Step 1: `ClientDetail.tsx`에서 `Register` 타입 export**

`type Register = (key: string, editor: Editor) => () => void;` → `export type Register = …`, 그 위 `type Editor` 도 `export type Editor = …`.

- [ ] **Step 2: `BudgetPanel.tsx` 작성**

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';
import { formatAmount, parseAmount } from '@/lib/campaignCost';
import {
  budgetJudgment, monthLabel, budgetTipText, BUDGET_AMOUNT_MESSAGE, JPY_TO_KRW, type MonthRow,
} from '@/lib/clientBudget';
import type { ClientRow } from '@/lib/clientStore';
import type { Register } from './ClientDetail';

// 월 마케팅 예산 패널(스펙 2026-08-27 §6-1) — 위: 기본 월 예산(클라이언트 저장 흐름과 같은 dirty/저장됨 패턴),
// 아래: 월별 예산·집행·잔액 표. 표는 자기 데이터(/budget)를 따로 부른다 — 집행은 캠페인에서 계산되는 값이라
// 클라이언트 목록 응답에 실리지 않는다. 예산 셀 클릭 → 그 행 인라인 편집(즉시 저장).

async function errOf(r: Response): Promise<string> {
  return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`;
}
// 입력칸 표시용 — 저장은 정수, 표시는 콤마
const withCommas = (s: string) => {
  const n = parseAmount(s);
  return n === null ? s : n.toLocaleString('ko-KR');
};

export function BudgetPanel({ client, register, onChanged }: {
  client: ClientRow; register: Register; onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<MonthRow[] | null>(null);
  const [rowsErr, setRowsErr] = useState(false);
  const loadRows = useCallback(async () => {
    setRowsErr(false);
    try {
      const r = await apiFetch(`/api/clients/${client.id}/budget`);
      if (!r.ok) throw new Error(String(r.status));
      setRows(((await r.json()) as { rows: MonthRow[] }).rows);
    } catch {
      setRowsErr(true); // 실패를 빈 표로 위장하지 않는다
    }
  }, [client.id]);
  useEffect(() => { void loadRows(); }, [loadRows]);

  return (
    <div className="mt-4 rounded-2xl border border-x-border-strong">
      <div className="px-4 py-3">
        <h3 className="text-content font-bold">월 마케팅 예산</h3>
        <p className="text-caption text-x-muted">매달 이 금액을 기준으로 캠페인 비용을 대조해요. 특정 달만 다르면 아래 표에서 그 달을 고쳐요.</p>
      </div>
      <div className="border-t border-x-border px-4 py-4">
        <DefaultBudgetEditor key={client.id} client={client} register={register}
                             onSaved={async () => { await onChanged(); await loadRows(); }} />
      </div>
      <div className="border-t border-x-border px-4 py-4">
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-ui font-bold">월별 예산과 집행</span>
          <InfoTip text={budgetTipText()} label="집계 방식 설명 보기" />
        </div>
        {rowsErr ? (
          <div className="flex items-center gap-2 text-ui text-red-500">
            <span>예산 정보를 불러오지 못했어요</span>
            <Button onClick={() => void loadRows()}>다시 시도</Button>
          </div>
        ) : rows === null ? (
          <p className="text-ui text-x-muted">불러오는 중…</p>
        ) : (
          <BudgetTable clientId={client.id} rows={rows} onChanged={async () => { await onChanged(); await loadRows(); }} />
        )}
      </div>
    </div>
  );
}

// 기본 월 예산 — BasicInfoEditor와 같은 dirty/저장됨 패턴(baseline 대비, register로 일괄 저장에 포함)
function DefaultBudgetEditor({ client, register, onSaved }: {
  client: ClientRow; register: Register; onSaved: () => Promise<void>;
}) {
  const initial = client.monthlyBudget === null ? '' : String(client.monthlyBudget);
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const baseline = useRef(initial);
  const cur = useRef(value);
  useEffect(() => { cur.current = value; }, [value]);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const raw = cur.current.trim();
    const n = raw === '' ? null : parseAmount(raw);
    if (raw !== '' && n === null) { setErr(BUDGET_AMOUNT_MESSAGE); return false; }
    setSaving(true);
    try {
      const r = await apiFetch(`/api/clients/${client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ monthlyBudget: n }),
      });
      if (!r.ok) { setErr(await errOf(r)); return false; }
      baseline.current = n === null ? '' : String(n);
      setValue(baseline.current);
      setErr(''); setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2500);
      await onSaved();
      return true;
    } finally { setSaving(false); }
  }, [client.id, onSaved]);

  useEffect(() => register('budget', {
    isDirty: () => (parseAmount(cur.current) ?? cur.current.trim()) !== (parseAmount(baseline.current) ?? baseline.current),
    save,
  }), [register, save]);

  return (
    <label className="block">
      <span className="text-ui font-bold">기본 월 예산 <span className="font-normal text-x-muted">선택</span></span>
      <div className="mt-1 flex items-center gap-2.5">
        <input value={withCommas(value)} inputMode="numeric" autoComplete="off"
               onChange={(e) => { setValue(e.target.value.replace(/,/g, '')); setSaved(false); }}
               placeholder="예: 3,000,000"
               className="w-48 rounded-md border border-x-border-strong p-2 text-right text-ui tabular-nums outline-none focus:border-x-blue" />
        <span className="text-ui">원</span>
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
        {saved && <span className="text-ui font-medium text-x-green">저장됨 ✓</span>}
      </div>
      {err && <p className="mt-1 text-ui text-red-500">{err}</p>}
    </label>
  );
}

function BudgetTable({ clientId, rows, onChanged }: { clientId: string; rows: MonthRow[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);   // 편집 중인 month
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="text-left text-x-secondary">
            <th className="py-2 pr-4 font-bold">월</th>
            <th className="py-2 pr-4 font-bold">예산</th>
            <th className="py-2 pr-4 font-bold">집행</th>
            <th className="py-2 font-bold">잔액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <BudgetRow key={r.month} clientId={clientId} row={r} editing={editing === r.month}
                       onEdit={() => setEditing(r.month)} onClose={() => setEditing(null)} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetRow({ clientId, row, editing, onEdit, onClose, onChanged }: {
  clientId: string; row: MonthRow; editing: boolean; onEdit: () => void; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState(row.budget === null ? '' : String(row.budget));
  const [err, setErr] = useState('');
  const busy = useRef(false);
  useEffect(() => { if (editing) { setValue(row.budget === null ? '' : String(row.budget)); setErr(''); } }, [editing, row.budget]);

  async function put(amount: number | null) {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await apiFetch(`/api/clients/${clientId}/budget/${row.month}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }),
      });
      if (!r.ok) { setErr(await errOf(r)); return; }
      onClose(); await onChanged();
    } finally { busy.current = false; }
  }
  function save() {
    const raw = value.trim();
    if (raw === '') { setErr(BUDGET_AMOUNT_MESSAGE); return; }   // 예외를 지우려면 '기본값으로 되돌리기'
    const n = parseAmount(raw);
    if (n === null) { setErr(BUDGET_AMOUNT_MESSAGE); return; }
    void put(n);
  }

  const over = row.remaining !== null && row.remaining < 0;
  return (
    <tr className="border-t border-x-border align-top">
      <td className="whitespace-nowrap py-3 pr-4">{monthLabel(row.month)}</td>
      <td className="py-3 pr-4">
        {editing ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input value={withCommas(value)} inputMode="numeric" autoFocus autoComplete="off"
                     onChange={(e) => setValue(e.target.value.replace(/,/g, ''))}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && !e.nativeEvent.isComposing) save();
                       if (e.key === 'Escape') onClose();
                     }}
                     className="w-36 rounded-md border border-x-border-strong p-1.5 text-right text-ui tabular-nums outline-none focus:border-x-blue" />
              <span>원</span>
              <Button variant="primary" onClick={save}>저장</Button>
              <Button variant="ghost" onClick={onClose}>취소</Button>
            </div>
            {row.source === 'override' && (
              <button onClick={() => void put(null)} className="text-caption text-x-secondary hover:text-x-text">기본값으로 되돌리기</button>
            )}
            {err && <p className="text-caption text-red-500">{err}</p>}
          </div>
        ) : (
          <button onClick={onEdit} className="text-left tabular-nums hover:text-x-blue-text" title="이 달 예산 고치기">
            {row.budget === null ? '—' : formatAmount(row.budget, 'KRW')}
            <span className="ml-1.5 text-caption text-x-muted">{row.source === 'override' ? '(수정)' : row.source === 'default' ? '기본' : '미설정'}</span>
          </button>
        )}
      </td>
      <td className="py-3 pr-4 tabular-nums">
        {formatAmount(row.spentKrw, 'KRW')}
        <span className="ml-1.5 text-x-muted">· {row.campaignCount === 0 ? '캠페인 없음' : `캠페인 ${row.campaignCount}개`}</span>
        {row.jpyIncluded > 0 && (
          <p className="text-caption text-x-muted">엔화 {formatAmount(row.jpyIncluded, 'JPY')} 포함({formatAmount(row.jpyIncluded * JPY_TO_KRW, 'KRW')}으로 환산)</p>
        )}
      </td>
      <td className={`py-3 tabular-nums ${over ? 'font-bold text-red-700' : row.remaining === null ? 'text-x-muted' : ''}`}>
        {budgetJudgment(row.budget, row.remaining)}
      </td>
    </tr>
  );
}
```

- [ ] **Step 3: `ClientDetail.tsx`에 패널 배치**

import 추가: `import { BudgetPanel } from './BudgetPanel';`
시술 패널 `</div>`(`{deleting && (` 바로 위) 다음에:

```tsx
      <BudgetPanel client={client} register={register} onChanged={onChanged} />
```

- [ ] **Step 4: 타입·린트·빌드 확인**

Run: `npx tsc --noEmit 2>&1 | head; npm run lint 2>&1 | tail -3`
Expected: tsc 출력 없음, lint 경고 기준선 이하(`react-hooks/set-state-in-effect` 경고가 `BudgetRow`의 useEffect에서 나오면 그 줄에 `// eslint-disable-next-line react-hooks/set-state-in-effect -- 편집 시작 시 입력값 리셋(기존 코드베이스 관례)` 추가).

Run: `npm run build 2>&1 | tail -5` — Expected: `✓ Compiled` 와 라우트 목록에 `/api/clients/[id]/budget`, `/api/clients/[id]/budget/[month]`.

- [ ] **Step 5: 커밋**

```bash
git add src/app/clients/BudgetPanel.tsx src/app/clients/ClientDetail.tsx
git commit -m "feat(budget): 클라이언트 상세 '월 마케팅 예산' 패널 — 기본 예산 입력 + 월별 예산·집행·잔액 표(행 인라인 편집·기본값 되돌리기)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 캠페인 요약 — "N월 예산 잔액" 5번째 칸

**Files:**
- Modify: `src/app/campaigns/SummaryCards.tsx`
- Modify: `src/app/campaigns/CampaignDetail.tsx:44` (`DetailState`), load(), `<SummaryCards …>` 호출

**Interfaces:**
- Consumes: Task 3 `CampaignDetail.budget: CampaignMonthBudget | null`; Task 2 `toKrw`, `remainingOf`, `monthShort`, `budgetTipText`, `formatAmount`.
- Produces: `<SummaryCards summary perf total budget clientId />`.

- [ ] **Step 1: `SummaryCards.tsx` 수정**

import 추가:

```ts
import Link from 'next/link';
import { toKrw, remainingOf, monthShort, budgetTipText, type CampaignMonthBudget } from '@/lib/clientBudget';
```

`Card`의 `sub` 타입을 `ReactNode`로: `{ alert?: boolean; value: ReactNode; label: string; sub: ReactNode; good?: boolean; tip?: string }`.

`SummaryCards` 시그니처와 본문:

```tsx
export function SummaryCards({ summary, perf, total, budget, clientId }: {
  summary: CampaignSummary; perf: PerfSummary; total: MoneyByCurrency;
  budget: CampaignMonthBudget | null;   // 이 달 클라이언트 예산(서버). 클라 없는 캠페인은 null → 4칸 유지
  clientId: string | null;
}) {
  const money = moneyParts(total);
  // 잔액 = 예산 − (다른 캠페인 몫 + 이 캠페인 합계 환산). 이 캠페인 몫을 화면의 total에서 더해야
  // 비용 셀을 고친 순간 '비용 합계' 칸과 같은 박자로 움직인다(스펙 §6-2, UX 원칙 4).
  const spentKrw = budget ? budget.othersKrw + toKrw(total).krw : 0;
  const remaining = budget ? remainingOf(budget.amount, spentKrw) : null;
  return (
    <div className={`grid ${budget ? 'grid-cols-5' : 'grid-cols-4'}`}>
      … 기존 4칸 그대로 …
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
    </div>
  );
}
```

- [ ] **Step 2: `CampaignDetail.tsx` 연결**

`DetailState`에 `budget: CampaignMonthBudget | null` 추가(import `type CampaignMonthBudget` from `@/lib/clientBudget`). `load()`의 구조분해에 `budget` 추가:

```ts
      const { campaign, drafts, costRows, today, budget } = r.data;
      setData({ campaign, drafts, costRows, today, budget });
```

호출부:

```tsx
          <SummaryCards summary={summary} perf={perf} total={total} budget={data.budget} clientId={data.campaign.clientId} />
```

낙관적 갱신으로 `data.drafts`가 바뀌면 `total`이 다시 계산되어 잔액 칸도 따라 움직인다(추가 코드 없음).

- [ ] **Step 3: 타입·린트·빌드**

Run: `npx tsc --noEmit 2>&1 | head; npm run lint 2>&1 | tail -3; npm run build 2>&1 | tail -3`
Expected: 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/campaigns/SummaryCards.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(budget): 캠페인 요약에 'N월 예산 잔액' 칸 — 같은 달 캠페인 전체 기준, 비용 고치면 즉시 반영, 미설정은 클라이언트 설정 링크

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 업데이트 소식 + 전체 검증

**Files:**
- Modify: `src/content/updates.ts` (맨 위에 항목 추가)

- [ ] **Step 1: 항목 추가** (`UPDATES` 배열 첫 원소로)

```ts
  {
    date: '2026-08-28',
    type: '새 기능',
    title: '클라이언트마다 월 마케팅 예산을 정하고 캠페인 비용과 대조할 수 있어요',
    summary: '클라이언트 화면에 "월 마케팅 예산" 패널이 생겼어요. 기본 월 예산을 한 번 적어두면 매달 그 금액으로 대조하고, 특정 달만 다르면 표에서 그 달만 고칠 수 있어요. 캠페인 화면 요약에는 그 달 예산이 얼마나 남았는지가 함께 나와요.',
    bullets: [
      '클라이언트 상세 맨 아래 패널에서 기본 월 예산을 입력해요. 아래 표는 달마다 예산 · 집행 · 잔액을 보여주고, 예산 칸을 눌러 그 달만 다른 금액으로 바꾸거나 "기본값으로 되돌리기"를 할 수 있어요',
      '캠페인 상세의 요약에 "N월 예산 잔액" 칸이 생겼어요 — 같은 클라이언트가 그 달에 시작한 캠페인 비용을 전부 합쳐 계산해요. 예산을 넘으면 빨갛게 표시만 하고 막지는 않아요',
      '캠페인 비용은 캠페인이 시작한 달에 잡혀요(기간이 다음 달로 이어져도 시작 달 하나에만). 캠페인에 넣지 않은 콘텐츠의 비용은 예산 집계에 들어가지 않아요',
      '엔화 비용은 1엔 = 10원으로 환산해서 원화 예산과 대조해요 — 참고 환산이에요',
    ],
    link: { label: '클라이언트', href: '/clients' },
  },
```

- [ ] **Step 2: 업데이트 형식 테스트 + 전체 검증**

Run: `node --import tsx --test src/lib/updates.test.ts 2>&1 | tail -3` — Expected: `# fail 0`
Run: `node --import tsx --test src/lib/clientBudget.test.ts 2>&1 | tail -3` — Expected: `# pass 11`
Run: `npm test 2>&1 | grep -E "^# (pass|fail)"` (실 DB, ~4분) — Expected: `# fail 0`
Run: `npx tsc --noEmit && npm run lint 2>&1 | tail -2 && npm run build 2>&1 | tail -3`

- [ ] **Step 3: 커밋**

```bash
git add src/content/updates.ts
git commit -m "docs(updates): 클라이언트 월 마케팅 예산 소식

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 자체 검토

- **스펙 커버리지**: §3 컬럼(T1) · §4 함수 전부(T2; `budgetJudgment`는 (budget, remaining) 인자로, `MonthRow`에 있는 값을 넘긴다) · §5-1(T1) · §5-2(T3) · §5-3 라우트 4개(T4; 캠페인 상세 응답은 T3) · §6-1 패널(T5: 기본 입력·표·인라인 편집·되돌리기·엔화 보조줄·미설정 문구·로딩/오류) · §6-2 5칸(T6: 미설정 링크, 클라 없으면 4칸) · §7 경계(스토어·순수 테스트) · §10 소식(T7).
- **스펙과 다른 점 1**: §5-3의 캠페인 상세 `budget` 필드는 `spentKrw`가 아니라 `othersKrw`(다른 캠페인 몫)로 내린다 — 비용 셀을 고쳤을 때 잔액 칸이 즉시 따라 움직이게 하기 위함(UX 원칙 4). 스펙 §5-3에 이 변경을 반영해 둘 것(구현 시작 시 한 줄 수정).
- **스펙과 다른 점 2**: §6-1 "예산 셀 클릭 → 팝오버"를 행 인라인 편집으로 구현(같은 기능, 포털 없이).
- **타입 일관성**: `BudgetClient`(T1 정의, T2·T3 사용) · `MonthSpend`(T2 정의, T3 `spendByMonth` 반환) · `CampaignMonthBudget`(T2 정의, T3 `CampaignDetail.budget`, T6 prop) · `MonthRow`(T2 정의, T4 GET 응답, T5 표) · `Register`(T5에서 export 후 BudgetPanel import).
- **플레이스홀더**: 없음. T6 "… 기존 4칸 그대로 …"는 기존 코드를 유지한다는 뜻이며 새 코드가 아니다.
