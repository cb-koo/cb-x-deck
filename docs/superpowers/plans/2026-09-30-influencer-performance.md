# 인플루언서 성과 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업을 한 인플 전원을 한 표에 놓고 우리 캠페인 성과(조회·조회당 비용·참여율·반응·확산)의 중앙값/평균으로 줄 세워, 캠페인 참여 인플을 빠르게 선별하는 `/influencers/performance` 화면.

**Architecture:** 스토어가 SQL 한 번으로 "취소 안 된 배정 작업 + 작업별 최신 스냅샷 합 + 명부" 행을 읽고 인플별로 묶어 API로 내려준다. 순수 계산 모듈이 행 집계(건수·중앙값/평균·표본 수)와 정렬·주소 쿼리를 맡고, 화면은 클라이언트에서 이 모듈로 바로 전환·정렬한다(데이터 약 113건). DB 변경 없음.

**Tech Stack:** Next.js App Router(이 리포 버전 — 코드 쓰기 전 `node_modules/next/dist/docs/` 확인), TypeScript, `postgres`(porsager), Tailwind(`x-*` 토큰), `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-30-influencer-performance-design.md` — 모든 태스크는 이 스펙이 우선이다.

## Global Constraints

- 작업 폴더: `/Users/koo_clinicbridge/cb-x-deck/.worktrees/influencer-performance` (브랜치 `cb-koo/influencer-performance`). 원 저장소 루트로 `cd` 하지 않는다.
- **커밋은 경로를 명시해 스테이징**한다(`git add -A` 금지). **push·머지·배포 금지**(main push = 운영 자동 배포).
- 마이그레이션 추가 금지(이번 작업은 DB 변경 0).
- 단일 테스트 파일: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test <파일>` (DB 테스트는 연습용 DB. 운영이면 testGuard가 막는다 — 막히면 멈추고 보고).
- 순수 테스트(DB 없음)는 `node --import tsx --test <파일>`.
- 타입 확인: `npx tsc --noEmit -p .` / 린트: `npx eslint <파일들>` — 새 파일에서 새 경고·오류 0.
- 파일 상단·주석 문체는 리포 관례(한국어, 짧게, "왜"를 적는다). 
- 화면 문구 규칙(AGENTS.md UX 원칙): 사용자 말, 내부 용어 금지. 가독성: 본문 14~15px(`text-ui` 등 기존 토큰), 행 높이 44px 이상, **한 행 = 한 줄**(줄바꿈 금지 `whitespace-nowrap`).
- 값 없음 표기는 `—`.
- 유형 라벨: `TASK_TYPE_LABEL`(`src/lib/campaignJudgment.ts`) = `{ post:'투고', quoteRt:'인용RT', rt:'RT', visit:'방문협찬' }`, 표시 순서 `DISPLAY_TYPE_ORDER`(`src/lib/campaignFlowView.ts`) = `['post','quoteRt','rt','visit']`.
- 엔화 환산: `toKrw`(`src/lib/clientBudget.ts`, 1엔=10원). 중앙값: `median`(`src/lib/analysisStats.ts`).

## File Structure

| 파일 | 책임 |
|---|---|
| Create `src/lib/influencerPerformance.ts` | 순수 계산: 타입, 인플 1명 집계(`summarizeInfluencer`), 정렬(`sortPerfRows`), 첫 정렬 방향, 주소 쿼리 파싱/직렬화, 표시 포맷 |
| Create `src/lib/influencerPerformance.test.ts` | 계산 규칙 고정(DB 없음) |
| Create `src/lib/influencerPerformanceStore.ts` | SQL 1회 → `PerfInfluencerInput[]` |
| Create `src/lib/influencerPerformanceStore.test.ts` | 연습용 DB: 취소 제외·다게시물 합·명부 조인 |
| Create `src/app/api/influencers/performance/route.ts` | `GET` → `PerfRow[]` |
| Create `src/app/influencers/performance/page.tsx` | 화면: 로드·토글·정렬·주소 상태 |
| Create `src/app/influencers/performance/InfluencerPerfTable.tsx` | 표 + 펼침 행 |
| Modify `src/components/Sidebar.tsx:70` | `인플루언서` 아래 메뉴 1줄 |
| Modify `src/content/updates.ts` | 업데이트 소식 1건(맨 위) |

---

### Task 1: 계산 모듈

**Files:**
- Create: `src/lib/influencerPerformance.ts`
- Test: `src/lib/influencerPerformance.test.ts`

**Interfaces:**
- Consumes: `median(nums: number[]): number | null` (`./analysisStats.ts`), `toKrw(m: MoneyByCurrency): { krw: number }` (`./clientBudget.ts`), `type TaskType` (`./campaignJudgment.ts`), `type TaskCost = { amount: number; currency: 'KRW'|'JPY' }` (`./campaignCost.ts`)
- Produces (이 이름·타입 그대로 Task 2·3이 쓴다):

```ts
export interface PerfTaskMetrics { postCount: number; views: number | null; likes: number | null; replies: number | null; bookmarks: number | null; retweets: number | null; quotes: number | null }
export interface PerfTask { id: string; campaignId: string; campaignName: string; type: TaskType; postedAt: string | null; postUrl: string | null; cost: TaskCost | null; metrics: PerfTaskMetrics | null }
export interface PerfInfluencerInput { handle: string; influencerId: string | null; displayName: string | null; avatarUrl: string | null; isBlueVerified: boolean | null; tasks: PerfTask[] }
export type MetricKey = 'views' | 'cpv' | 'engagement' | 'likes' | 'replies' | 'bookmarks' | 'retweets' | 'quotes';
export interface MetricStat { median: number | null; mean: number | null; n: number }
export interface PerfRow extends Omit<PerfInfluencerInput, 'tasks'> { campaignCount: number; lastPostedAt: string | null; typeCounts: Record<TaskType, number>; postedContentTasks: number; stats: Record<MetricKey, MetricStat>; tasks: PerfTask[] }
export type Agg = 'median' | 'mean';
export type SortKey = MetricKey | 'campaigns' | 'lastPosted' | 'n_post' | 'n_quoteRt' | 'n_rt' | 'n_visit';
export type SortDir = 'asc' | 'desc';
export const METRIC_KEYS: readonly MetricKey[];
export const CONTENT_TYPES: readonly TaskType[];            // ['post','quoteRt','visit']
export function taskEngagement(m: PerfTaskMetrics | null): number | null;
export function taskCpv(t: PerfTask): number | null;
export function summarizeInfluencer(inf: PerfInfluencerInput): PerfRow;
export function firstDir(key: SortKey): SortDir;             // cpv만 'asc'
export function sortPerfRows(rows: PerfRow[], key: SortKey, dir: SortDir, agg: Agg): PerfRow[];
export interface PerfQuery { sort: SortKey; dir: SortDir; agg: Agg }
export const DEFAULT_QUERY: PerfQuery;                        // { sort:'views', dir:'desc', agg:'median' }
export function parsePerfQuery(get: (k: string) => string | null): PerfQuery;
export function perfQueryString(q: PerfQuery): string;       // 기본값인 키는 생략, 전부 기본이면 ''
export function formatMetric(key: MetricKey, v: number | null): string;
export function viewsSampleNote(r: PerfRow): string | null;  // 표본 ≠ 게시된 게시물 작업일 때만 'n/m'
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/influencerPerformance.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeInfluencer, sortPerfRows, firstDir, parsePerfQuery, perfQueryString, DEFAULT_QUERY,
  taskEngagement, taskCpv, formatMetric, viewsSampleNote,
  type PerfTask, type PerfInfluencerInput, type PerfTaskMetrics,
} from './influencerPerformance.ts';

const m = (views: number | null, x: Partial<PerfTaskMetrics> = {}): PerfTaskMetrics =>
  ({ postCount: 1, views, likes: 10, replies: 2, bookmarks: 3, retweets: 4, quotes: 1, ...x });
let seq = 0;
const task = (x: Partial<PerfTask> = {}): PerfTask => ({
  id: 't' + ++seq, campaignId: 'c1', campaignName: '캠1', type: 'quoteRt', postedAt: '2026-09-10',
  postUrl: 'https://x.com/a/status/1', cost: { amount: 10000, currency: 'KRW' }, metrics: m(1000), ...x,
});
const inf = (tasks: PerfTask[], x: Partial<PerfInfluencerInput> = {}): PerfInfluencerInput =>
  ({ handle: 'rio', influencerId: 'i1', displayName: '리오', avatarUrl: null, isBlueVerified: false, tasks, ...x });

test('RT는 건수에만 — 성과 표본에서 빠진다', () => {
  const r = summarizeInfluencer(inf([task({ metrics: m(1000) }), task({ type: 'rt', metrics: m(999999) })]));
  assert.equal(r.typeCounts.rt, 1);
  assert.equal(r.typeCounts.quoteRt, 1);
  assert.equal(r.stats.views.n, 1);
  assert.equal(r.stats.views.median, 1000);
});

test('RT만 한 인플은 성과 전부 null·n 0', () => {
  const r = summarizeInfluencer(inf([task({ type: 'rt' }), task({ type: 'rt' })]));
  for (const s of Object.values(r.stats)) { assert.equal(s.median, null); assert.equal(s.mean, null); assert.equal(s.n, 0); }
  assert.equal(r.postedContentTasks, 0);
});

test('중앙값·평균 — 짝수 표본', () => {
  const r = summarizeInfluencer(inf([task({ metrics: m(100) }), task({ metrics: m(300) }), task({ metrics: m(1100) }), task({ metrics: m(500) })]));
  assert.equal(r.stats.views.median, 400);
  assert.equal(r.stats.views.mean, 500);
});

test('조회 null 작업은 표본 제외 + 표본/게시된 게시물 작업 표시', () => {
  const r = summarizeInfluencer(inf([task({ metrics: m(1000) }), task({ metrics: m(null) }), task({ metrics: null })]));
  assert.equal(r.stats.views.n, 1);
  assert.equal(r.postedContentTasks, 3);
  assert.equal(viewsSampleNote(r), '1/3');
});

test('게시 전 작업은 표본 분모(게시된 게시물 작업)에 안 들어간다', () => {
  const r = summarizeInfluencer(inf([task({ metrics: m(1000) }), task({ postedAt: null, postUrl: null, metrics: null })]));
  assert.equal(r.typeCounts.quoteRt, 2);         // 작업 건수엔 들어간다
  assert.equal(r.postedContentTasks, 1);
  assert.equal(viewsSampleNote(r), null);        // 어긋남 없음 → 표시 안 함
});

test('참여율 = 공개 반응 5종 ÷ 조회, 작업별 비율의 중앙값(합의 비율 아님)', () => {
  // 작업1: (10+2+3+4+1)/100 = 0.2, 작업2: 20/10000 = 0.002 → 중앙값 0.101, 합의 비율이면 40/10100
  const r = summarizeInfluencer(inf([task({ metrics: m(100) }), task({ metrics: m(10000) })]));
  assert.ok(Math.abs((r.stats.engagement.median ?? 0) - 0.101) < 1e-9);
  assert.equal(taskEngagement(m(0)), null);                       // 조회 0 제외
  assert.equal(taskEngagement(m(100, { bookmarks: null })), null); // 반응 하나라도 null → 제외
  assert.equal(taskEngagement(null), null);
});

test('반응 지표 null은 그 지표 표본에서만 빠진다', () => {
  const r = summarizeInfluencer(inf([task({ metrics: m(100, { likes: null }) }), task({ metrics: m(200, { likes: 50 }) })]));
  assert.equal(r.stats.views.n, 2);
  assert.equal(r.stats.likes.n, 1);
  assert.equal(r.stats.likes.median, 50);
});

test('조회당 비용 — 엔화 1엔=10원, 비용 null·조회 0 제외', () => {
  assert.equal(taskCpv(task({ cost: { amount: 1000, currency: 'JPY' }, metrics: m(1000) })), 10);
  assert.equal(taskCpv(task({ cost: { amount: 5000, currency: 'KRW' }, metrics: m(1000) })), 5);
  assert.equal(taskCpv(task({ cost: null })), null);
  assert.equal(taskCpv(task({ metrics: m(0) })), null);
  assert.equal(taskCpv(task({ type: 'rt' })), null);   // RT 비용은 조회당 비용에 안 섞는다
});

test('캠페인 수는 서로 다른 캠페인, 최근 게시일은 게시된 작업만', () => {
  const r = summarizeInfluencer(inf([
    task({ campaignId: 'c1', postedAt: '2026-09-03' }), task({ campaignId: 'c1', postedAt: '2026-09-20' }),
    task({ campaignId: 'c2', postedAt: null, postUrl: null, metrics: null }),
  ]));
  assert.equal(r.campaignCount, 2);
  assert.equal(r.lastPostedAt, '2026-09-20');
  assert.equal(summarizeInfluencer(inf([task({ postedAt: null })])).lastPostedAt, null);
});

test('펼침용 작업 순서 — 게시일 내림차순, 게시 전은 맨 아래', () => {
  const r = summarizeInfluencer(inf([
    task({ id: 'a', postedAt: '2026-09-03' }), task({ id: 'b', postedAt: null }), task({ id: 'c', postedAt: '2026-09-20' }),
  ]));
  assert.deepEqual(r.tasks.map((t) => t.id), ['c', 'a', 'b']);
});

test('정렬 — 방향 무관 null 맨 아래, 동점은 핸들 순', () => {
  const rows = [
    summarizeInfluencer(inf([task({ metrics: m(500) })], { handle: 'b' })),
    summarizeInfluencer(inf([task({ type: 'rt' })], { handle: 'none' })),
    summarizeInfluencer(inf([task({ metrics: m(900) })], { handle: 'c' })),
    summarizeInfluencer(inf([task({ metrics: m(500) })], { handle: 'a' })),
  ];
  assert.deepEqual(sortPerfRows(rows, 'views', 'desc', 'median').map((r) => r.handle), ['c', 'a', 'b', 'none']);
  assert.deepEqual(sortPerfRows(rows, 'views', 'asc', 'median').map((r) => r.handle), ['a', 'b', 'c', 'none']);
  assert.deepEqual(sortPerfRows(rows, 'n_rt', 'desc', 'median').map((r) => r.handle)[0], 'none');
  assert.deepEqual(sortPerfRows(rows, 'lastPosted', 'desc', 'median').map((r) => r.handle).at(-1), 'none');
});

test('정렬은 선택한 기준(중앙값/평균)을 쓴다', () => {
  const skew = summarizeInfluencer(inf([task({ metrics: m(100) }), task({ metrics: m(100) }), task({ metrics: m(10000) })], { handle: 'skew' })); // 중앙 100, 평균 3400
  const flat = summarizeInfluencer(inf([task({ metrics: m(1000) })], { handle: 'flat' }));
  assert.equal(sortPerfRows([skew, flat], 'views', 'desc', 'median')[0].handle, 'flat');
  assert.equal(sortPerfRows([skew, flat], 'views', 'desc', 'mean')[0].handle, 'skew');
});

test('첫 정렬 방향 — 조회당 비용만 낮은 순', () => {
  assert.equal(firstDir('cpv'), 'asc');
  assert.equal(firstDir('views'), 'desc');
  assert.equal(firstDir('lastPosted'), 'desc');
});

test('주소 쿼리 — 왕복·틀린 값은 기본값·기본값은 생략', () => {
  const q = { sort: 'cpv' as const, dir: 'asc' as const, agg: 'mean' as const };
  const s = perfQueryString(q);
  const p = new URLSearchParams(s);
  assert.deepEqual(parsePerfQuery((k) => p.get(k)), q);
  assert.equal(perfQueryString(DEFAULT_QUERY), '');
  assert.deepEqual(parsePerfQuery((k) => ({ sort: 'zzz', dir: 'up', agg: 'x' } as Record<string, string>)[k] ?? null), DEFAULT_QUERY);
  // sort만 있고 dir이 없으면 그 열의 첫 방향
  assert.deepEqual(parsePerfQuery((k) => (k === 'sort' ? 'cpv' : null)), { sort: 'cpv', dir: 'asc', agg: 'median' });
});

test('표시 포맷', () => {
  assert.equal(formatMetric('views', null), '—');
  assert.equal(formatMetric('engagement', 0.0254), '2.5%');
  assert.equal(formatMetric('cpv', 4.06), '4.1원');
  assert.equal(formatMetric('likes', 210.5), '211');
  assert.equal(formatMetric('views', 12000), '1.2만');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/influencerPerformance.test.ts`
Expected: FAIL (`Cannot find module './influencerPerformance.ts'`)

- [ ] **Step 3: 구현**

`src/lib/influencerPerformance.ts`:

```ts
// 인플루언서 성과 비교 — 순수 계산(DB·네트워크 없음). 스펙 docs/superpowers/specs/2026-09-30-influencer-performance-design.md
// 저장소가 넘긴 "작업 + 작업별 최신 스냅샷 합"을 인플 1행으로 요약하고, 정렬·주소 쿼리를 맡는다. 화면이 전환·정렬 때 바로 부른다.
import { median } from './analysisStats.ts';
import { toKrw } from './clientBudget.ts';
import { formatKoCount } from './formatKo.ts';
import type { TaskType } from './campaignJudgment.ts';
import type { TaskCost } from './campaignCost.ts';

export interface PerfTaskMetrics { postCount: number; views: number | null; likes: number | null; replies: number | null; bookmarks: number | null; retweets: number | null; quotes: number | null }
export interface PerfTask { id: string; campaignId: string; campaignName: string; type: TaskType; postedAt: string | null; postUrl: string | null; cost: TaskCost | null; metrics: PerfTaskMetrics | null }
export interface PerfInfluencerInput { handle: string; influencerId: string | null; displayName: string | null; avatarUrl: string | null; isBlueVerified: boolean | null; tasks: PerfTask[] }
export type MetricKey = 'views' | 'cpv' | 'engagement' | 'likes' | 'replies' | 'bookmarks' | 'retweets' | 'quotes';
export interface MetricStat { median: number | null; mean: number | null; n: number }
export interface PerfRow extends Omit<PerfInfluencerInput, 'tasks'> {
  campaignCount: number; lastPostedAt: string | null; typeCounts: Record<TaskType, number>;
  postedContentTasks: number;   // 게시된 게시물 작업(투고·인용RT·방문협찬) — 조회 표본의 분모(스펙 §4-3)
  stats: Record<MetricKey, MetricStat>; tasks: PerfTask[];
}
export type Agg = 'median' | 'mean';
export type SortKey = MetricKey | 'campaigns' | 'lastPosted' | 'n_post' | 'n_quoteRt' | 'n_rt' | 'n_visit';
export type SortDir = 'asc' | 'desc';

export const METRIC_KEYS: readonly MetricKey[] = ['views', 'cpv', 'engagement', 'likes', 'replies', 'bookmarks', 'retweets', 'quotes'];
// 자기 게시물이 있는 유형 — RT는 조회가 원글에 쌓여 인플 몫이 없다(스펙 §4-1)
export const CONTENT_TYPES: readonly TaskType[] = ['post', 'quoteRt', 'visit'];
const isContent = (t: PerfTask) => CONTENT_TYPES.includes(t.type);
const isPosted = (t: PerfTask) => t.postedAt !== null || t.postUrl !== null;

// 참여율 — 공개 반응 5종 ÷ 조회. 하나라도 없으면 null(0으로 채우면 낮게 왜곡), 조회 0도 null.
export function taskEngagement(m: PerfTaskMetrics | null): number | null {
  if (!m || !m.views) return null;
  const parts = [m.likes, m.replies, m.bookmarks, m.retweets, m.quotes];
  if (parts.some((v) => v === null)) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0) / m.views;
}

// 조회당 비용(원) — 게시물 작업의 비용만. 엔화는 1엔=10원.
export function taskCpv(t: PerfTask): number | null {
  if (!isContent(t) || !t.cost || !t.metrics?.views) return null;
  return toKrw({ [t.cost.currency]: t.cost.amount }).krw / t.metrics.views;
}

function stat(values: Array<number | null>): MetricStat {
  const xs = values.filter((v): v is number => v !== null);
  return { median: median(xs), mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
}

export function summarizeInfluencer(inf: PerfInfluencerInput): PerfRow {
  const { tasks, ...who } = inf;
  const typeCounts: Record<TaskType, number> = { post: 0, quoteRt: 0, rt: 0, visit: 0 };
  for (const t of tasks) typeCounts[t.type] += 1;
  const posted = tasks.map((t) => t.postedAt).filter((d): d is string => d !== null).sort();
  // 성과 표본 = 게시물 작업 중 조회가 수집된 것(스펙 §4-1)
  const sample = tasks.filter((t) => isContent(t) && t.metrics?.views != null);
  const pick = (k: 'likes' | 'replies' | 'bookmarks' | 'retweets' | 'quotes') => sample.map((t) => t.metrics![k]);
  const stats: Record<MetricKey, MetricStat> = {
    views: stat(sample.map((t) => t.metrics!.views)),
    cpv: stat(sample.map(taskCpv)),
    engagement: stat(sample.map((t) => taskEngagement(t.metrics))),
    likes: stat(pick('likes')), replies: stat(pick('replies')), bookmarks: stat(pick('bookmarks')),
    retweets: stat(pick('retweets')), quotes: stat(pick('quotes')),
  };
  const ordered = [...tasks].sort((a, b) =>
    a.postedAt === b.postedAt ? 0 : a.postedAt === null ? 1 : b.postedAt === null ? -1 : b.postedAt.localeCompare(a.postedAt));
  return {
    ...who,
    campaignCount: new Set(tasks.map((t) => t.campaignId)).size,
    lastPostedAt: posted.at(-1) ?? null,
    typeCounts,
    postedContentTasks: tasks.filter((t) => isContent(t) && isPosted(t)).length,
    stats,
    tasks: ordered,
  };
}

// 첫 클릭은 "좋은 쪽부터" — 조회당 비용만 싼 쪽이 좋다(스펙 §4)
export const firstDir = (key: SortKey): SortDir => (key === 'cpv' ? 'asc' : 'desc');

function sortValue(r: PerfRow, key: SortKey, agg: Agg): number | string | null {
  switch (key) {
    case 'campaigns': return r.campaignCount;
    case 'lastPosted': return r.lastPostedAt;
    case 'n_post': return r.typeCounts.post;
    case 'n_quoteRt': return r.typeCounts.quoteRt;
    case 'n_rt': return r.typeCounts.rt;
    case 'n_visit': return r.typeCounts.visit;
    default: return r.stats[key][agg];
  }
}

// 값 없음은 방향과 무관하게 맨 아래, 동점은 핸들 순(안정적인 순서)
export function sortPerfRows(rows: PerfRow[], key: SortKey, dir: SortDir, agg: Agg): PerfRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key, agg); const vb = sortValue(b, key, agg);
    if (va === null && vb === null) return a.handle.localeCompare(b.handle);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
    return c !== 0 ? sign * c : a.handle.localeCompare(b.handle);
  });
}

export interface PerfQuery { sort: SortKey; dir: SortDir; agg: Agg }
export const DEFAULT_QUERY: PerfQuery = { sort: 'views', dir: 'desc', agg: 'median' };
const SORT_KEYS: readonly SortKey[] = [...METRIC_KEYS, 'campaigns', 'lastPosted', 'n_post', 'n_quoteRt', 'n_rt', 'n_visit'];

export function parsePerfQuery(get: (k: string) => string | null): PerfQuery {
  const s = get('sort');
  const sort = SORT_KEYS.includes(s as SortKey) ? (s as SortKey) : DEFAULT_QUERY.sort;
  const d = get('dir');
  const dir: SortDir = d === 'asc' || d === 'desc' ? d : firstDir(sort);
  const agg: Agg = get('agg') === 'mean' ? 'mean' : 'median';
  return { sort, dir, agg };
}

// 기본값인 키는 주소에서 뺀다 — 처음 들어온 주소가 깨끗하게
export function perfQueryString(q: PerfQuery): string {
  const p = new URLSearchParams();
  if (q.sort !== DEFAULT_QUERY.sort) p.set('sort', q.sort);
  if (q.dir !== firstDir(q.sort)) p.set('dir', q.dir);
  if (q.agg !== DEFAULT_QUERY.agg) p.set('agg', q.agg);
  return p.toString();
}

export function formatMetric(key: MetricKey, v: number | null): string {
  if (v === null) return '—';
  if (key === 'engagement') return `${(v * 100).toFixed(1)}%`;
  if (key === 'cpv') return `${v.toFixed(1)}원`;
  return formatKoCount(Math.round(v));
}

// 조회 표본이 게시된 게시물 작업보다 적을 때만 'n/m'(스펙 §4-3) — 평소엔 숫자만
export function viewsSampleNote(r: PerfRow): string | null {
  return r.postedContentTasks > 0 && r.stats.views.n !== r.postedContentTasks ? `${r.stats.views.n}/${r.postedContentTasks}` : null;
}
```

(`formatKoCount(12000)` = `'1.2만'` 확인함.)

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/influencerPerformance.test.ts`
Expected: 전 테스트 PASS. 이어서 `npx tsc --noEmit -p .` 오류 0, `npx eslint src/lib/influencerPerformance.ts src/lib/influencerPerformance.test.ts` 오류 0.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/influencerPerformance.ts src/lib/influencerPerformance.test.ts
git commit -m "feat(influencer-perf): 인플 성과 요약·정렬 계산 모듈

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 스토어 + API

**Files:**
- Create: `src/lib/influencerPerformanceStore.ts`
- Test: `src/lib/influencerPerformanceStore.test.ts`
- Create: `src/app/api/influencers/performance/route.ts`

**Interfaces:**
- Consumes: Task 1의 `PerfInfluencerInput`, `PerfTask`, `summarizeInfluencer`, `PerfRow`. `getSql()`(`@/lib/db`), `requireAllowedUser()`(`@/lib/authGuard` — `{ response }`가 있으면 그걸 돌려준다).
- Produces: `listInfluencerPerformance(sql: postgres.Sql): Promise<PerfInfluencerInput[]>`, `GET /api/influencers/performance` → `PerfRow[]`(JSON).

- [ ] **Step 1: 실패하는 DB 테스트 작성**

테스트 데이터 만드는 법은 `src/lib/campaignTaskStore.test.ts`·`src/lib/campaignStore.test.ts:90`(tracked_post 직접 insert)의 관례를 따른다. 연습용 DB엔 다른 데이터도 있으니 결과를 접두어 핸들로 걸러서 본다.

`src/lib/influencerPerformanceStore.test.ts`:

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createInfluencer } from './influencerStore.ts';
import { createTasks } from './campaignTaskStore.ts';
import { listInfluencerPerformance } from './influencerPerformanceStore.ts';

const sql = getSql();
const P = 'tipf' + process.pid;

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

const base = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
const snap = (tpId: string, v: Record<string, number | null>, at: string) =>
  sql`insert into post_metric_snapshot (tracked_post_id, views, likes, retweets, replies, bookmarks, quotes, captured_at)
      values (${tpId}, ${v.views}, ${v.likes}, ${v.retweets}, ${v.replies}, ${v.bookmarks}, ${v.quotes}, ${at})`;

test('취소 제외·게시물 여러 개는 최신 스냅샷 합·명부 조인·명부 밖 핸들', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + '캠', nameEn: `${P}-a`,
    startsOn: '2026-09-01', endsOn: '2026-09-06', kind: null, note: '', createdBy: null,
  });
  const { row: roster } = await createInfluencer(sql, { handle: P + 'Rio', createdBy: null });

  const [q1] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', items: [{ handle: (P + 'rio').toUpperCase(), cost: { amount: 1000, currency: 'JPY' } }] });
  const [cancelled] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', items: [{ handle: P + 'rio', cost: null }] });
  await createTasks(sql, camp.id, { ...base, type: 'rt', items: [{ handle: P + 'ghost', cost: null }] });
  await sql`update campaign_task set cancelled_at = now() where id = ${cancelled.id}`;
  await sql`update campaign_task set posted_at = '2026-09-03', post_url = 'https://x.com/r/status/1' where id = ${q1.id}`;

  // 작업 q1에 게시물 2개 — 각자 최신 스냅샷만 합산
  const [tp1] = await sql<Array<{ id: string }>>`insert into tracked_post (tweet_id, author_handle, text, task_id) values (${P + 'x1'}, 'rio', '', ${q1.id}) returning id`;
  const [tp2] = await sql<Array<{ id: string }>>`insert into tracked_post (tweet_id, author_handle, text, task_id) values (${P + 'x2'}, 'rio', '', ${q1.id}) returning id`;
  await snap(tp1.id, { views: 50, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 }, '2026-09-04T00:00:00Z');
  await snap(tp1.id, { views: 100, likes: 5, retweets: 1, replies: 1, bookmarks: 2, quotes: 0 }, '2026-09-05T00:00:00Z');
  await snap(tp2.id, { views: 20, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 1 }, '2026-09-05T00:00:00Z');

  const all = await listInfluencerPerformance(sql);
  const mine = all.filter((r) => r.handle.toLowerCase().startsWith(P));
  assert.equal(mine.length, 2);

  const rio = mine.find((r) => r.influencerId === roster.id)!;
  assert.equal(rio.handle, roster.handle);          // 명부 표기를 쓴다
  assert.equal(rio.tasks.length, 1);                 // 취소 작업은 없다
  const t = rio.tasks[0];
  assert.equal(t.campaignName, P + '캠');
  assert.equal(t.postedAt, '2026-09-03');
  assert.deepEqual(t.cost, { amount: 1000, currency: 'JPY' });
  assert.deepEqual(t.metrics, { postCount: 2, views: 120, likes: 6, replies: 1, bookmarks: 2, retweets: 1, quotes: 1 });

  const ghost = mine.find((r) => r.handle === P + 'ghost')!;
  assert.equal(ghost.influencerId, null);
  assert.equal(ghost.tasks[0].type, 'rt');
  assert.equal(ghost.tasks[0].metrics, null);        // 게시물 없음
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/influencerPerformanceStore.test.ts`
Expected: FAIL (모듈 없음). testGuard가 운영 DB라며 막으면 멈추고 보고한다.

- [ ] **Step 3: 스토어 구현**

`src/lib/influencerPerformanceStore.ts`:

```ts
// 인플루언서 성과 — 취소 안 된 배정 작업 + 작업별 최신 스냅샷 합 + 명부를 한 번에 읽어 인플별로 묶는다(스펙 §7).
// 작업 지표는 캠페인 화면(campaignStore.getCampaignDetail)과 같은 방식 — 게시물마다 최신 1건(lateral)을 합산해 두 화면 숫자가 같다.
import type postgres from 'postgres';
import type { PerfInfluencerInput, PerfTask } from './influencerPerformance.ts';
import type { TaskType } from './campaignJudgment.ts';
import { parseTaskCost, type TaskCost } from './campaignCost.ts';

type Row = {
  id: string; campaign_id: string; campaign_name: string; type: TaskType; influencer_handle: string;
  posted_at: string | null; post_url: string | null; cost: unknown;
  post_count: number; views: string | null; likes: string | null; replies: string | null;
  bookmarks: string | null; retweets: string | null; quotes: string | null;
  influencer_id: string | null; roster_handle: string | null; display_name: string | null;
  avatar_url: string | null; is_blue_verified: boolean | null;
};
const num = (v: string | number | null) => (v === null ? null : Number(v)); // sum()은 문자열로 온다
// jsonb 모양은 보증되지 않는다 — 검증 통과분만(campaignTaskStore.costOf 태도)
function costOf(v: unknown): TaskCost | null { const p = parseTaskCost(v ?? null); return p.ok ? p.value : null; }

export async function listInfluencerPerformance(sql: postgres.Sql): Promise<PerfInfluencerInput[]> {
  const rows = await sql<Row[]>`
    select t.id, t.campaign_id, c.name as campaign_name, t.type, t.influencer_handle,
           to_char(t.posted_at, 'YYYY-MM-DD') as posted_at, t.post_url, t.cost,
           p.post_count, p.views, p.likes, p.replies, p.bookmarks, p.retweets, p.quotes,
           i.id as influencer_id, i.handle as roster_handle, i.display_name, i.avatar_url, i.is_blue_verified
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join lateral (
        select count(tp.id)::int as post_count, sum(s.views) as views, sum(s.likes) as likes, sum(s.replies) as replies,
               sum(s.bookmarks) as bookmarks, sum(s.retweets) as retweets, sum(s.quotes) as quotes
          from tracked_post tp
          left join lateral (
            select views, likes, replies, bookmarks, retweets, quotes from post_metric_snapshot
             where tracked_post_id = tp.id order by captured_at desc limit 1
          ) s on true
         where tp.task_id = t.id
      ) p on true
      left join influencer i on lower(i.handle) = lower(t.influencer_handle)
     where t.cancelled_at is null and t.influencer_handle is not null
     order by t.created_at`;

  const byHandle = new Map<string, PerfInfluencerInput>();
  for (const r of rows) {
    const key = r.influencer_handle.toLowerCase();
    let inf = byHandle.get(key);
    if (!inf) {
      inf = {
        handle: r.roster_handle ?? r.influencer_handle, influencerId: r.influencer_id, displayName: r.display_name,
        avatarUrl: r.avatar_url, isBlueVerified: r.is_blue_verified, tasks: [],
      };
      byHandle.set(key, inf);
    }
    const task: PerfTask = {
      id: r.id, campaignId: r.campaign_id, campaignName: r.campaign_name, type: r.type,
      postedAt: r.posted_at, postUrl: r.post_url, cost: costOf(r.cost),
      metrics: r.post_count > 0 ? {
        postCount: r.post_count, views: num(r.views), likes: num(r.likes), replies: num(r.replies),
        bookmarks: num(r.bookmarks), retweets: num(r.retweets), quotes: num(r.quotes),
      } : null,
    };
    inf.tasks.push(task);
  }
  return [...byHandle.values()];
}
```

**cost 검증:** jsonb 모양은 보증되지 않으므로 `campaignTaskStore.ts`의 `costOf` 태도를 따른다 — `Row.cost`를 `unknown`으로 받고, `parseTaskCost`(`./campaignCost.ts`)로 검증해 `const p = parseTaskCost(r.cost ?? null); cost: p.ok ? p.value : null`로 넣는다.

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test src/lib/influencerPerformanceStore.test.ts`
Expected: PASS

- [ ] **Step 5: API 라우트**

`src/app/api/influencers/performance/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listInfluencerPerformance } from '@/lib/influencerPerformanceStore';
import { summarizeInfluencer } from '@/lib/influencerPerformance';

// 인플루언서 성과 비교(스펙 §7) — 워크스페이스 무관(명부와 같은 최상위). 읽기 전용.
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const inputs = await listInfluencerPerformance(getSql());
  return NextResponse.json(inputs.map(summarizeInfluencer));
}
```

`/api/influencers/[id]`와 경로가 겹치지만 정적 세그먼트 `performance`가 우선한다 — 확신이 없으면 `node_modules/next/dist/docs/`에서 동적 라우트 우선순위를 확인한다.

- [ ] **Step 6: 타입·린트**

Run: `npx tsc --noEmit -p .` → 오류 0. `npx eslint src/lib/influencerPerformanceStore.ts src/lib/influencerPerformanceStore.test.ts src/app/api/influencers/performance/route.ts` → 오류 0.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/influencerPerformanceStore.ts src/lib/influencerPerformanceStore.test.ts src/app/api/influencers/performance/route.ts
git commit -m "feat(influencer-perf): 인플 성과 스토어·API — 작업별 최신 스냅샷 합, 취소 제외

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 화면 + 사이드바 + 업데이트 소식

**Files:**
- Create: `src/app/influencers/performance/page.tsx`
- Create: `src/app/influencers/performance/InfluencerPerfTable.tsx`
- Modify: `src/components/Sidebar.tsx` (`{ href: '/influencers', ... }` 바로 아래)
- Modify: `src/content/updates.ts` (맨 위 항목)

**Interfaces:**
- Consumes: Task 1 전부(`PerfRow`, `sortPerfRows`, `parsePerfQuery`, `perfQueryString`, `firstDir`, `formatMetric`, `viewsSampleNote`, `taskEngagement`, `CONTENT_TYPES`, `type SortKey/Agg/PerfQuery/MetricKey`), `GET /api/influencers/performance`. 재사용: `apiFetch`(`@/lib/apiFetch`), `Avatar`(`@/components/Avatar` — `{ url, name, size }`), `BlueCheckIcon`(`@/components/XIcons`), `TASK_TYPE_LABEL`(`@/lib/campaignJudgment`), `DISPLAY_TYPE_ORDER`(`@/lib/campaignFlowView`), `formatAmount`(`@/lib/campaignCost` — `(amount, currency)`), `Button`(`@/components/ui`).
- Produces: 화면 `/influencers/performance`(`src/app/influencers/layout.tsx`의 GlobalShell을 그대로 탄다).

**먼저 읽을 선례:** `src/components/PerformanceTable.tsx`(정렬 머리·펼침 행·열 너비 방식), `src/app/influencers/page.tsx`(로드·오류 처리, Suspense 경계), `src/app/campaigns/flow/`에서 `history.replaceState`를 쓰는 곳(`grep -rn replaceState src/app`). 표 스타일(글자 토큰·테두리·hover·고정 열)은 PerformanceTable과 맞춘다.

- [ ] **Step 1: 표 컴포넌트**

`src/app/influencers/performance/InfluencerPerfTable.tsx` — 요구 동작(스펙 §4·§5):

```tsx
'use client';
import { Fragment } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { BlueCheckIcon } from '@/components/XIcons';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { DISPLAY_TYPE_ORDER } from '@/lib/campaignFlowView';
import { formatAmount } from '@/lib/campaignCost';
import {
  formatMetric, viewsSampleNote, taskEngagement, CONTENT_TYPES,
  type PerfRow, type PerfTask, type SortKey, type Agg, type MetricKey, type SortDir,
} from '@/lib/influencerPerformance';

interface Col { key: SortKey; label: string; width: number; help?: string }
interface Group { label: string; cols: Col[] }

// 묶음 순서(스펙 §4): 이력 · 작업 · 노출 · 참여율 · 반응 · 확산 — 관련 지표끼리 붙인다(koo 09-30)
const ENGAGEMENT_HELP = '공개 반응(좋아요·답글·북마크·RT·인용) ÷ 조회 · X 분석 화면보다 낮게 나와요 (클릭 수 미포함)';
const GROUPS: Group[] = [
  { label: '이력', cols: [{ key: 'campaigns', label: '캠페인', width: 72 }, { key: 'lastPosted', label: '최근 게시일', width: 96 }] },
  { label: '작업', cols: DISPLAY_TYPE_ORDER.map((t) => ({ key: `n_${t}` as SortKey, label: TASK_TYPE_LABEL[t], width: 72 })) },
  { label: '노출', cols: [{ key: 'views', label: '조회', width: 104 }, { key: 'cpv', label: '조회당 비용', width: 96 }] },
  { label: '', cols: [{ key: 'engagement', label: '참여율', width: 80, help: ENGAGEMENT_HELP }] },
  { label: '반응', cols: [{ key: 'likes', label: '좋아요', width: 72 }, { key: 'replies', label: '답글', width: 64 }, { key: 'bookmarks', label: '북마크', width: 72 }] },
  { label: '확산', cols: [{ key: 'retweets', label: 'RT수', width: 64 }, { key: 'quotes', label: '인용수', width: 64 }] },
];
const METRIC_COLS = new Set<SortKey>(['views', 'cpv', 'engagement', 'likes', 'replies', 'bookmarks', 'retweets', 'quotes']);
const md = (ymd: string | null) => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : '—');

function cellText(r: PerfRow, key: SortKey, agg: Agg): string {
  if (METRIC_COLS.has(key)) return formatMetric(key as MetricKey, r.stats[key as MetricKey][agg]);
  if (key === 'campaigns') return String(r.campaignCount);
  if (key === 'lastPosted') return md(r.lastPostedAt);
  const n = r.typeCounts[key.slice(2) as TaskType];
  return n ? String(n) : '—';
}

export function InfluencerPerfTable({ rows, agg, sort, dir, onSort, expanded, onToggle }: {
  rows: PerfRow[];              // 이미 정렬된 배열 — 여기서 순서를 바꾸지 않는다(PerformanceTable 관례)
  agg: Agg; sort: SortKey; dir: SortDir;
  onSort: (key: SortKey) => void;
  expanded: Set<string>; onToggle: (handle: string) => void;
}) {
  const allCols = GROUPS.flatMap((g) => g.cols);
  // 구현 요구:
  // - <table> 하나, 머리 2줄: 1줄 = 묶음 이름(colSpan, 묶음 첫 칸 왼쪽 테두리), 2줄 = 열 이름 버튼(onSort, 현재 정렬 열은 ▲/▼, aria-sort).
  // - 첫 열 '인플'(너비 220) sticky left-0 + 배경색(가로 스크롤 시 고정): Avatar 28 + 이름(없으면 핸들) + 파란 체크(isBlueVerified) + 흐린 @핸들, 한 줄 말줄임.
  // - 행 전체 클릭 = onToggle(handle), 행 높이 44px 이상, 숫자 칸 오른쪽 정렬 tabular-nums, 값 '—'은 흐리게.
  // - 조회 칸: viewsSampleNote(r)가 있으면 숫자 뒤에 흐린 작은 글자로 붙인다(title='조회가 수집된 게시물 / 게시된 게시물').
  // - 참여율 머리에 help를 title로 + 머리 옆 작은 ⓘ.
  // - 펼친 행: 바로 아래 <tr><td colSpan={1 + allCols.length}>에 <ExpandedTasks tasks={r.tasks} /> + (r.influencerId ? <Link href={`/influencers?i=${r.influencerId}`}>인플루언서 프로필 열기</Link> : null).
  // 표 컨테이너는 overflow-x-auto(표 컨테이너 린트 예외 선례는 PerformanceTable을 따른다).
  return null as never; // ← 위 요구대로 JSX로 교체
}

// 펼친 행 — 작업 목록(스펙 §5). 열 순서는 위 표 성과 묶음과 같다.
function ExpandedTasks({ tasks }: { tasks: PerfTask[] }) {
  // 열: 날짜(md(postedAt) 또는 '게시 전') · 캠페인 · 유형 · 비용(formatAmount 원래 통화, 없으면 '—')
  //     · 조회 · 참여율(taskEngagement) · 좋아요 · 답글 · 북마크 · RT수 · 인용수 · 게시물(postUrl 있으면 <a target=_blank rel=noopener>↗</a>)
  // 성과 칸 처리:
  //   - type==='rt' → 성과 칸 전체를 colSpan 하나로 'RT는 조회가 원글에 쌓여요'(흐리게)
  //   - CONTENT_TYPES이고 postedAt·postUrl 둘 다 없음 → 성과 칸 '—'
  //   - 게시됐는데 metrics?.views == null → 성과 칸 colSpan 하나로 '수집 전'(흐리게, title='조회 수치가 아직 없어 평균·중앙값에서 빠졌어요')
  //   - 그 외 → formatMetric으로 각 값
  return null as never; // ← 위 요구대로 JSX로 교체
}
```

위 주석의 요구를 **실제 JSX로 구현**한다(`return null as never` 자리). 글자 크기·색 토큰은 PerformanceTable에서 쓰는 클래스를 그대로 쓴다.

- [ ] **Step 2: 페이지**

`src/app/influencers/performance/page.tsx`:

```tsx
'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import {
  sortPerfRows, parsePerfQuery, perfQueryString, firstDir,
  type PerfRow, type PerfQuery, type SortKey, type Agg,
} from '@/lib/influencerPerformance';
import { InfluencerPerfTable } from './InfluencerPerfTable';

export default function InfluencerPerformancePage() {
  // useSearchParams는 Suspense 경계 필수(influencers/page.tsx 관례)
  return <Suspense><PerfView /></Suspense>;
}

function PerfView() {
  const sp = useSearchParams();
  // 주소가 첫 상태 — 이후 변경은 history.replaceState(router.replace는 서버 왕복으로 클릭이 멈춘다, 09-27 캠페인 목록 사례)
  const [query, setQuery] = useState<PerfQuery>(() => parsePerfQuery((k) => sp.get(k)));
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/influencers/performance');
      if (!r.ok) throw new Error(String(r.status));
      setRows((await r.json()) as PerfRow[]);
      setLoadErr(false);
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    } finally {
      setLoaded(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(influencers/page.tsx 관례)
  useEffect(() => { load(); }, [load]);

  const apply = (next: PerfQuery) => {
    setQuery(next);
    const q = perfQueryString(next);
    window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
  };
  const onSort = (key: SortKey) =>
    apply({ ...query, sort: key, dir: query.sort === key ? (query.dir === 'asc' ? 'desc' : 'asc') : firstDir(key) });
  const setAgg = (agg: Agg) => apply({ ...query, agg });
  const onToggle = (h: string) => setExpanded((s) => { const n = new Set(s); if (n.has(h)) n.delete(h); else n.add(h); return n; });

  const sorted = useMemo(() => sortPerfRows(rows, query.sort, query.dir, query.agg), [rows, query]);

  // 구현 요구(JSX):
  // - 제목 '인플루언서 성과' + 한 줄 도움말 '캠페인에 참여한 인플의 게시물 성과를 비교해요. 열 이름을 누르면 그 기준으로 줄을 세워요.'
  // - 표 위 오른쪽: 세그먼트 토글 [중앙값 | 평균](aria-pressed), 옆 흐린 도움말 '중앙값: 한 번 크게 터진 글에 덜 흔들려요'
  // - !loaded → '불러오는 중…' / loadErr → '성과를 불러오지 못했어요' + <Button onClick={load}>다시 시도</Button>
  // - loaded && rows.length===0 → '아직 캠페인 작업이 없어요 — 캠페인에서 작업을 만들고 게시되면 여기에 성과가 모여요' + <Link href="/campaigns/flow">캠페인으로</Link>
  // - 그 외 → <InfluencerPerfTable rows={sorted} agg={query.agg} sort={query.sort} dir={query.dir} onSort={onSort} expanded={expanded} onToggle={onToggle} />
  // - 페이지 여백·제목 크기는 src/app/performance/page.tsx와 맞춘다.
  return null as never; // ← 위 요구대로 JSX로 교체
}
```

- [ ] **Step 3: 사이드바**

`src/components/Sidebar.tsx`의 `{ href: '/influencers', label: '인플루언서', Ic: UserIcon },` 바로 아래에:

```ts
    // 인플루언서 성과 — 명부(한 명씩 관리)와 달리 여럿을 성과로 줄 세워 섭외할 인플을 고르는 곳(스펙 2026-09-30 §6)
    { href: '/influencers/performance', label: '인플루언서 성과', Ic: TrendIcon },
```

활성 표시는 `pathname === n.href` 완전 일치라 두 메뉴가 동시에 켜지지 않는다(확인만).

- [ ] **Step 4: 업데이트 소식**

`src/content/updates.ts`를 열어 기존 항목의 필드 모양을 확인하고, 맨 위에 같은 모양으로 추가한다:
- 날짜 `2026-09-30`, 유형 `새 기능`
- 제목: `인플루언서 성과를 한 표에서 비교할 수 있어요`
- 불릿:
  - `캠페인에 참여한 인플의 조회·조회당 비용·참여율·좋아요·RT 등을 한 표에 모았어요 — 열 이름을 누르면 그 기준으로 줄을 세워요`
  - `중앙값/평균을 바꿔 볼 수 있어요. 기본은 중앙값이라 한 번 크게 터진 글에 덜 흔들려요`
  - `행을 누르면 그 인플의 캠페인별 게시물 성과가 펼쳐져요`
  - `RT는 조회가 원글에 쌓여서 성과 계산에서 빼고 건수만 셌어요`
- 바로가기: `/influencers/performance`

Run: `node --import tsx --test src/lib/updates.test.ts` → PASS

- [ ] **Step 5: 타입·린트·빌드**

Run: `npx tsc --noEmit -p .` → 오류 0
Run: `npx eslint src/app/influencers/performance src/components/Sidebar.tsx src/content/updates.ts` → 새 오류 0
Run: `npx next build` (마이그레이션 단계 없이 next만 — `npm run build`는 DB 마이그레이션을 돌리므로 쓰지 않는다) → 성공, `/influencers/performance`가 라우트 목록에 있음

- [ ] **Step 6: 커밋**

```bash
git add src/app/influencers/performance/page.tsx src/app/influencers/performance/InfluencerPerfTable.tsx src/components/Sidebar.tsx src/content/updates.ts
git commit -m "feat(influencer-perf): 인플루언서 성과 화면 — 성과 묶음 표·중앙값/평균·정렬·펼침

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 마무리(컨트롤러가 직접)

- 운영 데이터로 계산 결과 점검(읽기 전용): 로컬 `next start -p 3001` + `.env`(운영) 대신, 스토어를 운영 `.env`로 직접 불러 56명·RT만 4명·표본 78건이 나오는지 스크립트로 확인.
- 화면 확인은 OAuth 게이팅으로 koo만 가능 — koo QA 요청.
- push·머지·배포는 koo 지시 후.
