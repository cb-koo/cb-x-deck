# /usage 개편 (실청구·사이드바·스토리텔링) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `/usage`를 워크스페이스 사이드바 안으로 옮기고, 제공사 실청구(getxapi·Exa)를 끌어와 추정과 대조하며, 정보 위계를 스토리텔링(총액→신뢰·잔액→구성→추세→상세)으로 재구성한다.

**Architecture:** 신규 `actualCost.ts`가 제공사 실청구를 온디맨드+TTL캐시로 조회(실패 시 폴백). 페이지를 `/w/[wsId]/usage`로 이동해 사이드바 상속. 페이지는 서버 컴포넌트로 DB 집계 + 실청구를 모아 프레젠테이셔널 컴포넌트들에 넘긴다. 기존 `usagePricing`/`usageStore`/`usageFeatures`는 재사용.

**Tech Stack:** Next.js 16(App Router, 서버 컴포넌트), postgres, TypeScript, node:test, Tailwind v4.

## Global Constraints

- 실청구 조회는 실패해도 페이지를 깨지 않는다: 타임아웃(5s) + 실패 시 `null`/폴백, 절대 throw 전파 금지.
- 실청구 fetcher는 `fetchImpl` 주입을 받아 테스트에서 실제 네트워크를 타지 않는다. 키(`GETXAPI_KEY`/`EXA_SERVICE_KEY`) 없으면 `null`.
- 데이터는 앱 전체 공통 — `params.wsId`는 사이드바 렌더용이며 집계 쿼리 필터에 쓰지 않는다.
- 숫자에 사용자 언어 해석을 붙이고(AGENTS.md UX), operation 원문·내부용어를 노출하지 않는다.
- `@/lib/...` 별칭 import는 확장자 없이, `src/lib` 내부 상대 import는 `.ts` 확장자.
- 검증: `npx tsc --noEmit`(권위), `npm run build`, `npm test`. tsx/에디터는 타입체크 안 함 — 커밋 전 반드시 `tsc --noEmit` CLEAN 확인. 로컬 DB 없어 DB 의존 테스트는 실패가 정상.
- 실단가/화폐: USD 표기. 기존 `formatMoney` 사용.

## File Structure

- Create `src/lib/actualCost.ts` (+ `.test.ts`) — 제공사 실청구 fetcher + `getProviderActuals`.
- Create `src/lib/usageTrend.ts` (+ `.test.ts`) — 전 기간 대비 증감 계산.
- Move `src/app/usage/page.tsx` → `src/app/w/[wsId]/usage/page.tsx`; `src/app/usage/UsageBar.tsx` → `src/app/w/[wsId]/usage/UsageBar.tsx`. Delete old `src/app/usage/`.
- Create `src/app/w/[wsId]/usage/UsageHeadline.tsx`, `ActualCostPanel.tsx`, `FeatureBreakdown.tsx`, `UsageDetailTables.tsx`.
- Modify `src/components/Sidebar.tsx` — 링크 `/usage` → `/w/${wsId}/usage`.
- Reuse (no change) `src/lib/usagePricing.ts`, `usageStore.ts`, `usageFeatures.ts`.

---

### Task 1: 제공사 실청구 fetcher (`actualCost.ts`)

**Files:**
- Create: `src/lib/actualCost.ts`
- Test: `src/lib/actualCost.test.ts`

**Interfaces:**
- Produces:
  - `getxapiActual(fetchImpl?): Promise<GetxapiActual | null>` — `{ creditsRemaining, creditsUsed, totalRequests }`
  - `exaActual(from: Date, to: Date, fetchImpl?): Promise<ExaActual | null>` — `{ totalCostUsd, periodStart, periodEnd, budgetUsd, overBudget }`
  - `getProviderActuals(from, to, opts?: { fetchImpl?; now?: () => number }): Promise<ProviderActual[]>` — getxapi·exa·anthropic 카드 배열
  - `interface ProviderActual { api: 'getxapi'|'exa'|'anthropic'; kind: 'cumulative'|'period'|'estimate-only'; actualUsd: number|null; balanceUsd?: number|null; budgetUsd?: number|null; overBudget?: boolean; note?: string }`

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/actualCost.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getxapiActual, exaActual, getProviderActuals } from './actualCost.ts';

// 요청 URL → 응답 매핑 fake fetch
function fakeFetch(routes: Array<{ match: string; status?: number; body: unknown }>) {
  return (async (url: string | URL) => {
    const u = String(url);
    const r = routes.find((x) => u.includes(x.match)) ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
}

const withEnv = async (env: Record<string, string>, fn: () => Promise<void>) => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
  try { await fn(); } finally {
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
};

test('getxapiActual: /account/me 파싱', async () => {
  await withEnv({ GETXAPI_KEY: 'k' }, async () => {
    const f = fakeFetch([{ match: '/account/me', body: { credits_remaining: 38.1, credits_used: 24.3, total_requests: 21703 } }]);
    const out = await getxapiActual(f);
    assert.deepEqual(out, { creditsRemaining: 38.1, creditsUsed: 24.3, totalRequests: 21703 });
  });
});

test('getxapiActual: 키 없으면 null', async () => {
  await withEnv({ GETXAPI_KEY: '' }, async () => {
    assert.equal(await getxapiActual(fakeFetch([])), null);
  });
});

test('getxapiActual: 호출 실패면 null (throw 안 함)', async () => {
  await withEnv({ GETXAPI_KEY: 'k' }, async () => {
    const f = (async () => { throw new Error('network'); }) as typeof fetch;
    assert.equal(await getxapiActual(f), null);
  });
});

test('exaActual: 키목록→usage 파싱 + 예산', async () => {
  await withEnv({ EXA_SERVICE_KEY: 's' }, async () => {
    const f = fakeFetch([
      { match: '/team-management/api-keys/', body: { period: {}, total_cost_usd: 4.165 } }, // usage (더 구체적 경로 먼저)
      { match: '/team-management/api-keys', body: { apiKeys: [{ id: 'key_1', budgetCents: 5000, isOverBudget: false }] } },
    ]);
    const out = await exaActual(new Date('2026-06-23T00:00:00Z'), new Date('2026-07-23T00:00:00Z'), f);
    assert.equal(out?.totalCostUsd, 4.165);
    assert.equal(out?.budgetUsd, 50);
    assert.equal(out?.overBudget, false);
    assert.equal(out?.periodStart, '2026-06-23');
  });
});

test('exaActual: 키 없으면 null', async () => {
  await withEnv({ EXA_SERVICE_KEY: '' }, async () => {
    assert.equal(await exaActual(new Date(), new Date(), fakeFetch([])), null);
  });
});

test('getProviderActuals: 실패 시 카드별 폴백 + anthropic 안내', async () => {
  await withEnv({ GETXAPI_KEY: '', EXA_SERVICE_KEY: '' }, async () => {
    const out = await getProviderActuals(new Date(), new Date(), { fetchImpl: fakeFetch([]), now: () => 1 });
    const gx = out.find((c) => c.api === 'getxapi')!;
    const ex = out.find((c) => c.api === 'exa')!;
    const an = out.find((c) => c.api === 'anthropic')!;
    assert.equal(gx.actualUsd, null); assert.ok(gx.note);
    assert.equal(ex.actualUsd, null); assert.ok(ex.note);
    assert.equal(an.kind, 'estimate-only'); assert.ok(an.note);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test` → FAIL `Cannot find module './actualCost.ts'`

- [ ] **Step 3: 구현 작성**

`src/lib/actualCost.ts`:
```ts
const GETXAPI_BASE = 'https://api.getxapi.com';
const EXA_ADMIN_BASE = 'https://admin-api.exa.ai';
const TIMEOUT_MS = 5000;
const TTL_MS = 5 * 60 * 1000;

export interface GetxapiActual { creditsRemaining: number; creditsUsed: number; totalRequests: number }
export interface ExaActual { totalCostUsd: number; periodStart: string; periodEnd: string; budgetUsd: number | null; overBudget: boolean }
export interface ProviderActual {
  api: 'getxapi' | 'exa' | 'anthropic';
  kind: 'cumulative' | 'period' | 'estimate-only';
  actualUsd: number | null;
  balanceUsd?: number | null;
  budgetUsd?: number | null;
  overBudget?: boolean;
  note?: string;
}

type Fetch = typeof fetch;

// 실패·타임아웃은 null. 절대 throw 전파 안 함(페이지를 깨지 않는다).
async function getJson(url: string, headers: Record<string, string>, fetchImpl: Fetch): Promise<Record<string, unknown> | unknown[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown> | unknown[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getxapiActual(fetchImpl: Fetch = fetch): Promise<GetxapiActual | null> {
  const key = process.env.GETXAPI_KEY;
  if (!key) return null;
  const me = await getJson(`${GETXAPI_BASE}/account/me`, { Authorization: `Bearer ${key}` }, fetchImpl) as Record<string, unknown> | null;
  if (!me || typeof me.credits_remaining !== 'number') return null;
  return {
    creditsRemaining: me.credits_remaining,
    creditsUsed: typeof me.credits_used === 'number' ? me.credits_used : 0,
    totalRequests: typeof me.total_requests === 'number' ? me.total_requests : 0,
  };
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

export async function exaActual(from: Date, to: Date, fetchImpl: Fetch = fetch): Promise<ExaActual | null> {
  const key = process.env.EXA_SERVICE_KEY;
  if (!key) return null;
  const h = { 'x-api-key': key };
  const list = await getJson(`${EXA_ADMIN_BASE}/team-management/api-keys`, h, fetchImpl) as Record<string, unknown> | null;
  const keys = list && Array.isArray(list.apiKeys) ? (list.apiKeys as Array<Record<string, unknown>>) : [];
  const k = keys[0];
  if (!k || typeof k.id !== 'string') return null;
  const usage = await getJson(
    `${EXA_ADMIN_BASE}/team-management/api-keys/${encodeURIComponent(k.id)}/usage?start_date=${ymd(from)}&end_date=${ymd(to)}`,
    h, fetchImpl,
  ) as Record<string, unknown> | null;
  if (!usage || typeof usage.total_cost_usd !== 'number') return null;
  return {
    totalCostUsd: usage.total_cost_usd,
    periodStart: ymd(from),
    periodEnd: ymd(to),
    budgetUsd: typeof k.budgetCents === 'number' ? k.budgetCents / 100 : null,
    overBudget: k.isOverBudget === true,
  };
}

const cache = new Map<string, { at: number; data: ProviderActual[] }>();

export async function getProviderActuals(
  from: Date, to: Date,
  opts?: { fetchImpl?: Fetch; now?: () => number },
): Promise<ProviderActual[]> {
  const now = opts?.now ?? Date.now;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const cacheKey = `${ymd(from)}_${ymd(to)}`;
  const hit = cache.get(cacheKey);
  if (hit && now() - hit.at < TTL_MS) return hit.data;

  const [gx, exa] = await Promise.all([getxapiActual(fetchImpl), exaActual(from, to, fetchImpl)]);
  const data: ProviderActual[] = [
    gx
      ? { api: 'getxapi', kind: 'cumulative', actualUsd: gx.creditsUsed, balanceUsd: gx.creditsRemaining }
      : { api: 'getxapi', kind: 'cumulative', actualUsd: null, note: '불러오기 실패' },
    exa
      ? { api: 'exa', kind: 'period', actualUsd: exa.totalCostUsd, budgetUsd: exa.budgetUsd, overBudget: exa.overBudget }
      : { api: 'exa', kind: 'period', actualUsd: null, note: '불러오기 실패(또는 키 없음)' },
    { api: 'anthropic', kind: 'estimate-only', actualUsd: null, note: '실청구 API 미연동 — 콘솔에서 확인' },
  ];
  cache.set(cacheKey, { at: now(), data });
  return data;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test` → actualCost 6건 PASS. 그리고 `npx tsc --noEmit` → CLEAN.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/actualCost.ts src/lib/actualCost.test.ts
git commit -m "feat(x-research): 제공사 실청구 fetcher(actualCost) — getxapi·Exa 온디맨드+TTL캐시+폴백"
```

---

### Task 2: `/usage`를 워크스페이스 레이아웃으로 이동 + 사이드바 링크

**Files:**
- Move: `src/app/usage/page.tsx` → `src/app/w/[wsId]/usage/page.tsx`
- Move: `src/app/usage/UsageBar.tsx` → `src/app/w/[wsId]/usage/UsageBar.tsx`
- Delete: `src/app/usage/` (빈 디렉터리)
- Modify: `src/components/Sidebar.tsx` (링크 href/active)

**Interfaces:**
- Produces: 라우트 `/w/[wsId]/usage` (사이드바 상속). 이 단계에선 **내용은 그대로**(이동만) — 재구성은 Task 4·5.

- [ ] **Step 1: 파일 이동 (git mv)**

```bash
mkdir -p src/app/w/\[wsId\]/usage
git mv src/app/usage/page.tsx src/app/w/\[wsId\]/usage/page.tsx
git mv src/app/usage/UsageBar.tsx src/app/w/\[wsId\]/usage/UsageBar.tsx
rmdir src/app/usage 2>/dev/null || true
```

- [ ] **Step 2: page.tsx의 기간 링크·params 수정**

이동한 `src/app/w/[wsId]/usage/page.tsx`에서:
- 컴포넌트 시그니처를 wsId params까지 받도록 변경:
```tsx
export default async function UsagePage({
  params, searchParams,
}: {
  params: Promise<{ wsId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { wsId } = await params;
  const sp = await searchParams;
```
- 기간 토글 링크의 `href`를 `/usage?period=${p}` → `` `/w/${wsId}/usage?period=${p}` `` 로 변경.
- 최상위 래퍼의 `className="h-screen overflow-y-auto p-8"`는 그대로 둔다(사이드바 옆 영역).

(그 외 내용은 이 단계에서 변경하지 않는다.)

- [ ] **Step 3: 사이드바 링크 수정**

`src/components/Sidebar.tsx`의 usage 링크 블록(현재 `href="/usage"`, `pathname === '/usage'`)을 교체:
```tsx
      <div className="mb-2 border-t border-x-border pt-2">
        <a href={`/w/${wsId}/usage`}
           className={`flex items-center gap-2.5 rounded-full px-3 py-1.5 text-caption hover:bg-x-text/5 ${pathname === `/w/${wsId}/usage` ? 'text-x-text' : 'text-x-muted'}`}>
          API 사용량
        </a>
      </div>
```

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit` → CLEAN. `npm run build` → 성공, 라우트 목록에 `/w/[wsId]/usage` 존재, 옛 `/usage` 없음.

- [ ] **Step 5: 수동 확인(선택, DB 있는 환경)**

`npm run dev` → 워크스페이스 화면 사이드바의 "API 사용량" 클릭 → `/w/<id>/usage`로 이동하고 좌측 사이드바가 그대로 보임.

- [ ] **Step 6: 커밋**

```bash
git add -A src/app src/components/Sidebar.tsx
git commit -m "feat(x-research): /usage를 워크스페이스 레이아웃으로 이동(사이드바 상속) + 링크 갱신"
```

---

### Task 3: 전 기간 대비 추세 (`usageTrend.ts`)

**Files:**
- Create: `src/lib/usageTrend.ts`
- Test: `src/lib/usageTrend.test.ts`

**Interfaces:**
- Produces: `trend(current: number, previous: number): { pct: number | null; direction: 'up' | 'down' | 'flat' }`
  - `previous === 0`이면 `pct: null`(증감률 무의미), direction은 current>0이면 'up' 아니면 'flat'.

- [ ] **Step 1: 실패 테스트 작성**

`src/lib/usageTrend.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trend } from './usageTrend.ts';

test('증가', () => { assert.deepEqual(trend(112, 100), { pct: 12, direction: 'up' }); });
test('감소', () => { assert.deepEqual(trend(80, 100), { pct: -20, direction: 'down' }); });
test('변화 없음', () => { assert.deepEqual(trend(100, 100), { pct: 0, direction: 'flat' }); });
test('이전 0이면 pct null', () => { assert.deepEqual(trend(5, 0), { pct: null, direction: 'up' }); });
test('둘 다 0', () => { assert.deepEqual(trend(0, 0), { pct: null, direction: 'flat' }); });
```

- [ ] **Step 2: 실패 확인** — Run: `npm test` → FAIL `Cannot find module './usageTrend.ts'`

- [ ] **Step 3: 구현**

`src/lib/usageTrend.ts`:
```ts
export function trend(current: number, previous: number): { pct: number | null; direction: 'up' | 'down' | 'flat' } {
  if (previous === 0) {
    return { pct: null, direction: current > 0 ? 'up' : 'flat' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` → 5건 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/usageTrend.ts src/lib/usageTrend.test.ts
git commit -m "feat(x-research): 전 기간 대비 증감 계산(usageTrend)"
```

---

### Task 4: 프레젠테이셔널 컴포넌트 4종

**Files:**
- Create: `src/app/w/[wsId]/usage/UsageHeadline.tsx`
- Create: `src/app/w/[wsId]/usage/ActualCostPanel.tsx`
- Create: `src/app/w/[wsId]/usage/FeatureBreakdown.tsx`
- Create: `src/app/w/[wsId]/usage/UsageDetailTables.tsx`
- Modify: `src/app/w/[wsId]/usage/UsageBar.tsx` (튀는 날 강조)

**Interfaces:**
- Consumes: `formatMoney` from `@/lib/usagePricing`; `ProviderActual` from `@/lib/actualCost`; `trend` from `@/lib/usageTrend`.
- Produces (각 컴포넌트 props):
  - `UsageHeadline({ total, prevTotal, periodLabel })`
  - `ActualCostPanel({ actuals, estimateByApi })` where `actuals: ProviderActual[]`, `estimateByApi: Record<string, number>` (api→추정 USD)
  - `FeatureBreakdown({ features })` where `features: Array<{ feature: string; calls: number; costUsd: number }>`
  - `UsageDetailTables({ byApi, byFeature })`
  - `UsageBar({ data })` where `data: Array<{ day: string; costUsd: number }>`

> 모두 서버 컴포넌트(‘use client’ 불필요). Tailwind 토큰(text-x-muted, bg-x-surface, border-x-border, text-caption, text-ui, text-x-text, text-x-secondary, text-x-blue, bg-x-blue) 재사용.

- [ ] **Step 1: `UsageHeadline.tsx`**

```tsx
import { formatMoney } from '@/lib/usagePricing';
import { trend } from '@/lib/usageTrend';

export function UsageHeadline({ total, prevTotal, periodLabel }: { total: number; prevTotal: number; periodLabel: string }) {
  const t = trend(total, prevTotal);
  const arrow = t.direction === 'up' ? '▲' : t.direction === 'down' ? '▼' : '■';
  const color = t.direction === 'up' ? 'text-red-500' : t.direction === 'down' ? 'text-green-600' : 'text-x-muted';
  const changeText = t.pct === null
    ? '이전 기간엔 기록이 없어 비교할 수 없어요'
    : t.direction === 'flat'
      ? '지난 기간과 비슷해요'
      : `지난 기간보다 ${Math.abs(t.pct)}% ${t.direction === 'up' ? '늘었어요' : '줄었어요'}`;
  return (
    <section className="mb-8 rounded-lg border border-x-border bg-x-surface p-6">
      <p className="text-caption text-x-muted">{periodLabel} 총 추정비용</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-x-text">{formatMoney(total)}</p>
      <p className={`mt-1 text-ui ${color}`}>
        {t.pct !== null && <span className="tabular-nums">{arrow} {Math.abs(t.pct)}% </span>}
        <span className="text-x-secondary">{changeText}</span>
      </p>
    </section>
  );
}
```

- [ ] **Step 2: `ActualCostPanel.tsx`**

```tsx
import { formatMoney } from '@/lib/usagePricing';
import type { ProviderActual } from '@/lib/actualCost';

const API_LABEL: Record<string, string> = { getxapi: 'getxapi (X 데이터)', exa: 'Exa (웹 검색)', anthropic: 'Anthropic (AI)' };

function matchNote(actual: number, estimate: number): string {
  if (estimate === 0) return '추정 대비 판단 보류';
  const ratio = actual / estimate;
  if (ratio >= 0.8 && ratio <= 1.25) return '추정과 거의 일치 — 믿어도 돼요';
  return ratio > 1.25 ? '실제가 추정보다 큼 — 단가 점검 필요' : '실제가 추정보다 작음';
}

export function ActualCostPanel({ actuals, estimateByApi }: { actuals: ProviderActual[]; estimateByApi: Record<string, number> }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-ui font-bold text-x-text">실제 청구 대조</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {actuals.map((a) => {
          const est = estimateByApi[a.api] ?? 0;
          return (
            <div key={a.api} className="rounded-lg border border-x-border bg-x-surface p-4">
              <p className="text-caption text-x-muted">{API_LABEL[a.api] ?? a.api}</p>
              {a.note && a.actualUsd === null ? (
                <>
                  <p className="mt-1 text-ui text-x-secondary">추정 {formatMoney(est)}</p>
                  <p className="mt-1 text-caption text-x-muted">{a.note}</p>
                </>
              ) : a.kind === 'period' ? (
                <>
                  <p className="mt-1 text-lg font-bold tabular-nums text-x-text">실제 {formatMoney(a.actualUsd ?? 0)}</p>
                  <p className="text-caption text-x-muted">추정 {formatMoney(est)} · {matchNote(a.actualUsd ?? 0, est)}</p>
                  {a.budgetUsd != null && (
                    <p className={`mt-1 text-caption ${a.overBudget ? 'text-red-500' : 'text-x-muted'}`}>
                      예산 {formatMoney(a.budgetUsd)} {a.overBudget ? '· 초과!' : '· 여유'}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="mt-1 text-lg font-bold tabular-nums text-x-text">누적 사용 {formatMoney(a.actualUsd ?? 0)}</p>
                  {a.balanceUsd != null && (
                    <p className={`text-caption ${a.balanceUsd < 5 ? 'text-red-500' : 'text-x-muted'}`}>
                      잔액 {formatMoney(a.balanceUsd)}{a.balanceUsd < 5 ? ' · 충전 필요' : ''}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-caption text-x-muted">getxapi는 계정 누적치, Exa는 선택 기간 실제 청구입니다. Anthropic 실청구는 콘솔에서 확인하세요.</p>
    </section>
  );
}
```

- [ ] **Step 3: `FeatureBreakdown.tsx`**

```tsx
import { formatMoney } from '@/lib/usagePricing';

export function FeatureBreakdown({ features }: { features: Array<{ feature: string; calls: number; costUsd: number }> }) {
  const total = features.reduce((s, f) => s + f.costUsd, 0);
  if (features.length === 0) {
    return (
      <section className="mb-8">
        <h2 className="mb-2 text-ui font-bold text-x-text">어디에 쓰였나</h2>
        <p className="text-caption text-x-muted">이 기간에 기록된 호출이 없습니다.</p>
      </section>
    );
  }
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-ui font-bold text-x-text">어디에 쓰였나 (기능별)</h2>
      <div className="flex flex-col gap-2">
        {features.map((f) => {
          const pct = total ? Math.round((f.costUsd / total) * 100) : 0;
          return (
            <div key={f.feature} className="flex items-center gap-3 text-ui">
              <span className="w-28 shrink-0 text-x-text">{f.feature}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-x-text/10">
                <span className="block h-full rounded-full bg-x-blue/70" style={{ width: `${Math.max(pct, 2)}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-x-muted">{pct}%</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-x-text">{formatMoney(f.costUsd)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: `UsageDetailTables.tsx` (접기/펼치기 — `<details>`)**

```tsx
import { formatMoney } from '@/lib/usagePricing';

type ApiRow = { api: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number };
type FeatRow = { feature: string; calls: number; costUsd: number };

export function UsageDetailTables({ byApi, byFeature }: { byApi: ApiRow[]; byFeature: FeatRow[] }) {
  return (
    <details className="mb-8 rounded-lg border border-x-border">
      <summary className="cursor-pointer px-4 py-2 text-ui text-x-secondary">상세 표 (API별 · 기능별)</summary>
      <div className="px-4 pb-4">
        <h3 className="mb-1 mt-2 text-caption text-x-muted">API별</h3>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">API</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">토큰(입/출)</th>
              <th className="py-1 text-right font-normal">추정비용</th>
            </tr>
          </thead>
          <tbody>
            {byApi.map((a) => (
              <tr key={a.api} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{a.label}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{a.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-muted">{a.api === 'anthropic' ? `${a.inputTokens.toLocaleString()} / ${a.outputTokens.toLocaleString()}` : '—'}</td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(a.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mb-1 mt-4 text-caption text-x-muted">기능별</h3>
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-x-border text-left text-caption text-x-muted">
              <th className="py-1 font-normal">기능</th>
              <th className="py-1 text-right font-normal">호출수</th>
              <th className="py-1 text-right font-normal">추정비용</th>
            </tr>
          </thead>
          <tbody>
            {byFeature.map((f) => (
              <tr key={f.feature} className="border-b border-x-border">
                <td className="py-1.5 text-x-text">{f.feature}</td>
                <td className="py-1.5 text-right tabular-nums text-x-secondary">{f.calls.toLocaleString()}</td>
                <td className="py-1.5 text-right tabular-nums text-x-text">{formatMoney(f.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
```

- [ ] **Step 5: `UsageBar.tsx` — 튀는 날 강조로 교체**

`src/app/w/[wsId]/usage/UsageBar.tsx` 전체를 교체:
```tsx
import { formatMoney } from '@/lib/usagePricing';

export function UsageBar({ data }: { data: Array<{ day: string; costUsd: number }> }) {
  if (data.length === 0) return <p className="text-caption text-x-muted">데이터 없음</p>;
  const max = Math.max(...data.map((d) => d.costUsd), 0.0001);
  return (
    <div className="flex items-end gap-1" style={{ height: 120 }}>
      {data.map((d) => {
        const isPeak = d.costUsd === max && max > 0.0001;
        return (
          <div key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day} · ${formatMoney(d.costUsd)}`}>
            <div className={`w-full rounded-t ${isPeak ? 'bg-x-blue' : 'bg-x-blue/50'}`} style={{ height: `${Math.max((d.costUsd / max) * 100, 2)}%` }} />
            <span className={`mt-1 text-caption ${isPeak ? 'text-x-text' : 'text-x-muted'}`}>{d.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: 검증**

Run: `npx tsc --noEmit` → CLEAN (컴포넌트가 아직 page에서 안 쓰여도 export라 OK). `npm run build` → 성공.

- [ ] **Step 7: 커밋**

```bash
git add src/app/w/\[wsId\]/usage/
git commit -m "feat(x-research): /usage 스토리텔링 컴포넌트(헤드라인·실청구패널·기능비중·상세·추이)"
```

---

### Task 5: 페이지 재구성 (데이터 취득 + 스토리텔링 조립)

**Files:**
- Modify: `src/app/w/[wsId]/usage/page.tsx` (전체 재작성)

**Interfaces:**
- Consumes: `rawAggregate`, `dailyAggregate`, `summarizeByApi`, `summarizeByFeature`, `summarizeByDay`, `totalCostUsd` from `@/lib/usageStore`; `getProviderActuals` from `@/lib/actualCost`; 컴포넌트 5종.

- [ ] **Step 1: page.tsx 전체 재작성**

`src/app/w/[wsId]/usage/page.tsx`:
```tsx
import { getSql } from '@/lib/db';
import {
  rawAggregate, dailyAggregate,
  summarizeByApi, summarizeByFeature, summarizeByDay, totalCostUsd,
} from '@/lib/usageStore';
import { getProviderActuals } from '@/lib/actualCost';
import { UsageHeadline } from './UsageHeadline';
import { ActualCostPanel } from './ActualCostPanel';
import { FeatureBreakdown } from './FeatureBreakdown';
import { UsageDetailTables } from './UsageDetailTables';
import { UsageBar } from './UsageBar';

export const dynamic = 'force-dynamic';

type Period = '7d' | '30d' | 'month';
const PERIOD_LABEL: Record<Period, string> = { '7d': '최근 7일', '30d': '최근 30일', month: '이번 달' };

// 현재 기간 + 동일 길이 직전 기간(추세 비교용)
function ranges(period: Period): { from: Date; to: Date; prevFrom: Date; prevTo: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === '7d') from.setDate(from.getDate() - 7);
  else if (period === 'month') { from.setDate(1); from.setHours(0, 0, 0, 0); }
  else from.setDate(from.getDate() - 30);
  const spanMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - spanMs);
  return { from, to, prevFrom, prevTo };
}

export default async function UsagePage({
  params, searchParams,
}: {
  params: Promise<{ wsId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { wsId } = await params;
  const sp = await searchParams;
  const period: Period = sp.period === '7d' || sp.period === 'month' ? sp.period : '30d';
  const { from, to, prevFrom, prevTo } = ranges(period);

  const sql = getSql();
  const rows = await rawAggregate(sql, from, to);
  const prevRows = await rawAggregate(sql, prevFrom, prevTo);
  const daily = await dailyAggregate(sql, from, to);

  const byApi = summarizeByApi(rows);
  const byFeature = summarizeByFeature(rows);
  const byDay = summarizeByDay(daily);
  const total = totalCostUsd(rows);
  const prevTotal = totalCostUsd(prevRows);
  const estimateByApi: Record<string, number> = Object.fromEntries(byApi.map((a) => [a.api, a.costUsd]));

  const actuals = await getProviderActuals(from, to);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-x-text">API 사용량·비용</h1>
          <p className="mt-1 text-caption text-x-muted">추정치(기록 × 기준 단가)와 제공사 실제 청구를 함께 보여줍니다. 실제와 다를 수 있어요.</p>
        </div>
        <nav className="flex shrink-0 gap-2">
          {(['7d', '30d', 'month'] as Period[]).map((p) => (
            <a key={p} href={`/w/${wsId}/usage?period=${p}`}
               className={`rounded-full border px-3 py-1 text-ui ${p === period ? 'border-x-blue text-x-blue' : 'border-x-border-strong text-x-secondary'}`}>
              {PERIOD_LABEL[p]}
            </a>
          ))}
        </nav>
      </header>

      <UsageHeadline total={total} prevTotal={prevTotal} periodLabel={PERIOD_LABEL[period]} />
      <ActualCostPanel actuals={actuals} estimateByApi={estimateByApi} />
      <FeatureBreakdown features={byFeature} />

      <section className="mb-8">
        <h2 className="mb-2 text-ui font-bold text-x-text">일별 추이</h2>
        <UsageBar data={byDay} />
      </section>

      <UsageDetailTables byApi={byApi} byFeature={byFeature} />
    </div>
  );
}
```

- [ ] **Step 2: 검증**

Run: `npx tsc --noEmit` → CLEAN. `npm run build` → 성공, `/w/[wsId]/usage` 동적 라우트 존재.

- [ ] **Step 3: 수동 확인(선택, DB 있는 환경)**

`npm run dev` → `/w/<id>/usage`: 사이드바 + 헤드라인(총액·증감) + 실청구 대조(getxapi 잔액/누적, Exa 실제vs추정·예산, Anthropic 안내) + 기능별 막대 + 일별 추이(피크 강조) + 상세(접힘). 실청구 실패해도 페이지 정상.

- [ ] **Step 4: 커밋**

```bash
git add src/app/w/\[wsId\]/usage/page.tsx
git commit -m "feat(x-research): /usage 페이지 재구성 — 실청구 대조 + 스토리텔링 조립"
```

---

## Self-Review 결과

- **스펙 커버리지:** 사이드바 통합=Task 2; 실청구 fetcher=Task 1; 추세=Task 3; 스토리텔링 컴포넌트=Task 4; 조립·데이터흐름=Task 5. Anthropic 실청구·워크스페이스 분해·DB적재=비목표(제외). 누락 없음.
- **플레이스홀더:** 모든 코드 스텝에 실제 코드. 없음.
- **타입 일관성:** `ProviderActual`(actualCost 정본, ActualCostPanel·page가 소비), `getProviderActuals(from,to,opts)`, `trend(current,previous)→{pct,direction}`, 컴포넌트 props 시그니처가 Task 4 정의와 Task 5 사용에서 일치. `summarizeByApi` row는 `{api,label,calls,inputTokens,outputTokens,costUsd}`(기존 usageStore와 일치), `UsageDetailTables`/`estimateByApi`가 이 필드명 사용.
- **주의:** Task 2는 페이지를 "이동만", Task 5에서 전체 재작성 — 순차 실행 전제. Exa fake fetch 테스트는 더 구체적 경로(`/api-keys/`)를 배열 앞에 둬 매칭 우선순위 확보.
