# 마케팅 리포트 페이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부 클리닉 마케팅 리포트 API를 DB 스냅샷으로 수집하고, `/reports`에서 기간·단위(일/주/월) 자유형 3층 리포트(요약→구성→흐름)를 보여준다.

**Architecture:** 외부 API 지식은 `reportApi.ts` 한 파일에 격리. 크론이 `report_snapshot` 테이블에 일/주/월 버킷을 수집(재개 가능한 예산 방식), 화면의 흐름 층은 DB에서 읽고 요약·구성 층만 기간당 1회 라이브 호출. 파생·버킷 계산은 순수 함수(`reportSeries.ts`)로 분리해 단위 테스트한다.

**Tech Stack:** Next.js 16(App Router, 이 리포는 훈련 데이터와 다른 버전 — `node_modules/next/dist/docs/` 참조), postgres.js(`getSql()` 트랜잭션 풀), Tailwind, 차트는 라이브러리 없이 인라인 SVG.

**Spec:** `docs/superpowers/specs/2026-08-24-marketing-report-design.md` (필드 정의 원천: 스크래치패드에 받아둔 openapi.yaml — 없으면 `curl -s https://linemessagedashboard.vercel.app/api/reports/v1/openapi.yaml`)

## Global Constraints

- 외부 API: `GET https://linemessagedashboard.vercel.app/api/reports/v1/metrics`, 헤더 `x-api-key: $REPORT_API_KEY`, **분당 60회**, 기간 최대 366일, 저쪽 5분 캐시.
- 수집 호출 파라미터 고정: `date_basis=both`, `compare=none`, `group_by=branch`, include 전 묶음(파라미터 생략 = 전부).
- **null ≠ 0**: 외부 응답의 null은 "모름"이다. 화면 표기는 "—", 파생 계산은 null 전파(분모 0 또는 null → null).
- 날짜는 전부 **KST date-only 문자열**(`YYYY-MM-DD`, 양끝 포함). 주간 버킷은 **월요일 시작**.
- 모든 앱 라우트는 `requireMember()` 게이트(크론 라우트만 `CRON_SECRET`).
- 키는 서버 전용: `REPORT_API_KEY`가 클라이언트 번들에 들어가면 안 된다(`NEXT_PUBLIC_` 금지).
- 테스트: `node --import tsx --env-file-if-exists=.env --test <파일>` (단일 파일 수초). 전체 `npm test`는 실 DB 대상 ~4분. **린트 기준선은 24개** — 새 경고를 늘리지 않는다.
- 마이그레이션 번호: **028** (026은 다른 브랜치가 프로덕션에 이미 적용 — 027 헤더 주석 관례 참조).
- UI 라벨은 AGENTS.md UX 원칙: 내부 개념어 금지, 이득을 사용자 언어로, 행동 전 기대 설정, 숫자에 판단 서술.
- 커밋 메시지는 리포 관례(한국어, `feat(reports): …` 형태)로, 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 마이그레이션 028 + client.clinic_code

**Files:**
- Create: `migrations/028_report_snapshot.sql`
- Modify: `src/lib/clientStore.ts` (ClientRow에 clinicCode)
- Test: `src/lib/clientStore.test.ts` (기존 파일에 테스트 추가)

**Interfaces:**
- Produces: `report_snapshot` 테이블, `client.clinic_code text unique` 컬럼, `ClientRow.clinicCode: string | null`, `updateClient(sql, id, { clinicCode?: string | null })`.

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 028: 마케팅 리포트 — 외부 리포트 API 스냅샷 + 클라이언트↔클리닉 코드 매핑.
-- 설계: docs/superpowers/specs/2026-08-24-marketing-report-design.md
create table if not exists report_snapshot (
  clinic_code  text not null,           -- 외부 API의 clinic 파라미터 값 (예: velybjp)
  granularity  text not null check (granularity in ('day','week','month')),
  period_start date not null,           -- KST 버킷 시작일 (주=월요일, 월=1일)
  period_end   date not null,           -- KST 버킷 종료일 (양끝 포함)
  payload      jsonb not null,          -- 외부 응답 current 원본(전 묶음, 지점 분해 포함) — 파싱은 읽기 쪽 책임
  fetched_at   timestamptz not null default now(),
  primary key (clinic_code, granularity, period_start)
);

-- 클라이언트 ↔ 외부 리포트 클리닉 코드 매핑. null = 리포트 미연동 클라이언트.
alter table client add column if not exists clinic_code text unique;
```

- [ ] **Step 2: 로컬(프로덕션 DB — 이 리포 관례) 적용**

Run: `npm run migrate`
Expected: 028 적용 로그, 오류 없음.

- [ ] **Step 3: clientStore 실패 테스트 추가** — `src/lib/clientStore.test.ts` 마지막에:

```ts
test('clinic_code 왕복 — 설정·해제·목록 노출', async () => {
  const c = await createClient(sql, P + 'C클리닉');
  assert.equal(c.clinicCode, null);
  await updateClient(sql, c.id, { clinicCode: P + 'code' });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.client.clinicCode, P + 'code');
  assert.ok((await listClients(sql)).some((x) => x.id === c.id && x.clinicCode === P + 'code'));
  await updateClient(sql, c.id, { clinicCode: null });
  assert.equal((await getClientWithProcedures(sql, c.id))!.client.clinicCode, null);
  await deleteClient(sql, c.id);
});
```

- [ ] **Step 4: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/clientStore.test.ts`
Expected: FAIL — `clinicCode`가 ClientRow에 없음(undefined ≠ null).

- [ ] **Step 5: clientStore 수정** — `src/lib/clientStore.ts`:
  - `ClientRow`에 `clinicCode: string | null` 추가, `CRow`에 `clinic_code: string | null` 추가.
  - `toClient`에 `clinicCode: r.clinic_code` 추가.
  - `createClient`/`listClients`/`getClientWithProcedures`의 select·returning 목록에 `clinic_code` 추가.
  - `updateClient` patch 타입에 `clinicCode?: string | null`을 추가하고 set 절 확장. **주의**: 기존 coalesce 패턴은 "null로 되돌리기"를 표현 못 하므로 clinicCode는 undefined 검사로 분기:

```ts
export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[]; clinicCode?: string | null },
): Promise<void> {
  await sql`update client set
      name = coalesce(${patch.name ?? null}, name),
      info = coalesce(${patch.info ?? null}, info),
      banned_phrases = coalesce(${patch.bannedPhrases ?? null}, banned_phrases),
      clinic_code = ${patch.clinicCode === undefined ? sql`clinic_code` : patch.clinicCode},
      updated_at = now()
    where id = ${id}`;
}
```

(기존 함수 본문의 실제 set 절 구성을 유지한 채 clinic_code 분기만 추가한다 — 위는 형태 예시이며, postgres.js에서 `sql\`clinic_code\`` 조각 삽입이 동작하지 않으면 `patch.clinicCode !== undefined`일 때만 별도 update를 실행하는 2-쿼리 분기로 구현해도 된다. 테스트가 판정한다.)

- [ ] **Step 6: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/clientStore.test.ts`
Expected: PASS (기존 테스트 포함 전부).

- [ ] **Step 7: 커밋**

```bash
git add migrations/028_report_snapshot.sql src/lib/clientStore.ts src/lib/clientStore.test.ts
git commit -m "feat(reports): report_snapshot 테이블 + client.clinic_code 매핑"
```

---

### Task 2: reportApi.ts — 외부 API 클라이언트 + 타입

**Files:**
- Create: `src/lib/reportApi.ts`
- Test: `src/lib/reportApi.test.ts`

**Interfaces:**
- Produces (이후 전 태스크가 사용):

```ts
export type ReportUnit = 'day' | 'week' | 'month';
export interface Reservers { by_line_id: number; by_name: number }
export interface Revenue { total: number; first_visit: number; repeat_visit: number }
export interface StatusCounts { reviewing: number; confirmed: number; visited: number; cancelled: number; lost: number; noshow: number }
export interface ReservationMetrics {
  reservation_count: number; revenue: Revenue;
  visit_type_counts: { first_visit: number; repeat_visit: number };
  reservers: Reservers; visitors: Reservers; status_counts: StatusCounts;
}
export interface BranchBreakdown extends ReservationMetrics {
  branch_name: string | null; branch_id: string | null; in_master: boolean; source_values: (string | null)[];
}
export interface ReservationsBlock extends ReservationMetrics { by_branch?: BranchBreakdown[] }
export interface FollowersBundle {
  total_at_end: number; snapshot_date: string; total_at_baseline: number | null;
  baseline_date: string; change: number | null; blocked: number; reachable: number;
}
export interface FunnelBundle {
  active_customers: number; new_customers: number; consulted_customers: number;
  reservers: Reservers; visitors: Reservers;
}
export interface CostsBundle {
  marketing_cost: { total: number; by_media: Array<{ media: string; amount: number }> };
  x_views: { cumulative_at_end: number; change: number } | null;
  roas: number | null; cpa: { by_line_id: number | null; by_name: number | null };
}
export interface ReservationsBundle {
  created_at: ReservationsBlock | null; reservation_date: ReservationsBlock | null; upcoming_confirmed: number;
}
export interface ClinicBundle {
  name_ko: string; branches: Array<{ id: string; name: string; is_active: boolean }>;
  business_days_in_period: number;
}
export interface ReportBundles {
  clinic?: ClinicBundle | null; followers?: FollowersBundle | null; funnel?: FunnelBundle | null;
  reservations?: ReservationsBundle | null; costs?: CostsBundle | null;
}
export interface ReportResponse {
  meta: { clinic: { name: string }; period: { start: string; end: string; days: number }; generated_at: string };
  current: ReportBundles;
  previous?: ReportBundles & { period?: { start: string; end: string; days: number } };
  unavailable?: Record<string, { code: string; message: string }>;
}
export type ReportFetch =
  | { kind: 'ok'; report: ReportResponse }
  | { kind: 'rate_limited' }
  | { kind: 'error'; status: number; message: string };
export interface ReportParams {
  clinic: string; start: string; end: string;
  dateBasis?: 'created_at' | 'reservation_date' | 'both';
  compare?: 'calendar' | 'period' | 'none';
  groupBy?: 'branch';
}
export async function fetchReportMetrics(
  params: ReportParams,
  deps?: { fetchFn?: typeof fetch; apiKey?: string },
): Promise<ReportFetch>
```

- [ ] **Step 1: 실패 테스트 작성** — `src/lib/reportApi.test.ts` (fetch 주입, 실 네트워크 없음):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReportMetrics } from './reportApi.ts';

const OK_BODY = JSON.stringify({
  meta: { clinic: { name: '블리비' }, period: { start: '2026-07-01', end: '2026-07-31', days: 31 }, generated_at: 'x' },
  current: { funnel: { active_customers: 1, new_customers: 1, consulted_customers: 1,
    reservers: { by_line_id: 1, by_name: 1 }, visitors: { by_line_id: 1, by_name: 1 } } },
});

function stub(status: number, body: string, capture?: { url?: string; headers?: Record<string, string> }) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (capture) { capture.url = String(input); capture.headers = Object.fromEntries(new Headers(init?.headers).entries()); }
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('URL 조립 — 파라미터·인코딩·키 헤더', async () => {
  const cap: { url?: string; headers?: Record<string, string> } = {};
  const r = await fetchReportMetrics(
    { clinic: 'velybjp', start: '2026-07-01', end: '2026-07-31', dateBasis: 'both', compare: 'none', groupBy: 'branch' },
    { fetchFn: stub(200, OK_BODY, cap), apiKey: 'k1' });
  assert.equal(r.kind, 'ok');
  const u = new URL(cap.url!);
  assert.equal(u.searchParams.get('clinic'), 'velybjp');
  assert.equal(u.searchParams.get('date_basis'), 'both');
  assert.equal(u.searchParams.get('compare'), 'none');
  assert.equal(u.searchParams.get('group_by'), 'branch');
  assert.equal(cap.headers!['x-api-key'], 'k1');
});

test('오류 매핑 — 429는 rate_limited, 4xx는 본문 error 메시지', async () => {
  assert.deepEqual(await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' },
    { fetchFn: stub(429, '{}'), apiKey: 'k' }), { kind: 'rate_limited' });
  const e = await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' },
    { fetchFn: stub(404, JSON.stringify({ error: '없는 클리닉' })), apiKey: 'k' });
  assert.deepEqual(e, { kind: 'error', status: 404, message: '없는 클리닉' });
});

test('네트워크 예외 → error(status 0)', async () => {
  const boom = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
  const e = await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' }, { fetchFn: boom, apiKey: 'k' });
  assert.equal(e.kind, 'error');
});

test('키 미설정이면 호출 전에 실패한다', async () => {
  const prev = process.env.REPORT_API_KEY; delete process.env.REPORT_API_KEY;
  const e = await fetchReportMetrics({ clinic: 'x', start: 'a', end: 'b' });
  assert.equal(e.kind, 'error');
  if (prev !== undefined) process.env.REPORT_API_KEY = prev;
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/reportApi.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `src/lib/reportApi.ts`. 위 Interfaces 블록의 타입 전부 + :

```ts
// 외부 "클리닉 마케팅 리포트 API" 클라이언트. 이 파일만 외부 API를 안다.
// 필드 의미의 원천은 openapi.yaml — 특히 null("모름")과 0("정말 0")의 구분,
// upcoming_confirmed(기간 무관·호출 시점 이후), funnel(항상 접수일 기준)을 오독하지 말 것.
const BASE = process.env.REPORT_API_BASE ?? 'https://linemessagedashboard.vercel.app/api/reports/v1/metrics';

export async function fetchReportMetrics(
  params: ReportParams, deps?: { fetchFn?: typeof fetch; apiKey?: string },
): Promise<ReportFetch> {
  const apiKey = deps?.apiKey ?? process.env.REPORT_API_KEY;
  if (!apiKey) return { kind: 'error', status: 0, message: 'REPORT_API_KEY가 설정되지 않았어요' };
  const u = new URL(BASE);
  u.searchParams.set('clinic', params.clinic);
  u.searchParams.set('start', params.start);
  u.searchParams.set('end', params.end);
  if (params.dateBasis) u.searchParams.set('date_basis', params.dateBasis);
  if (params.compare) u.searchParams.set('compare', params.compare);
  if (params.groupBy) u.searchParams.set('group_by', params.groupBy);
  try {
    const res = await (deps?.fetchFn ?? fetch)(u, { headers: { 'x-api-key': apiKey } });
    if (res.status === 429) return { kind: 'rate_limited' };
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body as { error?: string } | null)?.error ?? `리포트 API 오류 (HTTP ${res.status})`;
      return { kind: 'error', status: res.status, message };
    }
    if (!body || typeof body !== 'object' || !('current' in body))
      return { kind: 'error', status: res.status, message: '리포트 API 응답 형식이 예상과 달라요' };
    return { kind: 'ok', report: body as ReportResponse };
  } catch {
    return { kind: 'error', status: 0, message: '리포트 API에 연결하지 못했어요' };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/reportApi.test.ts`
Expected: PASS 4건.

- [ ] **Step 5: 실 응답 fixture 채집 스크립트** — `scripts/capture-report-fixtures.ts`:

```ts
// 실 API 응답을 fixtures/에 저장 — reportSeries 파생 테스트와 화면 개발의 참조용.
// 실행: node --import tsx --env-file-if-exists=.env scripts/capture-report-fixtures.ts
import { writeFileSync } from 'node:fs';
import { fetchReportMetrics } from '../src/lib/reportApi.ts';

const CASES = [
  { name: 'report-month-velyb-2026-07', clinic: 'velybjp', start: '2026-07-01', end: '2026-07-31', compare: 'calendar' as const },
  { name: 'report-day-velyb-2026-07-15', clinic: 'velybjp', start: '2026-07-15', end: '2026-07-15', compare: 'none' as const },
  { name: 'report-week-sonyouna-2026-07-06', clinic: 'sonyounajp', start: '2026-07-06', end: '2026-07-12', compare: 'none' as const },
];
for (const c of CASES) {
  const r = await fetchReportMetrics({ clinic: c.clinic, start: c.start, end: c.end, dateBasis: 'both', compare: c.compare, groupBy: 'branch' });
  if (r.kind !== 'ok') { console.error(c.name, r); process.exit(1); }
  writeFileSync(`fixtures/${c.name}.json`, JSON.stringify(r.report, null, 2));
  console.log('saved', c.name);
  await new Promise((res) => setTimeout(res, 1200)); // 분당 60회 제한
}
```

`.env`에 `REPORT_API_KEY=<전달받은 키>` 추가 후(전달 문서 1절의 키 — **키 재발급을 작성자에게 요청하는 것은 별도 진행**, 재발급되면 교체):

Run: `node --import tsx --env-file-if-exists=.env scripts/capture-report-fixtures.ts`
Expected: `fixtures/report-*.json` 3개 생성. 열어서 `current.funnel`·`current.reservations.created_at`·`unavailable`이 타입 정의와 맞는지 눈으로 대조 — **불일치가 있으면 이 태스크의 타입을 실응답에 맞춘다**(openapi보다 실응답이 우선).

- [ ] **Step 6: 커밋**

```bash
git add src/lib/reportApi.ts src/lib/reportApi.test.ts scripts/capture-report-fixtures.ts fixtures/report-*.json
git commit -m "feat(reports): 외부 리포트 API 클라이언트 + 실응답 fixture"
```

---

### Task 3: reportSeries.ts — 버킷 경계·단위 추천·파생값 (순수 함수)

**Files:**
- Create: `src/lib/reportSeries.ts`
- Test: `src/lib/reportSeries.test.ts`

**Interfaces:**
- Consumes: `ReportBundles`, `ReportUnit` (reportApi.ts)
- Produces:

```ts
export interface BucketRange { start: string; end: string } // KST date-only, 양끝 포함
export function inclusiveDays(start: string, end: string): number
export function recommendUnit(start: string, end: string): ReportUnit // ≤31 day, ≤120 week, 그 외 month
export function bucketRanges(start: string, end: string, unit: ReportUnit): BucketRange[]
// week/month는 정규 경계(월요일 시작 주, 달력 월)로 스냅 — 범위와 겹치는 정규 버킷 전부.
// 저장 키(period_start)와 일치시키기 위해 가장자리 부분 버킷도 정규 경계 그대로 쓴다.
export function isCalendarMonth(start: string, end: string): boolean
export function addDays(date: string, n: number): string
export function ratio(num: number | null | undefined, den: number | null | undefined): number | null // den 0/null → null
export function movingAverage(values: (number | null)[], window: number): (number | null)[]
export interface SeriesPoint {
  start: string; end: string; inProgress: boolean; missing: boolean; fetchedAt: string | null;
  inflow: number | null; newCustomers: number | null; consulted: number | null; reserversByLineId: number | null;
  convInflowToConsult: number | null; convConsultToReserve: number | null;
  reservationCount: number | null; revenueTotal: number | null; revenueFirst: number | null; revenueRepeat: number | null;
  cancelNoshowRate: number | null; followersTotal: number | null; followersChange: number | null;
  marketingCost: number | null; costByMedia: Array<{ media: string; amount: number }> | null;
  roas: number | null; xViewsChange: number | null;
}
export function toSeriesPoint(
  bucket: BucketRange,
  stored: { payload: ReportBundles; fetchedAt: string | null } | null,
  todayKst: string,
): SeriesPoint
```

- [ ] **Step 1: 실패 테스트 작성** — `src/lib/reportSeries.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inclusiveDays, recommendUnit, bucketRanges, isCalendarMonth, addDays,
  ratio, movingAverage, toSeriesPoint,
} from './reportSeries.ts';
import type { ReportBundles } from './reportApi.ts';

test('inclusiveDays·addDays·isCalendarMonth', () => {
  assert.equal(inclusiveDays('2026-07-01', '2026-07-31'), 31);
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.ok(isCalendarMonth('2026-07-01', '2026-07-31'));
  assert.ok(!isCalendarMonth('2026-07-01', '2026-07-30'));
  assert.ok(!isCalendarMonth('2026-07-02', '2026-07-31'));
});

test('recommendUnit — ≤31 일간, ≤120 주간, 초과 월간', () => {
  assert.equal(recommendUnit('2026-07-01', '2026-07-31'), 'day');
  assert.equal(recommendUnit('2026-04-01', '2026-07-29'), 'week');  // 120일
  assert.equal(recommendUnit('2026-01-01', '2026-07-31'), 'month');
});

test('bucketRanges day — 하루씩, 양끝 포함', () => {
  const b = bucketRanges('2026-07-30', '2026-08-01', 'day');
  assert.deepEqual(b, [
    { start: '2026-07-30', end: '2026-07-30' },
    { start: '2026-07-31', end: '2026-07-31' },
    { start: '2026-08-01', end: '2026-08-01' },
  ]);
});

test('bucketRanges week — 월요일 시작 정규 주로 스냅', () => {
  // 2026-07-15는 수요일 → 그 주는 7/13(월)~7/19(일)
  const b = bucketRanges('2026-07-15', '2026-07-21', 'week');
  assert.deepEqual(b, [
    { start: '2026-07-13', end: '2026-07-19' },
    { start: '2026-07-20', end: '2026-07-26' },
  ]);
});

test('bucketRanges month — 달력 월로 스냅', () => {
  const b = bucketRanges('2026-06-10', '2026-08-05', 'month');
  assert.deepEqual(b, [
    { start: '2026-06-01', end: '2026-06-30' },
    { start: '2026-07-01', end: '2026-07-31' },
    { start: '2026-08-01', end: '2026-08-31' },
  ]);
});

test('ratio — 분모 0·null이면 null (0 아님)', () => {
  assert.equal(ratio(5, 10), 0.5);
  assert.equal(ratio(5, 0), null);
  assert.equal(ratio(null, 10), null);
  assert.equal(ratio(5, null), null);
});

test('movingAverage — null은 건너뛰고 창 안 실측만 평균, 실측 0개면 null', () => {
  assert.deepEqual(movingAverage([2, 4, null, 6], 2), [2, 3, 4, 6]);
  assert.deepEqual(movingAverage([null, null], 2), [null, null]);
});

const PAYLOAD: ReportBundles = {
  followers: { total_at_end: 8742, snapshot_date: '2026-07-15', total_at_baseline: 8700,
    baseline_date: '2026-07-14', change: 42, blocked: 1024, reachable: 7718 },
  funnel: { active_customers: 40, new_customers: 12, consulted_customers: 20,
    reservers: { by_line_id: 14, by_name: 18 }, visitors: { by_line_id: 10, by_name: 12 } },
  reservations: { upcoming_confirmed: 99, reservation_date: null,
    created_at: { reservation_count: 16, revenue: { total: 4200000, first_visit: 2600000, repeat_visit: 1600000 },
      visit_type_counts: { first_visit: 10, repeat_visit: 6 },
      reservers: { by_line_id: 14, by_name: 18 }, visitors: { by_line_id: 10, by_name: 12 },
      status_counts: { reviewing: 1, confirmed: 12, visited: 4, cancelled: 2, lost: 0, noshow: 1 } } },
  costs: { marketing_cost: { total: 120000, by_media: [{ media: '메타', amount: 120000 }] },
    x_views: { cumulative_at_end: 100, change: 10 }, roas: 35, cpa: { by_line_id: 8571, by_name: 6667 } },
};

test('toSeriesPoint — 정상 payload에서 파생값', () => {
  const p = toSeriesPoint({ start: '2026-07-15', end: '2026-07-15' },
    { payload: PAYLOAD, fetchedAt: '2026-07-16T00:00:00Z' }, '2026-08-24');
  assert.equal(p.missing, false);
  assert.equal(p.inProgress, false);
  assert.equal(p.inflow, 40);
  assert.equal(p.convInflowToConsult, 0.5);           // 20/40
  assert.equal(p.convConsultToReserve, 0.7);          // 14/20
  assert.equal(p.reservationCount, 16);
  assert.equal(p.revenueTotal, 4200000);
  // 취소·노쇼율 = (cancelled+noshow) ÷ status 6종 합 = 3/20
  assert.equal(p.cancelNoshowRate, 0.15);
  assert.equal(p.followersTotal, 8742);
  assert.equal(p.marketingCost, 120000);
  assert.equal(p.roas, 35);
  assert.equal(p.xViewsChange, 10);
});

test('toSeriesPoint — 결손 규칙: missing / followers null / 광고비 0이면 ROAS null', () => {
  const missing = toSeriesPoint({ start: '2026-07-01', end: '2026-07-01' }, null, '2026-08-24');
  assert.equal(missing.missing, true);
  assert.equal(missing.inflow, null);

  const noFollowers: ReportBundles = { ...PAYLOAD, followers: null,
    costs: { marketing_cost: { total: 0, by_media: [] }, x_views: null, roas: null, cpa: { by_line_id: null, by_name: null } } };
  const p = toSeriesPoint({ start: '2026-07-15', end: '2026-07-15' },
    { payload: noFollowers, fetchedAt: 'x' }, '2026-08-24');
  assert.equal(p.followersTotal, null);      // SNAPSHOT_MISSING — 0으로 읽으면 안 됨
  assert.equal(p.marketingCost, 0);          // 0은 그대로 0 (경고는 화면 몫)
  assert.equal(p.roas, null);
});

test('toSeriesPoint — 진행 중 버킷 판정 (end ≥ 오늘)', () => {
  const p = toSeriesPoint({ start: '2026-08-24', end: '2026-08-30' }, null, '2026-08-24');
  assert.equal(p.inProgress, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/reportSeries.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `src/lib/reportSeries.ts`:

```ts
import type { ReportBundles, ReportUnit } from './reportApi.ts';

// 날짜는 전부 KST date-only 문자열. Date는 UTC 자정으로만 다뤄 시간대 오염을 차단한다.
const d2u = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const u2d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;

export interface BucketRange { start: string; end: string }

export function addDays(date: string, n: number): string { return u2d(d2u(date) + n * DAY); }
export function inclusiveDays(start: string, end: string): number { return Math.round((d2u(end) - d2u(start)) / DAY) + 1; }
export function isCalendarMonth(start: string, end: string): boolean {
  return start.slice(8) === '01' && start.slice(0, 7) === end.slice(0, 7) && addDays(end, 1).slice(8) === '01';
}
export function recommendUnit(start: string, end: string): ReportUnit {
  const n = inclusiveDays(start, end);
  return n <= 31 ? 'day' : n <= 120 ? 'week' : 'month';
}

function weekStart(date: string): string { // 월요일 시작
  const wd = new Date(d2u(date)).getUTCDay(); // 0=일
  return addDays(date, -((wd + 6) % 7));
}
function monthStart(date: string): string { return date.slice(0, 8) + '01'; }
function monthEnd(date: string): string {
  const next = date.slice(0, 7) === '2026-12' ? `${+date.slice(0, 4) + 1}-01-01` : monthStart(addDays(monthStart(date), 45));
  return addDays(next, -1);
}

export function bucketRanges(start: string, end: string, unit: ReportUnit): BucketRange[] {
  const out: BucketRange[] = [];
  if (unit === 'day') {
    for (let t = d2u(start); t <= d2u(end); t += DAY) out.push({ start: u2d(t), end: u2d(t) });
    return out;
  }
  let s = unit === 'week' ? weekStart(start) : monthStart(start);
  while (d2u(s) <= d2u(end)) {
    const e = unit === 'week' ? addDays(s, 6) : monthEnd(s);
    out.push({ start: s, end: e });
    s = addDays(e, 1);
  }
  return out;
}

export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined || den === null || den === undefined || den === 0) return null;
  return num / den;
}

export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v !== null);
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

export interface SeriesPoint {
  start: string; end: string; inProgress: boolean; missing: boolean; fetchedAt: string | null;
  inflow: number | null; newCustomers: number | null; consulted: number | null; reserversByLineId: number | null;
  convInflowToConsult: number | null; convConsultToReserve: number | null;
  reservationCount: number | null; revenueTotal: number | null; revenueFirst: number | null; revenueRepeat: number | null;
  cancelNoshowRate: number | null; followersTotal: number | null; followersChange: number | null;
  marketingCost: number | null; costByMedia: Array<{ media: string; amount: number }> | null;
  roas: number | null; xViewsChange: number | null;
}

// 버킷 하나를 차트 점 하나로. null 전파가 본체다 — "모름"을 절대 0으로 만들지 않는다.
export function toSeriesPoint(
  bucket: BucketRange,
  stored: { payload: ReportBundles; fetchedAt: string | null } | null,
  todayKst: string,
): SeriesPoint {
  const b = stored?.payload ?? null;
  const fu = b?.funnel ?? null;
  const cr = b?.reservations?.created_at ?? null;
  const co = b?.costs ?? null;
  const fo = b?.followers ?? null;
  const statusTotal = cr ? Object.values(cr.status_counts).reduce((a, x) => a + x, 0) : null;
  return {
    start: bucket.start, end: bucket.end,
    inProgress: bucket.end >= todayKst, missing: stored === null, fetchedAt: stored?.fetchedAt ?? null,
    inflow: fu?.active_customers ?? null, newCustomers: fu?.new_customers ?? null,
    consulted: fu?.consulted_customers ?? null, reserversByLineId: fu?.reservers.by_line_id ?? null,
    convInflowToConsult: ratio(fu?.consulted_customers, fu?.active_customers),
    convConsultToReserve: ratio(fu?.reservers.by_line_id, fu?.consulted_customers),
    reservationCount: cr?.reservation_count ?? null,
    revenueTotal: cr?.revenue.total ?? null, revenueFirst: cr?.revenue.first_visit ?? null,
    revenueRepeat: cr?.revenue.repeat_visit ?? null,
    cancelNoshowRate: cr ? ratio(cr.status_counts.cancelled + cr.status_counts.noshow, statusTotal) : null,
    followersTotal: fo?.total_at_end ?? null, followersChange: fo?.change ?? null,
    marketingCost: co?.marketing_cost.total ?? null,
    costByMedia: co?.marketing_cost.by_media ?? null,
    roas: co?.roas ?? null,
    xViewsChange: co?.x_views?.change ?? null,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/reportSeries.test.ts`
Expected: PASS 전건. (실패 시 monthEnd의 연말 처리·주 시작 계산부터 의심.)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/reportSeries.ts src/lib/reportSeries.test.ts
git commit -m "feat(reports): 버킷 경계·단위 추천·파생값 순수 계산층"
```

---

### Task 4: reportStore.ts — 스냅샷 저장·조회 + 동기화 대기열

**Files:**
- Create: `src/lib/reportStore.ts`
- Test: `src/lib/reportStore.test.ts`

**Interfaces:**
- Consumes: `ReportBundles`, `ReportUnit`(reportApi), `bucketRanges`, `addDays`(reportSeries), `getSql`(db)
- Produces:

```ts
export interface SnapshotRow {
  clinicCode: string; granularity: ReportUnit; periodStart: string; periodEnd: string;
  payload: ReportBundles; fetchedAt: string;
}
export async function upsertSnapshot(sql: postgres.Sql, row: Omit<SnapshotRow, 'fetchedAt'>): Promise<void>
export async function getSnapshots(
  sql: postgres.Sql, clinicCode: string, granularity: ReportUnit, start: string, end: string,
): Promise<SnapshotRow[]> // period_start가 [start,end]와 겹치는 버킷, period_start asc
export interface SyncTask { clinicCode: string; granularity: ReportUnit; start: string; end: string }
export function taskKey(t: { clinicCode: string; granularity: ReportUnit; start: string }): string
export async function getStoredFetchedAt(
  sql: postgres.Sql, clinicCodes: string[], since: string,
): Promise<Map<string, string>> // taskKey → fetched_at ISO
export function planSyncTasks(opts: {
  clinicCodes: string[]; todayKst: string; windowDays: number; stored: Map<string, string>;
}): SyncTask[]
// 후보: 클리닉별 [오늘-windowDays, 어제]의 day 버킷 + 그 구간과 겹치며 이미 닫힌(end < 오늘) week/month 버킷.
// 정렬: 미수집(stored에 없음)이 먼저 — 그 안에서 최신 날짜 우선. 그다음 fetched_at 오래된 순.
```

- [ ] **Step 1: 실패 테스트 작성** — `src/lib/reportStore.test.ts` (planSyncTasks는 순수라 DB 불필요, 저장·조회는 실 DB — trackingStore.test.ts 관례):

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertSnapshot, getSnapshots, planSyncTasks, taskKey } from './reportStore.ts';
import type { ReportBundles } from './reportApi.ts';

const sql = getSql();
const C = 'trpt' + process.pid;
after(async () => {
  await sql`delete from report_snapshot where clinic_code like ${C + '%'}`;
  await sql.end();
});

const PAYLOAD = { funnel: { active_customers: 1, new_customers: 0, consulted_customers: 0,
  reservers: { by_line_id: 0, by_name: 0 }, visitors: { by_line_id: 0, by_name: 0 } } } as ReportBundles;

test('upsert 멱등 + 겹침 조회 + fetched_at 갱신', async () => {
  await upsertSnapshot(sql, { clinicCode: C, granularity: 'day', periodStart: '2026-07-01', periodEnd: '2026-07-01', payload: PAYLOAD });
  const first = (await getSnapshots(sql, C, 'day', '2026-07-01', '2026-07-02'))[0];
  await upsertSnapshot(sql, { clinicCode: C, granularity: 'day', periodStart: '2026-07-01', periodEnd: '2026-07-01', payload: PAYLOAD });
  const rows = await getSnapshots(sql, C, 'day', '2026-06-25', '2026-07-05');
  assert.equal(rows.length, 1); // 중복 없이 갱신
  assert.ok(rows[0].fetchedAt >= first.fetchedAt);
  assert.equal(rows[0].payload.funnel!.active_customers, 1);
  assert.equal((await getSnapshots(sql, C, 'week', '2026-07-01', '2026-07-31')).length, 0); // 단위 분리
});

test('planSyncTasks — 미수집 최신 우선, 그다음 오래 안 본 순, 닫힌 주·월 포함', () => {
  const stored = new Map<string, string>([
    [taskKey({ clinicCode: 'a', granularity: 'day', start: '2026-08-23' }), '2026-08-24T00:00:00Z'],
    [taskKey({ clinicCode: 'a', granularity: 'day', start: '2026-08-22' }), '2026-08-22T00:00:00Z'],
  ]);
  const tasks = planSyncTasks({ clinicCodes: ['a'], todayKst: '2026-08-24', windowDays: 3, stored });
  // 후보 day: 8/21·8/22·8/23. 미수집은 8/21뿐 → 맨 앞.
  assert.equal(tasks[0].start, '2026-08-21');
  assert.equal(tasks[0].granularity, 'day');
  // 수집된 것 중에선 fetched_at 오래된 8/22가 8/23보다 앞.
  const idx22 = tasks.findIndex((t) => t.granularity === 'day' && t.start === '2026-08-22');
  const idx23 = tasks.findIndex((t) => t.granularity === 'day' && t.start === '2026-08-23');
  assert.ok(idx22 < idx23);
  // 창과 겹치는 닫힌 주(8/17~8/23)와 닫히지 않은 8월 월간은 포함/제외.
  assert.ok(tasks.some((t) => t.granularity === 'week' && t.start === '2026-08-17'));
  assert.ok(!tasks.some((t) => t.granularity === 'month' && t.start === '2026-08-01'));
});

test('planSyncTasks — 클리닉 여러 개면 같은 우선순위끼리 교차 배치', () => {
  const tasks = planSyncTasks({ clinicCodes: ['a', 'b'], todayKst: '2026-08-24', windowDays: 2, stored: new Map() });
  const firstTwo = tasks.slice(0, 2).map((t) => t.clinicCode).sort();
  assert.deepEqual(firstTwo, ['a', 'b']); // 한 클리닉이 예산을 독식하지 않게
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/reportStore.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `src/lib/reportStore.ts`:

```ts
import type postgres from 'postgres';
import type { ReportBundles, ReportUnit } from './reportApi.ts';
import { addDays, bucketRanges } from './reportSeries.ts';

export interface SnapshotRow {
  clinicCode: string; granularity: ReportUnit; periodStart: string; periodEnd: string;
  payload: ReportBundles; fetchedAt: string;
}
type SRow = { clinic_code: string; granularity: ReportUnit; period_start: string; period_end: string; payload: ReportBundles; fetched_at: Date };
const toRow = (r: SRow): SnapshotRow => ({
  clinicCode: r.clinic_code, granularity: r.granularity,
  periodStart: String(r.period_start).slice(0, 10), periodEnd: String(r.period_end).slice(0, 10),
  payload: r.payload, fetchedAt: new Date(r.fetched_at).toISOString(),
});

export async function upsertSnapshot(sql: postgres.Sql, row: Omit<SnapshotRow, 'fetchedAt'>): Promise<void> {
  await sql`insert into report_snapshot (clinic_code, granularity, period_start, period_end, payload, fetched_at)
    values (${row.clinicCode}, ${row.granularity}, ${row.periodStart}, ${row.periodEnd}, ${sql.json(row.payload as never)}, now())
    on conflict (clinic_code, granularity, period_start)
    do update set period_end = excluded.period_end, payload = excluded.payload, fetched_at = now()`;
}

export async function getSnapshots(
  sql: postgres.Sql, clinicCode: string, granularity: ReportUnit, start: string, end: string,
): Promise<SnapshotRow[]> {
  const rows = await sql<SRow[]>`select clinic_code, granularity, period_start, period_end, payload, fetched_at
    from report_snapshot
    where clinic_code = ${clinicCode} and granularity = ${granularity}
      and period_end >= ${start} and period_start <= ${end}
    order by period_start`;
  return rows.map(toRow);
}

export interface SyncTask { clinicCode: string; granularity: ReportUnit; start: string; end: string }
export const taskKey = (t: { clinicCode: string; granularity: ReportUnit; start: string }) =>
  `${t.clinicCode}|${t.granularity}|${t.start}`;

export async function getStoredFetchedAt(
  sql: postgres.Sql, clinicCodes: string[], since: string,
): Promise<Map<string, string>> {
  if (clinicCodes.length === 0) return new Map();
  const rows = await sql<{ clinic_code: string; granularity: ReportUnit; period_start: string; fetched_at: Date }[]>`
    select clinic_code, granularity, period_start, fetched_at from report_snapshot
    where clinic_code = any(${clinicCodes}) and period_end >= ${since}`;
  return new Map(rows.map((r) => [
    taskKey({ clinicCode: r.clinic_code, granularity: r.granularity, start: String(r.period_start).slice(0, 10) }),
    new Date(r.fetched_at).toISOString(),
  ]));
}

// 크론 한 번의 할 일 목록. 우선순위: 미수집(최신 날짜 먼저) → 수집됐지만 오래 안 본 순.
// 소급 변경(취소·노쇼 상태, 광고비 늦은 입력) 때문에 창 안은 반복 재동기화한다.
export function planSyncTasks(opts: {
  clinicCodes: string[]; todayKst: string; windowDays: number; stored: Map<string, string>;
}): SyncTask[] {
  const { clinicCodes, todayKst, windowDays, stored } = opts;
  const winStart = addDays(todayKst, -windowDays);
  const yesterday = addDays(todayKst, -1);
  if (yesterday < winStart || clinicCodes.length === 0) return [];
  const candidates: SyncTask[] = [];
  for (const clinicCode of clinicCodes) {
    for (const b of bucketRanges(winStart, yesterday, 'day'))
      candidates.push({ clinicCode, granularity: 'day', start: b.start, end: b.end });
    for (const g of ['week', 'month'] as const)
      for (const b of bucketRanges(winStart, yesterday, g))
        if (b.end < todayKst) candidates.push({ clinicCode, granularity: g, start: b.start, end: b.end });
  }
  const rank = (t: SyncTask): [number, string] => {
    const f = stored.get(taskKey(t));
    // 미수집: 0순위, 최신 먼저(역순 문자열). 수집됨: 1순위, fetched_at 오래된 순.
    return f === undefined ? [0, revDate(t.start)] : [1, f];
  };
  const revDate = (d: string) => String(99999999 - Number(d.replaceAll('-', '')));
  return candidates
    .map((t, i) => ({ t, r: rank(t), i }))
    .sort((a, b) => (a.r[0] - b.r[0]) || a.r[1].localeCompare(b.r[1]) || (a.i % clinicCodes.length) - (b.i % clinicCodes.length))
    .map((x) => x.t);
}
```

(`revDate`는 rank보다 위에 선언해야 한다 — 구현 시 순서 조정. "같은 우선순위 교차 배치" 테스트가 실패하면 정렬 키에 `날짜별로 클리닉 라운드로빈`이 되도록 3차 키를 조정한다 — 테스트가 요구하는 것은 첫 두 태스크가 서로 다른 클리닉이라는 것뿐이다.)

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/reportStore.test.ts`
Expected: PASS 3건.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/reportStore.ts src/lib/reportStore.test.ts
git commit -m "feat(reports): 스냅샷 저장·조회 + 재개 가능한 동기화 대기열"
```

---

### Task 5: 크론 동기화 라우트 + vercel.json

**Files:**
- Create: `src/app/api/reports/sync/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `fetchReportMetrics`, `planSyncTasks`/`getStoredFetchedAt`/`upsertSnapshot`(reportStore), `kstToday`(datetime), `getSql`
- Produces: `POST /api/reports/sync` → `{ attempted, saved, failed, remaining }`. Vercel 크론이 매일 19:00 UTC(04:00 KST)에 호출.

- [ ] **Step 1: 구현** — `src/app/api/reports/sync/route.ts` (라우트 하네스 없음 — 리포 관례. 판단 로직은 전부 Task 3·4에서 테스트됨):

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { fetchReportMetrics } from '@/lib/reportApi';
import { getStoredFetchedAt, planSyncTasks, upsertSnapshot } from '@/lib/reportStore';
import { addDays } from '@/lib/reportSeries';
import { kstToday } from '@/lib/datetime';

export const maxDuration = 300; // 크론 실행 여유 (Fluid 기준 플랜 한도 내)

const WINDOW_DAYS = 90;   // 소급 변경(취소·노쇼, 광고비 늦은 입력) 재동기화 창
const CALL_GAP_MS = 1100; // 분당 60회 제한 준수
const DEADLINE_MS = 240_000;

// Vercel Cron은 CRON_SECRET 환경변수가 있으면 Authorization: Bearer <값>을 실어 보낸다.
export async function POST(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sql = getSql();
  const clinics = await sql<{ clinic_code: string }[]>`select clinic_code from client where clinic_code is not null`;
  const codes = clinics.map((c) => c.clinic_code);
  const today = kstToday();
  const stored = await getStoredFetchedAt(sql, codes, addDays(today, -WINDOW_DAYS));
  const tasks = planSyncTasks({ clinicCodes: codes, todayKst: today, windowDays: WINDOW_DAYS, stored });

  const startedAt = Date.now();
  let attempted = 0, saved = 0;
  const failed: Array<{ task: string; message: string }> = [];
  for (const t of tasks) {
    if (Date.now() - startedAt > DEADLINE_MS) break; // 나머지는 다음 실행이 이어서
    attempted++;
    const r = await fetchReportMetrics({ clinic: t.clinicCode, start: t.start, end: t.end,
      dateBasis: 'both', compare: 'none', groupBy: 'branch' });
    if (r.kind === 'ok') {
      await upsertSnapshot(sql, { clinicCode: t.clinicCode, granularity: t.granularity,
        periodStart: t.start, periodEnd: t.end, payload: r.report.current });
      saved++;
    } else if (r.kind === 'rate_limited') {
      await new Promise((res) => setTimeout(res, 60_000)); // 1분 쉬고 다음 태스크로
    } else {
      failed.push({ task: `${t.clinicCode} ${t.granularity} ${t.start}`, message: r.message });
    }
    await new Promise((res) => setTimeout(res, CALL_GAP_MS));
  }
  return NextResponse.json({ attempted, saved, failed, remaining: tasks.length - attempted });
}
```

- [ ] **Step 2: vercel.json에 크론 추가**

```json
{
  "regions": ["sin1"],
  "crons": [{ "path": "/api/reports/sync", "schedule": "0 19 * * *" }]
}
```

(Vercel Cron은 GET으로 호출한다 — 배포 전 Vercel 문서 기준으로 확인하고, GET이면 위 핸들러를 `export async function GET`으로 노출한다. POST/GET 둘 다 같은 본문을 export해도 된다.)

- [ ] **Step 3: 로컬 검증** — build 후 로컬 서버에서 인증 게이트만 확인:

Run: `npm run build && npm start -- -p 3001 &` 다음 `curl -s -X POST http://127.0.0.1:3001/api/reports/sync | head -c 200`
Expected: `{"error":"unauthorized"}` (CRON_SECRET 불일치). `.env`에 `CRON_SECRET=devsecret` 넣고 `curl -s -X POST -H "Authorization: Bearer devsecret" http://127.0.0.1:3001/api/reports/sync`로 실제 수집 1회 — 응답에 `saved > 0` 확인 후 서버 종료.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/reports/sync/route.ts vercel.json
git commit -m "feat(reports): 크론 동기화 라우트 — 예산 내 재개 가능 수집 (매일 04:00 KST)"
```

---

### Task 6: 백필 스크립트

**Files:**
- Create: `scripts/backfill-reports.ts`

**Interfaces:**
- Consumes: `fetchReportMetrics`, `upsertSnapshot`/`getStoredFetchedAt`/`taskKey`, `bucketRanges`/`addDays`, `kstToday`, `getSql`
- Produces: `node --import tsx --env-file-if-exists=.env scripts/backfill-reports.ts [--from 2026-04-01] [--force]`

- [ ] **Step 1: 구현**:

```ts
// 과거 리포트 데이터 1회성 백필 — 일간 + 닫힌 주간·월간 버킷.
// 이미 저장된 버킷은 건너뛴다(--force로 재수집). 분당 60회 제한 준수(1.1초 간격).
// 데이터 시작점 자동 감지: 월간을 최신→과거로 훑다가 활동 0인 달이 2번 연속이면 그 클리닉은 중단.
import { getSql } from '../src/lib/db.ts';
import { fetchReportMetrics, type ReportBundles } from '../src/lib/reportApi.ts';
import { getStoredFetchedAt, taskKey, upsertSnapshot } from '../src/lib/reportStore.ts';
import { addDays, bucketRanges } from '../src/lib/reportSeries.ts';
import { kstToday } from '../src/lib/datetime.ts';

const FROM = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : '2026-04-01';
const FORCE = process.argv.includes('--force');
const sql = getSql();
const gap = () => new Promise((r) => setTimeout(r, 1100));

const looksEmpty = (b: ReportBundles) => {
  const status = b.reservations?.created_at?.status_counts;
  const statusTotal = status ? Object.values(status).reduce((a, x) => a + x, 0) : 0;
  return (b.funnel?.active_customers ?? 0) === 0 && statusTotal === 0;
};

const clinics = await sql<{ clinic_code: string }[]>`select clinic_code from client where clinic_code is not null`;
const today = kstToday();
const yesterday = addDays(today, -1);
const stored = await getStoredFetchedAt(sql, clinics.map((c) => c.clinic_code), FROM);
let calls = 0, saved = 0, skipped = 0;

async function collect(clinic: string, granularity: 'day' | 'week' | 'month', start: string, end: string): Promise<ReportBundles | null> {
  if (!FORCE && stored.has(taskKey({ clinicCode: clinic, granularity, start }))) { skipped++; return null; }
  calls++;
  const r = await fetchReportMetrics({ clinic, start, end, dateBasis: 'both', compare: 'none', groupBy: 'branch' });
  await gap();
  if (r.kind !== 'ok') { console.error('FAIL', clinic, granularity, start, r); return null; }
  await upsertSnapshot(sql, { clinicCode: clinic, granularity, periodStart: start, periodEnd: end, payload: r.report.current });
  saved++;
  return r.report.current;
}

for (const { clinic_code: clinic } of clinics) {
  const months = bucketRanges(FROM, yesterday, 'month').filter((m) => m.end < today).reverse(); // 최신→과거
  let emptyStreak = 0;
  for (const m of months) {
    const payload = await collect(clinic, 'month', m.start, m.end);
    if (payload && looksEmpty(payload)) { emptyStreak++; if (emptyStreak >= 2) { console.log(clinic, m.start, '이전은 데이터 없음으로 판단 — 중단'); break; } }
    else if (payload) emptyStreak = 0;
    for (const w of bucketRanges(m.start, m.end, 'week').filter((w) => w.end < today))
      await collect(clinic, 'week', w.start, w.end);
    for (const d of bucketRanges(m.start, m.end < yesterday ? m.end : yesterday, 'day'))
      await collect(clinic, 'day', d.start, d.end);
    console.log(clinic, m.start, `누적 호출 ${calls} 저장 ${saved} 건너뜀 ${skipped}`);
  }
}
console.log(`완료 — 호출 ${calls}, 저장 ${saved}, 건너뜀 ${skipped}`);
await sql.end();
```

(주의: 월간 루프가 최신→과거인데 주간 버킷은 월 경계에 걸치므로 인접 월에서 중복 시도될 수 있다 — `stored`에 없고 이번 실행에서 이미 저장한 것도 건너뛰도록 `collect` 안에서 저장 성공 시 `stored.set(taskKey(...), 'now')`를 추가한다.)

- [ ] **Step 2: 소규모 검증 실행** — 최근 5일만:

Run: `node --import tsx --env-file-if-exists=.env scripts/backfill-reports.ts --from $(date -v-5d +%F)`
Expected: 클리닉별 진행 로그, FAIL 없음. `psql` 또는 테스트 스크립트로 `select clinic_code, granularity, count(*) from report_snapshot group by 1,2` 확인.

- [ ] **Step 3: 커밋** (전체 백필 실행은 Task 12에서 사용자 확인 후)

```bash
git add scripts/backfill-reports.ts
git commit -m "feat(reports): 과거 데이터 백필 스크립트 (일·주·월, 시작점 자동 감지)"
```

---

### Task 7: summary·series 라우트

**Files:**
- Create: `src/app/api/reports/summary/route.ts`
- Create: `src/app/api/reports/series/route.ts`

**Interfaces:**
- Produces:
  - `GET /api/reports/summary?clientId&start&end` → `{ report: ReportResponse }` | `{ error }` — compare는 캘린더 월이면 `calendar`, 아니면 `period`.
  - `GET /api/reports/series?clientId&start&end&unit=day|week|month` → `{ unit, points: SeriesPoint[] }` — DB에서 읽고, 진행 중 마지막 버킷만 라이브 보충. 버킷 121개 이상이면 400.

- [ ] **Step 1: summary 라우트 구현**:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { fetchReportMetrics } from '@/lib/reportApi';
import { isCalendarMonth } from '@/lib/reportSeries';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const clientId = p.get('clientId') ?? '';
  const start = p.get('start') ?? '', end = p.get('end') ?? '';
  if (!DATE.test(start) || !DATE.test(end) || start > end)
    return NextResponse.json({ error: '기간이 올바르지 않아요 (YYYY-MM-DD, 시작 ≤ 끝)' }, { status: 400 });
  const rows = await getSql()<{ clinic_code: string | null }[]>`select clinic_code from client where id = ${clientId}`;
  if (!rows[0]?.clinic_code)
    return NextResponse.json({ error: '이 클라이언트는 아직 리포트가 연결되지 않았어요' }, { status: 404 });
  const r = await fetchReportMetrics({
    clinic: rows[0].clinic_code, start, end, dateBasis: 'both',
    compare: isCalendarMonth(start, end) ? 'calendar' : 'period', groupBy: 'branch',
  });
  if (r.kind === 'rate_limited')
    return NextResponse.json({ error: '잠시 조회가 많아요 — 1분 뒤 다시 시도해 주세요' }, { status: 503 });
  if (r.kind === 'error') return NextResponse.json({ error: r.message }, { status: 502 });
  return NextResponse.json({ report: r.report });
}
```

- [ ] **Step 2: series 라우트 구현**:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { fetchReportMetrics, type ReportUnit } from '@/lib/reportApi';
import { bucketRanges, recommendUnit, toSeriesPoint } from '@/lib/reportSeries';
import { getSnapshots } from '@/lib/reportStore';
import { kstToday } from '@/lib/datetime';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: ReportUnit[] = ['day', 'week', 'month'];

export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const clientId = p.get('clientId') ?? '';
  const start = p.get('start') ?? '', end = p.get('end') ?? '';
  if (!DATE.test(start) || !DATE.test(end) || start > end)
    return NextResponse.json({ error: '기간이 올바르지 않아요 (YYYY-MM-DD, 시작 ≤ 끝)' }, { status: 400 });
  const unit = (UNITS as string[]).includes(p.get('unit') ?? '') ? (p.get('unit') as ReportUnit) : recommendUnit(start, end);
  const buckets = bucketRanges(start, end, unit);
  if (buckets.length > 120)
    return NextResponse.json({ error: '구간이 너무 잘게 나뉘어요 — 기간을 줄이거나 단위를 키워 주세요 (최대 120칸)' }, { status: 400 });

  const sql = getSql();
  const rows = await sql<{ clinic_code: string | null }[]>`select clinic_code from client where id = ${clientId}`;
  const clinic = rows[0]?.clinic_code;
  if (!clinic) return NextResponse.json({ error: '이 클라이언트는 아직 리포트가 연결되지 않았어요' }, { status: 404 });

  const today = kstToday();
  const snaps = await getSnapshots(sql, clinic, unit, buckets[0].start, buckets[buckets.length - 1].end);
  const byStart = new Map(snaps.map((s) => [s.periodStart, s]));

  // 진행 중인 마지막 버킷만 라이브 보충(버킷 시작~오늘) — 저장하지 않는다(부분값이라 닫힌 버킷과 섞이면 안 됨).
  const live = new Map<string, { payload: (typeof snaps)[number]['payload']; fetchedAt: string | null }>();
  const last = buckets[buckets.length - 1];
  if (last.end >= today && last.start <= today) {
    const r = await fetchReportMetrics({ clinic, start: last.start, end: today, dateBasis: 'both', compare: 'none', groupBy: 'branch' });
    if (r.kind === 'ok') live.set(last.start, { payload: r.report.current, fetchedAt: new Date().toISOString() });
  }

  const points = buckets.map((b) => toSeriesPoint(b,
    live.get(b.start) ?? (byStart.has(b.start) ? { payload: byStart.get(b.start)!.payload, fetchedAt: byStart.get(b.start)!.fetchedAt } : null),
    today));
  return NextResponse.json({ unit, points });
}
```

- [ ] **Step 3: 로컬 검증**

Run: `npm run build && npm start -- -p 3001 &` — 브라우저 로그인 세션이 없으므로 게이트 확인만: `curl -s "http://127.0.0.1:3001/api/reports/summary?clientId=x&start=2026-07-01&end=2026-07-31" | head -c 120`
Expected: 401 계열 응답(requireMember). 서버 종료. 정상 경로는 Task 11의 화면 확인에서 함께 검증.

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/reports/summary/route.ts src/app/api/reports/series/route.ts
git commit -m "feat(reports): 요약(라이브 1회)·흐름(DB+진행중 보충) 조회 라우트"
```

---

### Task 8: 클라이언트 편집 화면에 리포트 연결 필드

**Files:**
- Modify: `src/app/api/clients/[id]/route.ts` (PATCH body에 clinicCode 통과)
- Modify: `src/app/clients/ClientDetail.tsx` (연결 코드 select)

- [ ] **Step 1: PATCH 확장** — body 타입에 `clinicCode?: string | null` 추가하고 `updateClient`로 그대로 전달. unique 충돌은 409로:

```ts
const body = (await req.json().catch(() => ({}))) as { name?: string; info?: string; bannedPhrases?: string[]; clinicCode?: string | null };
// …기존 name 검증 유지…
try {
  await updateClient(getSql(), id, body);
} catch (e) {
  if ((e as { code?: string }).code === '23505')
    return NextResponse.json({ error: '이 리포트 코드는 이미 다른 클라이언트에 연결돼 있어요' }, { status: 409 });
  throw e;
}
```

- [ ] **Step 2: ClientDetail에 필드 추가** — 기존 info 저장 패턴(디바운스/블러 PATCH)을 그대로 따르되, 코드는 자유 입력이 아니라 select (6개 코드 상수). 정보 편집 섹션 근처에:

```tsx
const CLINIC_CODES = [
  { code: 'velybjp', label: '블리비의원' }, { code: 'mimodreamjp', label: '미모드림의원' },
  { code: 'maindskinjp', label: '마인드피부과' }, { code: 'sonyounajp', label: '손유나클리닉' },
  { code: 'brightskinjp', label: '브라이트피부과' }, { code: 'triomphejp', label: '트리옹프닥터' },
];
// 렌더 (기존 필드들의 클래스·레이아웃 관례를 그대로 사용):
<label className="text-caption text-x-muted">월간 리포트 연결
  <select value={client.clinicCode ?? ''} onChange={(e) => saveClinicCode(e.target.value || null)}
          className="mt-1 block h-8 w-full rounded-md border border-x-border-strong bg-white px-2 text-[13px]">
    <option value="">연결 안 함</option>
    {CLINIC_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
  </select>
  <span className="mt-1 block text-caption text-x-muted">연결하면 리포트 페이지에서 이 클라이언트의 마케팅 성과를 볼 수 있어요</span>
</label>
```

`saveClinicCode`는 기존 name 저장 함수와 같은 PATCH 패턴(`{ clinicCode }` body, 409면 오류 메시지 표시). ClientDetail의 실제 상태 관리 구조에 맞춰 붙인다.

- [ ] **Step 3: 검증 + 커밋**

Run: `npm run lint` (기준선 24 유지), `npm run build`
Expected: 성공. 이후:

```bash
git add src/app/api/clients/[id]/route.ts src/app/clients/ClientDetail.tsx
git commit -m "feat(reports): 클라이언트 편집에서 리포트(클리닉 코드) 연결"
```

---

### Task 9: /reports 페이지 — 셸·컨트롤·요약·구성 층

**Files:**
- Create: `src/app/reports/layout.tsx`
- Create: `src/app/reports/page.tsx`
- Create: `src/components/ReportControls.tsx`
- Create: `src/components/ReportSummary.tsx`

**Interfaces:**
- Consumes: `GET /api/clients`(기존 — clinicCode 포함), `GET /api/reports/summary`, `GET /api/reports/series`, `SeriesPoint`·`recommendUnit`·`ratio`·`inclusiveDays`(reportSeries), `ReportResponse`(reportApi)
- Produces: `ReportControls` props `{ clients, value: ReportQuery, onChange, onLoad, loading }` — `ReportQuery = { clientId: string; start: string; end: string; unit: ReportUnit }`. `ReportSummary` props `{ report: ReportResponse; isCalendarMonth: boolean }`. Task 10이 `points: SeriesPoint[]`를 받는 `ReportTrends`를 붙인다.

- [ ] **Step 1: layout.tsx** — tracking/layout.tsx와 동일 구조 (GlobalShell + ToastProvider).

- [ ] **Step 2: 페이지 골격** — `src/app/reports/page.tsx` ('use client'):

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow } from '@/lib/clientStore';
import type { ReportResponse, ReportUnit } from '@/lib/reportApi';
import { inclusiveDays, isCalendarMonth, recommendUnit, type SeriesPoint } from '@/lib/reportSeries';
import { ReportControls, type ReportQuery } from '@/components/ReportControls';
import { ReportSummary } from '@/components/ReportSummary';
import { ReportTrends } from '@/components/ReportTrends'; // Task 10에서 생성 — 그 전까지는 임시로 주석 처리

function lastMonthRange(): { start: string; end: string } {
  const now = new Date(Date.now() + 9 * 3600_000); // KST
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

export default function ReportsPage() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [q, setQ] = useState<ReportQuery>(() => ({ clientId: '', ...lastMonthRange(), unit: 'day' }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [series, setSeries] = useState<{ unit: ReportUnit; points: SeriesPoint[] } | null>(null);

  useEffect(() => {
    apiFetch('/api/clients').then(async (r) => {
      const all = (await r.json()) as ClientRow[];
      const linked = all.filter((c) => c.clinicCode);
      setClients(linked);
      setQ((prev) => ({ ...prev, clientId: linked[0]?.id ?? '' }));
    }).catch(() => setClients([]));
  }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const base = `clientId=${q.clientId}&start=${q.start}&end=${q.end}`;
      const [sr, tr] = await Promise.all([
        apiFetch(`/api/reports/summary?${base}`),
        apiFetch(`/api/reports/series?${base}&unit=${q.unit}`),
      ]);
      if (!sr.ok || !tr.ok) {
        const bad = !sr.ok ? sr : tr;
        setError(((await bad.json()) as { error?: string }).error ?? '리포트를 불러오지 못했어요');
        setReport(null); setSeries(null);
      } else {
        setReport(((await sr.json()) as { report: ReportResponse }).report);
        setSeries(await tr.json());
      }
    } catch { setError('리포트를 불러오지 못했어요 — 잠시 후 다시 시도해 주세요'); }
    setLoading(false);
  };

  const calMonth = useMemo(() => isCalendarMonth(q.start, q.end), [q.start, q.end]);

  if (clients === null) return <main className="p-6 text-x-secondary">불러오는 중…</main>;
  if (clients.length === 0) return (
    <main className="p-6">
      <h1 className="text-xl font-bold">리포트</h1>
      <p className="mt-3 text-x-secondary">아직 리포트가 연결된 클라이언트가 없어요 —
        <a href="/clients" className="text-x-blue-text underline"> 클라이언트 페이지</a>에서 "월간 리포트 연결"을 설정해 주세요.</p>
    </main>
  );
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-bold">리포트</h1>
      <p className="mt-1 text-caption text-x-muted">클리닉과 기간을 고르고 불러오면, 마케팅 성과를 요약·구성·흐름 순서로 보여드려요</p>
      <ReportControls clients={clients} value={q} onChange={setQ} onLoad={load} loading={loading} />
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      {report && <ReportSummary report={report} isCalendarMonth={calMonth} />}
      {series && <ReportTrends unit={series.unit} points={series.points} periodDays={inclusiveDays(q.start, q.end)} />}
    </main>
  );
}
```

- [ ] **Step 3: ReportControls** — `src/components/ReportControls.tsx`:

```tsx
'use client';
import type { ClientRow } from '@/lib/clientStore';
import type { ReportUnit } from '@/lib/reportApi';
import { addDays, bucketRanges, inclusiveDays, recommendUnit } from '@/lib/reportSeries';

export interface ReportQuery { clientId: string; start: string; end: string; unit: ReportUnit }
const UNIT_LABEL: Record<ReportUnit, string> = { day: '일간', week: '주간', month: '월간' };

function kstToday(): string { return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); }
const CHIPS: Array<{ label: string; range: () => { start: string; end: string } }> = [
  { label: '지난달 (보고서용)', range: () => { const t = kstToday(); const first = t.slice(0, 8) + '01';
      return { start: addDays(first, -1).slice(0, 8) + '01', end: addDays(first, -1) }; } },
  { label: '이번 달', range: () => { const t = kstToday(); return { start: t.slice(0, 8) + '01', end: t }; } },
  { label: '최근 7일', range: () => ({ start: addDays(kstToday(), -7), end: addDays(kstToday(), -1) }) },
  { label: '최근 30일', range: () => ({ start: addDays(kstToday(), -30), end: addDays(kstToday(), -1) }) },
  { label: '최근 6개월', range: () => ({ start: addDays(kstToday(), -182), end: addDays(kstToday(), -1) }) },
];

export function ReportControls({ clients, value, onChange, onLoad, loading }: {
  clients: ClientRow[]; value: ReportQuery; onChange: (q: ReportQuery) => void;
  onLoad: () => void; loading: boolean;
}) {
  const setRange = (start: string, end: string) => onChange({ ...value, start, end, unit: recommendUnit(start, end) });
  const buckets = value.start <= value.end ? bucketRanges(value.start, value.end, value.unit).length : 0;
  const tooMany = buckets > 120;
  const inverted = value.start > value.end;
  return (
    <div className="mt-4 rounded-xl border border-x-border bg-x-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={value.clientId} onChange={(e) => onChange({ ...value, clientId: e.target.value })}
                aria-label="클리닉 선택"
                className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px]">
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={value.start} aria-label="시작일"
               onChange={(e) => setRange(e.target.value, value.end)}
               className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px]" />
        <span className="text-x-muted">~</span>
        <input type="date" value={value.end} aria-label="끝일"
               onChange={(e) => setRange(value.start, e.target.value)}
               className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px]" />
        <div role="group" aria-label="단위" className="flex overflow-hidden rounded-md border border-x-border-strong">
          {(['day', 'week', 'month'] as const).map((u) => (
            <button key={u} onClick={() => onChange({ ...value, unit: u })}
                    className={`px-3 py-1.5 text-[13px] ${value.unit === u ? 'bg-x-blue/10 font-bold text-x-blue-text' : 'bg-white text-x-secondary'}`}>
              {UNIT_LABEL[u]}
            </button>
          ))}
        </div>
        <button onClick={onLoad} disabled={loading || tooMany || inverted || !value.clientId}
                className="h-8 rounded-md bg-x-blue px-3 text-[13px] font-bold text-white disabled:opacity-40">
          {loading ? '불러오는 중…' : '리포트 불러오기'}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-x-muted">자주 쓰는 기간:</span>
        {CHIPS.map((c) => (
          <button key={c.label} onClick={() => { const r = c.range(); setRange(r.start, r.end); }}
                  className="rounded-full border border-x-border px-2.5 py-1 text-caption text-x-secondary hover:bg-x-hover">
            {c.label}
          </button>
        ))}
      </div>
      {inverted && <p className="mt-2 text-caption text-red-600">시작이 끝보다 늦어요</p>}
      {tooMany && <p className="mt-2 text-caption text-red-600">
        {UNIT_LABEL[value.unit]} 단위로는 {buckets}칸이라 차트가 읽기 어려워요 — 기간을 줄이거나 단위를 키워 주세요 (최대 120칸)</p>}
    </div>
  );
}
```

- [ ] **Step 4: ReportSummary (①요약 + ②구성)** — `src/components/ReportSummary.tsx`. 데이터 근원: `report.current` / `report.previous`. 표기 규칙(전역 제약)의 null="—"를 헬퍼로 강제:

```tsx
'use client';
import { useState } from 'react';
import type { ReportResponse, ReservationsBlock } from '@/lib/reportApi';
import { ratio } from '@/lib/reportSeries';

const num = (v: number | null | undefined) => v === null || v === undefined ? '—' : v.toLocaleString('ko-KR');
const won = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v.toLocaleString('ko-KR')}원`;
const pct = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;

function Delta({ cur, prev, label }: { cur: number | null | undefined; prev: number | null | undefined; label: string }) {
  if (cur === null || cur === undefined || prev === null || prev === undefined)
    return <span className="text-caption text-x-muted">비교 불가</span>;
  const d = cur - prev;
  return <span className={`text-caption ${d >= 0 ? 'text-green-700' : 'text-amber-700'}`}>
    {d >= 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('ko-KR')} {label}</span>;
}

export function ReportSummary({ report, isCalendarMonth }: { report: ReportResponse; isCalendarMonth: boolean }) {
  const [basis, setBasis] = useState<'created_at' | 'reservation_date'>('created_at');
  const [showXViews, setShowXViews] = useState(false);
  const cur = report.current, prev = report.previous;
  const res: ReservationsBlock | null = cur.reservations?.[basis] ?? null;
  const prevRes = prev?.reservations?.[basis] ?? null;
  const compareLabel = isCalendarMonth ? '전월 대비' : '직전 기간 대비';
  const unavailable = report.unavailable ?? {};
  const cost = cur.costs?.marketing_cost.total;
  const costZero = cost === 0;

  return (
    <section className="mt-6">
      <h2 className="text-base font-bold">① 기간 요약 <span className="text-caption font-normal text-x-muted">({compareLabel} · 방금 조회)</span></h2>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile label="LINE 친구 (기간 끝 기준)" value={num(cur.followers?.total_at_end)}
              sub={cur.followers ? <Delta cur={cur.followers.total_at_end} prev={prev?.followers?.total_at_end} label={compareLabel} /> :
                <span className="text-caption text-x-muted">{unavailable.followers?.message ?? '수집 안 됨'}</span>} />
        <Tile label="인입 고객" value={num(cur.funnel?.active_customers)}
              sub={<Delta cur={cur.funnel?.active_customers} prev={prev?.funnel?.active_customers} label={compareLabel} />} />
        <Tile label="상담" value={num(cur.funnel?.consulted_customers)}
              sub={<Delta cur={cur.funnel?.consulted_customers} prev={prev?.funnel?.consulted_customers} label={compareLabel} />} />
        <Tile label="예약 건수" value={num(res?.reservation_count)}
              sub={<Delta cur={res?.reservation_count} prev={prevRes?.reservation_count} label={compareLabel} />} />
        <Tile label="예약 매출" value={won(res?.revenue.total)}
              sub={<Delta cur={res?.revenue.total} prev={prevRes?.revenue.total} label={compareLabel} />} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-caption text-x-secondary">
        <span>날짜 기준:</span>
        {(['created_at', 'reservation_date'] as const).map((b) => (
          <label key={b} className="flex items-center gap-1">
            <input type="radio" checked={basis === b} onChange={() => setBasis(b)} />
            {b === 'created_at' ? '접수일 (광고 성과용)' : '방문일 (실제 매출용)'}
          </label>
        ))}
        <span className="text-x-muted">— 어느 기준인지 보고서에 함께 적어 주세요</span>
      </div>

      <h2 className="mt-6 text-base font-bold">② 기간 구성</h2>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Panel title="고객 흐름 (인입 → 방문)">
          <FlowBar label="인입" v={cur.funnel?.active_customers ?? null} max={cur.funnel?.active_customers ?? null} />
          <FlowBar label="상담" v={cur.funnel?.consulted_customers ?? null} max={cur.funnel?.active_customers ?? null}
                   conv={ratio(cur.funnel?.consulted_customers, cur.funnel?.active_customers)} />
          <FlowBar label="예약자" v={cur.funnel?.reservers.by_line_id ?? null} max={cur.funnel?.active_customers ?? null}
                   conv={ratio(cur.funnel?.reservers.by_line_id, cur.funnel?.consulted_customers)} />
          <FlowBar label="방문" v={cur.funnel?.visitors.by_line_id ?? null} max={cur.funnel?.active_customers ?? null} />
          <p className="mt-1 text-caption text-x-muted">신규 {num(cur.funnel?.new_customers)} · 기존 {cur.funnel ? num(cur.funnel.active_customers - cur.funnel.new_customers) : '—'} (계산) · 사람 수는 LINE ID 기준</p>
        </Panel>
        <Panel title="지점별 예약 매출">
          {res?.by_branch?.length ? [...res.by_branch].sort((a, b) => b.revenue.total - a.revenue.total).map((b, i) => (
            <FlowBar key={i}
              label={b.branch_name ?? '기타'} v={b.revenue.total} max={Math.max(...res.by_branch!.map((x) => x.revenue.total))}
              suffix={b.in_master ? '' : ' [미등록]'}
              title={b.branch_name === null ? `표기 불명 원본: ${b.source_values.filter(Boolean).join(', ') || '(빈칸)'}` : undefined}
              money />
          )) : <p className="text-caption text-x-muted">지점 분해 없음</p>}
        </Panel>
        <Panel title="매출 구성과 객단가">
          <p className="text-[13px]">초진 {won(res?.revenue.first_visit)} · 재진 {won(res?.revenue.repeat_visit)} ·
            재진 비율 {pct(ratio(res?.revenue.repeat_visit, res?.revenue.total))} (계산)</p>
          <p className="mt-1 text-[13px]">객단가 {won(res && res.reservers.by_line_id ? Math.round(res.revenue.total / res.reservers.by_line_id) : null)}
            <span className="text-caption text-x-muted"> /LINE ID 기준 (계산)</span></p>
          <p className="mt-1 text-[13px]">예약자 {num(res?.reservers.by_line_id)}명(LINE ID) / {num(res?.reservers.by_name)}명(이름) ·
            취소 {num(res?.status_counts.cancelled)} · 노쇼 {num(res?.status_counts.noshow)}</p>
          <p className="mt-1 text-caption text-x-muted">지금 이후 확정 예약 {num(cur.reservations?.upcoming_confirmed)}건
            — 조회 기간과 무관하게 "오늘부터 미래 전체"예요</p>
        </Panel>
        <Panel title="비용">
          {unavailable.costs ? <p className="text-caption text-x-muted">가져오지 못함 — {unavailable.costs.message}</p> : <>
            <p className="text-[13px]">광고비 {won(cost)}{cur.costs?.marketing_cost.by_media.length ?
              ` (${cur.costs.marketing_cost.by_media.map((m) => `${m.media} ${won(m.amount)}`).join(' · ')})` : ''}</p>
            {costZero && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-caption text-amber-800">
              광고비 0원은 "안 썼다"와 "시트에 입력 안 됐다"를 구분할 수 없어요 — 보고서에 쓰기 전에 입력 여부를 확인해 주세요</p>}
            {!costZero && <p className="mt-1 text-[13px]">ROAS {cur.costs?.roas === null || cur.costs?.roas === undefined ? '—' : cur.costs.roas.toFixed(2)} ·
              CPA {won(cur.costs?.cpa.by_line_id)} <span className="text-caption text-x-muted">/LINE ID 기준 · 항상 접수일 기준</span></p>}
            <label className="mt-2 flex items-center gap-1.5 text-caption text-x-muted">
              <input type="checkbox" checked={showXViews} onChange={(e) => setShowXViews(e.target.checked)} />
              X 조회수 표시 (외부 집계 — 부정확할 수 있어 기본은 숨김)
            </label>
            {showXViews && <p className="text-[13px]">X 조회수 증가 {num(cur.costs?.x_views?.change)}
              {cur.costs?.x_views === null && <span className="text-caption text-x-muted"> — 이 클리닉은 X 연동 없음</span>}</p>}
          </>}
        </Panel>
      </div>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return <div className="rounded-lg border border-x-border bg-x-surface p-3">
    <div className="text-caption text-x-muted">{label}</div>
    <div className="text-lg font-bold">{value}</div>
    <div className="mt-0.5">{sub}</div>
  </div>;
}
function FlowBar({ label, v, max, conv, suffix, title, money }: {
  label: string; v: number | null; max: number | null; conv?: number | null; suffix?: string; title?: string; money?: boolean;
}) {
  const w = v !== null && max ? Math.max(2, (v / max) * 100) : 0;
  return <div className="my-1" title={title}>
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-16 shrink-0 text-right text-x-secondary">{label}{suffix}</span>
      <span className="h-3.5 rounded-r bg-x-blue/70" style={{ width: `${w}%` }} />
      <span className="shrink-0 tabular-nums">{v === null ? '—' : money ? `${v.toLocaleString('ko-KR')}원` : v.toLocaleString('ko-KR')}</span>
      {conv !== undefined && <span className="text-caption text-x-muted">{conv === null ? '' : `↓ ${(conv * 100).toFixed(1)}%`}</span>}
    </div>
  </div>;
}
```

(색·클래스 토큰은 리포의 기존 팔레트(`x-blue`, `x-border` 등)를 쓴다 — 실제 토큰명이 다르면 GlobalShell·기존 컴포넌트에서 확인해 맞춘다. `ReportTrends` import는 Task 10 전까지 주석 처리하고 빌드를 깨지 않는다.)

- [ ] **Step 5: 검증 + 커밋**

Run: `npm run lint && npm run build`
Expected: 성공(기준선 24). 커밋:

```bash
git add src/app/reports/ src/components/ReportControls.tsx src/components/ReportSummary.tsx
git commit -m "feat(reports): /reports 페이지 — 컨트롤 + 요약·구성 층"
```

---

### Task 10: 흐름 층 차트 (ReportTrends)

**Files:**
- Create: `src/components/ReportTrends.tsx`
- Modify: `src/app/reports/page.tsx` (주석 처리했던 import·렌더 활성화)

**Interfaces:**
- Consumes: `SeriesPoint`, `movingAverage`(reportSeries)
- Produces: `<ReportTrends unit points periodDays />`

차트 5종(설계 §3층·리서치 근거): 전환율 라인 2선 / 예약 건수 막대 / 매출 스택(초진·재진) / 취소·노쇼율 라인+통상범위 띠(5~8%) / 광고비 막대 + ROAS 라인(별도 차트, 이동평균 병기). 규칙: 이중축 금지, 진행 중 버킷 옅게, missing 버킷은 공백(선 끊김), 일간에서는 ROAS 차트 숨김.

- [ ] **Step 1: 구현** — `src/components/ReportTrends.tsx`:

```tsx
'use client';
import type { ReportUnit } from '@/lib/reportApi';
import { movingAverage, type SeriesPoint } from '@/lib/reportSeries';

const W = 560, H = 120, PAD = 4;

// null 구간에서 선을 끊는 폴리라인 조각들 — "모름"을 보간해 이으면 거짓말이 된다.
function linePaths(values: (number | null)[], max: number): string[] {
  const paths: string[] = []; let seg: string[] = [];
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  values.forEach((v, i) => {
    if (v === null) { if (seg.length > 1) paths.push(seg.join(' ')); seg = []; return; }
    seg.push(`${PAD + i * step},${H - PAD - (max ? (v / max) * (H - PAD * 2) : 0)}`);
  });
  if (seg.length > 1) paths.push(seg.join(' '));
  return paths;
}
const maxOf = (arr: (number | null)[]) => Math.max(1, ...arr.filter((v): v is number => v !== null));

function Chart({ title, desc, children, footer }: { title: string; desc: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return <div className="rounded-lg border border-x-border bg-x-surface p-3">
    <h3 className="text-[13px] font-bold">{title}</h3>
    <p className="mb-2 text-caption text-x-muted">{desc}</p>
    {children}
    {footer && <div className="mt-1 text-caption text-x-muted">{footer}</div>}
  </div>;
}

function Bars({ points, get, color = '#4a72b8', stackGet }: {
  points: SeriesPoint[]; get: (p: SeriesPoint) => number | null; color?: string;
  stackGet?: (p: SeriesPoint) => number | null; // 스택 위칸(옅은 색)
}) {
  const totals = points.map((p) => { const a = get(p), b = stackGet?.(p) ?? 0; return a === null ? null : a + (b ?? 0); });
  const max = maxOf(totals);
  return <div className="flex h-[110px] items-end gap-[2px]">
    {points.map((p, i) => {
      const base = get(p), top = stackGet?.(p) ?? null;
      if (base === null) return <div key={i} className="flex-1 self-stretch rounded-sm bg-x-text/5" title={`${p.start} 미수집`} />;
      return <div key={i} className="flex flex-1 flex-col justify-end gap-[1px]" title={`${p.start}${p.inProgress ? ' (진행 중)' : ''}`}>
        {top !== null && <div style={{ height: `${(top / max) * 100}%`, background: color, opacity: p.inProgress ? 0.25 : 0.45 }} className="rounded-t-sm" />}
        <div style={{ height: `${(base / max) * 100}%`, background: color, opacity: p.inProgress ? 0.35 : 1 }} className={top === null ? 'rounded-t-sm' : ''} />
      </div>;
    })}
  </div>;
}

export function ReportTrends({ unit, points }: { unit: ReportUnit; points: SeriesPoint[]; periodDays: number }) {
  const missing = points.filter((p) => p.missing && !p.inProgress).length;
  const convA = points.map((p) => p.convInflowToConsult);
  const convB = points.map((p) => p.convConsultToReserve);
  const convMax = Math.max(0.01, maxOf(convA), maxOf(convB));
  const cancel = points.map((p) => p.cancelNoshowRate);
  const cancelMax = Math.max(0.1, maxOf(cancel));
  const roas = points.map((p) => p.roas);
  const roasAvg = movingAverage(roas, 3);
  const roasMax = maxOf([...roas, ...roasAvg]);
  const unitLabel = unit === 'day' ? '일간' : unit === 'week' ? '주간(월요일 시작)' : '월간';
  const dash = (p: SeriesPoint) => p.inProgress;

  return (
    <section className="mt-6">
      <h2 className="text-base font-bold">③ 흐름 <span className="text-caption font-normal text-x-muted">({unitLabel} · 저장된 수집분 기준{missing ? ` · 미수집 ${missing}칸은 공백` : ''})</span></h2>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Chart title="다음 단계로 넘어간 비율" desc="인입→상담, 상담→예약이 각각 몇 %였는지 — 선이 내려가면 전환이 약해진 것">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            {linePaths(convA, convMax).map((d, i) => <polyline key={`a${i}`} points={d} fill="none" stroke="#4a72b8" strokeWidth="2" />)}
            {linePaths(convB, convMax).map((d, i) => <polyline key={`b${i}`} points={d} fill="none" stroke="#c2703e" strokeWidth="2" />)}
          </svg>
          <p className="text-caption text-x-muted"><span style={{ color: '#4a72b8' }}>■</span> 인입→상담 <span style={{ color: '#c2703e' }}>■</span> 상담→예약 · 선이 끊긴 곳 = 데이터 없음(0 아님)</p>
        </Chart>
        <Chart title="예약 건수" desc="확정+방문 기준 건수 — 옅은 칸은 아직 진행 중">
          <Bars points={points} get={(p) => p.reservationCount} />
        </Chart>
        <Chart title="매출 (초진/재진)" desc="막대 전체가 그 구간 매출, 아래 진한 부분이 초진">
          <Bars points={points} get={(p) => p.revenueFirst} stackGet={(p) => p.revenueRepeat} />
        </Chart>
        <Chart title="취소·노쇼는 관리되고 있나" desc="취소+노쇼가 전체 예약의 몇 %인지 — 회색 띠가 업계 통상 범위(5~8%)">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            <rect x={0} y={H - PAD - (0.08 / cancelMax) * (H - PAD * 2)} width={W}
                  height={(0.03 / cancelMax) * (H - PAD * 2)} fill="currentColor" opacity="0.08" />
            {linePaths(cancel, cancelMax).map((d, i) => <polyline key={i} points={d} fill="none" stroke="#4a72b8" strokeWidth="2" />)}
          </svg>
        </Chart>
        <Chart title="광고비" desc="구간별 광고비 — 0원인 칸은 시트 미입력일 수 있어요 (0과 미입력을 구분 못 함)">
          <Bars points={points} get={(p) => p.marketingCost} />
        </Chart>
        {unit !== 'day' && (
          <Chart title="ROAS (광고비 대비 매출)" desc="점선은 최근 3구간 평균 — 구간별 값은 출렁임이 커요"
                 footer="광고비가 0이거나 미입력인 구간은 계산하지 않아 선이 끊겨요">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
              {linePaths(roas, roasMax).map((d, i) => <polyline key={`r${i}`} points={d} fill="none" stroke="#4a72b8" strokeWidth="2" />)}
              {linePaths(roasAvg, roasMax).map((d, i) => <polyline key={`m${i}`} points={d} fill="none" stroke="#9aa4b2" strokeWidth="1.5" strokeDasharray="3 3" />)}
            </svg>
          </Chart>
        )}
        {unit === 'day' && <div className="rounded-lg border border-dashed border-x-border p-3 text-caption text-x-muted">
          ROAS·CPA는 일간에서는 보여드리지 않아요 — 하루 단위 값은 출렁임이 커서 오독을 부릅니다. 주간·월간으로 보면 나타나요.</div>}
      </div>
      <p className="mt-2 text-caption text-x-muted">
        x축: {points[0]?.start} ~ {points[points.length - 1]?.end} · 마지막 칸이 옅으면 아직 진행 중인 {unitLabel.slice(0, 1)} — 확정 수치가 아니에요
      </p>
    </section>
  );
}
```

(참고: `dash` 변수처럼 사용하지 않는 잔재가 남지 않게 lint로 정리한다. 호버 툴팁은 `title` 속성으로 시작 — 커스텀 툴팁은 QA 후 필요 시.)

- [ ] **Step 2: page.tsx의 ReportTrends 활성화 + 검증**

Run: `npm run lint && npm run build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add src/components/ReportTrends.tsx src/app/reports/page.tsx
git commit -m "feat(reports): 흐름 층 차트 5종 — null 끊김·진행중 옅게·일간 ROAS 숨김"
```

---

### Task 11: 사이드바 링크 + 화면 통합 확인

**Files:**
- Modify: `src/components/Sidebar.tsx` (globalNav에 리포트 추가)

- [ ] **Step 1: Sidebar globalNav 수정** — 기존 아이콘 컴포넌트들과 같은 형태로 `ReportIcon`을 추가하고(파일 상단 아이콘 정의부에, 기존 아이콘의 props 시그니처를 그대로 따른다):

```tsx
// 기존 아이콘들과 같은 시그니처로:
const ReportIcon = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={p.className} aria-hidden>
    <path d="M4 20V10M10 20V4M16 20v-7" strokeLinecap="round" /><path d="M3 20h18" strokeLinecap="round" />
  </svg>
);
```

globalNav 배열에(트래킹 다음 — "원고가 어떻게 됐는지" 다음에 "캠페인 전체가 어떻게 가고 있는지"로 읽힌다):

```ts
const globalNav = [
  { href: '/generate', label: '콘텐츠 생성', Ic: PenIcon },
  { href: '/influencers', label: '인플루언서', Ic: UserIcon },
  { href: '/tracking', label: '트래킹', Ic: ViewIcon },
  // 캠페인 성과 리포트 — 트래킹(개별 게시물) 다음, 전체 성과로 시야가 넓어지는 순서
  { href: '/reports', label: '리포트', Ic: ReportIcon },
];
```

- [ ] **Step 2: 통합 화면 확인** (memory: next dev 금지 — build+start, 127.0.0.1)

Run: `npm run build && npm start -- -p 3001`
사용자에게 `http://127.0.0.1:3001/reports` 확인 요청(OAuth 게이팅으로 사용자만 로그인 가능): 사이드바 링크, 클라이언트 미연결 안내 → `/clients`에서 코드 연결 → 지난달 불러오기 → 3층 렌더·null 표기·경고 확인.
Expected: 사용자 QA 통과. 문제는 이 태스크에서 수정.

- [ ] **Step 3: 전체 테스트·린트**

Run: `npm test` (~4분, 실 DB), `npm run lint`
Expected: 전부 PASS, 린트 기준선 24 유지.

- [ ] **Step 4: 커밋**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(reports): 사이드바에 리포트 메뉴 추가"
```

---

### Task 12: 배포 준비 (사용자 게이트 — 각 단계 확인 후 진행)

**Files:** 없음 (운영 작업)

- [ ] **Step 1: 프로덕션 마이그레이션** — 028은 Task 1에서 이미 적용됨(이 리포는 로컬=프로덕션 DB). `select 1 from report_snapshot limit 1`로 재확인.

- [ ] **Step 2: 환경변수** — `.vercel/project.json`이 cb-x-deck 프로젝트인지 먼저 확인(메모리: 워크트리가 엉뚱한 프로젝트에 연결된 사례). 그 다음:

```bash
vercel env add REPORT_API_KEY production   # 전달받은 키 (재발급되면 교체)
openssl rand -hex 24 | vercel env add CRON_SECRET production
```

- [ ] **Step 3: 전체 백필 실행** (로컬에서, 사용자에게 시작을 알리고):

Run: `node --import tsx --env-file-if-exists=.env scripts/backfill-reports.ts --from 2026-04-01`
Expected: 15~20분, 완료 로그. `select clinic_code, granularity, min(period_start), max(period_start), count(*) from report_snapshot group by 1,2`로 커버리지 확인.

- [ ] **Step 4: main 머지·배포는 사용자 QA 승인 후** — 리포 관례(사용자가 배포 지시). 배포 후 크론 첫 실행(다음 날 04:00 KST) 결과를 Vercel 로그에서 확인하고, `/reports`에서 어제 날짜 버킷이 채워졌는지 본다.

---

## Self-Review 결과 (계획 검증 완료)

- 스펙 전 항목 ↔ 태스크 대응 확인: 3층 화면(9·10), 표기 규칙(9·10), 스냅샷 테이블·수집(1·4·5·6), 읽기 경로(7), 클리닉 매핑(1·8), 사이드바(11), 보안·환경변수(12), 테스트(각 태스크). X 조회수 기본 숨김은 Task 9의 체크박스(세션 상태)로 구현 — 스펙의 localStorage 영속은 QA 피드백 후 승격(YAGNI).
- 타입 일관성: `SeriesPoint`·`ReportBundles`·`SnapshotRow`·`ReportQuery` 정의(2·3·4·9)와 사용처(5·6·7·9·10) 대조 완료.
- 알려진 조정 지점(구현자가 판단): postgres.js 조각 삽입 문법(Task 1), Vercel Cron의 HTTP 메서드(Task 5), 디자인 토큰명(Task 9·10) — 각 태스크에 대안 명시.
