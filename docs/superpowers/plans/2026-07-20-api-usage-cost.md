# API 사용량·비용 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cb-x-deck가 호출하는 외부 API(getxapi/Exa/Anthropic)의 사용량을 기록하고, `/usage` 페이지에서 API별·기능별·일별로 집계해 추정 비용(USD)을 보여준다.

**Architecture:** 각 API 클라이언트/호출부에 fire-and-forget 계측 훅을 심어 `api_usage` 테이블에 호출 이벤트를 쌓는다. `/usage` 서버 컴포넌트가 이 테이블을 집계하고, 저장된 수량에 현재 단가를 곱해 조회 시점에 비용을 계산한다(단가 수정 시 과거분 자동 재환산).

**Tech Stack:** Next.js 16(App Router, 서버 컴포넌트), postgres(3.x), TypeScript, node:test, Tailwind v4.

## Global Constraints

- 기록은 실제 API 동작을 절대 막지 않는다: 계측은 `await` 하지 않는 fire-and-forget이며 예외를 삼킨다.
- `process.env.PGHOST`가 없으면 기록은 no-op(테스트/로컬에서 DB 접속 없음).
- 기존 클라이언트 테스트는 계측 훅을 주입하지 않으므로 그대로 통과해야 한다(계측 훅은 `makeClient`/`makeExaClient`/`callLLM`에서만 배선).
- 단가는 공식 실단가(2026-07-20 확인), env 오버라이드 가능, 출처·확인일을 주석에 남긴다: Anthropic `claude-haiku-4-5` = 입력 $1 / 출력 $5 per 1M 토큰; getxapi = $0.001/콜; Exa = $0.007/검색.
- 화폐는 USD 표기. 원화 병기는 이번 범위 아님(구조 자리만).
- DB 마이그레이션은 `migrations/NNN_*.sql`, 적용은 `npm run migrate`.
- 테스트 실행: `npm test` (node:test, `--test-concurrency=1`).
- 파일은 `.ts` 상대 import에 확장자를 붙인다(기존 관례: `./suggest.ts`).

## File Structure

- Create `src/lib/usagePricing.ts` — 단가 상수 + `rowCostUsd(AggRow)` + `formatMoney`.
- Create `src/lib/usageFeatures.ts` — `featureLabel(operation)` + `apiLabel(api)`.
- Create `src/lib/usageStore.ts` — `recordUsageSafe`, 타입(`UsageEvent`/`AggRow`), 집계 쿼리(`rawAggregate`/`dailyAggregate`), 순수 reshape(`summarizeByApi`/`summarizeByFeature`/`summarizeByDay`/`totalCostUsd`).
- Create `src/lib/llm.ts` — `AnthropicLike`/`LLMResponse` 타입 + `callLLM(operation, params, client?)`.
- Create `migrations/009_api_usage.sql`.
- Create `src/app/usage/page.tsx` — `/usage` 서버 컴포넌트.
- Create `src/app/usage/UsageBar.tsx` — 일별 추이 인라인 막대(서버 컴포넌트).
- Modify `src/lib/getxapi.ts` — `onUsage` 콜백 + `makeClient` 배선.
- Modify `src/lib/exa.ts` — `onUsage` 콜백 + `makeExaClient` 배선.
- Modify `src/lib/suggest.ts` — `AnthropicLike`를 `llm.ts`에서 re-export, 3개 호출부를 `callLLM`으로.
- Modify `src/lib/research.ts`, `src/lib/pillar.ts`, `src/lib/briefing.ts` — 호출부를 `callLLM`으로.
- Modify `src/components/Sidebar.tsx` — "API 사용량" 링크 추가.
- Create tests: `usagePricing.test.ts`, `usageFeatures.test.ts`, `usageStore.test.ts`, and extend `getxapi.test.ts` / `exa.test.ts`.

---

### Task 1: 단가 모듈 (usagePricing)

**Files:**
- Create: `src/lib/usagePricing.ts`
- Test: `src/lib/usagePricing.test.ts`

**Interfaces:**
- Consumes: `AggRow` (Task 3에서 최종 정의되지만, 이 파일은 구조 타입만 참조 — 아래 로컬 `interface AggRow`로 자립).
- Produces: `rowCostUsd(row: AggRow): number`, `formatMoney(usd: number): string`, 상수 `GETXAPI_PER_CALL`, `EXA_PER_SEARCH`, `ANTHROPIC_PRICES`.

> 참고: `AggRow`의 정본은 Task 3의 `usageStore.ts`가 export한다. 순환을 피하려고 이 파일은 타입만 로컬 선언한다(구조가 동일하면 호환). Task 3에서 `usageStore`가 `rowCostUsd(row as AggRow)`로 넘길 때 구조 호환된다.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/usagePricing.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowCostUsd, formatMoney } from './usagePricing.ts';

test('getxapi: 콜당 $0.001', () => {
  assert.equal(rowCostUsd({ api: 'getxapi', operation: 'getxapi.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 }), 1);
});

test('exa: 검색당 $0.007', () => {
  assert.equal(rowCostUsd({ api: 'exa', operation: 'exa.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 }), 7);
});

test('anthropic haiku: 입력 $1/출력 $5 per 1M', () => {
  const c = rowCostUsd({ api: 'anthropic', operation: 'anthropic.suggest', model: 'claude-haiku-4-5-20251001', calls: 1, inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(c, 6); // 1*1 + 1*5
});

test('anthropic 모델 미상/누락이면 haiku 단가로 폴백', () => {
  const c = rowCostUsd({ api: 'anthropic', operation: 'anthropic.suggest', model: null, calls: 1, inputTokens: 2_000_000, outputTokens: 0 });
  assert.equal(c, 2);
});

test('formatMoney: 1달러 미만은 4자리, 이상은 2자리', () => {
  assert.equal(formatMoney(0.007), '$0.0070');
  assert.equal(formatMoney(12.5), '$12.50');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/lib/usagePricing.test.ts` (또는 `npm test`)
Expected: FAIL — `Cannot find module './usagePricing.ts'`

- [ ] **Step 3: 구현 작성**

`src/lib/usagePricing.ts`:
```ts
// API 단가 (공식, 2026-07-20 확인). USD.
// - Anthropic: platform.claude.com 모델 가격표 (per 1M tokens)
// - getxapi: getxapi.com/pricing — 표준 read 콜 $0.001/콜 (앱은 프리미엄 미사용)
// - Exa: exa.ai/pricing — 검색 $0.007/콜($7/1k). 본문(contents)은 상위 10개까지 무료이고
//   앱은 numResults:8이라 본문비 없음. numResults를 11+로 올리면 본문비 $1/1k 추가됨.
export const GETXAPI_PER_CALL = Number(process.env.PRICE_GETXAPI_PER_CALL ?? 0.001);
export const EXA_PER_SEARCH = Number(process.env.PRICE_EXA_PER_SEARCH ?? 0.007);

export const ANTHROPIC_PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
};
const DEFAULT_ANTHROPIC = ANTHROPIC_PRICES['claude-haiku-4-5']; // 앱 기본 모델

interface AggRow {
  api: string; operation: string; model: string | null;
  calls: number; inputTokens: number; outputTokens: number;
}

function anthropicPrice(model: string | null): { in: number; out: number } {
  if (!model) return DEFAULT_ANTHROPIC;
  const key = Object.keys(ANTHROPIC_PRICES).find((k) => model.startsWith(k));
  return key ? ANTHROPIC_PRICES[key] : DEFAULT_ANTHROPIC;
}

export function rowCostUsd(row: AggRow): number {
  if (row.api === 'anthropic') {
    const p = anthropicPrice(row.model);
    return (row.inputTokens / 1e6) * p.in + (row.outputTokens / 1e6) * p.out;
  }
  if (row.api === 'getxapi') return row.calls * GETXAPI_PER_CALL;
  if (row.api === 'exa') return row.calls * EXA_PER_SEARCH;
  return 0;
}

export function formatMoney(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (usagePricing 5건)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/usagePricing.ts src/lib/usagePricing.test.ts
git commit -m "feat(x-research): API 단가 모듈(usagePricing) — 공식 실단가·조회시 비용계산"
```

---

### Task 2: 기능 라벨 매핑 (usageFeatures)

**Files:**
- Create: `src/lib/usageFeatures.ts`
- Test: `src/lib/usageFeatures.test.ts`

**Interfaces:**
- Produces: `featureLabel(operation: string): string`, `apiLabel(api: string): string`.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/usageFeatures.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureLabel, apiLabel } from './usageFeatures.ts';

test('operation → 기능 라벨', () => {
  assert.equal(featureLabel('getxapi.search'), '트윗 검색');
  assert.equal(featureLabel('getxapi.thread'), '트윗 확장 탐색');
  assert.equal(featureLabel('exa.search'), '웹 기사 검색');
  assert.equal(featureLabel('anthropic.suggest'), '키워드 추천');
  assert.equal(featureLabel('anthropic.translateTags'), '번역');
  assert.equal(featureLabel('anthropic.briefing'), '브리핑 생성');
});

test('미지 operation은 원문 폴백', () => {
  assert.equal(featureLabel('getxapi.unknown'), 'getxapi.unknown');
});

test('apiLabel', () => {
  assert.equal(apiLabel('getxapi'), 'getxapi (X 데이터)');
  assert.equal(apiLabel('exa'), 'Exa (웹 검색)');
  assert.equal(apiLabel('anthropic'), 'Anthropic (AI)');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './usageFeatures.ts'`

- [ ] **Step 3: 구현 작성**

`src/lib/usageFeatures.ts`:
```ts
const FEATURE: Record<string, string> = {
  'getxapi.search': '트윗 검색',
  'getxapi.userTweets': '워치리스트 갱신',
  'getxapi.userInfo': '계정 조회',
  'getxapi.tweetDetail': '인용 트윗 보강',
  'getxapi.replies': '트윗 확장 탐색',
  'getxapi.thread': '트윗 확장 탐색',
  'getxapi.retweeters': '트윗 확장 탐색',
  'exa.search': '웹 기사 검색',
  'anthropic.suggest': '키워드 추천',
  'anthropic.translateKeyword': '번역',
  'anthropic.translateTags': '번역',
  'anthropic.briefing': '브리핑 생성',
  'anthropic.pillar': '기둥 분석',
  'anthropic.research': '리서치 요약',
};

export function featureLabel(operation: string): string {
  return FEATURE[operation] ?? operation;
}

const API: Record<string, string> = {
  getxapi: 'getxapi (X 데이터)',
  exa: 'Exa (웹 검색)',
  anthropic: 'Anthropic (AI)',
};

export function apiLabel(api: string): string {
  return API[api] ?? api;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/usageFeatures.ts src/lib/usageFeatures.test.ts
git commit -m "feat(x-research): operation→기능 라벨 매핑(usageFeatures)"
```

---

### Task 3: DB 스키마 + 기록/집계 스토어 (usageStore)

**Files:**
- Create: `migrations/009_api_usage.sql`
- Create: `src/lib/usageStore.ts`
- Test: `src/lib/usageStore.test.ts`

**Interfaces:**
- Consumes: `getSql` from `./db.ts`; `rowCostUsd` from `./usagePricing.ts`; `featureLabel`, `apiLabel` from `./usageFeatures.ts`.
- Produces:
  - `interface UsageEvent { api: string; operation: string; ok?: boolean; httpStatus?: number | null; model?: string | null; inputTokens?: number | null; outputTokens?: number | null; units?: number }`
  - `interface AggRow { api: string; operation: string; model: string | null; calls: number; inputTokens: number; outputTokens: number }`
  - `recordUsageSafe(ev: UsageEvent): void`
  - `rawAggregate(sql, from: Date, to: Date): Promise<AggRow[]>`
  - `dailyAggregate(sql, from: Date, to: Date): Promise<Array<AggRow & { day: string }>>`
  - `summarizeByApi(rows: AggRow[]): Array<{ api: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>`
  - `summarizeByFeature(rows: AggRow[]): Array<{ feature: string; calls: number; costUsd: number }>`
  - `summarizeByDay(rows: Array<AggRow & { day: string }>): Array<{ day: string; costUsd: number }>`
  - `totalCostUsd(rows: AggRow[]): number`

- [ ] **Step 1: 마이그레이션 작성**

`migrations/009_api_usage.sql`:
```sql
-- 외부 API 호출 사용량 기록. 비용은 저장하지 않고 조회 시 단가로 계산.
create table if not exists api_usage (
  id uuid primary key default gen_random_uuid(),
  api text not null,             -- getxapi | exa | anthropic
  operation text not null,       -- getxapi.search, anthropic.suggest, ...
  ok boolean not null default true,
  http_status int,
  model text,                    -- anthropic만
  input_tokens int,              -- anthropic만
  output_tokens int,             -- anthropic만
  units int not null default 1,  -- 요청/검색 수
  created_at timestamptz not null default now()
);
create index if not exists api_usage_created_at_idx on api_usage (created_at);
create index if not exists api_usage_api_idx on api_usage (api);
```

- [ ] **Step 2: 실패 테스트 작성 (순수 함수 + no-op 가드)**

`src/lib/usageStore.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordUsageSafe, summarizeByApi, summarizeByFeature, summarizeByDay, totalCostUsd, type AggRow } from './usageStore.ts';

const rows: AggRow[] = [
  { api: 'getxapi', operation: 'getxapi.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
  { api: 'getxapi', operation: 'getxapi.thread', model: null, calls: 500, inputTokens: 0, outputTokens: 0 },
  { api: 'exa', operation: 'exa.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
  { api: 'anthropic', operation: 'anthropic.suggest', model: 'claude-haiku-4-5', calls: 1, inputTokens: 1_000_000, outputTokens: 0 },
];

test('recordUsageSafe: PGHOST 없으면 예외 없이 no-op', () => {
  const prev = process.env.PGHOST;
  delete process.env.PGHOST;
  try {
    assert.doesNotThrow(() => recordUsageSafe({ api: 'getxapi', operation: 'getxapi.search' }));
  } finally {
    if (prev !== undefined) process.env.PGHOST = prev;
  }
});

test('summarizeByApi: API별 호출수·비용', () => {
  const out = summarizeByApi(rows);
  const gx = out.find((r) => r.api === 'getxapi')!;
  assert.equal(gx.calls, 1500);
  assert.equal(gx.costUsd, 1.5); // 1500 * 0.001
  const an = out.find((r) => r.api === 'anthropic')!;
  assert.equal(an.costUsd, 1); // 1M in * $1
});

test('summarizeByFeature: 같은 기능 라벨은 합산', () => {
  const out = summarizeByFeature(rows);
  const search = out.find((r) => r.feature === '트윗 검색')!;
  assert.equal(search.calls, 1000);
  // getxapi.thread → '트윗 확장 탐색' 로 별도 집계
  assert.ok(out.some((r) => r.feature === '트윗 확장 탐색' && r.calls === 500));
});

test('summarizeByDay: 일별 비용 합', () => {
  const daily = [
    { day: '2026-07-19', api: 'getxapi', operation: 'getxapi.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-07-19', api: 'exa', operation: 'exa.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-07-20', api: 'getxapi', operation: 'getxapi.search', model: null, calls: 2000, inputTokens: 0, outputTokens: 0 },
  ];
  const out = summarizeByDay(daily);
  assert.deepEqual(out, [
    { day: '2026-07-19', costUsd: 8 }, // 1 + 7
    { day: '2026-07-20', costUsd: 2 },
  ]);
});

test('totalCostUsd', () => {
  assert.equal(totalCostUsd(rows), 1.5 + 7 + 1);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module './usageStore.ts'`

- [ ] **Step 4: 구현 작성**

`src/lib/usageStore.ts`:
```ts
import type postgres from 'postgres';
import { getSql } from './db.ts';
import { rowCostUsd } from './usagePricing.ts';
import { featureLabel, apiLabel } from './usageFeatures.ts';

export interface UsageEvent {
  api: string;
  operation: string;
  ok?: boolean;
  httpStatus?: number | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  units?: number;
}

export interface AggRow {
  api: string;
  operation: string;
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

// 기록은 실제 API 동작을 막지 않는다: await 하지 않고, 실패는 삼키며, PGHOST 없으면 no-op.
export function recordUsageSafe(ev: UsageEvent): void {
  if (!process.env.PGHOST) return;
  void (async () => {
    try {
      const sql = getSql();
      await sql`
        insert into api_usage (api, operation, ok, http_status, model, input_tokens, output_tokens, units)
        values (${ev.api}, ${ev.operation}, ${ev.ok ?? true}, ${ev.httpStatus ?? null}, ${ev.model ?? null},
                ${ev.inputTokens ?? null}, ${ev.outputTokens ?? null}, ${ev.units ?? 1})`;
    } catch {
      // 기록 실패는 무해 — 사용량 통계는 부가 기능이며 본 기능을 막지 않는다
    }
  })();
}

export async function rawAggregate(sql: postgres.Sql, from: Date, to: Date): Promise<AggRow[]> {
  const rows = await sql<Array<{ api: string; operation: string; model: string | null; calls: number; input_tokens: number; output_tokens: number }>>`
    select api, operation, model,
           count(*)::int as calls,
           coalesce(sum(input_tokens), 0)::int as input_tokens,
           coalesce(sum(output_tokens), 0)::int as output_tokens
      from api_usage
     where ok = true and created_at >= ${from} and created_at < ${to}
     group by api, operation, model`;
  return rows.map((r) => ({
    api: r.api, operation: r.operation, model: r.model,
    calls: r.calls, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
  }));
}

export async function dailyAggregate(sql: postgres.Sql, from: Date, to: Date): Promise<Array<AggRow & { day: string }>> {
  const rows = await sql<Array<{ day: string; api: string; model: string | null; calls: number; input_tokens: number; output_tokens: number }>>`
    select to_char(date_trunc('day', created_at at time zone 'Asia/Tokyo'), 'YYYY-MM-DD') as day,
           api, model,
           count(*)::int as calls,
           coalesce(sum(input_tokens), 0)::int as input_tokens,
           coalesce(sum(output_tokens), 0)::int as output_tokens
      from api_usage
     where ok = true and created_at >= ${from} and created_at < ${to}
     group by day, api, model
     order by day`;
  return rows.map((r) => ({
    day: r.day, api: r.api, operation: '', model: r.model,
    calls: r.calls, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
  }));
}

// --- 순수 reshape (DB 불필요, 단위테스트 대상) ---

export function summarizeByApi(rows: AggRow[]) {
  const m = new Map<string, { api: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const r of rows) {
    const e = m.get(r.api) ?? { api: r.api, label: apiLabel(r.api), calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    e.calls += r.calls;
    e.inputTokens += r.inputTokens;
    e.outputTokens += r.outputTokens;
    e.costUsd += rowCostUsd(r);
    m.set(r.api, e);
  }
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function summarizeByFeature(rows: AggRow[]) {
  const m = new Map<string, { feature: string; calls: number; costUsd: number }>();
  for (const r of rows) {
    const f = featureLabel(r.operation);
    const e = m.get(f) ?? { feature: f, calls: 0, costUsd: 0 };
    e.calls += r.calls;
    e.costUsd += rowCostUsd(r);
    m.set(f, e);
  }
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function summarizeByDay(rows: Array<AggRow & { day: string }>) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + rowCostUsd(r));
  return [...m.entries()].map(([day, costUsd]) => ({ day, costUsd })).sort((a, b) => a.day.localeCompare(b.day));
}

export function totalCostUsd(rows: AggRow[]): number {
  return rows.reduce((s, r) => s + rowCostUsd(r), 0);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (usageStore 5건)

- [ ] **Step 6: 마이그레이션 적용 (DB 접속 가능 시)**

Run: `npm run migrate`
Expected: `009_api_usage.sql` 적용 성공. (로컬 DB 미구성 시 이 스텝은 배포 환경에서 수행 — 커밋은 진행.)

- [ ] **Step 7: 커밋**

```bash
git add migrations/009_api_usage.sql src/lib/usageStore.ts src/lib/usageStore.test.ts
git commit -m "feat(x-research): api_usage 테이블 + 기록/집계 스토어(usageStore)"
```

---

### Task 4: getxapi 계측

**Files:**
- Modify: `src/lib/getxapi.ts`
- Test: `src/lib/getxapi.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: `recordUsageSafe` from `./usageStore.ts`.
- Produces: `GetxapiClientOptions.onUsage?: (ev: { operation: string; ok: boolean; status: number }) => void`; `makeClient()`가 `onUsage`를 `recordUsageSafe`에 배선.

- [ ] **Step 1: 실패 테스트 작성 (기존 getxapi.test.ts 하단에 추가)**

```ts
test('onUsage: 성공 호출마다 operation과 함께 콜백', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { has_more: false, next_cursor: null, tweets: [] } }]);
  const events: Array<{ operation: string; ok: boolean; status: number }> = [];
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {}, onUsage: (e) => events.push(e) });
  await c.searchTweets('a');
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'getxapi.search');
  assert.equal(events[0].ok, true);
});

test('onUsage: userInfo operation 파생', async () => {
  const { fn } = fakeFetch([{ status: 200, body: { data: { id: '1', userName: 'x' } } }]);
  const events: Array<{ operation: string }> = [];
  const c = new GetxapiClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {}, onUsage: (e) => events.push(e) });
  await c.getUserInfo('x');
  assert.equal(events[0].operation, 'getxapi.userInfo');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `onUsage` 옵션이 타입에 없음 / 콜백 미호출로 `events.length` 0

- [ ] **Step 3: 구현 — 옵션 타입에 onUsage 추가**

`src/lib/getxapi.ts`의 `GetxapiClientOptions`에 추가:
```ts
export interface GetxapiClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onUsage?: (ev: { operation: string; ok: boolean; status: number }) => void;
}
```

- [ ] **Step 4: 구현 — operation 파생 + get() 성공 시 콜백**

클래스에 정적 메서드 추가:
```ts
  private static opFromPath(path: string): string {
    const p = path.split('?')[0];
    if (p.endsWith('/advanced_search')) return 'getxapi.search';
    if (p.endsWith('/user/tweets')) return 'getxapi.userTweets';
    if (p.endsWith('/user/info')) return 'getxapi.userInfo';
    if (p.endsWith('/tweet/detail')) return 'getxapi.tweetDetail';
    if (p.endsWith('/tweet/replies')) return 'getxapi.replies';
    if (p.endsWith('/tweet/thread')) return 'getxapi.thread';
    if (p.endsWith('/tweet/retweeters')) return 'getxapi.retweeters';
    return 'getxapi.other';
  }
```
`get<T>()`의 성공 반환 직전(`return (await res.json()) as T;` 바로 위)에 삽입:
```ts
      this.opts.onUsage?.({ operation: GetxapiClient.opFromPath(path), ok: true, status: res.status });
      return (await res.json()) as T;
```

- [ ] **Step 5: 구현 — makeClient 배선**

`makeClient()`를 교체:
```ts
export function makeClient(): GetxapiClient {
  const apiKey = process.env.GETXAPI_KEY;
  if (!apiKey) throw new Error('GETXAPI_KEY not set');
  return new GetxapiClient({
    apiKey,
    onUsage: (ev) => recordUsageSafe({ api: 'getxapi', operation: ev.operation, ok: ev.ok, httpStatus: ev.status, units: 1 }),
  });
}
```
파일 상단에 import 추가:
```ts
import { recordUsageSafe } from './usageStore.ts';
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 신규 2건 + 기존 getxapi 테스트 전부 통과(기존 테스트는 `onUsage` 미주입이라 영향 없음)

- [ ] **Step 7: 커밋**

```bash
git add src/lib/getxapi.ts src/lib/getxapi.test.ts
git commit -m "feat(x-research): getxapi 호출 계측(onUsage) + makeClient 배선"
```

---

### Task 5: Exa 계측

**Files:**
- Modify: `src/lib/exa.ts`
- Test: `src/lib/exa.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: `recordUsageSafe` from `./usageStore.ts`.
- Produces: `ExaClientOptions.onUsage?: (ev: { operation: string; ok: boolean; status: number }) => void`; `makeExaClient()`가 배선.

- [ ] **Step 1: 실패 테스트 작성 (기존 exa.test.ts 하단에 추가)**

> 기존 `exa.test.ts`의 fake fetch 헬퍼 이름을 그대로 재사용한다. 아래는 인라인 fetch로 자립하게 작성:
```ts
test('onUsage: search 성공 시 exa.search 콜백', async () => {
  const fn = (async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch;
  const events: Array<{ operation: string; ok: boolean; status: number }> = [];
  const c = new ExaClient({ apiKey: 'k', fetchImpl: fn, sleep: async () => {}, onUsage: (e) => events.push(e) });
  await c.search('hello');
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, 'exa.search');
});
```
(파일 상단 import에 `ExaClient`가 없으면 추가: `import { ExaClient } from './exa.ts';`)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `onUsage` 미지원

- [ ] **Step 3: 구현 — 옵션 타입 + post() 콜백**

`ExaClientOptions`에 추가:
```ts
  onUsage?: (ev: { operation: string; ok: boolean; status: number }) => void;
```
`post<T>()`의 성공 반환 직전(`return (await res.json()) as T;` 위)에 삽입:
```ts
      this.opts.onUsage?.({ operation: 'exa.search', ok: true, status: res.status });
      return (await res.json()) as T;
```
(exa는 `/search` 단일 엔드포인트이므로 operation 고정.)

- [ ] **Step 4: 구현 — makeExaClient 배선 + import**

파일 상단:
```ts
import { recordUsageSafe } from './usageStore.ts';
```
`makeExaClient()` 교체:
```ts
export function makeExaClient(): ExaClient {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error('EXA_API_KEY not set');
  return new ExaClient({
    apiKey,
    onUsage: (ev) => recordUsageSafe({ api: 'exa', operation: ev.operation, ok: ev.ok, httpStatus: ev.status, units: 1 }),
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 신규 1건 + 기존 exa 테스트 통과

- [ ] **Step 6: 커밋**

```bash
git add src/lib/exa.ts src/lib/exa.test.ts
git commit -m "feat(x-research): Exa 호출 계측(onUsage) + makeExaClient 배선"
```

---

### Task 6: Anthropic 계측 (llm.ts + 호출부 통일)

**Files:**
- Create: `src/lib/llm.ts`
- Modify: `src/lib/suggest.ts`, `src/lib/research.ts`, `src/lib/pillar.ts`, `src/lib/briefing.ts`

**Interfaces:**
- Consumes: `recordUsageSafe` from `./usageStore.ts`.
- Produces:
  - `interface LLMResponse { content: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }`
  - `interface AnthropicLike { messages: { create(p: object): Promise<LLMResponse> } }`
  - `callLLM(operation: string, params: { model: string; max_tokens: number; messages: object[] }, client?: AnthropicLike): Promise<LLMResponse>`
- 하위 호환: `suggest.ts`가 `AnthropicLike`를 re-export 하므로 `research/pillar/briefing`의 기존 import(`type AnthropicLike from './suggest.ts'`)는 그대로 유효.

- [ ] **Step 1: llm.ts 작성**

`src/lib/llm.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { recordUsageSafe } from './usageStore.ts';

export interface LLMResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicLike {
  messages: { create(p: object): Promise<LLMResponse> };
}

// 모든 Anthropic 호출의 단일 통로. 응답 usage(토큰)를 fire-and-forget으로 기록.
export async function callLLM(
  operation: string,
  params: { model: string; max_tokens: number; messages: object[] },
  client?: AnthropicLike,
): Promise<LLMResponse> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const res = await c.messages.create(params);
  recordUsageSafe({
    api: 'anthropic',
    operation,
    model: params.model,
    inputTokens: res.usage?.input_tokens ?? null,
    outputTokens: res.usage?.output_tokens ?? null,
    units: 1,
  });
  return res;
}
```

- [ ] **Step 2: suggest.ts — AnthropicLike를 llm.ts 것으로 교체·re-export**

`src/lib/suggest.ts` 상단의 기존 정의
```ts
export interface AnthropicLike {
  messages: { create(p: object): Promise<{ content: Array<{ type: string; text?: string }> }> };
}
```
를 삭제하고, `import Anthropic from '@anthropic-ai/sdk';` 아래에:
```ts
import { callLLM, type AnthropicLike } from './llm.ts';
export type { AnthropicLike };
```
`import Anthropic from '@anthropic-ai/sdk';`는 suggest 내부에서 더 이상 직접 `new Anthropic()`을 쓰지 않으면 제거한다(아래 Step 3에서 세 곳 모두 callLLM으로 교체하므로 제거 대상).

- [ ] **Step 3: suggest.ts — 3개 호출부를 callLLM으로**

`suggestKeywords`:
```ts
export async function suggestKeywords(
  keyword: string,
  client?: AnthropicLike,
): Promise<{ variants: KwPair[]; adjacent: KwPair[] }> {
  const res = await callLLM('anthropic.suggest',
    { model: MODEL(), max_tokens: 800, messages: [{ role: 'user', content: PROMPT(keyword) }] }, client);
  const j = extractJson(res) as { variants?: unknown; adjacent?: unknown } | null;
  if (!j) return { variants: [], adjacent: [] };
  return { variants: pairs(j.variants), adjacent: pairs(j.adjacent) };
}
```
`translateKeyword`:
```ts
export async function translateKeyword(
  keyword: string,
  client?: AnthropicLike,
): Promise<KwPair | null> {
  const res = await callLLM('anthropic.translateKeyword',
    { model: MODEL(), max_tokens: 200, messages: [{ role: 'user', content: TRANSLATE_PROMPT(keyword) }] }, client);
  const j = extractJson(res) as { ja?: unknown; ko?: unknown } | null;
  if (!j || typeof j.ja !== 'string' || j.ja.length === 0) return null;
  return { ja: j.ja, ko: typeof j.ko === 'string' && j.ko ? j.ko : keyword };
}
```
`translateTags`:
```ts
export async function translateTags(
  tags: string[],
  client?: AnthropicLike,
): Promise<Record<string, string>> {
  if (tags.length === 0) return {};
  const res = await callLLM('anthropic.translateTags',
    { model: MODEL(), max_tokens: 600, messages: [{ role: 'user', content: TAGS_PROMPT(tags) }] }, client);
  const j = extractJson(res);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: research.ts — callLLM으로**

`src/lib/research.ts`의 import 교체:
```ts
import { extractJson, pairs, MODEL } from './suggest.ts';
import { callLLM, type AnthropicLike } from './llm.ts';
import type { KwPair } from './suggest.ts';
```
> 주의: `research.ts`는 로컬 `const MODEL = () => ...`를 정의하고 있다. `suggest.ts`가 `MODEL`을 export하므로 로컬 정의를 삭제하고 위 import의 `MODEL`을 쓴다(중복 제거, DRY). 프롬프트 문자열/`EXTRACT_PROMPT`는 그대로 둔다.

`extractKeywords`:
```ts
export async function extractKeywords(
  article: { title: string; text: string },
  client?: AnthropicLike,
): Promise<ExtractedKeywords> {
  const res = await callLLM('anthropic.research',
    { model: MODEL(), max_tokens: 1000, messages: [{ role: 'user', content: EXTRACT_PROMPT(article.title, article.text) }] }, client);
  const json = extractJson(res);
  if (!json || typeof json !== 'object') return { keywords: [], hooks: [] };
  const o = json as Record<string, unknown>;
  return { keywords: pairs(o.keywords), hooks: pairs(o.hooks) };
}
```
그리고 `import Anthropic from '@anthropic-ai/sdk';` 제거.

- [ ] **Step 5: pillar.ts — 두 호출부를 callLLM으로**

`src/lib/pillar.ts` import에 추가: `import { callLLM } from './llm.ts';` (기존 `import { extractJson, MODEL, type AnthropicLike } from './suggest.ts';`는 유지 — AnthropicLike는 suggest가 re-export). `import Anthropic ...`가 pillar에서 다른 데 안 쓰이면 제거.

`deriveTopics` 내부:
```ts
  const res = await callLLM('anthropic.pillar',
    { model: MODEL(), max_tokens: 4000, messages: [{ role: 'user', content: DERIVE_PROMPT(tweetLines(tweets), tweets.length) }] }, client);
```
(기존 `const c = client ?? (new Anthropic() ...); const res = await c.messages.create({...});` 를 위 한 줄로 대체.)

`classifyTweets` 내부:
```ts
  const res = await callLLM('anthropic.pillar',
    { model: MODEL(), max_tokens: 2000, messages: [{ role: 'user', content: CLASSIFY_PROMPT(topics, tweetLines(tweets)) }] }, client);
```

- [ ] **Step 6: briefing.ts — 호출부를 callLLM으로**

`src/lib/briefing.ts` import에 추가: `import { callLLM } from './llm.ts';`. `generateBriefing` 내부의
```ts
  const res = await c.messages.create({ model: MODEL(), max_tokens: 4500, messages: [{ role: 'user', content: PROMPT(...) }] });
```
를
```ts
  const res = await callLLM('anthropic.briefing',
    { model: MODEL(), max_tokens: 4500, messages: [{ role: 'user', content: PROMPT(input.columnTitle, input.stats, lines, input.comparison ?? null) }] }, client);
```
로 교체하고, 이제 안 쓰는 `const c = client ?? (new Anthropic() ...);` 줄과 `import Anthropic ...`(다른 용도 없으면) 제거.

- [ ] **Step 7: 전체 테스트 통과 확인**

Run: `npm test`
Expected: PASS — suggest/pillar/briefing/research 기존 테스트가 모두 통과(mock client는 `usage` 없이 `{content}`만 반환 → `callLLM`이 `res.usage?...` 로 안전 처리, PGHOST 없어 기록 no-op).

- [ ] **Step 8: 타입/린트 확인**

Run: `npm run lint`
Expected: 에러 없음(미사용 `Anthropic` import 제거 확인).

- [ ] **Step 9: 커밋**

```bash
git add src/lib/llm.ts src/lib/suggest.ts src/lib/research.ts src/lib/pillar.ts src/lib/briefing.ts
git commit -m "feat(x-research): Anthropic 호출 계측 — callLLM 공용 통로로 6개 호출부 통일"
```

---

### Task 7: `/usage` 페이지

**Files:**
- Create: `src/app/usage/page.tsx`
- Create: `src/app/usage/UsageBar.tsx`

**Interfaces:**
- Consumes: `getSql` from `@/lib/db`; `rawAggregate`, `dailyAggregate`, `summarizeByApi`, `summarizeByFeature`, `summarizeByDay`, `totalCostUsd` from `@/lib/usageStore`; `formatMoney` from `@/lib/usagePricing`.
- Produces: 라우트 `/usage`.

> UI는 단위테스트 대신 수동 검증(Step 4). 기존 페이지들의 Tailwind 토큰(`text-x-muted`, `bg-x-surface`, `border-x-border`, `text-caption` 등)을 그대로 사용한다.

- [ ] **Step 1: 기간 계산 + 페이지 작성**

`src/app/usage/page.tsx`:
```tsx
import { getSql } from '@/lib/db';
import {
  rawAggregate, dailyAggregate,
  summarizeByApi, summarizeByFeature, summarizeByDay, totalCostUsd,
} from '@/lib/usageStore';
import { formatMoney } from '@/lib/usagePricing';
import { UsageBar } from './UsageBar';

export const dynamic = 'force-dynamic';

type Period = '7d' | '30d' | 'month';

function range(period: Period): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === '7d') from.setDate(from.getDate() - 7);
  else if (period === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
  else from.setDate(from.getDate() - 30);
  return { from, to };
}

const PERIOD_LABEL: Record<Period, string> = { '7d': '최근 7일', '30d': '최근 30일', month: '이번 달' };

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const period: Period = sp.period === '7d' || sp.period === 'month' ? sp.period : '30d';
  const { from, to } = range(period);

  const sql = getSql();
  const rows = await rawAggregate(sql, from, to);
  const daily = await dailyAggregate(sql, from, to);

  const byApi = summarizeByApi(rows);
  const byFeature = summarizeByFeature(rows);
  const byDay = summarizeByDay(daily);
  const total = totalCostUsd(rows);
  const featTotal = byFeature.reduce((s, f) => s + f.costUsd, 0);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <header className="mb-6">
        <h1 className="text-lg font-bold text-x-text">API 사용량·비용</h1>
        <p className="mt-1 text-caption text-x-muted">
          외부 API 호출 기록을 집계한 <b>추정치</b>입니다. 기준 단가(2026-07-20 확인)로 환산했으며 실제 청구와 다를 수 있습니다.
        </p>
        <nav className="mt-3 flex gap-2">
          {(['7d', '30d', 'month'] as Period[]).map((p) => (
            <a key={p} href={`/usage?period=${p}`}
               className={`rounded-full border px-3 py-1 text-ui ${p === period ? 'border-x-blue text-x-blue' : 'border-x-border-strong text-x-secondary'}`}>
              {PERIOD_LABEL[p]}
            </a>
          ))}
        </nav>
      </header>

      {/* 요약 카드 */}
      <section className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-x-border bg-x-surface p-4">
          <p className="text-caption text-x-muted">{PERIOD_LABEL[period]} 총 추정비용</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-x-text">{formatMoney(total)}</p>
        </div>
        {byApi.map((a) => (
          <div key={a.api} className="rounded-lg border border-x-border bg-x-surface p-4">
            <p className="text-caption text-x-muted">{a.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-x-text">{formatMoney(a.costUsd)}</p>
            <p className="text-caption text-x-muted">{a.calls.toLocaleString()}회 호출</p>
          </div>
        ))}
      </section>

      {/* 일별 추이 */}
      <section className="mb-8">
        <h2 className="mb-2 text-ui font-bold text-x-text">일별 추이</h2>
        <UsageBar data={byDay} />
      </section>

      {/* 기능별 표 */}
      <section className="mb-8">
        <h2 className="mb-2 text-ui font-bold text-x-text">기능별</h2>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">기능</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">추정비용</th>
              <th className="py-1 text-right font-normal">비중</th>
            </tr>
          </thead>
          <tbody>
            {byFeature.map((f) => (
              <tr key={f.feature} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{f.feature}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{f.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(f.costUsd)}</td>
                <td className="py-1.5 text-right tabular-nums text-x-muted">{featTotal ? Math.round((f.costUsd / featTotal) * 100) : 0}%</td>
              </tr>
            ))}
            {byFeature.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-x-muted">이 기간에 기록된 호출이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* API별 표 */}
      <section>
        <h2 className="mb-2 text-ui font-bold text-x-text">API별</h2>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">API</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">토큰(입력/출력)</th>
              <th className="py-1 text-right font-normal">추정비용</th>
            </tr>
          </thead>
          <tbody>
            {byApi.map((a) => (
              <tr key={a.api} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{a.label}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{a.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-muted">
                  {a.api === 'anthropic' ? `${a.inputTokens.toLocaleString()} / ${a.outputTokens.toLocaleString()}` : '—'}
                </td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(a.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 일별 막대 컴포넌트 작성**

`src/app/usage/UsageBar.tsx`:
```tsx
import { formatMoney } from '@/lib/usagePricing';

export function UsageBar({ data }: { data: Array<{ day: string; costUsd: number }> }) {
  if (data.length === 0) return <p className="text-caption text-x-muted">데이터 없음</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((d) => (
        <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day} · ${formatMoney(d.costUsd)}`}>
          <div className="w-full rounded-t bg-x-blue/70" style={{ height: `${Math.max((d.costUsd / max) * 100, 2)}%` }} />
          <span className="mt-1 text-caption text-x-muted">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: `/usage` 라우트 포함, 타입 에러 없이 빌드 성공.

- [ ] **Step 4: 수동 검증 (DB 접속 가능 환경)**

Run: `npm run dev` 후 브라우저에서 `/usage` 접속.
Expected: 요약 카드·기간 토글·기능별/API별 표·일별 막대가 렌더된다. 기록이 없으면 "기록된 호출이 없습니다" 표시(에러 없음). 기간 토글 클릭 시 `?period=` 갱신.

- [ ] **Step 5: 커밋**

```bash
git add src/app/usage/page.tsx src/app/usage/UsageBar.tsx
git commit -m "feat(x-research): /usage 페이지 — API별·기능별·일별 사용량/추정비용"
```

---

### Task 8: 사이드바 링크

**Files:**
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: 없음(정적 링크).

- [ ] **Step 1: 멤버 섹션 위에 "API 사용량" 링크 추가**

`src/components/Sidebar.tsx`의 `<nav>` 블록(리서치/덱/브리핑/보관함) **바로 아래**, 멤버 섹션 `<div className="border-t border-x-border pt-2">` **직전**에 삽입:
```tsx
      <div className="mb-2 border-t border-x-border pt-2">
        <a href="/usage"
           className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === '/usage' ? 'text-x-text' : 'text-x-muted'}`}>
          API 사용량
        </a>
      </div>
```
(`pathname`은 이미 컴포넌트 상단에서 `usePathname()`로 확보되어 있음 — 추가 import 불필요.)

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공.

- [ ] **Step 3: 수동 검증**

Run: `npm run dev` 후 워크스페이스 화면 좌측 사이드바 하단에 "API 사용량" 링크 확인 → 클릭 시 `/usage` 이동.

- [ ] **Step 4: 커밋**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(x-research): 사이드바에 API 사용량 링크 추가"
```

---

## Self-Review 결과

- **스펙 커버리지:** 계측(getxapi/exa/anthropic) = Task 4/5/6; 스키마 = Task 3; 단가·조회시계산 = Task 1; operation→기능 = Task 2; 페이지(요약/API별/기능별/일별) = Task 7; 사이드바 = Task 8. 제공사 대조는 비목표(§9)로 계획에서 제외. 누락 없음.
- **플레이스홀더:** 모든 코드 스텝에 실제 코드 포함. TBD/TODO 없음.
- **타입 일관성:** `AggRow`(usageStore 정본, usagePricing은 구조 동일 로컬 선언), `UsageEvent`, `AnthropicLike`/`LLMResponse`(llm.ts 정본, suggest re-export), `onUsage` 이벤트 형태(`{operation, ok, status}`)를 getxapi/exa에서 동일하게 사용. `recordUsageSafe` 필드명이 스키마 컬럼과 매핑 일치.
- **주의:** `research.ts`의 로컬 `MODEL` 중복은 Task 6 Step 4에서 suggest의 `MODEL`로 통일(제거). 기존 mock client는 `usage` 미포함이지만 `callLLM`이 옵셔널 체이닝으로 안전 처리.
