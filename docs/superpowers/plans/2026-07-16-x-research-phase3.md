# X 리서치 Phase 3 (트렌드 모니터링 + 기간 종합 브리핑) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 컬럼에 "추이" 패널(주간 게시량·좋아요 중앙값 + 한 줄 판정 + 계정 컬럼 주제별 격주 추이, 저장 없이 조회 시 계산)을 추가하고, 리서치 페이지에 "기간 종합 브리핑"(컬럼×기간 선택 → LLM 보고서 생성·저장·목록) 섹션을 추가한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-16-x-research-phase3-design.md` 승인본을 따른다. 트렌드 = 순수 함수(`trend.ts`)가 기존 `listAnalysisTweets` 결과를 주차(JST 월요일 시작)로 버킷 — 신규 테이블 없음. 브리핑 = `briefing` 테이블 1개(008) + LLM 엔진(`briefing.ts`, 숫자는 코드 계산값 주입·트윗 인용은 `[T번호]`→실트윗 복원·문체 검증) + 저장소 + 얇은 라우트 + 리서치 페이지 섹션. 검색 컬럼 백필은 `refreshColumn`에 since/until 1회성 오버라이드(`queryBuilder`는 이미 since/until 지원 — 변경 불필요).

**Tech Stack:** Next.js 16(App Router)·React 19·Postgres(Supabase, `postgres` npm)·`@anthropic-ai/sdk`·node 내장 테스트 러너(tsx).

## Global Constraints

- **AGENTS.md UX 원칙 준수**: 라벨은 이득 중심 사용자 언어(내부 개념어 금지), 행동 전 기대 설정 한 줄 도움말, 결과는 판정까지 서술, 라벨↔값 파생값으로 일치, 기술값은 맥락으로 감싸기(♥중앙값 툴팁), 비용 유발 액션 opt-in.
- **Next.js 16은 학습 데이터와 다름** — 라우트/컴포넌트 작업 전 `node_modules/next/dist/docs/`의 해당 가이드 확인.
- 테스트: `npm test` = 실 Supabase, `test-` 접두사 데이터 자기 정리. 단일 파일: `node --import tsx --env-file-if-exists=.env --test src/lib/<파일>.test.ts`. **현재 106개 전부 green 유지.**
- 마이그레이션: 멱등 SQL(`if not exists`), 다음 번호 **008**, `npm run migrate`.
- 주차 = `tweet_created_at` 기준, **JST(UTC+9) 달력, 월요일 시작**. 최신(미완성) 주는 "집계 중" — 판정·비교 제외. 대푯값 = 좋아요 **중앙값**.
- 모델 `MODEL()`(suggest.ts) = `process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001'`.
- 사용자 대면 비용 카피: 추이 = "추가 비용 없음", 백필 = "약 $0.01", 브리핑 = "약 $0.1 이하".
- 브리핑 문체(프롬프트 명시 + 금지 표현 회귀 테스트): 전문용어·압축어 금지(부득이하면 풀어쓰기), AI 상투 표현 금지, 짧은 완결 문장, 처음 읽는 팀원 기준.
- `리서치` 페이지 기존 웹 리서치(exa) UI는 마크업·동작 불변 — 브리핑은 **새 섹션 추가**만.
- 라우트는 thin proxy(자체 테스트 없음, 게이트 = `npm run build`). 로직은 `src/lib`에.
- 커밋 메시지는 한국어 `feat(x-research): ...` 컨벤션. 전체 완료 후 push.
- 스펙과의 확정 편차 2건(구현 중 발견, 스펙 취지 유지): ① `queryBuilder.ts` since/until은 **이미 구현돼 있음**(SearchConfig.sinceDate/untilDate) — 수정 불필요, refreshColumn 오버라이드만 추가. ② `briefing.created_by`는 spec의 `text` 대신 **`uuid references member(id) on delete set null`**(scout_account 선례와 통일).

---

### Task 1: 추이 집계 엔진 `trend.ts` (순수 함수)

**Files:**
- Create: `src/lib/trend.ts`
- Test: `src/lib/trend.test.ts`

**Interfaces:**
- Consumes: `PillarTopic`(pillarTypes.ts — `{id: string; label: string}`). DB·네트워크 없음(순수).
- Produces (후속 태스크가 사용):
  - `TrendTweet { tweetId: string; likes: number | null; createdAt: string | null; topicId: string | null }` — `listAnalysisTweets`의 `AnalysisTweet`가 구조적으로 호환(초과 필드 무시).
  - `WeekBucket { weekStart: string; count: number; medianLikes: number }` (weekStart = 'YYYY-MM-DD' JST 월요일)
  - `Direction = 'up' | 'flat' | 'down'`, `Sufficiency = 'ok' | 'sparse' | 'insufficient'`
  - `TopicTrendRow { topicId; label; recent: {count; medianLikes}; previous: {count; medianLikes}; direction: Direction; judgment: string }`
  - `TrendPayload { weekly: WeekBucket[]; partialWeek: WeekBucket | null; judgment: string | null; sufficiency: Sufficiency; dataWeeks: number; topicTrends: TopicTrendRow[] | null }`
  - `weekStartJst(iso: string): string` / `addWeeks(weekStart: string, n: number): string` / `median(ns: number[]): number` / `TREND_WINDOW_WEEKS = 8`
  - `computeWeeklyTrend(tweets: TrendTweet[], nowIso: string): Omit<TrendPayload, 'topicTrends'>`
  - `computeTopicTrend(tweets: TrendTweet[], topics: PillarTopic[], nowIso: string): TopicTrendRow[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/trend.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weekStartJst, addWeeks, median,
  computeWeeklyTrend, computeTopicTrend, type TrendTweet,
} from './trend.ts';

// 고정 현재 시각: 2026-07-16T00:00:00Z = JST 7/16(목) 09:00 → 현재 주 = 2026-07-13(월)
const NOW = '2026-07-16T00:00:00.000Z';

// weekStart('YYYY-MM-DD')의 주에 속하는 트윗 생성(그 주 수요일 정오 JST)
function tw(week: string, likes: number, topicId: string | null = null): TrendTweet {
  const created = new Date(Date.parse(week + 'T00:00:00Z') + 2 * 86_400_000 + 3 * 3_600_000).toISOString(); // JST 수 12:00
  return { tweetId: week + '-' + likes + '-' + Math.random(), likes, createdAt: created, topicId };
}

test('weekStartJst: JST 달력 기준 월요일, 경계·연말', () => {
  assert.equal(weekStartJst('2026-07-15T20:00:00Z'), '2026-07-13');       // JST 7/16(목)
  assert.equal(weekStartJst('2026-07-12T15:00:00Z'), '2026-07-13');       // JST 7/13(월) 00:00 정각
  assert.equal(weekStartJst('2026-07-12T14:59:59Z'), '2026-07-06');       // JST 7/12(일) 23:59
  assert.equal(weekStartJst('2025-12-31T00:00:00Z'), '2025-12-29');       // 연말 걸침(수→그 주 월요일)
  assert.equal(addWeeks('2026-07-13', -2), '2026-06-29');
});

test('median: 홀수·짝수·단건·빈 배열', () => {
  assert.equal(median([]), 0);
  assert.equal(median([7]), 7);
  assert.equal(median([1, 9, 5]), 5);
  assert.equal(median([1, 3, 5, 100]), 4); // (3+5)/2
});

test('computeWeeklyTrend: 8슬롯 달력 고정·0건 주 채움·집계 중 분리', () => {
  const tweets = [
    ...[100, 200, 300].map((l) => tw('2026-07-06', l)),
    ...[50, 60].map((l) => tw('2026-06-29', l)),
    // 6/22 주는 0건(공백 주)
    ...[10, 20, 30, 40].map((l) => tw('2026-06-15', l)),
    tw('2026-07-13', 999), // 현재(집계 중) 주
  ];
  const r = computeWeeklyTrend(tweets, NOW);
  assert.equal(r.weekly.length, 8);
  assert.equal(r.weekly[0].weekStart, '2026-05-18');                       // 현재 주 -8
  assert.equal(r.weekly[7].weekStart, '2026-07-06');                       // 현재 주 -1
  const w622 = r.weekly.find((b) => b.weekStart === '2026-06-22')!;
  assert.deepEqual([w622.count, w622.medianLikes], [0, 0]);                // 공백 주 0 채움
  assert.equal(r.weekly[7].count, 3);
  assert.equal(r.weekly[7].medianLikes, 200);
  assert.deepEqual(r.partialWeek, { weekStart: '2026-07-13', count: 1, medianLikes: 999 });
});

test('computeWeeklyTrend: 판정 — up/down/flat 경계값(+50%/−33%)', () => {
  // 직전 3주(기준): 매주 6건·♥100 / 최근 완성 주를 바꿔가며 판정 확인
  const base = ['2026-06-15', '2026-06-22', '2026-06-29']
    .flatMap((w) => [100, 100, 100, 100, 100, 100].map((l) => tw(w, l)));
  const up = computeWeeklyTrend([...base, ...Array.from({ length: 9 }, (_, i) => tw('2026-07-06', 150 + i))], NOW);
  assert.equal(up.judgment, '게시량은 늘어나는 중 · 반응은 뜨거워지는 중이에요'); // 9/6=1.5, 중앙값≥150
  const down = computeWeeklyTrend([...base, tw('2026-07-06', 60), tw('2026-07-06', 60), tw('2026-07-06', 60), tw('2026-07-06', 60)], NOW);
  assert.equal(down.judgment, '게시량은 줄어드는 중 · 반응은 줄어드는 중이에요'); // 4/6≤0.67, 60/100≤0.67
  const flat = computeWeeklyTrend([...base, ...[100, 100, 100, 100, 100, 100].map((l) => tw('2026-07-06', l))], NOW);
  assert.equal(flat.judgment, '게시량은 유지 · 반응은 비슷해요');
});

test('computeWeeklyTrend: 표본 부족 2단계', () => {
  // 데이터 주 2개 → insufficient, 판정 없음
  const thin = computeWeeklyTrend([tw('2026-07-06', 10), tw('2026-06-29', 10)], NOW);
  assert.equal(thin.sufficiency, 'insufficient');
  assert.equal(thin.dataWeeks, 2);
  assert.equal(thin.judgment, null);
  // 데이터 주 4개인데 주당 1~2건 → sparse, 판정 유보
  const sparse = computeWeeklyTrend(
    ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06'].flatMap((w) => [tw(w, 10), tw(w, 20)]), NOW);
  assert.equal(sparse.sufficiency, 'sparse');
  assert.equal(sparse.judgment, null);
  // 빈 입력 — 8슬롯 0 채움, 집계 중 없음, 판정 없음
  const empty = computeWeeklyTrend([], NOW);
  assert.equal(empty.sufficiency, 'insufficient');
  assert.equal(empty.weekly.length, 8);
  assert.equal(empty.partialWeek, null);
  assert.equal(empty.judgment, null);
});

test('computeTopicTrend: 격주 비교·빈 주제 생략·정렬', () => {
  const topics = [{ id: 'a', label: '루메카' }, { id: 'b', label: '니키비 케어' }, { id: 'c', label: '빈 주제' }];
  const tweets = [
    // 직전 격주(6/15~6/28): 루메카 고반응
    tw('2026-06-15', 9000, 'a'), tw('2026-06-22', 5000, 'a'),
    // 최근 격주(6/29~7/12): 루메카 급랭
    tw('2026-06-29', 60, 'a'), tw('2026-07-06', 20, 'a'),
    // 니키비 케어: 유지
    tw('2026-06-15', 800, 'b'), tw('2026-06-29', 900, 'b'),
    tw('2026-07-13', 777, 'a'), // 집계 중 주 — 격주 계산에서 제외
  ];
  const rows = computeTopicTrend(tweets, topics, NOW);
  assert.deepEqual(rows.map((r) => r.topicId), ['b', 'a']);               // 최근 중앙값 내림차순
  const a = rows.find((r) => r.topicId === 'a')!;
  assert.equal(a.direction, 'down');
  assert.equal(a.judgment, '식는 중');
  assert.deepEqual(a.recent, { count: 2, medianLikes: 40 });
  assert.deepEqual(a.previous, { count: 2, medianLikes: 7000 });
  const b = rows.find((r) => r.topicId === 'b')!;
  assert.equal(b.judgment, '유지');
  assert.equal(rows.find((r) => r.topicId === 'c'), undefined);           // 표본 0 주제 생략
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trend.test.ts`
Expected: FAIL — `Cannot find module './trend.ts'`

- [ ] **Step 3: 구현**

`src/lib/trend.ts`:

```ts
import type { PillarTopic } from './pillarTypes.ts';

export interface TrendTweet { tweetId: string; likes: number | null; createdAt: string | null; topicId: string | null }
export interface WeekBucket { weekStart: string; count: number; medianLikes: number }
export type Direction = 'up' | 'flat' | 'down';
export type Sufficiency = 'ok' | 'sparse' | 'insufficient';
export interface TopicTrendRow {
  topicId: string; label: string;
  recent: { count: number; medianLikes: number };
  previous: { count: number; medianLikes: number };
  direction: Direction;
  judgment: string;
}
export interface TrendPayload {
  weekly: WeekBucket[];            // 완성 주 8슬롯(달력 고정, 0건 주 포함), 오래된→최신
  partialWeek: WeekBucket | null;  // 현재(집계 중) 주 — 판정·비교 제외
  judgment: string | null;         // sufficiency='ok'이고 기준 주 2개 이상일 때만
  sufficiency: Sufficiency;
  dataWeeks: number;               // weekly 중 트윗이 있는 주 수
  topicTrends: TopicTrendRow[] | null; // 계정 컬럼 + 주제 분석 존재 시(라우트가 채움)
}

const JST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
export const TREND_WINDOW_WEEKS = 8;

// ISO 시각 → 그 시각이 속한 주의 월요일(JST 달력) 'YYYY-MM-DD'
export function weekStartJst(iso: string): string {
  const d = new Date(Date.parse(iso) + JST_MS); // UTC 게터가 JST 벽시계가 되도록 시프트
  const dow = (d.getUTCDay() + 6) % 7;          // 월=0 … 일=6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}

export function addWeeks(weekStart: string, n: number): string {
  return new Date(Date.parse(weekStart + 'T00:00:00Z') + n * 7 * DAY_MS).toISOString().slice(0, 10);
}

export function median(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function bucket(tweets: TrendTweet[], weekStart: string): WeekBucket {
  return { weekStart, count: tweets.length, medianLikes: median(tweets.map((t) => t.likes ?? 0)) };
}

function groupByWeek(tweets: TrendTweet[]): Map<string, TrendTweet[]> {
  const m = new Map<string, TrendTweet[]>();
  for (const t of tweets) {
    if (!t.createdAt) continue;
    const w = weekStartJst(t.createdAt);
    if (!m.has(w)) m.set(w, []);
    m.get(w)!.push(t);
  }
  return m;
}

function direction(recent: number, base: number): Direction {
  if (base === 0) return recent > 0 ? 'up' : 'flat';
  const r = recent / base;
  if (r >= 1.5) return 'up';
  if (r <= 0.67) return 'down';
  return 'flat';
}

const POST_LABEL: Record<Direction, string> = { up: '늘어나는 중', flat: '유지', down: '줄어드는 중' };
const LIKE_LABEL: Record<Direction, string> = { up: '뜨거워지는 중이에요', flat: '비슷해요', down: '줄어드는 중이에요' };
const TOPIC_LABEL: Record<Direction, string> = { up: '뜨는 중', flat: '유지', down: '식는 중' };

export function computeWeeklyTrend(tweets: TrendTweet[], nowIso: string): Omit<TrendPayload, 'topicTrends'> {
  const currentWeek = weekStartJst(nowIso);
  const byWeek = groupByWeek(tweets);

  const weekly: WeekBucket[] = [];
  for (let i = TREND_WINDOW_WEEKS; i >= 1; i--) {
    const w = addWeeks(currentWeek, -i);
    weekly.push(bucket(byWeek.get(w) ?? [], w));
  }
  const partial = byWeek.get(currentWeek);
  const partialWeek = partial ? bucket(partial, currentWeek) : null;

  const withData = weekly.filter((b) => b.count > 0);
  const dataWeeks = withData.length;
  const sufficiency: Sufficiency =
    dataWeeks < 3 ? 'insufficient' : median(withData.map((b) => b.count)) < 5 ? 'sparse' : 'ok';

  // 판정: 최근 완성 1주 vs 직전 완성 주 최대 3개(트윗 있는 주만, 최소 2개) 평균 — 파생값(원칙 4)
  let judgment: string | null = null;
  if (sufficiency === 'ok') {
    const recent = weekly[weekly.length - 1];
    const baseWeeks = weekly.slice(-4, -1).filter((b) => b.count > 0);
    if (baseWeeks.length >= 2) {
      const avg = (f: (b: WeekBucket) => number) => baseWeeks.reduce((s, b) => s + f(b), 0) / baseWeeks.length;
      const postDir = direction(recent.count, avg((b) => b.count));
      const likeDir = direction(recent.medianLikes, avg((b) => b.medianLikes));
      judgment = `게시량은 ${POST_LABEL[postDir]} · 반응은 ${LIKE_LABEL[likeDir]}`;
    }
  }
  return { weekly, partialWeek, judgment, sufficiency, dataWeeks };
}

// 주제별 격주 비교: 최근 격주(현재 주 -2 ~ -1) vs 직전 격주(-4 ~ -3). 집계 중 주 제외, 남는 주 버림.
export function computeTopicTrend(tweets: TrendTweet[], topics: PillarTopic[], nowIso: string): TopicTrendRow[] {
  const currentWeek = weekStartJst(nowIso);
  const recentFrom = addWeeks(currentWeek, -2);
  const prevFrom = addWeeks(currentWeek, -4);
  const weekOf = (t: TrendTweet) => (t.createdAt ? weekStartJst(t.createdAt) : null);

  const rows: TopicTrendRow[] = [];
  for (const topic of topics) {
    const mine = tweets.filter((t) => t.topicId === topic.id);
    const recent = mine.filter((t) => { const w = weekOf(t); return w !== null && w >= recentFrom && w < currentWeek; });
    const previous = mine.filter((t) => { const w = weekOf(t); return w !== null && w >= prevFrom && w < recentFrom; });
    if (recent.length + previous.length === 0) continue;
    const r = { count: recent.length, medianLikes: median(recent.map((t) => t.likes ?? 0)) };
    const p = { count: previous.length, medianLikes: median(previous.map((t) => t.likes ?? 0)) };
    const dir = direction(r.medianLikes, p.medianLikes);
    rows.push({ topicId: topic.id, label: topic.label, recent: r, previous: p, direction: dir, judgment: TOPIC_LABEL[dir] });
  }
  rows.sort((a, b) => b.recent.medianLikes - a.recent.medianLikes);
  return rows;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trend.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/trend.ts src/lib/trend.test.ts
git commit -m "feat(x-research): 주간 추이 집계 엔진 — JST 주차 버킷·판정 파생·격주 주제 추이·표본 부족 2단계"
```

---

### Task 2: 추이 API — `GET /api/columns/[id]/trend`

**Files:**
- Create: `src/app/api/columns/[id]/trend/route.ts`

**Interfaces:**
- Consumes: Task 1의 `computeWeeklyTrend`/`computeTopicTrend`/`TrendPayload`, `pillarStore.listAnalysisTweets(sql, columnId, {limit})`/`getAnalysis`, `columnStore.getColumn`.
- Produces: `GET /api/columns/[id]/trend` → `TrendPayload` JSON (검색 컬럼·분석 없는 계정 컬럼은 `topicTrends: null`). 404 = 컬럼 없음.

- [ ] **Step 1: 라우트 작성** (thin proxy — 자체 테스트 없음, 게이트는 build)

`src/app/api/columns/[id]/trend/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { getAnalysis, listAnalysisTweets } from '@/lib/pillarStore';
import { computeWeeklyTrend, computeTopicTrend, type TrendPayload, type TopicTrendRow } from '@/lib/trend';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();
  const col = await getColumn(sql, id);
  if (!col) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });

  const now = new Date().toISOString();
  const tweets = await listAnalysisTweets(sql, id, { limit: 2000 }); // 추이 창(12주+)을 덮는 상한
  const base = computeWeeklyTrend(tweets, now);

  let topicTrends: TopicTrendRow[] | null = null;
  if (col.kind === 'watchlist') {
    const analysis = await getAnalysis(sql, id);
    if (analysis) topicTrends = computeTopicTrend(tweets, analysis.topics, now);
  }
  const payload: TrendPayload = { ...base, topicTrends };
  return NextResponse.json(payload);
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 성공, `/api/columns/[id]/trend` 라우트 목록에 표시.

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/columns/\[id\]/trend/route.ts
git commit -m "feat(x-research): 추이 조회 API — 저장 없는 온더플라이 집계 프록시"
```

---

### Task 3: 추이 패널 UI — `TrendPanel` + `Column` 배선

**Files:**
- Create: `src/components/TrendPanel.tsx`
- Modify: `src/components/Column.tsx` (헤더 버튼 + 패널 렌더)

**Interfaces:**
- Consumes: `GET /api/columns/[id]/trend`(Task 2), `POST /api/columns/[id]/refresh`(백필 — Task 4에서 검색 컬럼용 파라미터 추가, 계정 컬럼은 기존 `{maxPages}` 동작), `TrendPayload`/`weekStartJst` 타입(Task 1), `formatCount`(format.ts).
- Produces: `TrendPanel({ columnId, kind, onAfterBackfill, onClose })` — Column이 렌더.

- [ ] **Step 1: TrendPanel 작성**

`src/components/TrendPanel.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ColumnKind } from '@/lib/types';
import type { TrendPayload } from '@/lib/trend';
import { formatCount } from '@/lib/format';

function fmtWeek(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
const DIR_ICON = { up: '▲', flat: '─', down: '▼' } as const;
const DIR_COLOR = { up: 'text-red-500', flat: 'text-x-muted', down: 'text-blue-500' } as const;

export function TrendPanel({ columnId, kind, onAfterBackfill, onClose }: {
  columnId: string;
  kind: ColumnKind;
  onAfterBackfill: () => void; // 백필 수집 후 Column 트윗 목록 재조회
  onClose: () => void;
}) {
  const [data, setData] = useState<TrendPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/columns/${columnId}/trend`);
    if (r.ok) setData((await r.json()) as TrendPayload);
    else setErr(`오류 ${r.status}`);
  }, [columnId]);
  useEffect(() => { load(); }, [load]);

  // 표본 부족 시 과거 수집 — 계정: 깊은 페이지네이션 / 검색: 기간 지정(since/until) 재검색
  async function backfill() {
    if (!data) return;
    setBusy(true); setErr('');
    const body = kind === 'watchlist'
      ? { maxPages: 10 }
      : { sinceDate: data.weekly[0].weekStart, untilDate: new Date().toISOString().slice(0, 10) };
    const r = await fetch(`/api/columns/${columnId}/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) { onAfterBackfill(); await load(); }
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy(false);
  }

  const maxCount = data ? Math.max(1, ...data.weekly.map((b) => b.count)) : 1;
  const smallBtn = 'rounded border border-x-border-strong px-2 py-1 text-xs hover:bg-x-hover disabled:opacity-50';

  return (
    <div className="border-b border-x-border px-3 py-2 text-[13px]">
      <div className="flex items-baseline gap-2">
        <p className="font-bold">주간 추이</p>
        <span className="text-xs text-x-muted">이 컬럼에 쌓인 트윗 기준 · 추가 비용 없음</span>
        <button onClick={onClose} className="ml-auto rounded px-1 text-x-secondary hover:bg-x-border">✕</button>
      </div>

      {data && data.sufficiency === 'insufficient' && (
        <div className="mt-1">
          <p className="text-xs text-x-secondary">아직 데이터가 {data.dataWeeks}주치뿐이라 추이를 보기 어려워요.</p>
          <button onClick={backfill} disabled={busy} className={`mt-1 ${smallBtn}`}
                  title="과거 트윗을 더 수집해 기간을 채워요 (약 $0.01)">
            {busy ? '수집 중…' : '과거 트윗 더 가져오기 (약 $0.01)'}
          </button>
        </div>
      )}

      {data && data.sufficiency !== 'insufficient' && (
        <>
          <ul className="mt-1 space-y-0.5">
            {data.weekly.map((b) => (
              <li key={b.weekStart} className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-xs text-x-muted">{fmtWeek(b.weekStart)}주</span>
                <span className="h-2 rounded-sm bg-x-blue/60" style={{ width: `${Math.round((b.count / maxCount) * 100)}%`, minWidth: b.count > 0 ? 4 : 0 }} />
                <span className="shrink-0 text-xs text-x-secondary">{b.count}건</span>
                <span className="ml-auto shrink-0 text-xs text-x-secondary"
                      title="그 주 트윗의 보통 반응 수준(좋아요 중앙값)">♥{formatCount(b.medianLikes)}</span>
              </li>
            ))}
            {data.partialWeek && (
              <li className="flex items-center gap-2 opacity-60">
                <span className="w-9 shrink-0 text-xs text-x-muted">{fmtWeek(data.partialWeek.weekStart)}주</span>
                <span className="text-xs text-x-muted">▒ 집계 중 ({data.partialWeek.count}건) — 이번 주는 아직 숫자가 낮게 나와요</span>
              </li>
            )}
          </ul>
          {data.judgment && <p className="mt-1 text-xs font-bold">💬 {data.judgment}</p>}
          {data.sufficiency === 'sparse' && (
            <p className="mt-1 text-xs text-x-muted">표본이 적어 추이가 흔들릴 수 있어요 — 참고용으로만 보세요.</p>
          )}

          {kind === 'watchlist' && (
            data.topicTrends === null
              ? <p className="mt-2 text-xs text-x-muted">주제 분석을 먼저 실행하면 주제별 추이도 보여요.</p>
              : data.topicTrends.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-x-muted">주제별 추이 (2주 단위 비교 — 주제는 표본이 적어 2주씩 묶어요)</p>
                  <ul className="mt-0.5">
                    {data.topicTrends.map((t) => (
                      <li key={t.topicId} className="flex items-baseline gap-1 px-1 py-0.5">
                        <span className="truncate">{t.label}</span>
                        <span className="ml-auto shrink-0 text-xs text-x-secondary">
                          ♥{formatCount(t.previous.medianLikes)} → ♥{formatCount(t.recent.medianLikes)}
                        </span>
                        <span className={`shrink-0 text-xs ${DIR_COLOR[t.direction]}`}>{DIR_ICON[t.direction]} {t.judgment}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
          )}
        </>
      )}

      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Column 배선**

`src/components/Column.tsx` 수정 3곳:

(a) import 추가(기존 PillarPanel import 아래):

```tsx
import { TrendPanel } from './TrendPanel';
```

(b) 상태 추가(`const [showPillar, setShowPillar] = useState(false);` 근처):

```tsx
const [showTrend, setShowTrend] = useState(false);
```

(c) 헤더 버튼 — 기존 "주제 분석" 버튼 블록 **바로 위**에(모든 컬럼 종류 공통이므로 watchlist 조건 밖):

```tsx
<button onClick={() => setShowTrend((v) => !v)}
        className={`${btn} ${showTrend ? 'font-bold text-x-text' : ''}`}
        title="이 컬럼에 쌓인 트윗으로 주간 추이를 보여줘요 · 추가 비용 없음">
  추이{showTrend ? '✓' : ''}
</button>
```

(d) 패널 렌더 — `{column.kind === 'search' && (<CooccurrencePanel …/>)}` 블록 **바로 위**에:

```tsx
{showTrend && (
  <TrendPanel columnId={column.id} kind={column.kind}
              onAfterBackfill={() => load(sort)}
              onClose={() => setShowTrend(false)} />
)}
```

- [ ] **Step 3: 빌드 + 기존 테스트 확인**

Run: `npm run build && npm test`
Expected: build 성공, 기존 106개 테스트 + Task 1의 6개 전부 PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/components/TrendPanel.tsx src/components/Column.tsx
git commit -m "feat(x-research): 추이 패널 — 주간 막대·집계중 분리·판정문·주제별 격주·표본부족 안내"
```

---

### Task 4: 검색 컬럼 백필 — refreshColumn since/until 오버라이드 + refresh 라우트

**Files:**
- Modify: `src/lib/refreshColumn.ts`
- Modify: `src/app/api/columns/[id]/refresh/route.ts`
- Test: `src/lib/refreshColumn.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: `buildSearchQuery`(queryBuilder — SearchConfig의 `sinceDate`/`untilDate`를 이미 `since:`/`until:` 연산자로 조립함, 수정 불필요).
- Produces: `refreshColumn(sql, client, columnId, opts?: { maxPagesOverride?: number; searchOverride?: { sinceDate: string; untilDate: string } })` — searchOverride는 검색 컬럼의 이번 1회 호출에만 병합(저장 안 함). refresh 라우트가 body `{sinceDate, untilDate}`(YYYY-MM-DD)를 받아 전달, 이때 maxPages는 기본 10.

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/refreshColumn.test.ts` 말미에 추가:

```ts
test('search 백필: searchOverride가 이번 호출 쿼리에만 since/until을 병합, config는 불변', async () => {
  const ws = await createWorkspace(sql, P + 'ws3');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'search', title: P + 'bf',
    config: { keywords: ['毛穴'], minFaves: 300, maxPages: 1 },
  });
  const queries: string[] = [];
  const fake = {
    searchTweets: async (q: string) => { queries.push(q); return page([raw('x', 1000)], null); },
    getUserTweets: async () => page([], null),
  };
  try {
    await refreshColumn(sql, fake, col.id, { searchOverride: { sinceDate: '2026-05-18', untilDate: '2026-07-16' } });
    assert.match(queries[0], /since:2026-05-18/);
    assert.match(queries[0], /until:2026-07-16/);
    const c2 = await getColumn(sql, col.id);
    assert.equal((c2!.config as { sinceDate?: string | null }).sinceDate ?? null, null); // 저장 안 됨
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/refreshColumn.test.ts`
Expected: 신규 테스트 FAIL — 쿼리에 `since:` 없음(오버라이드 미구현).

- [ ] **Step 3: refreshColumn 구현**

`src/lib/refreshColumn.ts` — 시그니처와 search 분기 수정:

```ts
export async function refreshColumn(
  sql: postgres.Sql,
  client: Pick<GetxapiClient, 'searchTweets' | 'getUserTweets'>,
  columnId: string,
  opts?: { maxPagesOverride?: number; searchOverride?: { sinceDate: string; untilDate: string } },
): Promise<{ fetched: number; inserted: number; updated: number }> {
```

루프 내 search 분기를 아래로 교체(오버라이드는 조회 쿼리에만 병합 — config 저장 없음):

```ts
    const page = col.kind === 'search'
      ? await client.searchTweets(
          buildSearchQuery({ ...(col.config as SearchConfig), ...opts?.searchOverride }), cursor)
      : await client.getUserTweets((col.config as WatchlistConfig).userId, cursor);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/refreshColumn.test.ts`
Expected: PASS (기존 + 신규 전부)

- [ ] **Step 5: refresh 라우트에 파라미터 추가**

`src/app/api/columns/[id]/refresh/route.ts` — body 파싱 블록을 아래로 교체:

```ts
  // 과거 백필용: {maxPages} = 깊은 페이지네이션(계정), {sinceDate, untilDate} = 기간 지정 재검색(검색 컬럼)
  const body = (await req.json().catch(() => ({}))) as { maxPages?: unknown; sinceDate?: unknown; untilDate?: unknown };
  const mp = Number(body.maxPages);
  let maxPagesOverride = Number.isFinite(mp) && mp >= 1 ? Math.min(10, Math.floor(mp)) : undefined;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const searchOverride = existing.kind === 'search'
    && typeof body.sinceDate === 'string' && DATE.test(body.sinceDate)
    && typeof body.untilDate === 'string' && DATE.test(body.untilDate)
    ? { sinceDate: body.sinceDate, untilDate: body.untilDate } : undefined;
  if (searchOverride) maxPagesOverride = maxPagesOverride ?? 10; // 기간 백필은 기본으로 깊게
```

그리고 `refreshColumn` 호출에 전달:

```ts
    const result = await refreshColumn(sql, client, id, { maxPagesOverride, searchOverride });
```

- [ ] **Step 6: 빌드 확인 후 커밋**

Run: `npm run build`
Expected: 성공.

```bash
git add src/lib/refreshColumn.ts src/lib/refreshColumn.test.ts src/app/api/columns/\[id\]/refresh/route.ts
git commit -m "feat(x-research): 검색 컬럼 기간 백필 — since/until 1회성 오버라이드(설정 불변·날짜 형식 검증)"
```

---

### Task 5: 마이그레이션 008 + briefingStore

**Files:**
- Create: `migrations/008_briefing.sql`
- Create: `src/lib/briefingStore.ts`
- Test: `src/lib/briefingStore.test.ts`

**Interfaces:**
- Consumes: `getSql()`, 기존 `deck_column`/`member`/`workspace` 테이블. `BriefingContent` 타입(Task 6에서 정의 — 이 태스크에서는 `briefingTypes.ts`로 선행 분리).
- Produces:
  - `src/lib/briefingTypes.ts`(서버·클라이언트 공용 순수 타입): `BriefingCitation { n: number; tweetId: string; text: string; likes: number | null; url: string | null; flags: string[] }` / `BriefingStatsWeek { weekStart: string; count: number; medianLikes: number }` / `BriefingStats { periodFrom: string; periodTo: string; totalCount: number; weekly: BriefingStatsWeek[] }` / `BriefingContent { tldr: string[]; body: string; citations: BriefingCitation[]; stats: BriefingStats }`
  - `briefingStore.ts`: `saveBriefing(sql, input: { workspaceId, columnId, periodFrom, periodTo, sampleSize, content: BriefingContent, model, memberId }): Promise<string>`(id 반환) / `listBriefings(sql, workspaceId): Promise<BriefingListRow[]>`(`BriefingListRow = {id, columnId, columnTitle, periodFrom, periodTo, sampleSize, createdAt, member: Member | null}`) / `getBriefing(sql, id): Promise<BriefingRow | null>`(`BriefingRow = BriefingListRow & {content, model: string | null}`) / `removeBriefing(sql, id): Promise<void>`

- [ ] **Step 1: 마이그레이션 파일 작성**

`migrations/008_briefing.sql`:

```sql
-- Phase 3: 기간 종합 브리핑 — 생성물 저장(재열람·비교, 재생성 비용 절약)
create table if not exists briefing (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace(id) on delete cascade,
  column_id uuid not null references deck_column(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  sample_size int not null,
  content jsonb not null,   -- {tldr, body, citations, stats} — 저장 시점에 렌더링 전부 포함(재현성)
  model text,
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists briefing_ws_created on briefing (workspace_id, created_at desc);
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `npm run migrate`
Expected: 008 적용 로그, 에러 없음.

- [ ] **Step 3: 공용 타입 파일 작성**

`src/lib/briefingTypes.ts`:

```ts
export interface BriefingCitation {
  n: number; tweetId: string; text: string;
  likes: number | null; url: string | null;
  flags: string[]; // 薬機法 주의 패턴(complianceFlags) — 경고 배지용, 필터링 없음
}
export interface BriefingStatsWeek { weekStart: string; count: number; medianLikes: number }
export interface BriefingStats { periodFrom: string; periodTo: string; totalCount: number; weekly: BriefingStatsWeek[] }
export interface BriefingContent {
  tldr: string[];                 // 3줄 요약
  body: string;                   // 마크다운 본문(트윗 인용은 [T숫자] 토큰)
  citations: BriefingCitation[];  // 토큰 → 실트윗 복원 정보
  stats: BriefingStats;           // 코드 계산 수치(LLM 미경유)
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

`src/lib/briefingStore.test.ts`:

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { saveBriefing, listBriefings, getBriefing, removeBriefing } from './briefingStore.ts';
import { createColumn, deleteColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import type { BriefingContent } from './briefingTypes.ts';

const sql = getSql();
const P = 'test-bf-' + process.pid + '-';

const content: BriefingContent = {
  tldr: ['한 줄', '두 줄', '세 줄'],
  body: '## 핵심 화두\n니키비 얘기 [T1]',
  citations: [{ n: 1, tweetId: 'x1', text: '본문', likes: 10, url: null, flags: [] }],
  stats: { periodFrom: '2026-06-15', periodTo: '2026-07-12', totalCount: 42,
           weekly: [{ weekStart: '2026-06-15', count: 42, medianLikes: 100 }] },
};

after(async () => {
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql.end();
});

test('saveBriefing→listBriefings→getBriefing→removeBriefing 왕복', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'search', title: P + 'col', config: { keywords: ['毛穴'] },
  });
  try {
    const id = await saveBriefing(sql, {
      workspaceId: ws.id, columnId: col.id,
      periodFrom: '2026-06-15', periodTo: '2026-07-12',
      sampleSize: 42, content, model: 'test-model', memberId: null,
    });
    assert.ok(id);

    const list = await listBriefings(sql, ws.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, id);
    assert.equal(list[0].columnTitle, P + 'col');
    assert.equal(list[0].periodFrom, '2026-06-15');
    assert.equal(list[0].sampleSize, 42);
    assert.equal(list[0].member, null);

    const full = await getBriefing(sql, id);
    assert.deepEqual(full!.content, content);
    assert.equal(full!.model, 'test-model');

    await removeBriefing(sql, id);
    assert.equal(await getBriefing(sql, id), null);
    assert.equal((await listBriefings(sql, ws.id)).length, 0);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('컬럼 삭제 시 브리핑도 연쇄 삭제(cascade)', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'search', title: P + 'col2', config: { keywords: ['a'] },
  });
  try {
    await saveBriefing(sql, {
      workspaceId: ws.id, columnId: col.id, periodFrom: '2026-06-15', periodTo: '2026-07-12',
      sampleSize: 1, content, model: null, memberId: null,
    });
    await deleteColumn(sql, col.id);
    assert.equal((await listBriefings(sql, ws.id)).length, 0);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/briefingStore.test.ts`
Expected: FAIL — `Cannot find module './briefingStore.ts'`

- [ ] **Step 6: briefingStore 구현**

`src/lib/briefingStore.ts`:

```ts
import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { BriefingContent } from './briefingTypes.ts';

export interface BriefingListRow {
  id: string; columnId: string; columnTitle: string;
  periodFrom: string; periodTo: string; sampleSize: number;
  createdAt: string; member: Member | null;
}
export interface BriefingRow extends BriefingListRow { content: BriefingContent; model: string | null }

type Row = {
  id: string; column_id: string; column_title: string;
  period_from: string; period_to: string; sample_size: number;
  created_at: Date; content?: BriefingContent; model?: string | null;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

function toListRow(r: Row): BriefingListRow {
  return {
    id: r.id, columnId: r.column_id, columnTitle: r.column_title,
    periodFrom: r.period_from, periodTo: r.period_to, sampleSize: r.sample_size,
    createdAt: r.created_at.toISOString(),
    member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  };
}

export async function saveBriefing(sql: postgres.Sql, input: {
  workspaceId: string; columnId: string; periodFrom: string; periodTo: string;
  sampleSize: number; content: BriefingContent; model: string | null; memberId: string | null;
}): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into briefing (workspace_id, column_id, period_from, period_to, sample_size, content, model, created_by)
    values (${input.workspaceId}, ${input.columnId}, ${input.periodFrom}, ${input.periodTo},
            ${input.sampleSize}, ${sql.json(input.content as never)}, ${input.model}, ${input.memberId})
    returning id`;
  return rows[0].id;
}

export async function listBriefings(sql: postgres.Sql, workspaceId: string): Promise<BriefingListRow[]> {
  const rows = await sql<Row[]>`
    select b.id, b.column_id, c.title as column_title,
           to_char(b.period_from, 'YYYY-MM-DD') as period_from, to_char(b.period_to, 'YYYY-MM-DD') as period_to,
           b.sample_size, b.created_at,
           m.id as member_id, m.name as member_name, m.color as member_color
      from briefing b
      join deck_column c on c.id = b.column_id
      left join member m on m.id = b.created_by
     where b.workspace_id = ${workspaceId}
     order by b.created_at desc`;
  return rows.map(toListRow);
}

export async function getBriefing(sql: postgres.Sql, id: string): Promise<BriefingRow | null> {
  const rows = await sql<Row[]>`
    select b.id, b.column_id, c.title as column_title,
           to_char(b.period_from, 'YYYY-MM-DD') as period_from, to_char(b.period_to, 'YYYY-MM-DD') as period_to,
           b.sample_size, b.created_at, b.content, b.model,
           m.id as member_id, m.name as member_name, m.color as member_color
      from briefing b
      join deck_column c on c.id = b.column_id
      left join member m on m.id = b.created_by
     where b.id = ${id}`;
  if (rows.length === 0) return null;
  return { ...toListRow(rows[0]), content: rows[0].content as BriefingContent, model: rows[0].model ?? null };
}

export async function removeBriefing(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from briefing where id = ${id}`;
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/briefingStore.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: 커밋**

```bash
git add migrations/008_briefing.sql src/lib/briefingTypes.ts src/lib/briefingStore.ts src/lib/briefingStore.test.ts
git commit -m "feat(x-research): 브리핑 저장 백엔드 — briefing 008(콘텐츠 jsonb 재현성)·store CRUD·컬럼 연쇄삭제"
```

---

### Task 6: 브리핑 생성 엔진 `briefing.ts`

**Files:**
- Create: `src/lib/briefing.ts`
- Test: `src/lib/briefing.test.ts`

**Interfaces:**
- Consumes: `AnthropicLike`/`extractJson`/`MODEL`(suggest.ts), `weekStartJst`/`addWeeks`/`median`(trend.ts), `flagYakkiho`(complianceFlags.ts), `BriefingContent`/`BriefingStats`(briefingTypes.ts).
- Produces (라우트가 사용):
  - `BriefingTweet { tweetId: string; text: string; likes: number | null; createdAt: string | null; tweetUrl: string | null }`
  - `BRIEFING_WEEKS = [2, 4, 8] as const` / `BRIEFING_TWEET_CAP = 300` / `FORBIDDEN_PHRASES: string[]`
  - `briefingPeriod(nowIso: string, weeks: number): { from: string; toExclusive: string; toDisplay: string }` — 완성 주 기준 소급(from=현재주−N주, toExclusive=현재주 월요일, toDisplay=그 전 일요일)
  - `filterPeriod(tweets: BriefingTweet[], from: string, toExclusive: string): BriefingTweet[]`
  - `computeBriefingStats(tweets: BriefingTweet[], nowIso: string, weeks: number): BriefingStats`
  - `selectBriefingTweets(tweets: BriefingTweet[], cap?: number): BriefingTweet[]` — 주별 안배 + 좋아요 상위
  - `generateBriefing(input: { columnTitle: string; tweets: BriefingTweet[]; stats: BriefingStats }, client?: AnthropicLike): Promise<BriefingContent | null>` — null = 파싱/검증 실패(호출부가 502 처리, 저장 금지)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/briefing.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  briefingPeriod, filterPeriod, computeBriefingStats, selectBriefingTweets,
  generateBriefing, FORBIDDEN_PHRASES, type BriefingTweet,
} from './briefing.ts';
import type { AnthropicLike } from './suggest.ts';

const NOW = '2026-07-16T00:00:00.000Z'; // 현재 주 = 2026-07-13(월)

function tw(week: string, likes: number, id = ''): BriefingTweet {
  const created = new Date(Date.parse(week + 'T00:00:00Z') + 2 * 86_400_000).toISOString();
  return { tweetId: id || week + '-' + likes + '-' + Math.random(), text: '본문 ' + likes, likes, createdAt: created, tweetUrl: 'https://x.com/i/status/1' };
}

const fakeLLM = (payload: unknown): AnthropicLike => ({
  messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }) },
});
const GOOD = {
  tldr: ['니키비 화제가 늘었다', '흉터 케어 반응이 좋다', '홈케어 제품 언급 증가'],
  topics: '이번 기간엔 니키비 흉터 이야기가 많았다.',
  hits: '흉터 회복 후기 [T1] 반응이 가장 좋았다.',
  changes: '후반부에 게시량이 늘었다.',
  implications: '흉터 회복 과정 콘텐츠를 검토하자.',
};

test('briefingPeriod: 완성 주 기준 소급 — 집계 중 주 제외', () => {
  const p = briefingPeriod(NOW, 4);
  assert.equal(p.from, '2026-06-15');
  assert.equal(p.toExclusive, '2026-07-13');
  assert.equal(p.toDisplay, '2026-07-12'); // 마지막 완성 주 일요일
});

test('filterPeriod + computeBriefingStats: 기간 내 주별 수치(0건 주 포함)', () => {
  const tweets = [tw('2026-06-15', 100), tw('2026-06-15', 200), tw('2026-07-06', 50), tw('2026-07-13', 999)];
  const inP = filterPeriod(tweets, '2026-06-15', '2026-07-13');
  assert.equal(inP.length, 3); // 집계 중 주 제외
  const s = computeBriefingStats(tweets, NOW, 4);
  assert.equal(s.totalCount, 3);
  assert.equal(s.periodFrom, '2026-06-15');
  assert.equal(s.periodTo, '2026-07-12');
  assert.deepEqual(s.weekly.map((w) => w.count), [2, 0, 0, 1]);
  assert.equal(s.weekly[0].medianLikes, 150);
});

test('selectBriefingTweets: 상한 + 주별 안배(라운드로빈) + 좋아요 상위 우선', () => {
  const many = [
    ...Array.from({ length: 10 }, (_, i) => tw('2026-06-15', 100 - i, 'w1-' + i)),
    ...Array.from({ length: 10 }, (_, i) => tw('2026-06-22', 200 - i, 'w2-' + i)),
  ];
  const sel = selectBriefingTweets(many, 4);
  assert.equal(sel.length, 4);
  const ids = sel.map((t) => t.tweetId);
  assert.ok(ids.includes('w1-0') && ids.includes('w2-0')); // 각 주 1위 포함(안배)
  assert.ok(ids.includes('w1-1') && ids.includes('w2-1')); // 각 주 2위까지
});

test('generateBriefing: 수치 주입·[T] 복원·본문 조립', async () => {
  const tweets = [tw('2026-06-15', 500, 'tid-1'), tw('2026-06-22', 10, 'tid-2')];
  const stats = computeBriefingStats(tweets, NOW, 4);
  let prompt = '';
  const spy: AnthropicLike = {
    messages: { create: async (p) => { prompt = JSON.stringify(p); return fakeLLM(GOOD).messages.create(p); } },
  };
  const c = await generateBriefing({ columnTitle: '니키비跡', tweets, stats }, spy);
  assert.ok(prompt.includes('좋아요 중앙값'));            // 코드 계산 수치가 프롬프트에 주입됨
  assert.ok(prompt.includes('[T1]'));                     // 번호 매핑 주입
  assert.deepEqual(c!.tldr, GOOD.tldr);
  assert.ok(c!.body.includes('## 핵심 화두'));            // 고정 섹션 제목으로 코드가 조립
  assert.ok(c!.body.includes('## 기획 시사점'));
  assert.deepEqual(c!.citations.map((x) => x.tweetId), ['tid-1']); // [T1]만 인용됨
  assert.ok(Array.isArray(c!.citations[0].flags));
  assert.deepEqual(c!.stats, stats);
});

test('generateBriefing: 없는 번호 인용은 본문에서 제거·인용 목록 제외', async () => {
  const tweets = [tw('2026-06-15', 500, 'tid-1')];
  const stats = computeBriefingStats(tweets, NOW, 4);
  const c = await generateBriefing({ columnTitle: 'c', tweets, stats },
    fakeLLM({ ...GOOD, hits: '유령 트윗 [T99] 이 좋았다 [T1]' }));
  assert.ok(!c!.body.includes('[T99]'));
  assert.deepEqual(c!.citations.map((x) => x.n), [1]);
});

test('generateBriefing: 금지 표현·형식 불량 → null(저장 금지 신호)', async () => {
  const tweets = [tw('2026-06-15', 500)];
  const stats = computeBriefingStats(tweets, NOW, 4);
  assert.equal(await generateBriefing({ columnTitle: 'c', tweets, stats },
    fakeLLM({ ...GOOD, topics: '인게이지먼트가 높다고 할 수 있습니다.' })), null); // 금지 표현
  assert.equal(await generateBriefing({ columnTitle: 'c', tweets, stats },
    fakeLLM({ tldr: '배열 아님', topics: 1 })), null);                            // 형식 불량
  const noJson: AnthropicLike = { messages: { create: async () => ({ content: [{ type: 'text', text: '죄송합니다' }] }) } };
  assert.equal(await generateBriefing({ columnTitle: 'c', tweets, stats }, noJson), null);
});

test('FORBIDDEN_PHRASES에 핵심 금지어 포함(회귀 고정)', () => {
  for (const p of ['라고 할 수 있습니다', '주목할 만한', '인게이지먼트']) {
    assert.ok(FORBIDDEN_PHRASES.includes(p), p);
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/briefing.test.ts`
Expected: FAIL — `Cannot find module './briefing.ts'`

- [ ] **Step 3: 구현**

`src/lib/briefing.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { extractJson, MODEL, type AnthropicLike } from './suggest.ts';
import { weekStartJst, addWeeks, median } from './trend.ts';
import { flagYakkiho } from './complianceFlags.ts';
import type { BriefingContent, BriefingCitation, BriefingStats } from './briefingTypes.ts';

export interface BriefingTweet {
  tweetId: string; text: string; likes: number | null;
  createdAt: string | null; tweetUrl: string | null;
}

export const BRIEFING_WEEKS = [2, 4, 8] as const;
export const BRIEFING_TWEET_CAP = 300;
// AI 상투 표현·업계 압축어 — 출력에 있으면 검증 실패(회귀 테스트로 고정)
export const FORBIDDEN_PHRASES = ['라고 할 수 있습니다', '주목할 만한', '인게이지먼트', '괄목할', '눈여겨볼 만'];

const DAY_MS = 86_400_000;

// 기간 = 마지막 완성 주 기준 소급 N주(집계 중인 현재 주 제외 — 후반부가 식어 보이는 왜곡 방지)
export function briefingPeriod(nowIso: string, weeks: number): { from: string; toExclusive: string; toDisplay: string } {
  const toExclusive = weekStartJst(nowIso);
  return {
    from: addWeeks(toExclusive, -weeks),
    toExclusive,
    toDisplay: new Date(Date.parse(toExclusive + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10),
  };
}

export function filterPeriod(tweets: BriefingTweet[], from: string, toExclusive: string): BriefingTweet[] {
  return tweets.filter((t) => {
    if (!t.createdAt) return false;
    const w = weekStartJst(t.createdAt);
    return w >= from && w < toExclusive;
  });
}

export function computeBriefingStats(tweets: BriefingTweet[], nowIso: string, weeks: number): BriefingStats {
  const { from, toExclusive, toDisplay } = briefingPeriod(nowIso, weeks);
  const inPeriod = filterPeriod(tweets, from, toExclusive);
  const byWeek = new Map<string, BriefingTweet[]>();
  for (const t of inPeriod) {
    const w = weekStartJst(t.createdAt!);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(t);
  }
  const weekly = [];
  for (let i = 0; i < weeks; i++) {
    const w = addWeeks(from, i);
    const arr = byWeek.get(w) ?? [];
    weekly.push({ weekStart: w, count: arr.length, medianLikes: median(arr.map((t) => t.likes ?? 0)) });
  }
  return { periodFrom: from, periodTo: toDisplay, totalCount: inPeriod.length, weekly };
}

// 상한 선별: 주별로 좋아요 내림차순 정렬 후 라운드로빈 — 상위 반응 우선 + 시간 편중 방지
export function selectBriefingTweets(tweets: BriefingTweet[], cap = BRIEFING_TWEET_CAP): BriefingTweet[] {
  const byWeek = new Map<string, BriefingTweet[]>();
  for (const t of tweets) {
    if (!t.createdAt) continue;
    const w = weekStartJst(t.createdAt);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(t);
  }
  for (const arr of byWeek.values()) arr.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
  const weeks = [...byWeek.keys()].sort();
  const out: BriefingTweet[] = [];
  for (let i = 0; out.length < cap; i++) {
    let added = false;
    for (const w of weeks) {
      const t = byWeek.get(w)![i];
      if (t && out.length < cap) { out.push(t); added = true; }
    }
    if (!added) break;
  }
  return out;
}

const SECTIONS = [
  ['topics', '핵심 화두'], ['hits', '반응이 좋았던 것'], ['changes', '변화'], ['implications', '기획 시사점'],
] as const;

const PROMPT = (columnTitle: string, stats: BriefingStats, tweetLines: string[]) =>
  `당신은 일본 뷰티/미용의료 X(트위터)를 관찰해 한국 콘텐츠 기획팀에 보고하는 리서처입니다.
관찰 대상 컬럼: "${columnTitle}" · 기간: ${stats.periodFrom} ~ ${stats.periodTo} · 표본 ${stats.totalCount}건

[주별 수치 — 코드가 계산한 확정값입니다. 숫자는 반드시 아래 값만 인용하고, 직접 세거나 계산하지 마세요]
${stats.weekly.map((w) => `${w.weekStart} 주: ${w.count}건, 좋아요 중앙값 ${w.medianLikes}`).join('\n')}

[트윗 목록 — 트윗을 인용할 땐 반드시 [T번호] 표기만 사용하세요. 본문을 옮겨 적지 마세요]
${tweetLines.join('\n')}

다음 구조의 보고서를 한국어 JSON으로 작성하세요:
- tldr: 3줄 요약 (배열 3개, 각각 완결된 한 문장)
- topics: 핵심 화두 — 이 기간에 무슨 이야기가 돌았나
- hits: 반응이 좋았던 것 — 어떤 내용·형식이 반응을 얻었나. 근거 트윗을 [T번호]로 인용
- changes: 변화 — 기간 전반부와 후반부 사이에 뜨거나 식은 것. 위 주별 수치를 근거로
- implications: 기획 시사점 — 우리 계정의 콘텐츠 기획에 참고할 점

문체 규칙 (엄수):
- 처음 읽는 팀원이 배경 설명 없이 이해할 수 있게 씁니다
- 전문용어·업계 압축어 금지. 부득이하면 바로 옆에 풀어 씁니다 (예: "인게이지먼트" 대신 "반응(좋아요·리트윗)")
- "~라고 할 수 있습니다", "주목할 만한" 같은 상투 표현과 과장 수식어 금지
- 짧은 완결 문장으로, 한 문단에는 하나의 이야기만
- 컬럼 주제와 무관한 잡담성 트윗은 무시합니다
JSON만 출력: {"tldr": ["...","...","..."], "topics": "...", "hits": "...", "changes": "...", "implications": "..."}`;

export async function generateBriefing(
  input: { columnTitle: string; tweets: BriefingTweet[]; stats: BriefingStats },
  client?: AnthropicLike,
): Promise<BriefingContent | null> {
  const c = client ?? (new Anthropic() as unknown as AnthropicLike);
  const numbered = input.tweets.map((t, i) => ({ n: i + 1, t }));
  const lines = numbered.map(({ n, t }) => `[T${n}] (♥${t.likes ?? 0}) ${t.text.replace(/\s+/g, ' ').slice(0, 200)}`);

  const res = await c.messages.create({
    model: MODEL(),
    max_tokens: 3000,
    messages: [{ role: 'user', content: PROMPT(input.columnTitle, input.stats, lines) }],
  });
  const j = extractJson(res) as Record<string, unknown> | null;
  if (!j) return null;

  const tldr = Array.isArray(j.tldr) ? j.tldr.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
  if (tldr.length === 0) return null;
  for (const [key] of SECTIONS) if (typeof j[key] !== 'string' || !(j[key] as string).trim()) return null;

  // 본문 조립은 코드가 — 섹션 제목·순서 고정(회차 간 비교 가능)
  let body = SECTIONS.map(([key, title]) => `## ${title}\n${(j[key] as string).trim()}`).join('\n\n');

  // 인용 검증: 존재하는 번호만 살리고(실트윗 복원), 유령 번호는 본문에서 제거
  const valid = new Set<number>();
  body = body.replace(/\[T(\d+)\]/g, (tok, d: string) => {
    const n = Number(d);
    if (n >= 1 && n <= numbered.length) { valid.add(n); return tok; }
    return '';
  });
  const citations: BriefingCitation[] = [...valid].sort((a, b) => a - b).map((n) => {
    const t = numbered[n - 1].t;
    return { n, tweetId: t.tweetId, text: t.text, likes: t.likes, url: t.tweetUrl, flags: flagYakkiho(t.text) };
  });

  // 문체 검증 — 금지 표현이 있으면 통째 실패(반쪽 문서를 저장하지 않는다)
  const all = tldr.join(' ') + ' ' + body;
  if (FORBIDDEN_PHRASES.some((p) => all.includes(p))) return null;

  return { tldr, body, citations, stats: input.stats };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/briefing.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/briefing.ts src/lib/briefing.test.ts
git commit -m "feat(x-research): 브리핑 생성 엔진 — 수치 주입(숫자/서술 분리)·[T] 인용 검증·문체 금지어·주별 안배 선별"
```

---

### Task 7: 브리핑 API — `POST·GET /api/briefings`, `GET·DELETE /api/briefings/[id]`

**Files:**
- Create: `src/app/api/briefings/route.ts`
- Create: `src/app/api/briefings/[id]/route.ts`

**Interfaces:**
- Consumes: Task 5 store(`saveBriefing`/`listBriefings`/`getBriefing`/`removeBriefing`), Task 6 엔진(`briefingPeriod`/`filterPeriod`/`computeBriefingStats`/`selectBriefingTweets`/`generateBriefing`/`BRIEFING_WEEKS`), `pillarStore.listAnalysisTweets`, `columnStore.getColumn`, `MODEL`(suggest.ts).
- Produces:
  - `POST /api/briefings` body `{columnId, weeks: 2|4|8, memberId?: string|null}` → 생성·저장 후 `BriefingRow`. 400 = weeks 불량/기간 내 트윗 0건, 404 = 컬럼 없음, 502 = 생성 실패(저장 안 함).
  - `GET /api/briefings?workspaceId=` → `BriefingListRow[]`.
  - `GET /api/briefings/[id]` → `BriefingRow`(404), `DELETE` → `{ok: true}`.

- [ ] **Step 1: 목록·생성 라우트 작성**

`src/app/api/briefings/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { listAnalysisTweets } from '@/lib/pillarStore';
import {
  BRIEFING_WEEKS, briefingPeriod, filterPeriod, computeBriefingStats,
  selectBriefingTweets, generateBriefing, type BriefingTweet,
} from '@/lib/briefing';
import { saveBriefing, listBriefings, getBriefing } from '@/lib/briefingStore';
import { MODEL } from '@/lib/suggest';

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listBriefings(getSql(), workspaceId));
}

export async function POST(req: Request) {
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as { columnId?: string; weeks?: number; memberId?: string | null };
  const weeks = body.weeks as (typeof BRIEFING_WEEKS)[number];
  if (!body.columnId || !BRIEFING_WEEKS.includes(weeks)) {
    return NextResponse.json({ error: 'columnId와 weeks(2·4·8)가 필요해요' }, { status: 400 });
  }
  const col = await getColumn(sql, body.columnId);
  if (!col) return NextResponse.json({ error: `column not found: ${body.columnId}` }, { status: 404 });

  const now = new Date().toISOString();
  const rows = await listAnalysisTweets(sql, col.id, { limit: 2000 });
  // tweet_url은 listAnalysisTweets에 없음 — 트윗 ID로 X 상세 URL 구성(카드의 기존 관행과 동일 포맷)
  const all: BriefingTweet[] = rows.map((r) => ({
    tweetId: r.tweetId, text: r.text, likes: r.likes, createdAt: r.createdAt,
    tweetUrl: `https://x.com/i/status/${r.tweetId}`,
  }));
  const { from, toExclusive } = briefingPeriod(now, weeks);
  const inPeriod = filterPeriod(all, from, toExclusive);
  if (inPeriod.length === 0) {
    return NextResponse.json({ error: '이 기간엔 트윗이 없어요 — 먼저 새로고침하세요' }, { status: 400 });
  }

  const stats = computeBriefingStats(all, now, weeks);
  let content;
  try {
    content = await generateBriefing({ columnTitle: col.title, tweets: selectBriefingTweets(inPeriod), stats });
  } catch {
    return NextResponse.json({ error: '생성 실패 — 다시 시도해주세요' }, { status: 502 });
  }
  if (!content) return NextResponse.json({ error: '생성 실패 — 다시 시도해주세요' }, { status: 502 });

  const id = await saveBriefing(sql, {
    workspaceId: col.workspaceId, columnId: col.id,
    periodFrom: stats.periodFrom, periodTo: stats.periodTo,
    sampleSize: stats.totalCount, content, model: MODEL(), memberId: body.memberId ?? null,
  });
  return NextResponse.json(await getBriefing(sql, id));
}
```

- [ ] **Step 2: 단건 라우트 작성**

`src/app/api/briefings/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getBriefing, removeBriefing } from '@/lib/briefingStore';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await getBriefing(getSql(), id);
  if (!row) return NextResponse.json({ error: `briefing not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await removeBriefing(getSql(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 빌드 확인 후 커밋**

Run: `npm run build`
Expected: 성공, `/api/briefings`·`/api/briefings/[id]` 라우트 표시.

```bash
git add src/app/api/briefings
git commit -m "feat(x-research): 브리핑 API — 생성(완성 주 기간·트윗 0건 400·실패 시 저장 안 함)·목록·열람·삭제"
```

---

### Task 8: 브리핑 UI — `BriefingSection` + 리서치 페이지 배선

**Files:**
- Create: `src/components/BriefingSection.tsx`
- Modify: `src/app/w/[wsId]/research/page.tsx` (섹션 추가만 — 기존 마크업 불변)

**Interfaces:**
- Consumes: Task 7 API, `GET /api/columns?workspaceId=`(기존), `GET /api/columns/[id]/trend`(표본 미리 확인), `useMember()`(memberContext), `BriefingListRow`/`BriefingRow`(briefingStore), `BriefingContent`(briefingTypes), `TrendPayload`(trend), `formatCount`(format).
- Produces: `BriefingSection({ wsId })` — 리서치 페이지가 렌더.

- [ ] **Step 1: BriefingSection 작성**

`src/components/BriefingSection.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useMember } from '@/lib/memberContext';
import type { ColumnRow } from '@/lib/types';
import type { TrendPayload } from '@/lib/trend';
import type { BriefingListRow, BriefingRow } from '@/lib/briefingStore';
import type { BriefingContent } from '@/lib/briefingTypes';
import { formatCount } from '@/lib/format';

const WEEK_OPTIONS = [2, 4, 8] as const;
const MIN_SAMPLE = 10;

function fmtDay(s: string): string {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// 본문의 [T번호] 토큰을 실트윗 인용 카드로 복원해 렌더 — 모든 인용이 클릭해서 확인 가능한 실제 트윗
function Body({ content }: { content: BriefingContent }) {
  const byN = new Map(content.citations.map((c) => [c.n, c]));
  return (
    <div className="space-y-2 text-sm">
      {content.body.split('\n').map((line, i) => {
        if (line.startsWith('## ')) return <h3 key={i} className="mt-3 font-bold">{line.slice(3)}</h3>;
        if (!line.trim()) return null;
        const parts = line.split(/(\[T\d+\])/g);
        return (
          <p key={i}>
            {parts.map((p, j) => {
              const m = p.match(/^\[T(\d+)\]$/);
              const c = m ? byN.get(Number(m[1])) : undefined;
              if (!c) return <span key={j}>{p}</span>;
              return (
                <span key={j} className="mx-0.5 inline-block max-w-full rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 align-middle text-xs dark:border-gray-700 dark:bg-gray-900">
                  {c.flags.length > 0 && <span className="mr-1" title={`표현 주의(薬機法 참고): ${c.flags.join(', ')}`}>⚠️</span>}
                  <span className="line-clamp-1">{c.text}</span>
                  <span className="text-gray-400"> ♥{formatCount(c.likes)} </span>
                  {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">원문</a>}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

export function BriefingSection({ wsId }: { wsId: string }) {
  const { member } = useMember();
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [columnId, setColumnId] = useState('');
  const [weeks, setWeeks] = useState<(typeof WEEK_OPTIONS)[number]>(4);
  const [sample, setSample] = useState<number | null>(null);
  const [list, setList] = useState<BriefingListRow[]>([]);
  const [current, setCurrent] = useState<BriefingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadList = useCallback(async () => {
    const r = await fetch(`/api/briefings?workspaceId=${wsId}`);
    if (r.ok) setList((await r.json()) as BriefingListRow[]);
  }, [wsId]);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/columns?workspaceId=${wsId}`);
      if (r.ok) setColumns((await r.json()) as ColumnRow[]);
    })();
    loadList();
  }, [wsId, loadList]);

  // 표본 미리 확인 — 기존 추이 API 재사용(주별 건수 합산, 추가 비용 없음)
  useEffect(() => {
    setSample(null);
    if (!columnId) return;
    let stale = false;
    (async () => {
      const r = await fetch(`/api/columns/${columnId}/trend`);
      if (!r.ok || stale) return;
      const t = (await r.json()) as TrendPayload;
      setSample(t.weekly.slice(-weeks).reduce((s, w) => s + w.count, 0));
    })();
    return () => { stale = true; };
  }, [columnId, weeks]);

  async function generate() {
    setBusy(true); setErr('');
    const r = await fetch('/api/briefings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId, weeks, memberId: member?.id ?? null }),
    });
    if (r.ok) { setCurrent((await r.json()) as BriefingRow); await loadList(); }
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy(false);
  }

  async function open(id: string) {
    const r = await fetch(`/api/briefings/${id}`);
    if (r.ok) setCurrent((await r.json()) as BriefingRow);
  }
  async function remove(id: string) {
    await fetch(`/api/briefings/${id}`, { method: 'DELETE' });
    if (current?.id === id) setCurrent(null);
    await loadList();
  }

  return (
    <section className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
      <h2 className="font-bold">📋 기간 종합 브리핑 <span className="text-sm font-normal text-gray-400">컬럼 하나를 골라 최근 몇 주간 무슨 일이 있었는지 보고서로 정리해요</span></h2>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <select value={columnId} onChange={(e) => setColumnId(e.target.value)}
                className="rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-700">
          <option value="">컬럼 선택…</option>
          {columns.map((c) => <option key={c.id} value={c.id}>{c.kind === 'watchlist' ? '👤 ' : '🔍 '}{c.title}</option>)}
        </select>
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value) as typeof weeks)}
                className="rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-700">
          {WEEK_OPTIONS.map((w) => <option key={w} value={w}>최근 {w}주</option>)}
        </select>
        <button onClick={generate} disabled={busy || !columnId || sample === 0}
                className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40"
                title="이 기간의 트윗을 AI가 읽고 보고서를 만들어요 (약 $0.1 이하)">
          {busy ? '생성 중…' : '브리핑 생성 (약 $0.1 이하)'}
        </button>
        {sample !== null && (
          <span className={`text-xs ${sample < MIN_SAMPLE ? 'text-amber-600' : 'text-gray-400'}`}>
            이 기간 표본 {sample}건{sample === 0 ? ' — 생성할 수 없어요' : sample < MIN_SAMPLE ? ' — 적어서 브리핑이 빈약할 수 있어요' : ''}
          </span>
        )}
      </div>
      {err && <p className="mt-1 text-sm text-red-500">{err}</p>}

      {current && (
        <div className="mt-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
          <div className="flex items-baseline gap-2">
            <p className="font-bold">{current.columnTitle}</p>
            <span className="text-xs text-gray-400">
              {fmtDay(current.periodFrom)}~{fmtDay(current.periodTo)} · 표본 {current.sampleSize}건 · {fmtDay(current.createdAt.slice(0, 10))} 생성
              {current.member && <span className="ml-1 rounded px-1" style={{ backgroundColor: current.member.color + '33' }}>{current.member.name}</span>}
            </span>
            <button onClick={() => setCurrent(null)} className="ml-auto rounded px-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-900">✕</button>
          </div>

          {/* 수치 블록 — AI를 거치지 않은 코드 계산값 */}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
            {current.content.stats.weekly.map((w) => (
              <span key={w.weekStart} className="rounded bg-gray-50 px-1.5 py-0.5 dark:bg-gray-900"
                    title="그 주 트윗의 보통 반응 수준(좋아요 중앙값)">
                {fmtDay(w.weekStart)}주 {w.count}건 ♥{formatCount(w.medianLikes)}
              </span>
            ))}
          </div>

          <ul className="mt-2 list-disc pl-5 text-sm font-bold">
            {current.content.tldr.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          <Body content={current.content} />
        </div>
      )}

      {list.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-gray-400">지난 브리핑</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {list.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <button onClick={() => open(b.id)} className="truncate text-left hover:underline">
                  📄 {b.columnTitle} · {fmtDay(b.periodFrom)}~{fmtDay(b.periodTo)}
                </button>
                <span className="shrink-0 text-xs text-gray-400">
                  {fmtDay(b.createdAt.slice(0, 10))} 생성
                  {b.member && <span className="ml-1 rounded px-1" style={{ backgroundColor: b.member.color + '33' }}>{b.member.name}</span>}
                </span>
                <button onClick={() => remove(b.id)} className="shrink-0 rounded px-1 text-xs text-gray-400 hover:text-red-500" title="이 브리핑 삭제">삭제</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 리서치 페이지 배선** (기존 마크업 불변 — 추가만)

`src/app/w/[wsId]/research/page.tsx` 수정 2곳:

(a) import 추가(상단):

```tsx
import { BriefingSection } from '@/components/BriefingSection';
```

(b) `</main>` 닫는 태그 **바로 다음**(선택 바 `{(selected.length > 0 || createdColumn) && (` 블록 앞)에:

```tsx
      <BriefingSection wsId={wsId} />
```

- [ ] **Step 3: 빌드 + 전체 테스트**

Run: `npm run build && npm test`
Expected: build 성공, 전체 테스트 PASS (기존 106 + 신규 trend 6·briefing 7·briefingStore 2·refreshColumn 1 = 122).

- [ ] **Step 4: 커밋**

```bash
git add src/components/BriefingSection.tsx src/app/w/\[wsId\]/research/page.tsx
git commit -m "feat(x-research): 브리핑 섹션 — 컬럼·기간 선택, 표본 미리 확인·빈약 경고, [T] 인용 카드·규제 배지, 지난 브리핑 목록"
```

---

### Task 9: 전체 검증 — 테스트·빌드·실데이터 E2E·푸시

**Files:**
- Modify: `.git/sdd/progress.md` (진행 원장 기록)

**Interfaces:**
- Consumes: Task 1~8 전부.
- Produces: main에 push된 완성 기능 + 진행 원장 갱신.

- [ ] **Step 1: 전체 테스트·빌드**

Run: `npm test && npm run build`
Expected: 전체 PASS(122개), build 성공.

- [ ] **Step 2: dev 서버 확인**

Run: `pgrep -fl "next dev"` — 이미 떠 있으면 재사용, 없으면 `npm run dev` 백그라운드 기동. 2개 이상이면 모두 종료 후 `rm -rf .next` 하고 1개만 재기동(캐시 오염 예방 — Global Constraints 참조).

- [ ] **Step 3: 브라우저 E2E (실데이터)**

브라우저로 덱 페이지 열고 순서대로 확인:

1. **검색 컬럼**(니키비跡)에서 [추이] 클릭 → 주간 막대 8행 + "집계 중" 행 + 판정문 한 줄 표시. 스파이크 실측(주 41~61건)과 어긋나지 않는지 육안 대조.
2. **계정 컬럼**(주제 분석 실행된 것)에서 [추이] → 주제별 추이(2주 단위, ▲▼─) 표시. 주제 분석 없는 계정 컬럼 → "주제 분석을 먼저 실행하면…" 안내.
3. **표본 부족 컬럼**(CPR 세럼 등 1~2주치) → "아직 데이터가 N주치뿐" + [과거 트윗 더 가져오기] → 클릭(실 getxapi, ~$0.01) → 수집 후 추이 갱신 확인. 네트워크 탭에서 검색 컬럼이면 since/until이 쿼리에 들어갔는지 확인.
4. 추이 패널 열어둔 채 8초 대기 — `/api/` 반복 요청 없음(무한 루프 부재, Phase 2 회귀 항목).
5. **리서치 페이지** → 기존 웹 리서치(exa) 섹션 그대로 동작(검색 1회) → 아래 "기간 종합 브리핑" 섹션에서 니키비跡·4주 선택 → 표본 N건 표시 → [브리핑 생성](실 Haiku, ~$0.1) → 수치 블록·3줄 요약·본문·[T] 인용 카드(원문 링크 클릭 가능)·규제 배지(있다면) 확인. **문체 육안 확인**: 전문용어·AI 상투 문장 없는지.
6. 지난 브리핑 목록에서 재열람 → 삭제 → 목록에서 사라짐.
7. 표본 10건 미만 컬럼 선택 → "적어서 빈약할 수 있어요" 경고 노출, 0건 컬럼 → 생성 버튼 비활성.
8. 덱 기존 기능(새로고침·주제 분석·저장·버림) 회귀 없는지 가볍게 확인.

- [ ] **Step 4: 진행 원장 기록**

`.git/sdd/progress.md` 말미에 Phase 3 완료 요약 추가(태스크별 커밋 범위·E2E 결과·이연 이슈 — Phase 2 기록 형식 그대로).

- [ ] **Step 5: 푸시**

```bash
git push
```

Expected: `cb-koo/cb-x-deck` main 갱신.
