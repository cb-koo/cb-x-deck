# 계정 분석 v2(기간 기준 수집·활동/내용 분리·전체 분석) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 계정 분석의 수집을 "최근 28일 활동 + 직접 쓴 글 60건"으로 바꾸고, RT가 퍼나르는 주제 축을 더하고, 명부에서 전체 계정을 일괄 분석할 수 있게 한다.

**Architecture:** 수집(`TweetSource`)·통계(`analysisStats`)·판단(`influencerJudgment`)은 순수 함수로 확장하고, 파이프라인(`influencerAnalysis`)이 v2 저장 형태를 만든다. UI는 `activity` 유무로 v1/v2를 분기. 분석 실행은 구독 가능한 모듈 스토어(`analysisRun.ts`)로 추출해 프로필·일괄 실행이 공유한다. 스펙: `docs/superpowers/specs/2026-08-27-analysis-period-based-design.md`(판단이 갈리면 스펙 우선).

**Tech Stack:** Next.js App Router, React 19(`useSyncExternalStore`), postgres.js(jsonb `?`), node:test + tsx.

## Global Constraints
- 사용자 문구 한국어, AGENTS.md UX 원칙(라벨-값 일치·색만으로 전달 금지·숫자마다 판단문·상한에 걸린 때만 캡션).
- 마이그레이션 없음. API 라우트 변경 없음(`/api/influencers/[id]/analyze` 응답 `{analysis, analyzedAt}` 그대로).
- 상수(스펙 §1): `ACTIVITY_DAYS=28`, `DIRECT_TARGET=60`, `LOOKBACK_MONTHS=6`, `MAX_PAGES=60`, `MAX_TWEETS=2000`, `RT_CLASSIFY_MAX=100`, `COLLECT_DEADLINE_MS=120_000`.
- 테스트: `node --import tsx --test <file>`(스토어 테스트는 `--env-file-if-exists=.env`). `npm test` 전체는 마지막 태스크만.
- 검증 기준: `npx tsc --noEmit` 0, `npm run lint | grep problems` = `24 problems`, `npm run build` 성공. **예외**: 웨이브 2의 T5(타입·파이프라인) 완료 시점엔 `AnalysisSection.tsx`에만 타입 에러가 남는 것을 허용 — T6이 해소. 그 외 파일 에러는 결함.
- 커밋: 한국어 `feat(influencer): …`/`refactor…`/`fix…` + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add`는 자기 파일만(병행 커밋 중, index.lock 실패 시 2s 후 재시도).
- LLM 호출은 `callLLM` 경유(`AnalysisChat` 인터페이스), sampling 파라미터 금지.

## 실행 웨이브 · 모델

| 웨이브 | 태스크(병렬) | 모델 |
|---|---|---|
| 1 | T1 수집 v2 · T2 활동 통계 · T3 판단 함수(추가만) · T7 실행 스토어 · T8 명부 필드 | 전부 sonnet |
| 2 | T5 타입+파이프라인 v2 · T9 전체 분석 다이얼로그+명부 | 둘 다 opus |
| 3 | T6 분석 UI v2(judgeCadence 삭제 포함) | opus |
| 4 | T10 통합 검증 + updates 소식 | sonnet |

의존: T5←T1,T2,T3 / T9←T7,T8 / T6←T5,T3,T7 / T10←전부. 파일 소유: T1 `tweetSource.*` · T2 `analysisStats.*` · T3 `influencerJudgment.*` · T7 `analysisRun.ts`(+test) · T8 `influencerStore.*`(Row/SELECT만) · T5 `influencerStore.ts`(InfluencerAnalysis 타입만)+`influencerAnalysis.*` · T9 `page.tsx`+`BulkAnalyzeDialog.tsx` · T6 `AnalysisSection.tsx`+`influencerJudgment.*`(judgeCadence 삭제).

---

### Task 1: 수집 v2 (`src/lib/tweetSource.ts`)

**Files:** Modify `src/lib/tweetSource.ts`, rewrite `src/lib/tweetSource.test.ts`. (`AnalysisTweet.rtText`는 T2가 타입에 추가 — 이 태스크는 매퍼에서 채운다. T2보다 먼저 끝나면 tsc가 `rtText` 초과 속성으로 실패할 수 있음 → T2 완료를 기다려 재확인.)

**Interfaces — Produces:**
```ts
export interface FetchOpts { activitySince: string; directTarget: number; lookbackSince: string; maxPages: number; maxTweets: number; deadlineAt?: number }
export interface FetchResult { tweets: AnalysisTweet[]; truncated: boolean; reachedActivitySince: boolean; directCount: number; pagesUsed: number }
export interface TweetSource { fetchRecent(userId: string, opts: FetchOpts): Promise<FetchResult> }
export function mapRawAnalysisTweet(raw: RawTweet): AnalysisTweet | null;   // rtText 채움
export function makeGetxapiTweetSource(client: Pick<GetxapiClient, 'getUserTweets'>, now?: () => number): TweetSource;  // now 주입 = 데드라인 테스트용
```

- [ ] **Step 1: 테스트 재작성** — `src/lib/tweetSource.test.ts`
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRawAnalysisTweet, makeGetxapiTweetSource, type FetchOpts } from './tweetSource.ts';
import type { RawTweet, SearchPage } from './getxapi.ts';

const raw = (over: Record<string, unknown>): RawTweet => ({
  id: 't', text: '本文', createdAt: '2026-08-20T00:00:00.000Z', viewCount: 1, likeCount: 1, media: [], ...over,
});
const page = (tweets: RawTweet[], more: boolean): SearchPage => ({ tweets, has_more: more, next_cursor: more ? 'c' : null });
const src = (pages: SearchPage[], now = () => 0) => {
  let i = 0;
  return { source: makeGetxapiTweetSource({ getUserTweets: async () => pages[i++] }, now), calls: () => i };
};
const OPTS: FetchOpts = {
  activitySince: '2026-08-01T00:00:00.000Z', directTarget: 2,
  lookbackSince: '2026-03-01T00:00:00.000Z', maxPages: 10, maxTweets: 100,
};

test('mapRawAnalysisTweet: RT는 rtText에 원문(retweeted_tweet.text 우선)', () => {
  const t = mapRawAnalysisTweet(raw({ id: 'r', retweeted_tweet: { id: 'o', text: '原文' }, text: 'RT @o: 原…' }))!;
  assert.equal(t.kind, 'retweet');
  assert.equal(t.rtText, '原文');
  assert.equal(mapRawAnalysisTweet(raw({}))!.rtText, undefined);
});

test('정상 종료: activitySince를 지났고 직접 글 목표를 채우면 더 안 넘긴다', async () => {
  const { source, calls } = src([
    page([raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }), raw({ id: 'b', createdAt: '2026-07-30T00:00:00.000Z' })], true),
    page([raw({ id: 'never' })], false),
  ]);
  const r = await source.fetchRecent('u', OPTS);          // 직접 2건(a,b) 확보 + b가 activitySince 이전
  assert.deepEqual(r.tweets.map((t) => t.id), ['a', 'b']);
  assert.equal(r.reachedActivitySince, true);
  assert.equal(r.directCount, 2);
  assert.equal(r.truncated, false);
  assert.equal(calls(), 1);
});

test('activitySince를 지났어도 직접 글이 부족하면 lookbackSince까지 계속 넘긴다', async () => {
  const { source, calls } = src([
    page([raw({ id: 'rt1', kind: 'x', retweeted_tweet: { text: 'o' }, createdAt: '2026-07-20T00:00:00.000Z' })], true),
    page([raw({ id: 'd1', createdAt: '2026-06-01T00:00:00.000Z' }), raw({ id: 'd2', createdAt: '2026-05-01T00:00:00.000Z' })], true),
    page([raw({ id: 'never' })], false),
  ]);
  const r = await source.fetchRecent('u', OPTS);
  assert.deepEqual(r.tweets.map((t) => t.id), ['rt1', 'd1', 'd2']);
  assert.equal(r.directCount, 2);
  assert.equal(calls(), 2);
});

test('lookbackSince보다 오래된 트윗은 담지 않고 종료', async () => {
  const { source } = src([page([raw({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })], true), page([raw({ id: 'x' })], false)]);
  const r = await source.fetchRecent('u', OPTS);
  assert.deepEqual(r.tweets, []);
  assert.equal(r.truncated, false);
});

test('상한 종료: maxPages', async () => {
  const pages = Array.from({ length: 5 }, (_, i) => page([raw({ id: `p${i}`, retweeted_tweet: { text: 'o' } })], true));
  const { source } = src(pages);
  const r = await source.fetchRecent('u', { ...OPTS, maxPages: 3 });
  assert.equal(r.pagesUsed, 3);
  assert.equal(r.truncated, true);
  assert.equal(r.reachedActivitySince, false);
});

test('상한 종료: maxTweets', async () => {
  const { source } = src([page([raw({ id: '1' }), raw({ id: '2' }), raw({ id: '3' })], true), page([raw({ id: '4' })], false)]);
  const r = await source.fetchRecent('u', { ...OPTS, maxTweets: 2 });
  assert.equal(r.tweets.length, 2);
  assert.equal(r.truncated, true);
});

test('상한 종료: deadlineAt', async () => {
  let t = 0;
  const { source } = src([page([raw({ id: '1' })], true), page([raw({ id: '2' })], true), page([raw({ id: '3' })], false)], () => (t += 100));
  const r = await source.fetchRecent('u', { ...OPTS, deadlineAt: 150 });   // 1페이지 후 now=100<150 계속, 2페이지 후 200≥150 중단
  assert.equal(r.pagesUsed, 2);
  assert.equal(r.truncated, true);
});

test('계정 소진(has_more=false)은 상한이 아니다', async () => {
  const { source } = src([page([raw({ id: '1', createdAt: '2026-08-20T00:00:00.000Z' })], false)]);
  const r = await source.fetchRecent('u', OPTS);
  assert.equal(r.truncated, false);
  assert.equal(r.reachedActivitySince, false);  // 28일 전까지 못 갔지만 상한 아님
});

test('고정글은 시간순 판정에서만 빼고 수집엔 포함, 중복 제거', async () => {
  const { source, calls } = src([
    page([raw({ id: 'pin', isPinned: true, createdAt: '2026-05-05T00:00:00.000Z' }), raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }), raw({ id: 'b', createdAt: '2026-07-30T00:00:00.000Z' })], true),
    page([raw({ id: 'pin', createdAt: '2026-05-05T00:00:00.000Z' })], false),
  ]);
  const r = await source.fetchRecent('u', { ...OPTS, directTarget: 10 });
  assert.deepEqual([...r.tweets.map((t) => t.id)].sort(), ['a', 'b', 'pin']);   // pin 1번만
  assert.ok(calls() >= 1);
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test src/lib/tweetSource.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/lib/tweetSource.ts` 전체 교체
```ts
// 계정 분석용 수집 경계(스펙 §1). 활동은 activitySince(28일)까지, 내용은 직접 글 directTarget건까지 —
// 두 조건이 모두 차거나 lookbackSince(6개월)를 넘으면 정상 종료. 페이지/총량/데드라인은 "상한 종료"(truncated)로
// 따로 표시한다 — 계정 트윗이 소진돼 끝난 것은 상한이 아니다(캡션은 상한일 때만, 라벨-값 일치).
import type { GetxapiClient, RawTweet } from './getxapi.ts';
import { num, str, toIso } from './mappers.ts';
import type { AnalysisTweet } from './analysisStats.ts';

export interface FetchOpts {
  activitySince: string; directTarget: number; lookbackSince: string;
  maxPages: number; maxTweets: number; deadlineAt?: number;
}
export interface FetchResult {
  tweets: AnalysisTweet[]; truncated: boolean; reachedActivitySince: boolean; directCount: number; pagesUsed: number;
}
export interface TweetSource { fetchRecent(userId: string, opts: FetchOpts): Promise<FetchResult> }

export function mapRawAnalysisTweet(raw: RawTweet): AnalysisTweet | null {
  const id = str(raw.id);
  const createdAt = toIso(raw.createdAt);
  if (!id || !createdAt) return null;
  const rt = raw.retweeted_tweet as Record<string, unknown> | undefined;
  const kind = rt ? 'retweet' : raw.quoted_tweet ? 'quote' : 'original';
  const media = Array.isArray(raw.media) ? raw.media : [];
  return {
    id, createdAt, kind,
    text: str(raw.text) ?? '',
    // 퍼나르는 주제 분류용 — RT 원문. raw.text는 "RT @x: …"로 잘려 있을 수 있어 원본을 우선한다.
    ...(kind === 'retweet' ? { rtText: str(rt?.text) ?? str(raw.text) ?? '' } : {}),
    views: num(raw.viewCount), likes: num(raw.likeCount),
    hasMedia: media.length > 0,
  };
}

export function makeGetxapiTweetSource(
  client: Pick<GetxapiClient, 'getUserTweets'>, now: () => number = Date.now,
): TweetSource {
  return {
    async fetchRecent(userId, opts) {
      const out: AnalysisTweet[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let oldest: string | null = null;   // 고정글 제외한 시간순 최고령
      let directCount = 0;
      let pagesUsed = 0;
      let truncated = false;

      const done = () =>
        oldest !== null && oldest < opts.activitySince &&
        (directCount >= opts.directTarget || oldest < opts.lookbackSince);

      while (pagesUsed < opts.maxPages) {
        const page = await client.getUserTweets(userId, cursor);
        pagesUsed += 1;
        for (const raw of page.tweets) {
          const t = mapRawAnalysisTweet(raw);
          if (!t || seen.has(t.id)) continue;
          // 고정글은 1페이지 맨 앞에 시간순과 무관하게 실려 온다(실호출 확인) — 시간순 신호로 쓰지 않되 수집엔 포함.
          if (raw.isPinned !== true) oldest = oldest === null || t.createdAt < oldest ? t.createdAt : oldest;
          if (t.createdAt < opts.lookbackSince) continue;   // 6개월 밖은 담지 않는다
          seen.add(t.id);
          out.push(t);
          if (t.kind !== 'retweet') directCount += 1;
          if (out.length >= opts.maxTweets) { truncated = true; break; }
        }
        if (truncated) break;
        if (done() || !page.has_more || !page.next_cursor) break;
        if (opts.deadlineAt !== undefined && now() >= opts.deadlineAt) { truncated = true; break; }
        cursor = page.next_cursor;
      }
      if (!truncated && pagesUsed >= opts.maxPages && !done()) truncated = true;
      const reachedActivitySince = oldest !== null && oldest < opts.activitySince;
      return { tweets: out, truncated, reachedActivitySince, directCount, pagesUsed };
    },
  };
}
```
주의: `done()`은 페이지 끝에서 판정한다(페이지 중간 종료 안 함 — 이미 받은 페이지는 다 담는다). deadline 검사는 페이지를 받은 뒤 다음 페이지로 넘어가기 전.

- [ ] **Step 4: 통과 확인** — 같은 명령 9/9 PASS (T2가 `rtText`를 타입에 넣기 전엔 tsx 실행은 통과하고 tsc만 실패할 수 있음 — T2 후 `npx tsc --noEmit` 재확인).
- [ ] **Step 5: Commit** — `git add src/lib/tweetSource.ts src/lib/tweetSource.test.ts && git commit -m "feat(influencer): 수집 v2 — 28일 활동·직접 글 60건·6개월 상한·데드라인, 고정글 포함·중복 제거"`

---

### Task 2: 활동 통계 (`src/lib/analysisStats.ts`)

**Files:** Modify `src/lib/analysisStats.ts`, append tests `src/lib/analysisStats.test.ts`.

**Interfaces — Produces:**
```ts
export interface AnalysisTweet { …기존; rtText?: string }
export interface Activity { since: string; until: string; days: number; truncated: boolean; coveredDays: number; directPerDay: number; rtPerDay: number; rtShare: number; quoteShare: number; activeDays: number; dailyDirect: Record<string, number>; dailyRt: Record<string, number> }
export function computeActivity(tweets: AnalysisTweet[], opts: { since: string; until: string; truncated: boolean; reachedActivitySince: boolean }): Activity;  // tweets = 창 안 트윗만 넣는다(호출자가 필터)
export function dailyCountsBy(tweets: AnalysisTweet[], pred: (t: AnalysisTweet) => boolean): Record<string, number>;
export function medianEngagement(direct: AnalysisTweet[]): { medianViews: number | null; medianLikes: number | null };
```
기존 `computeStats`·`dailyCounts`는 그대로 둔다(v1 타입 호환).

- [ ] **Step 1: 테스트 추가**
```ts
import { computeActivity, dailyCountsBy, medianEngagement } from './analysisStats.ts';
const W = { since: '2026-07-30T00:00:00.000Z', until: '2026-08-27T00:00:00.000Z', truncated: false, reachedActivitySince: true };

test('computeActivity: 직접/RT 하루 평균·비중·활동일', () => {
  const tweets = [
    tw({ id: 'a', createdAt: '2026-08-20T01:00:00Z' }), tw({ id: 'b', kind: 'quote', createdAt: '2026-08-20T02:00:00Z' }),
    tw({ id: 'r1', kind: 'retweet', createdAt: '2026-08-21T01:00:00Z' }), tw({ id: 'r2', kind: 'retweet', createdAt: '2026-08-21T02:00:00Z' }),
  ];
  const a = computeActivity(tweets, W);
  assert.equal(a.coveredDays, 28);
  assert.equal(a.directPerDay, 0.1);        // 2/28=0.07→0.1
  assert.equal(a.rtPerDay, 0.1);
  assert.equal(a.rtShare, 0.5);
  assert.equal(a.quoteShare, 0.5);          // 인용 1 / 직접 2
  assert.equal(a.activeDays, 1);            // 직접 글이 있는 날: 8/20
  assert.deepEqual(a.dailyDirect, { '2026-08-20': 2 });
  assert.deepEqual(a.dailyRt, { '2026-08-21': 2 });
});

test('computeActivity: 0건이면 분모 28·비중 0, NaN 없음', () => {
  const a = computeActivity([], W);
  assert.equal(a.coveredDays, 28);
  assert.equal(a.directPerDay, 0); assert.equal(a.rtPerDay, 0); assert.equal(a.rtShare, 0); assert.equal(a.quoteShare, 0);
});

test('computeActivity: 28일까지 못 갔으면 분모 = 최고령~until 일수(최소 1)', () => {
  const tweets = [tw({ id: 'a', createdAt: '2026-08-25T00:00:00Z' }), tw({ id: 'b', createdAt: '2026-08-26T00:00:00Z' })];
  const a = computeActivity(tweets, { ...W, reachedActivitySince: false, truncated: true });
  assert.equal(a.coveredDays, 2);
  assert.equal(a.directPerDay, 1);
  assert.equal(a.truncated, true);
});

test('medianEngagement: 직접 글만 넣는 함수 — null 지표 제외', () => {
  assert.deepEqual(medianEngagement([tw({ views: 100, likes: null }), tw({ views: 300, likes: 4 })]), { medianViews: 200, medianLikes: 4 });
  assert.deepEqual(medianEngagement([]), { medianViews: null, medianLikes: null });
});
```
(`tw` 헬퍼는 기존 테스트 파일에 있음 — 재사용.)

- [ ] **Step 2: 실패 확인** → **Step 3: 구현**
```ts
export interface AnalysisTweet { id: string; text: string; createdAt: string; kind: TweetKind; views: number | null; likes: number | null; hasMedia: boolean; rtText?: string }

export function dailyCountsBy(tweets: AnalysisTweet[], pred: (t: AnalysisTweet) => boolean): Record<string, number> {
  return dailyCounts(tweets.filter(pred));
}

export function medianEngagement(direct: AnalysisTweet[]): { medianViews: number | null; medianLikes: number | null } {
  return {
    medianViews: median(direct.map((t) => t.views).filter((v): v is number => v !== null)),
    medianLikes: median(direct.map((t) => t.likes).filter((v): v is number => v !== null)),
  };
}

const DAY_MS = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Activity { /* Interfaces 블록 그대로 */ }

// 창 안 트윗만 받는다. 분모(coveredDays): 28일까지 거슬러 갔으면 28, 못 갔으면 최고령~until(최소 1),
// 0건이면 28 — "4주 내내 0건"이 사실이다(0/0 방지, 스펙 F5).
export function computeActivity(tweets: AnalysisTweet[], opts: { since: string; until: string; truncated: boolean; reachedActivitySince: boolean }): Activity {
  const direct = tweets.filter((t) => t.kind !== 'retweet');
  const rts = tweets.filter((t) => t.kind === 'retweet');
  const quotes = tweets.filter((t) => t.kind === 'quote');
  let coveredDays = 28;
  if (!opts.reachedActivitySince && tweets.length > 0) {
    const oldest = tweets.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), tweets[0].createdAt);
    coveredDays = Math.max(1, Math.round((Date.parse(opts.until) - Date.parse(oldest)) / DAY_MS));
  }
  const dailyDirect = dailyCountsBy(tweets, (t) => t.kind !== 'retweet');
  return {
    since: opts.since, until: opts.until, days: 28, truncated: opts.truncated, coveredDays,
    directPerDay: r1(direct.length / coveredDays), rtPerDay: r1(rts.length / coveredDays),
    rtShare: tweets.length ? r2(rts.length / tweets.length) : 0,
    quoteShare: direct.length ? r2(quotes.length / direct.length) : 0,
    activeDays: Object.keys(dailyDirect).length,
    dailyDirect, dailyRt: dailyCountsBy(tweets, (t) => t.kind === 'retweet'),
  };
}
```
- [ ] **Step 4: 통과 확인** → **Step 5: Commit** `feat(influencer): 활동 통계 computeActivity — 28일 창 직접/RT 지표·KST 일별 분리`

---

### Task 3: 판단 함수 추가 (`src/lib/influencerJudgment.ts`) — 추가만, `judgeCadence` 삭제는 T6

**Interfaces — Produces:**
```ts
export function judgeDirectCadence(directPerDay: number, collectedInWindow: number): CadenceJudgment;
export function judgeRt(rtPerDay: number, rtShare: number): { value: string; verdict: string; caution: false };
```
- [ ] **Step 1: 테스트**
```ts
test('judgeDirectCadence', () => {
  assert.deepEqual(judgeDirectCadence(0, 0), { label: '최근 4주 게시 없음 — 활동이 멈춘 계정일 수 있어요', caution: true });
  assert.deepEqual(judgeDirectCadence(0.1, 40), { label: '주 0.7건 — 직접 쓰는 글이 드물어요', caution: true });  // 0.1×7
  assert.deepEqual(judgeDirectCadence(0.3, 40), { label: '주 2.1건 — 보통', caution: false });
  assert.deepEqual(judgeDirectCadence(1, 40), { label: '주 7건 — 활발한 편', caution: false });
});
test('judgeRt', () => {
  assert.deepEqual(judgeRt(0.2, 0.1), { value: 'RT 하루 0.2건 · 글의 10%', verdict: '확산 활동이 거의 없어요', caution: false });
  assert.deepEqual(judgeRt(4, 0.55), { value: 'RT 하루 4건 · 글의 55%', verdict: '확산 활동이 있어요', caution: false });
  assert.deepEqual(judgeRt(32, 0.99), { value: 'RT 하루 32건 · 글의 99%', verdict: '확산 활동이 매우 활발해요', caution: false });
});
```
- [ ] **Step 2/3: 구현** — 파일 끝에
```ts
// v2(스펙 §4): 직접 쓴 글 기준 빈도. 임계(주 1·3건)는 2단계에서 분포를 보고 조정한다.
export function judgeDirectCadence(directPerDay: number, collectedInWindow: number): CadenceJudgment {
  if (collectedInWindow === 0) return { label: '최근 4주 게시 없음 — 활동이 멈춘 계정일 수 있어요', caution: true };
  const perWeek = Math.round(directPerDay * 7 * 10) / 10;
  const n = Number.isInteger(perWeek) ? String(perWeek) : perWeek.toFixed(1);
  if (perWeek < 1) return { label: `주 ${n}건 — 직접 쓰는 글이 드물어요`, caution: true };
  return perWeek > 3 ? { label: `주 ${n}건 — 활발한 편`, caution: false } : { label: `주 ${n}건 — 보통`, caution: false };
}
// RT는 "적으면 나쁜" 축이 아니다 — 확산 채널로서의 활동량을 서술만 한다(caution 없음).
export function judgeRt(rtPerDay: number, rtShare: number): { value: string; verdict: string; caution: false } {
  const n = Number.isInteger(rtPerDay) ? String(rtPerDay) : rtPerDay.toFixed(1);
  const value = `RT 하루 ${n}건 · 글의 ${Math.round(rtShare * 100)}%`;
  const verdict = rtPerDay < 1 ? '확산 활동이 거의 없어요' : rtPerDay < 10 ? '확산 활동이 있어요' : '확산 활동이 매우 활발해요';
  return { value, verdict, caution: false };
}
```
- [ ] **Step 4: 통과** → **Step 5: Commit** `feat(influencer): 판단 함수 v2 — 직접 발행 빈도·RT 확산 활동`

---

### Task 7: 분석 실행 스토어 (`src/app/influencers/analysisRun.ts`)

**Files:** Create `src/app/influencers/analysisRun.ts`, Create `src/lib/runQueue.ts` + `src/lib/runQueue.test.ts`(순수 스케줄러).

**Interfaces — Produces:**
```ts
// analysisRun.ts ('use client' 불필요 — 모듈 스코프 상태 + 구독)
export type RunState = 'idle' | 'running' | 'done' | 'failed';
export type AnalyzeResult = { analysis: InfluencerAnalysis; analyzedAt: string };
export class AnalyzeError extends Error {}
export function start(id: string): Promise<AnalyzeResult>;          // 진행 중이면 같은 프로미스
export function getState(id: string): RunState;
export function getError(id: string): string | null;
export function subscribe(id: string, cb: () => void): () => void;   // 상태 변화 시 통지
export function useRunState(id: string): RunState;                   // useSyncExternalStore 래퍼
export function subscribeAll(cb: () => void): () => void;            // 일괄 진행 배지용
// runQueue.ts
export async function runQueue<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number, onSettled?: (item: T, ok: boolean) => void): Promise<{ ok: number; failed: T[] }>;
```

- [ ] **Step 1: runQueue 테스트**
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQueue } from './runQueue.ts';

test('runQueue: 동시 실행 상한과 결과 집계', async () => {
  let active = 0, peak = 0;
  const seen: number[] = [];
  const r = await runQueue([1, 2, 3, 4, 5], async (n) => {
    active++; peak = Math.max(peak, active);
    await new Promise((res) => setTimeout(res, 5));
    active--; seen.push(n);
    if (n === 3) throw new Error('boom');
  }, 2);
  assert.equal(peak, 2);
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5]);
  assert.equal(r.ok, 4);
  assert.deepEqual(r.failed, [3]);
});
```
- [ ] **Step 2/3: 구현**
```ts
// src/lib/runQueue.ts — 동시 N개로 항목을 처리하는 작은 스케줄러(일괄 분석용). 실패는 모아 돌려주고 나머지는 계속.
export async function runQueue<T>(
  items: T[], worker: (item: T) => Promise<void>, concurrency: number,
  onSettled?: (item: T, ok: boolean) => void,
): Promise<{ ok: number; failed: T[] }> {
  const queue = [...items];
  const failed: T[] = [];
  let ok = 0;
  async function lane() {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try { await worker(item); ok += 1; onSettled?.(item, true); }
      catch { failed.push(item); onSettled?.(item, false); }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
  return { ok, failed };
}
```
```ts
// src/app/influencers/analysisRun.ts — 분석 실행의 단일 출처(스펙 §6).
// 계약: 서버는 이탈과 무관하게 끝까지 돌아 저장한다 — 여기는 표시·중복 방지용 상태다.
// 구독 가능해야 하는 이유: 명부의 일괄 실행이 시작한 분석을 "이미 열려 있는" 프로필도 봐야 한다.
import { useSyncExternalStore } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { InfluencerAnalysis } from '@/lib/influencerStore';

export type RunState = 'idle' | 'running' | 'done' | 'failed';
export type AnalyzeResult = { analysis: InfluencerAnalysis; analyzedAt: string };
export class AnalyzeError extends Error {}

const inflight = new Map<string, Promise<AnalyzeResult>>();
const state = new Map<string, RunState>();
const errors = new Map<string, string>();
const subs = new Map<string, Set<() => void>>();
const allSubs = new Set<() => void>();

function emit(id: string) { subs.get(id)?.forEach((cb) => cb()); allSubs.forEach((cb) => cb()); }
function setState(id: string, s: RunState, err?: string) {
  state.set(id, s);
  if (err) errors.set(id, err); else errors.delete(id);
  emit(id);
}

export function getState(id: string): RunState { return state.get(id) ?? 'idle'; }
export function getError(id: string): string | null { return errors.get(id) ?? null; }
export function subscribe(id: string, cb: () => void): () => void {
  const set = subs.get(id) ?? new Set(); set.add(cb); subs.set(id, set);
  return () => { set.delete(cb); };
}
export function subscribeAll(cb: () => void): () => void { allSubs.add(cb); return () => { allSubs.delete(cb); }; }
export function useRunState(id: string): RunState {
  return useSyncExternalStore((cb) => subscribe(id, cb), () => getState(id), () => 'idle');
}

export function start(id: string): Promise<AnalyzeResult> {
  const existing = inflight.get(id);
  if (existing) return existing;       // 진행 중 재요청은 붙기만 — 비용 2배 방지
  const p = (async () => {
    const r = await apiFetch(`/api/influencers/${id}/analyze`, { method: 'POST' });
    const body = (await r.json().catch(() => ({}))) as { analysis?: InfluencerAnalysis; analyzedAt?: string; error?: string };
    if (!r.ok || !body.analysis) throw new AnalyzeError(body.error ?? `분석하지 못했어요 (오류 ${r.status})`);
    return { analysis: body.analysis, analyzedAt: body.analyzedAt ?? new Date().toISOString() };
  })();
  inflight.set(id, p);
  setState(id, 'running');
  p.then(() => setState(id, 'done'),
         (e: unknown) => setState(id, 'failed', e instanceof AnalyzeError ? e.message : '분석하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요'))
   .finally(() => { if (inflight.get(id) === p) inflight.delete(id); });
  return p;
}
```
- [ ] **Step 4: 검증** — runQueue 테스트 PASS, `npx tsc --noEmit`(analysisRun은 아직 소비자 없음 — 0 에러). **Step 5: Commit** `feat(influencer): 분석 실행 스토어(구독형) + runQueue 스케줄러`

---

### Task 8: 명부 행 필드 (`influencerStore.ts` Row/SELECT만)

**Interfaces — Produces:** `InfluencerRow.analyzedAt: string | null`, `InfluencerRow.analysisV2: boolean`.

- [ ] **Step 1: 테스트 추가**(`influencerStore.test.ts`): 생성 직후 `row.analyzedAt === null && row.analysisV2 === false`; `saveAnalysis(sql, id, { …v1 shape… , activity: {…최소 필드…} } as unknown as InfluencerAnalysis)` 후 `findInfluencerById` → `analyzedAt` 존재·`analysisV2 === true`; activity 없는 분석 저장 → `analysisV2 === false`.
- [ ] **Step 2/3: 구현** — `IRow`에 `analyzed_at: Date | null; analysis_v2: boolean`, SELECT에 `i.analyzed_at, (i.analysis ? 'activity') as analysis_v2,`(세 SELECT가 공유하는 `SELECT` 템플릿 한 곳), `toRow`에 두 필드. `InfluencerRow` 인터페이스 확장. (analysis jsonb 자체는 목록에 싣지 않는다.)
- [ ] **Step 4: 검증** — `node --env-file-if-exists=.env --import tsx --test src/lib/influencerStore.test.ts` PASS, tsc 0. **Step 5: Commit** `feat(influencer): 명부 행에 분석 시점·v2 여부(analysis ? 'activity')`

---

### Task 5: 타입 + 파이프라인 v2 (`influencerStore.ts` 타입, `influencerAnalysis.ts`)

**Files:** Modify `src/lib/influencerStore.ts`(InfluencerAnalysis 타입만), `src/lib/influencerAnalysis.ts`, `src/lib/influencerAnalysis.test.ts`.
**Consumes:** T1 `FetchOpts/FetchResult`, T2 `Activity/computeActivity/medianEngagement`, T3 판단(사용 안 함 — UI가), 기존 `classifyAll`·`topicStats`·`typeDist`·`sponsoredCount`·`topByViews`.
**Produces:**
```ts
export interface InfluencerAnalysis {
  sample: { collected?: number; direct?: number; directClassified?: number; rtClassified?: number; directSince?: string | null; directComplete?: boolean; pagesUsed?: number; rtSince?: string | null;
            until: string; count?: number; classified?: number; since?: string; months?: number };   // v1 필드 옵셔널
  activity?: Activity;
  stats: { medianViews: number | null; medianLikes: number | null; typeDist: Partial<Record<ContentType, number>>; sponsoredCount: number; perWeek?: number; mix?: {…} };
  topics: TopicStat[]; rtTopics?: { tag: string; count: number }[];
  daily?: Record<string, number>;
  summary: { headline?: string; tone: string; patterns: string; sponsorship: string } | null;
  models: { classify: string; synth: string };
}
export const ACTIVITY_DAYS = 28; export const DIRECT_TARGET = 60; export const LOOKBACK_MONTHS = 6; export const MAX_PAGES = 60; export const MAX_TWEETS = 2000; export const RT_CLASSIFY_MAX = 100; export const COLLECT_DEADLINE_MS = 120_000;
export async function analyzeAccount(deps, userId, opts?): Promise<InfluencerAnalysis>;   // v2 저장 형태 반환
```
- [ ] **Step 1: 테스트 재작성**(페이크 주입): (a) 일반 계정 — 창 안 직접 2·RT 2·창 밖 직접 1 → `activity.rtShare 0.5`, `sample.direct 3`, `topics`·`rtTopics` 채워짐, 정규화 페이크가 `{direct:[…], rt:[…]}` 입력을 받았는지(`user`에 `"rt"` 키 존재) 단언, 종합 입력에 `주당_게시`·`구성`이 **없고** `활동`·`퍼나르는_주제`가 있는지; (b) RT-only — 직접 0·RT 3 → 분류 콜은 RT용 1회만, `summary.headline` 존재, `topics []`, `rtTopics` 채워짐; (c) 완전 0건 → LLM 0콜, `summary null`, `activity.directPerDay 0`; (d) 종합 JSON 불량 → `AnalysisFormatError`. 페이크 `fetchRecent`는 `FetchResult` 형태 반환.
- [ ] **Step 2: 실패 확인** → **Step 3: 구현**
  - 상수 정의(위). `analyzeAccount`: `since28 = now-28d`, `lookback = now-6mo`, `deadlineAt = now.getTime()+COLLECT_DEADLINE_MS` → `fetchRecent`. `inWindow = tweets.filter(createdAt ≥ since28)`. `activity = computeActivity(inWindow, {since: since28, until, truncated, reachedActivitySince})`. 직접 표본 `directSample = tweets.filter(kind!=='retweet').slice(0, DIRECT_TARGET)`(최신순). `stats = medianEngagement(directSample)` + typeDist/sponsoredCount.
  - RT 분류: `rtSample = inWindow.filter(retweet).slice(0, RT_CLASSIFY_MAX)`; 경량 시스템 프롬프트 `RT_CLASSIFY_SYSTEM`("각 항목의 topics만 1~3개, 한국어 명사구") + 스키마 `{items:[{id, topics:string[]}]}`; 입력 텍스트는 `rtText ?? text`. `missingIds` 재시도 1회 동일 규칙.
  - 정규화 1콜: 입력 `{direct:[{tag,count}], rt:[{tag,count}]}`, 시스템 프롬프트에 "direct와 rt 각각 대표 태그 3~5개, 서로 같은 표기는 같은 대표 태그로", 스키마 `{direct:[{tag,absorbs}], rt:[{tag,absorbs}]}` → 두 canonical 사전. 파싱 실패는 둘 다 `{}`.
  - `topics = topicStats(directClassified, directSample, canonDirect)`, `rtTopics = rt별 count 집계 후 canonRt 매핑, count 내림차순, 상위 10`.
  - 종합: 입력에서 `주당_게시`·`구성` 제거, `활동: {직접_하루: activity.directPerDay, RT_하루: activity.rtPerDay, RT_비중: activity.rtShare, 인용_비중: activity.quoteShare}`, `퍼나르는_주제: rtTopics.slice(0,5)` 추가. SYNTH_SYSTEM에 "RT가 많으면 무엇을 퍼나르는지가 이 계정의 정체성 — headline/tone에 반영. 직접 쓴 글이 없으면 patterns는 '직접 쓴 글이 없어 반응 패턴은 볼 수 없어요'로 쓴다" 추가. RT-only(직접 0·RT>0)도 종합을 돈다. 둘 다 0이면 LLM 생략·`summary null`.
  - 반환: `sample:{collected: tweets.length, direct: directSample.length, directClassified, rtClassified, directSince: directSample.at(-1)?.createdAt ?? null, until, directComplete: directCount ≥ DIRECT_TARGET, pagesUsed, rtSince: rtSample.at(-1)?.createdAt ?? null}`, `activity`, `stats`, `topics`, `rtTopics`, `summary`, `models`.
- [ ] **Step 4: 검증** — 테스트 PASS, `npx tsc --noEmit`: **`src/app/influencers/AnalysisSection.tsx`의 에러만 허용**(v1 필드 옵셔널화 때문 — T6이 해소), 다른 파일 에러 0. 리포트에 에러 목록 기록.
- [ ] **Step 5: Commit** `feat(influencer): 분석 파이프라인 v2 — 28일 활동·직접 글 60건·퍼나르는 주제(축 라벨 정규화)·RT-only 종합`

---

### Task 9: 전체 분석 다이얼로그 + 명부 (`page.tsx`, `BulkAnalyzeDialog.tsx`)

**Consumes:** T7 `start/subscribeAll/getState`, `runQueue`; T8 `InfluencerRow.analyzedAt/analysisV2`.
- [ ] **Step 1: `src/app/influencers/BulkAnalyzeDialog.tsx`** — props `{ rows: InfluencerRow[]; onClose(); onFinished(): Promise<void> }`. 열리면 대상 계산: 기본 `rows.filter(r => !r.analyzedAt || !r.analysisV2)`, 체크박스 `최근 분석도 포함` → 전부. 표시: `대상 N계정 · 예상 비용 약 $${(0.1*N).toFixed(1)}(수집+AI, 첫 실행 뒤 실측으로 보정) · 예상 시간 약 ${Math.ceil(N/3*2.5)}분`, 안내 문구(스펙 §6 그대로), 버튼 `시작`. 실행 중: `runQueue(ids, (id) => start(id), 3, onSettled)`로 진행 `12/24 완료 · 실패 1`(`aria-live="polite"`), 실패 목록(핸들) + `재시도`(실패분만 다시 runQueue). 진행 상태는 **모듈 스코프 변수**(`bulkState`)에 두어 다이얼로그를 닫아도 이어지고 다시 열면 이어 보임. 완료 시 `onFinished()`(명부 새로고침). 다이얼로그 접근성은 `AddInfluencersDialog.tsx` 관례(role=dialog·aria-modal·Esc·포커스 트랩) 복사.
- [ ] **Step 2: `page.tsx`** — 명부 헤더의 `+ 인플루언서 추가` 옆에 `전체 분석` 텍스트 버튼; 진행 중이면 헤더에 작은 배지 `분석 12/24`(`subscribeAll`/bulkState 구독, `useSyncExternalStore`). 행 캡션에 `분석 N일 전`(relTime) / `이전 방식` / `미분석`(text-caption). `beforeunload` 경고: 진행 중일 때만 등록.
- [ ] **Step 3: 검증** — tsc 0(이 태스크 파일들), lint 24, build. **Step 4: Commit** `feat(influencer): 전체 분석 — 대상·비용·시간 확인, 동시 3건 실행, 진행·실패 재시도, 명부 분석 시점 표시`

---

### Task 6: 분석 UI v2 (`AnalysisSection.tsx`, `influencerJudgment.*` judgeCadence 삭제)

**Consumes:** T5 v2 타입, T3 `judgeDirectCadence/judgeRt`, T7 `start/useRunState/getError`, 기존 도넛·표·히트맵 컴포넌트.
- [ ] **Step 1: 실행 배선 교체** — 로컬 `inflight/startAnalysis/attach`를 제거하고 `analysisRun`의 `start`·`useRunState(id)`·`getError(id)` 사용. `running = useRunState(id) === 'running'`. 완료 반영: `start(id).then(res => onAnalyzed(res.analysis, res.analyzedAt))` + 마운트 시 상태가 `running`이면 `start(id)`(기존 프로미스 재사용)에 붙는다. 오류 문구는 `getError`.
- [ ] **Step 2: v1/v2 분기** — `const v2 = analysis && analysis.activity`. v1(`!v2`)이면 헤드라인·서술만 + 한 줄 `이전 방식으로 분석된 결과예요 — 다시 분석하면 4주 활동·직접 글 기준 지표로 바뀌어요`. v1 값(perWeek·mix·daily·judgeCadence)을 읽는 코드 전부 삭제.
- [ ] **Step 3: v2 렌더** — 캡션(§5 문구, `directComplete`·`activity.truncated` 조건부), 타일 3(judgeDirectCadence(activity.directPerDay, 창 안 수집 수 = Object.values(dailyDirect)+dailyRt 합) / judgeRt / judgeEngagement), **히트맵 2줄**: `PostingHeatmap`을 `daily·since·until·thresholds·title·ariaLabel` prop으로 일반화 — 위 직접(임계 [1,2,3,5] 기존), 아래 RT(임계 [1,5,10,20], 범례 `1~4 · 5~9 · 10~19 · 20+`), 창 = `activity.since~until`(28일, 5열 최대 — 기존 클램프 로직에서 MIN/MAX 대신 정확히 창 범위), 셀 20px. 유형 도넛·주제 표 2열 유지(직접 0건이면 생략 + RT-only 문구). **퍼나르는 주제**: 주제 표 아래 `<ul>` 칩 `여행 21건`, 캡션 `최근 N일 RT ${sample.rtClassified}건 기준`(rtSince~until 일수), rtTopics 비면 생략.
- [ ] **Step 4: judgeCadence 삭제** — `influencerJudgment.ts`의 `judgeCadence`와 `influencerJudgment.test.ts`의 해당 테스트 3건 삭제(사용처 0 확인 `grep -rn judgeCadence src`).
- [ ] **Step 5: 검증** — `npx tsc --noEmit` **0**(T5의 잔여 에러 해소 확인), lint 24, build, `node --import tsx --test src/lib/influencerJudgment.test.ts`. **Step 6: Commit** `feat(influencer): 분석 UI v2 — 활동 타일·직접/RT 히트맵 2줄·퍼나르는 주제·실행 스토어 연동·v1 안내`

---

### Task 10: 통합 검증 + 소식
- [ ] `node --env-file-if-exists=.env --import tsx --test src/lib/tweetSource.test.ts src/lib/analysisStats.test.ts src/lib/influencerJudgment.test.ts src/lib/influencerAnalysis.test.ts src/lib/runQueue.test.ts src/lib/influencerStore.test.ts src/lib/updates.test.ts` 전부 PASS.
- [ ] `npm run lint | grep problems` = 24 · `npm run build` 성공 · `npx tsc --noEmit` 0.
- [ ] `src/content/updates.ts` 맨 위에 `개선` 항목(날짜 2026-08-27): 제목 `계정 분석이 계정마다 같은 기준으로 비교돼요 — 최근 4주 활동 + 직접 쓴 글 60건`, 불릿: 4주 고정 히트맵(직접/RT 두 줄) · 직접 발행·RT 타일 · 퍼나르는 주제 · 명부 `전체 분석`(비용·시간 확인 후 실행, 탭 열어둔 동안 진행) · 이전 분석은 "다시 분석" 안내. `node --import tsx --test src/lib/updates.test.ts` PASS. 커밋 `docs(updates): 계정 분석 v2 소식`.
- [ ] `npm test` 전체(실 DB) PASS 확인 후 보고.
