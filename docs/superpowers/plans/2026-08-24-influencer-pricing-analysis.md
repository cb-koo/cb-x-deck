# 인플루언서 협찬 단가 + 계정 분석 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인플루언서 프로필에 유형별 협찬 단가(+변경 이력)와 X 최근 글 기반 계정 분석(LLM map-reduce)을 추가한다.

**Architecture:** 순수 로직(단가 diff·통계·판단·파싱)을 lib로 분리하고, 수집(`TweetSource`)·LLM(`AnalysisChat`) 두 인터페이스 뒤에 구현을 둔다(교체 가능 경계). 저장은 `influencer` 테이블 jsonb 확장 + `influencer_log` 재사용(새 테이블 0개). 스펙: `docs/superpowers/specs/2026-08-24-influencer-pricing-analysis-design.md` (구현 중 판단이 갈리면 스펙이 우선).

**Tech Stack:** Next.js(App Router) + postgres.js + Anthropic SDK(구조화 출력 `output_config`) + getxapi. 테스트는 node:test(실 DB) / 순수 로직은 DB 없이.

## Global Constraints

- 사용자 대면 문구는 전부 한국어, AGENTS.md UX 원칙 6개 준수(내부 개념어 노출 금지·판단문 병기·라벨-값 일치).
- 순수 로직 테스트 실행: `npx tsx --test src/lib/<file>.test.ts` (수초). 전체 `npm test`는 실 DB로 ~4분 — 태스크에서는 새로 만든 테스트 파일만 tsx로 돌리고, 최종 통합 태스크에서 전체를 돈다.
- 린트 기준선: `npm run lint` 경고 24개(기존) — 새 경고 0개 추가.
- LLM 호출은 반드시 `callLLM`(src/lib/llm.ts) 경유. temperature 등 sampling 파라미터 금지(최신 모델 400).
- LLM에 보낼 사용자 텍스트는 callLLM이 lone surrogate를 제거하므로 추가 처리 불필요.
- 커밋 메시지는 기존 스타일(한국어, `feat(influencer): …`)로, 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- import 는 스토어·lib에서는 `./x.ts` 상대(+확장자), 라우트·컴포넌트에서는 `@/lib/x` 별칭 — 각 파일의 기존 이웃 스타일을 따른다.
- 이 워크트리에는 `.env`가 준비돼 있다(프로덕션 DB·API 키). 실 DB 테스트·마이그레이션은 그대로 실행 가능.

## 실행 웨이브 (병렬 지시)

| 웨이브 | 태스크 (병렬) | 권장 모델 |
|---|---|---|
| 1 | T1 마이그레이션 / T2 단가 lib / T3 통계 lib / T4 판단 함수 / T5 수집 어댑터 | T1 haiku · T2~T5 sonnet |
| 2 | T6 스토어 확장 / T7 LLM 파이프라인 | T6 opus · T7 fable(기본) |
| 3 | T8 analyze 라우트+계정 판정 공유화 / T9 pricing PATCH | T8 opus · T9 sonnet |
| 4 | T10 단가 섹션 UI / T11 분석 섹션 UI | 둘 다 opus |
| 5 | T12 통합 검증 | sonnet |

의존: T6←T1,T2 / T7←T3,T5 / T8←T6,T7 / T9←T6 / T10←T9 / T11←T8 / T12←전부.

---

### Task 1: 마이그레이션 028

**Files:**
- Create: `migrations/028_influencer_pricing_analysis.sql`

**Interfaces:**
- Produces: `influencer.pricing jsonb not null default '{}'`, `influencer.analysis jsonb`(null 허용), `influencer.analyzed_at timestamptz`(null 허용), `influencer_log.event_type`에 `'pricing_changed'` 허용.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 028: 인플루언서 협찬 단가 + 계정 분석 (스펙 2026-08-24-influencer-pricing-analysis)
-- 026(influencer_metrics)은 폐기된 게시물 추적 브랜치에서 소모됐고 프로덕션 DB에 적용된 채 남아 있다 — 그래서 028.
-- apply-migrations.sh가 매번 전 파일을 재적용하므로 재실행 안전(016·023 관례).

alter table influencer add column if not exists pricing jsonb not null default '{}';
alter table influencer add column if not exists analysis jsonb;
alter table influencer add column if not exists analyzed_at timestamptz;

-- 제약 이름은 프로덕션에서 확인됨(2026-08-24): influencer_log_event_type_check
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed'));
```

- [ ] **Step 2: 프로덕션 DB에 적용 (024·025 관행과 동일 — 검증 과정에서 적용)**

Run: `set -a; source .env; set +a; psql -v ON_ERROR_STOP=1 -f migrations/028_influencer_pricing_analysis.sql`
Expected: `ALTER TABLE` 5줄, 오류 없음.

- [ ] **Step 3: 재실행 안전 검증 (같은 명령 한 번 더)**

Run: 같은 명령 반복.
Expected: NOTICE("already exists, skipping") 포함 성공 — 중단 없음.

- [ ] **Step 4: 컬럼 확인**

Run: `set -a; source .env; set +a; psql -tAc "select column_name from information_schema.columns where table_name='influencer' and column_name in ('pricing','analysis','analyzed_at')"`
Expected: 3행.

- [ ] **Step 5: Commit**

```bash
git add migrations/028_influencer_pricing_analysis.sql
git commit -m "feat(influencer): 마이그레이션 028 — pricing·analysis 컬럼 + pricing_changed 이벤트"
```

---

### Task 2: 단가 순수 lib (`influencerPricing.ts`)

**Files:**
- Create: `src/lib/influencerPricing.ts`
- Test: `src/lib/influencerPricing.test.ts`

**Interfaces:**
- Produces (다른 태스크가 그대로 import):

```ts
export type Currency = 'KRW' | 'JPY';
export type PriceType = 'rt' | 'quoteRt' | 'post' | 'visit';
export const PRICE_TYPES: readonly PriceType[];                 // ['rt','quoteRt','post','visit'] 표시 순서
export const PRICE_TYPE_LABEL: Record<PriceType, string>;       // rt:'RT', quoteRt:'인용RT', post:'투고', visit:'방문협찬'
export const CURRENCY_LABEL: Record<Currency, string>;          // KRW:'원', JPY:'엔'
export interface Pricing { currency?: Currency; rt?: number | null; quoteRt?: number | null; post?: number | null; visit?: number | null }
export function normalizeCurrency(p: Pricing): Currency;        // 부재 = 'KRW' (스펙 §2)
export function parsePricingPatch(v: unknown): Pricing | null;  // 알려진 키만·금액은 0 이상 정수 또는 null·currency는 KRW/JPY만. 위반 시 null. 빈 객체 {}는 유효(변경 없음).
export function mergePricing(base: Pricing, patch: Pricing): Pricing; // patch에 온 키만 덮음(부분 병합, 스펙 §2)
export interface PricingChange { priceType: PriceType | 'currency'; from: number | string | null; to: number | string | null; currency: Currency }
export function diffPricing(base: Pricing, patch: Pricing): PricingChange[]; // patch에 온 키 중 실제로 값이 달라진 것만. currency 변경은 from/to에 통화 코드('KRW'/'JPY'). 각 금액 변경의 currency는 병합 결과 통화.
export function formatMoney(amount: number, currency: Currency): string;    // 300000,'KRW' → '300,000원'
```

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/influencerPricing.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePricingPatch, mergePricing, diffPricing, normalizeCurrency, formatMoney,
} from './influencerPricing.ts';

test('parsePricingPatch: 유효 입력', () => {
  assert.deepEqual(parsePricingPatch({ rt: 300000, currency: 'JPY' }), { rt: 300000, currency: 'JPY' });
  assert.deepEqual(parsePricingPatch({ post: null }), { post: null });   // 단가 지우기
  assert.deepEqual(parsePricingPatch({}), {});                            // 변경 없음도 유효
});

test('parsePricingPatch: 위반은 null', () => {
  assert.equal(parsePricingPatch({ rt: -1 }), null);          // 음수
  assert.equal(parsePricingPatch({ rt: 1.5 }), null);         // 소수
  assert.equal(parsePricingPatch({ rt: '30만' }), null);      // 문자열
  assert.equal(parsePricingPatch({ unknown: 1 }), null);      // 모르는 키
  assert.equal(parsePricingPatch({ currency: 'USD' }), null); // 지원 외 통화
  assert.equal(parsePricingPatch('x'), null);
  assert.equal(parsePricingPatch(null), null);
});

test('mergePricing: patch에 온 키만 덮는다', () => {
  assert.deepEqual(mergePricing({ rt: 100, post: 200 }, { post: 300 }), { rt: 100, post: 300 });
  assert.deepEqual(mergePricing({ rt: 100 }, { rt: null }), { rt: null }); // null로 지움도 반영
});

test('diffPricing: 실제로 바뀐 것만, 병합 결과 통화 부여', () => {
  const changes = diffPricing({ rt: 100, currency: 'KRW' }, { rt: 100, post: 200 });
  assert.deepEqual(changes, [{ priceType: 'post', from: null, to: 200, currency: 'KRW' }]); // rt는 동일값 → 제외
});

test('diffPricing: 통화 변경은 별도 행 + 이후 금액 변경은 새 통화', () => {
  const changes = diffPricing({ rt: 100 }, { currency: 'JPY', rt: 200 });
  assert.deepEqual(changes, [
    { priceType: 'currency', from: 'KRW', to: 'JPY', currency: 'JPY' }, // base 부재=KRW 간주(스펙 §2)
    { priceType: 'rt', from: 100, to: 200, currency: 'JPY' },
  ]);
});

test('diffPricing: 같은 통화 재전송은 변경 아님', () => {
  assert.deepEqual(diffPricing({ currency: 'KRW', rt: 1 }, { currency: 'KRW' }), []);
});

test('normalizeCurrency: 부재=KRW', () => {
  assert.equal(normalizeCurrency({}), 'KRW');
  assert.equal(normalizeCurrency({ currency: 'JPY' }), 'JPY');
});

test('formatMoney: 천 단위 구분 + 통화 접미', () => {
  assert.equal(formatMoney(300000, 'KRW'), '300,000원');
  assert.equal(formatMoney(30000, 'JPY'), '30,000엔');
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/influencerPricing.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/lib/influencerPricing.ts`

```ts
// 협찬 단가 — 유형·통화 상수와 순수 계산(검증·병합·diff·표시). DB 접근 없음.
// PATCH는 "바뀐 키만" 보내고 서버가 병합한다(스펙 §2 부분 병합 — 전체 교체는 스테일 덮어쓰기 여지).
export type Currency = 'KRW' | 'JPY';
export type PriceType = 'rt' | 'quoteRt' | 'post' | 'visit';

export const PRICE_TYPES: readonly PriceType[] = ['rt', 'quoteRt', 'post', 'visit'];
export const PRICE_TYPE_LABEL: Record<PriceType, string> = {
  rt: 'RT', quoteRt: '인용RT', post: '투고', visit: '방문협찬',
};
export const CURRENCY_LABEL: Record<Currency, string> = { KRW: '원', JPY: '엔' };

export interface Pricing {
  currency?: Currency;
  rt?: number | null; quoteRt?: number | null; post?: number | null; visit?: number | null;
}

// currency 부재 = KRW (UI 기본 선택·diff 계산이 같은 규칙을 쓴다 — 라벨-값 일치)
export function normalizeCurrency(p: Pricing): Currency {
  return p.currency ?? 'KRW';
}

const CURRENCIES: readonly Currency[] = ['KRW', 'JPY'];

// 라우트 입력 검증 — 알려진 키만, 금액은 0 이상 정수 또는 null. 위반은 null(라우트가 400으로).
export function parsePricingPatch(v: unknown): Pricing | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Pricing = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'currency') {
      if (!CURRENCIES.includes(val as Currency)) return null;
      out.currency = val as Currency;
    } else if ((PRICE_TYPES as readonly string[]).includes(k)) {
      if (val !== null && (typeof val !== 'number' || !Number.isInteger(val) || val < 0)) return null;
      out[k as PriceType] = val as number | null;
    } else {
      return null;
    }
  }
  return out;
}

export function mergePricing(base: Pricing, patch: Pricing): Pricing {
  return { ...base, ...patch };
}

export interface PricingChange {
  priceType: PriceType | 'currency';
  from: number | string | null;
  to: number | string | null;
  currency: Currency;
}

// patch에 온 키 중 실제 값이 달라진 것만 — 같은 값 재전송은 변경이 아니다(불필요한 로그 방지).
export function diffPricing(base: Pricing, patch: Pricing): PricingChange[] {
  const after = normalizeCurrency(mergePricing(base, patch));
  const changes: PricingChange[] = [];
  if (patch.currency !== undefined && patch.currency !== normalizeCurrency(base)) {
    changes.push({ priceType: 'currency', from: normalizeCurrency(base), to: patch.currency, currency: after });
  }
  for (const t of PRICE_TYPES) {
    if (patch[t] === undefined) continue;
    const from = base[t] ?? null;
    const to = patch[t] ?? null;
    if (from !== to) changes.push({ priceType: t, from, to, currency: after });
  }
  return changes;
}

export function formatMoney(amount: number, currency: Currency): string {
  return `${amount.toLocaleString('ko-KR')}${CURRENCY_LABEL[currency]}`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/influencerPricing.test.ts`
Expected: 전부 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/influencerPricing.ts src/lib/influencerPricing.test.ts
git commit -m "feat(influencer): 단가 순수 로직 — 검증·부분 병합·diff·표시"
```

---

### Task 3: 분석 통계 순수 lib (`analysisStats.ts`)

**Files:**
- Create: `src/lib/analysisStats.ts`
- Test: `src/lib/analysisStats.test.ts`

**Interfaces:**
- Produces:

```ts
export type TweetKind = 'original' | 'retweet' | 'quote';
export interface AnalysisTweet { id: string; text: string; createdAt: string; kind: TweetKind; views: number | null; likes: number | null; hasMedia: boolean }
export type ContentType = 'info' | 'review' | 'daily' | 'promo' | 'other';
export const CONTENT_TYPE_LABEL: Record<ContentType, string>; // info:'정보', review:'후기·체험', daily:'일상·잡담', promo:'홍보·협찬', other:'기타'
export interface ClassifiedTweet { id: string; contentType: ContentType; sponsored: boolean; evidence: string | null; topics: string[] }
export interface SampleStats {
  perWeek: number;                       // 소수 1자리 반올림
  medianViews: number | null; medianLikes: number | null;   // 원글+인용만, null 지표 제외 후 중앙값
  mix: { original: number; retweet: number; quote: number } // 건수(비율 아님 — UI가 파생)
}
export function median(nums: number[]): number | null;       // 빈 배열 null, 짝수면 두 값 평균
export function computeStats(tweets: AnalysisTweet[], opts: { since: string; until: string; truncatedByCount: boolean }): SampleStats;
export function chunk<T>(arr: T[], size: number): T[][];
export function missingIds(sent: ReadonlyArray<{ id: string }>, got: ReadonlyArray<{ id: string }>): string[];
export interface TopicStat { tag: string; count: number; medianViews: number | null }
export function topicStats(classified: ClassifiedTweet[], tweets: AnalysisTweet[], canonicalOf: Record<string, string>): TopicStat[];
  // canonicalOf: 원태그(소문자 trim) → 대표태그. 매핑 없는 원태그는 제외. count 내림차순.
export function typeDist(classified: ClassifiedTweet[]): Partial<Record<ContentType, number>>;
export function sponsoredCount(classified: ClassifiedTweet[]): number;
export function topByViews(tweets: AnalysisTweet[], n: number): AnalysisTweet[]; // 원글+인용만, views null 제외, 내림차순 n건
```

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/analysisStats.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median, computeStats, chunk, missingIds, topicStats, typeDist, sponsoredCount, topByViews,
  type AnalysisTweet, type ClassifiedTweet,
} from './analysisStats.ts';

const tw = (over: Partial<AnalysisTweet>): AnalysisTweet => ({
  id: 't1', text: 'x', createdAt: '2026-08-01T00:00:00Z', kind: 'original',
  views: 100, likes: 10, hasMedia: false, ...over,
});

test('median: 빈 배열 null·홀수·짝수', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('computeStats: RT는 mix에만, 반응 집계에서 제외', () => {
  const tweets = [
    tw({ id: 'a', views: 100, likes: 10 }),
    tw({ id: 'b', kind: 'quote', views: 300, likes: 30 }),
    tw({ id: 'c', kind: 'retweet', views: 99999, likes: 9999 }), // 지표는 원작자 것 — 제외돼야 함
  ];
  const s = computeStats(tweets, {
    since: '2026-05-24T00:00:00Z', until: '2026-08-24T00:00:00Z', truncatedByCount: false,
  });
  assert.deepEqual(s.mix, { original: 1, retweet: 1, quote: 1 });
  assert.equal(s.medianViews, 200);   // (100+300)/2
  assert.equal(s.medianLikes, 20);
  // 3건 / (92일/7주) ≈ 0.2
  assert.equal(s.perWeek, 0.2);
});

test('computeStats: 100건 상한에 걸리면 실제 구간(최고령 트윗~until)으로 빈도 계산', () => {
  const tweets = [
    tw({ id: 'a', createdAt: '2026-08-17T00:00:00Z' }),
    tw({ id: 'b', createdAt: '2026-08-10T00:00:00Z' }), // 가장 오래됨 → 구간 14일=2주
  ];
  const s = computeStats(tweets, {
    since: '2026-05-24T00:00:00Z', until: '2026-08-24T00:00:00Z', truncatedByCount: true,
  });
  assert.equal(s.perWeek, 1); // 2건/2주
});

test('computeStats: views 전부 null이면 중앙값 null', () => {
  const s = computeStats([tw({ views: null, likes: null })], {
    since: '2026-05-24T00:00:00Z', until: '2026-08-24T00:00:00Z', truncatedByCount: false,
  });
  assert.equal(s.medianViews, null);
  assert.equal(s.medianLikes, null);
});

test('chunk / missingIds', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(missingIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }]), ['a']);
});

const cl = (over: Partial<ClassifiedTweet>): ClassifiedTweet => ({
  id: 't1', contentType: 'info', sponsored: false, evidence: null, topics: [], ...over,
});

test('topicStats: 정규화 매핑 적용 + 태그별 조회 중앙값 + count 내림차순', () => {
  const tweets = [tw({ id: 'a', views: 100 }), tw({ id: 'b', views: 300 }), tw({ id: 'c', views: 500 })];
  const classified = [
    cl({ id: 'a', topics: ['미용 의료'] }),
    cl({ id: 'b', topics: ['미용의료', '다이어트'] }),
    cl({ id: 'c', topics: ['잡담'] }), // 매핑 없음 → 제외
  ];
  const stats = topicStats(classified, tweets, {
    '미용 의료': '미용의료', '미용의료': '미용의료', '다이어트': '다이어트',
  });
  assert.deepEqual(stats, [
    { tag: '미용의료', count: 2, medianViews: 200 },
    { tag: '다이어트', count: 1, medianViews: 300 },
  ]);
});

test('typeDist·sponsoredCount·topByViews', () => {
  const classified = [cl({}), cl({ contentType: 'review', sponsored: true, evidence: '#PR' })];
  assert.deepEqual(typeDist(classified), { info: 1, review: 1 });
  assert.equal(sponsoredCount(classified), 1);
  const tweets = [
    tw({ id: 'a', views: 100 }), tw({ id: 'b', views: 300 }),
    tw({ id: 'rt', kind: 'retweet', views: 900 }), tw({ id: 'n', views: null }),
  ];
  assert.deepEqual(topByViews(tweets, 2).map((t) => t.id), ['b', 'a']); // RT·null 제외
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/analysisStats.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `src/lib/analysisStats.ts`

```ts
// 계정 분석의 결정적 계산 전부 — LLM에 계산을 시키지 않는다(스펙 §3: 숫자는 코드가).
// DB·네트워크 없음. 저장되는 수치는 전부 "건수"고 비율·판단문은 UI가 파생한다.
export type TweetKind = 'original' | 'retweet' | 'quote';

export interface AnalysisTweet {
  id: string; text: string; createdAt: string; kind: TweetKind;
  views: number | null; likes: number | null; hasMedia: boolean;
}

export type ContentType = 'info' | 'review' | 'daily' | 'promo' | 'other';
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  info: '정보', review: '후기·체험', daily: '일상·잡담', promo: '홍보·협찬', other: '기타',
};

export interface ClassifiedTweet {
  id: string; contentType: ContentType; sponsored: boolean;
  evidence: string | null; topics: string[];
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface SampleStats {
  perWeek: number;
  medianViews: number | null; medianLikes: number | null;
  mix: { original: number; retweet: number; quote: number };
}

// 반응 집계는 원글+인용만 — 순수 RT의 지표는 원작자 것이다(스펙 §3-2).
// 빈도의 분모: 3개월을 다 왔으면 since~until, 100건 상한에 걸렸으면 실제 받은 구간(최고령~until).
export function computeStats(
  tweets: AnalysisTweet[],
  opts: { since: string; until: string; truncatedByCount: boolean },
): SampleStats {
  const mix = { original: 0, retweet: 0, quote: 0 };
  for (const t of tweets) mix[t.kind] += 1;

  const engage = tweets.filter((t) => t.kind !== 'retweet');
  const medianViews = median(engage.map((t) => t.views).filter((v): v is number => v !== null));
  const medianLikes = median(engage.map((t) => t.likes).filter((v): v is number => v !== null));

  const oldest = tweets.length
    ? tweets.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), tweets[0].createdAt)
    : opts.since;
  const spanStart = opts.truncatedByCount ? oldest : opts.since;
  const weeks = Math.max((Date.parse(opts.until) - Date.parse(spanStart)) / WEEK_MS, 1);
  const perWeek = Math.round((tweets.length / weeks) * 10) / 10;

  return { perWeek, medianViews, medianLikes, mix };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// 배치 분류의 알려진 실패 모드(항목 누락) 검출 — 누락분만 재호출한다(스펙 §3-3).
export function missingIds(
  sent: ReadonlyArray<{ id: string }>, got: ReadonlyArray<{ id: string }>,
): string[] {
  const have = new Set(got.map((g) => g.id));
  return sent.filter((s) => !have.has(s.id)).map((s) => s.id);
}

export interface TopicStat { tag: string; count: number; medianViews: number | null }

// canonicalOf: 원태그(소문자 trim 키) → 대표태그. "어떤 주제가 반응 좋은가"를 실제 수치로(스펙 §3-5).
export function topicStats(
  classified: ClassifiedTweet[], tweets: AnalysisTweet[], canonicalOf: Record<string, string>,
): TopicStat[] {
  const viewsOf = new Map(tweets.map((t) => [t.id, t.views]));
  const buckets = new Map<string, { count: number; views: number[] }>();
  for (const c of classified) {
    const canon = new Set(
      c.topics.map((t) => canonicalOf[t.trim().toLowerCase()] ?? canonicalOf[t]).filter(Boolean),
    );
    for (const tag of canon) {
      const b = buckets.get(tag as string) ?? { count: 0, views: [] };
      b.count += 1;
      const v = viewsOf.get(c.id);
      if (typeof v === 'number') b.views.push(v);
      buckets.set(tag as string, b);
    }
  }
  return [...buckets.entries()]
    .map(([tag, b]) => ({ tag, count: b.count, medianViews: median(b.views) }))
    .sort((a, b) => b.count - a.count);
}

export function typeDist(classified: ClassifiedTweet[]): Partial<Record<ContentType, number>> {
  const out: Partial<Record<ContentType, number>> = {};
  for (const c of classified) out[c.contentType] = (out[c.contentType] ?? 0) + 1;
  return out;
}

export function sponsoredCount(classified: ClassifiedTweet[]): number {
  return classified.filter((c) => c.sponsored).length;
}

// 종합 서술에 원문 샘플로 넣을 반응 상위 글 — RT·조회 미상 제외(스펙 §3-6).
export function topByViews(tweets: AnalysisTweet[], n: number): AnalysisTweet[] {
  return tweets
    .filter((t) => t.kind !== 'retweet' && t.views !== null)
    .sort((a, b) => (b.views as number) - (a.views as number))
    .slice(0, n);
}
```

주의: `topicStats`의 canonicalOf 키는 "소문자 trim"이 원칙이지만 테스트처럼 원문 그대로의 키도 허용한다(`?? canonicalOf[t]` 폴백) — 정규화 패스(T7)가 만드는 매핑이 원문 키일 수 있다.

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/analysisStats.test.ts`
Expected: 전부 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysisStats.ts src/lib/analysisStats.test.ts
git commit -m "feat(influencer): 계정 분석 통계 순수 로직 — 중앙값·구성비·빈도·청크·태그 통계"
```

---

### Task 4: 판단 함수 추가 (`influencerJudgment.ts`)

**Files:**
- Modify: `src/lib/influencerJudgment.ts` (파일 끝에 추가)
- Test: `src/lib/influencerJudgment.test.ts` (기존 파일 끝에 추가 — 없으면 생성)

**Interfaces:**
- Consumes: 없음 (순수 함수만).
- Produces:

```ts
export interface CadenceJudgment { label: string; caution: boolean }
export function judgeCadence(perWeek: number, sampleCount: number): CadenceJudgment;
export function judgeEngagement(medianViews: number | null, followers: number | null): string;
```

- [ ] **Step 1: 기존 테스트 파일 확인**

Run: `ls src/lib/influencerJudgment.test.ts && tail -5 src/lib/influencerJudgment.test.ts`
있으면 끝에 추가, 없으면 기존 스토어 테스트와 같은 node:test 스타일로 새로 만든다(DB 불필요 — `getSql` import 금지).

- [ ] **Step 2: 실패하는 테스트 추가** (새 파일이면 아래 헤더 포함, 기존 파일이면 import에 두 함수만 추가)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeCadence, judgeEngagement } from './influencerJudgment.ts';

test('judgeCadence: 주 1회 미만은 확산용 주의 문구', () => {
  const j = judgeCadence(0.6, 8);
  assert.equal(j.caution, true);
  assert.equal(j.label, '주 1회 미만 — 활동이 적은 편이에요. 확산용 계정으로는 신중히 볼 필요가 있어요');
});

test('judgeCadence: 구간별 문구', () => {
  assert.deepEqual(judgeCadence(2, 26), { label: '주 2건 — 보통', caution: false });
  assert.deepEqual(judgeCadence(6.7, 87), { label: '주 6.7건 — 활발한 편', caution: false });
});

test('judgeCadence: 0건', () => {
  const j = judgeCadence(0, 0);
  assert.equal(j.caution, true);
  assert.equal(j.label, '최근 3개월 게시물이 없어요 — 활동이 없는 계정일 수 있어요');
});

test('judgeEngagement: 팔로워 대비 비율 판단', () => {
  assert.equal(judgeEngagement(12000, 24000), '조회 중앙값 1.2만 — 팔로워 규모 대비 활발한 편');
  assert.equal(judgeEngagement(3000, 24000), '조회 중앙값 3천 — 팔로워 규모 대비 보통');
  assert.equal(judgeEngagement(1000, 24000), '조회 중앙값 1천 — 팔로워 규모 대비 드문 편');
});

test('judgeEngagement: 기준 불명 폴백', () => {
  assert.equal(judgeEngagement(null, 24000), '조회수를 확인할 수 없었어요');
  assert.equal(judgeEngagement(12000, null), '조회 중앙값 1.2만');
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx tsx --test src/lib/influencerJudgment.test.ts`
Expected: 새 테스트 FAIL.

- [ ] **Step 4: 구현** — `influencerJudgment.ts` 끝에 추가

```ts
// ---- 계정 분석 판단 (스펙 §3 결과 UI) — 숫자만 던지지 않고 판단까지 서술(UX 원칙 3) ----

export interface CadenceJudgment { label: string; caution: boolean }

// 표본이 얇은 것은 오류가 아니라 판단 재료다(스펙 §3 표본): 주 1회 미만 = 확산용 주의.
export function judgeCadence(perWeek: number, sampleCount: number): CadenceJudgment {
  if (sampleCount === 0) {
    return { label: '최근 3개월 게시물이 없어요 — 활동이 없는 계정일 수 있어요', caution: true };
  }
  if (perWeek < 1) {
    return { label: '주 1회 미만 — 활동이 적은 편이에요. 확산용 계정으로는 신중히 볼 필요가 있어요', caution: true };
  }
  const n = Number.isInteger(perWeek) ? String(perWeek) : perWeek.toFixed(1);
  return perWeek > 3
    ? { label: `주 ${n}건 — 활발한 편`, caution: false }
    : { label: `주 ${n}건 — 보통`, caution: false };
}

// 조회 중앙값을 팔로워 규모에 대 보고 판단한다 — 절대값만으론 계정 크기에 따라 의미가 다르다.
// 축약 표기는 formatCount(천/만)와 동일 규칙을 쓰기 위해 그쪽을 재사용한다.
import { formatCount } from './format.ts';

export function judgeEngagement(medianViews: number | null, followers: number | null): string {
  if (medianViews === null) return '조회수를 확인할 수 없었어요';
  const v = `조회 중앙값 ${formatCount(medianViews)}`;
  if (followers === null || followers === 0) return v;
  const r = medianViews / followers;
  if (r >= 0.5) return `${v} — 팔로워 규모 대비 활발한 편`;
  if (r >= 0.1) return `${v} — 팔로워 규모 대비 보통`;
  return `${v} — 팔로워 규모 대비 드문 편`;
}
```

주의: import 문은 파일 상단으로 올린다(중간 import 금지 — 린트). `formatCount`의 실제 출력(천/만 축약)을 먼저 확인하고 테스트 기대값을 실제 출력에 맞춘다 — 함수 확인: `grep -n "formatCount" src/lib/format.ts` 후 `npx tsx -e "import {formatCount} from './src/lib/format.ts'; console.log(formatCount(12000), formatCount(3000), formatCount(1000))"`. 출력이 '1.2만'·'3천'·'1천'이 아니면 **테스트 기대값을 실제 출력으로 수정**한다(표기 규칙의 단일 출처는 format.ts).

- [ ] **Step 5: 통과 확인**

Run: `npx tsx --test src/lib/influencerJudgment.test.ts`
Expected: 전부 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/influencerJudgment.ts src/lib/influencerJudgment.test.ts
git commit -m "feat(influencer): 분석 판단 함수 — 업로드 빈도·반응 수준 서술"
```

---

### Task 5: 수집 어댑터 (`tweetSource.ts` + mappers 헬퍼 export)

**Files:**
- Modify: `src/lib/mappers.ts:4-15` — `num`/`str`/`toIso`에 `export` 추가 (다른 변경 없음)
- Create: `src/lib/tweetSource.ts`
- Test: `src/lib/tweetSource.test.ts`

**Interfaces:**
- Consumes: `AnalysisTweet`, `TweetKind` (T3 `./analysisStats.ts`), `GetxapiClient`·`RawTweet`·`SearchPage` (`./getxapi.ts`), `num`/`str`/`toIso` (`./mappers.ts`).
- Produces:

```ts
export interface FetchRecentResult { tweets: AnalysisTweet[]; truncatedByCount: boolean }
export interface TweetSource {
  fetchRecent(userId: string, opts: { maxCount: number; since: string }): Promise<FetchRecentResult>;
}
export function mapRawAnalysisTweet(raw: RawTweet): AnalysisTweet | null;  // id·createdAt 없으면 null
export function makeGetxapiTweetSource(client: Pick<GetxapiClient, 'getUserTweets'>): TweetSource;
```

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/tweetSource.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRawAnalysisTweet, makeGetxapiTweetSource } from './tweetSource.ts';
import type { RawTweet, SearchPage } from './getxapi.ts';

const raw = (over: Record<string, unknown>): RawTweet => ({
  id: 't1', text: '本文', createdAt: '2026-08-20T00:00:00.000Z',
  viewCount: 100, likeCount: 10, media: [], ...over,
});

test('mapRawAnalysisTweet: 순수 RT를 버리지 않고 kind로 구분한다(mapRawTweet과 다른 점)', () => {
  assert.equal(mapRawAnalysisTweet(raw({}))!.kind, 'original');
  assert.equal(mapRawAnalysisTweet(raw({ retweeted_tweet: { id: 'x' } }))!.kind, 'retweet');
  assert.equal(mapRawAnalysisTweet(raw({ quoted_tweet: { id: 'x' } }))!.kind, 'quote');
});

test('mapRawAnalysisTweet: 지표 없음은 null, 미디어 유무, 필수값 없으면 null', () => {
  const t = mapRawAnalysisTweet(raw({ viewCount: undefined, likeCount: undefined, media: [{ url: 'u' }] }))!;
  assert.equal(t.views, null);
  assert.equal(t.likes, null);
  assert.equal(t.hasMedia, true);
  assert.equal(mapRawAnalysisTweet(raw({ id: undefined })), null);
  assert.equal(mapRawAnalysisTweet(raw({ createdAt: undefined })), null);
});

test('fetchRecent: since보다 오래된 트윗을 만나면 그 페이지에서 중단·잘라낸다', async () => {
  const pages: SearchPage[] = [
    { tweets: [raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }),
               raw({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })],
      has_more: true, next_cursor: 'c1' },
    { tweets: [raw({ id: 'never' })], has_more: false, next_cursor: null },
  ];
  let calls = 0;
  const source = makeGetxapiTweetSource({ getUserTweets: async () => pages[calls++] });
  const r = await source.fetchRecent('u1', { maxCount: 100, since: '2026-05-24T00:00:00.000Z' });
  assert.deepEqual(r.tweets.map((t) => t.id), ['a']);
  assert.equal(calls, 1);                 // 2페이지는 부르지 않는다
  assert.equal(r.truncatedByCount, false);
});

test('fetchRecent: maxCount에서 중단하고 truncatedByCount=true', async () => {
  const page = (ids: string[], more: boolean): SearchPage => ({
    tweets: ids.map((id) => raw({ id })), has_more: more, next_cursor: more ? 'c' : null,
  });
  const pages = [page(['1', '2'], true), page(['3', '4'], true), page(['5'], false)];
  let calls = 0;
  const source = makeGetxapiTweetSource({ getUserTweets: async () => pages[calls++] });
  const r = await source.fetchRecent('u1', { maxCount: 3, since: '2026-05-24T00:00:00.000Z' });
  assert.deepEqual(r.tweets.map((t) => t.id), ['1', '2', '3']);
  assert.equal(r.truncatedByCount, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/tweetSource.test.ts`
Expected: FAIL.

- [ ] **Step 3: mappers 헬퍼 export + 구현**

`src/lib/mappers.ts` — 함수 3개 앞에 `export`만 붙인다:
```ts
export function num(v: unknown): number | null { ... }   // 기존 본문 그대로
export function str(v: unknown): string | null { ... }
export function toIso(v: unknown): string | null { ... }
```

`src/lib/tweetSource.ts`:
```ts
// 계정 분석용 수집 경계(스펙 §4) — 다른 서비스 API로 교체할 수 있게 인터페이스 뒤에 둔다.
// mapRawTweet을 재사용하지 않는 이유: 그쪽은 순수 RT를 버린다(벤치마크 대상 아님) — 분석은
// RT 비중 자체가 판단 재료라 kind로 구분해 남긴다. RT의 본문·지표는 쓰지 않는다(원작자 것).
import type { GetxapiClient, RawTweet } from './getxapi.ts';
import { num, str, toIso } from './mappers.ts';
import type { AnalysisTweet } from './analysisStats.ts';

export interface FetchRecentResult { tweets: AnalysisTweet[]; truncatedByCount: boolean }

export interface TweetSource {
  fetchRecent(userId: string, opts: { maxCount: number; since: string }): Promise<FetchRecentResult>;
}

export function mapRawAnalysisTweet(raw: RawTweet): AnalysisTweet | null {
  const id = str(raw.id);
  const createdAt = toIso(raw.createdAt);
  if (!id || !createdAt) return null;
  const kind = raw.retweeted_tweet ? 'retweet' : raw.quoted_tweet ? 'quote' : 'original';
  const media = Array.isArray(raw.media) ? raw.media : [];
  return {
    id, createdAt, kind,
    text: str(raw.text) ?? '',
    views: num(raw.viewCount), likes: num(raw.likeCount),
    hasMedia: media.length > 0,
  };
}

const MAX_PAGES = 10; // 무한 커서 가드 — 100건이면 5~6페이지에서 끝난다

export function makeGetxapiTweetSource(client: Pick<GetxapiClient, 'getUserTweets'>): TweetSource {
  return {
    async fetchRecent(userId, { maxCount, since }) {
      const out: AnalysisTweet[] = [];
      let cursor: string | undefined;
      for (let p = 0; p < MAX_PAGES; p++) {
        const page = await client.getUserTweets(userId, cursor);
        let sawOld = false;
        for (const raw of page.tweets) {
          const t = mapRawAnalysisTweet(raw);
          if (!t) continue;
          if (t.createdAt < since) { sawOld = true; continue; } // 페이지가 최신순이라 이후는 전부 과거
          out.push(t);
          if (out.length >= maxCount) return { tweets: out, truncatedByCount: true };
        }
        if (sawOld || !page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      }
      return { tweets: out, truncatedByCount: false };
    },
  };
}
```

- [ ] **Step 4: 통과 확인 + 기존 매퍼 테스트 회귀 확인**

Run: `npx tsx --test src/lib/tweetSource.test.ts && npx tsx --test src/lib/mappers.test.ts 2>/dev/null || npx tsx --test src/lib/tweetSource.test.ts`
Expected: PASS (mappers.test.ts가 있으면 그것도 PASS).

- [ ] **Step 5: Commit**

```bash
git add src/lib/mappers.ts src/lib/tweetSource.ts src/lib/tweetSource.test.ts
git commit -m "feat(influencer): 분석용 트윗 수집 어댑터 — TweetSource 경계·RT kind 보존"
```

---

### Task 6: 스토어 확장 (`influencerStore.ts`)

**Files:**
- Modify: `src/lib/influencerStore.ts`
- Test: `src/lib/influencerStore.test.ts` (끝에 테스트 추가)

**Interfaces:**
- Consumes: `Pricing`, `PricingChange`, `parsePricingPatch` 제외 전부 (T2 `./influencerPricing.ts`의 `mergePricing`·`diffPricing`), `InfluencerAnalysis`는 이 태스크에서 타입만 정의(T7이 값을 만든다).
- Produces:

```ts
// influencerStore.ts에 추가/변경
export type InfluencerAutoEvent = ... | 'pricing_changed';           // 유니언 확장
export type LogPayload = { from?: string; to?: string } | PricingChange;  // InfluencerLogRow.payload 타입 확장
export interface InfluencerAnalysis {                                 // 스펙 §3 저장 형태 (T7·T11이 공유)
  sample: { count: number; classified: number; since: string; until: string; months: number };
  stats: { perWeek: number; medianViews: number | null; medianLikes: number | null;
           mix: { original: number; retweet: number; quote: number };
           typeDist: Partial<Record<ContentType, number>>; sponsoredCount: number };
  topics: TopicStat[];
  summary: { tone: string; patterns: string; sponsorship: string } | null;  // 표본 0건이면 null
  models: { classify: string; synth: string };
}
export interface InfluencerDetail { ...기존; pricing: Pricing; analysis: InfluencerAnalysis | null; analyzedAt: string | null }
export async function updatePricing(sql, id: string, patch: Pricing, actorId: string | null):
  Promise<{ pricing: Pricing; logs: InfluencerLogRow[] }>;   // 행 잠금→diff→변경별 auto 로그→병합 저장. logs는 방금 만든 로그 행(최신순).
export async function saveAnalysis(sql, id: string, analysis: InfluencerAnalysis): Promise<void>; // analysis + analyzed_at=now()
// insertAutoLog의 payload 파라미터를 LogPayload로 확장
```
- `ContentType`·`TopicStat`은 `./analysisStats.ts`에서 import.
- **InfluencerRow는 바꾸지 않는다** — pricing·analysis는 상세(Detail)에만 싣는다(목록 payload 비대 방지, 스펙 리뷰 반영).

- [ ] **Step 1: 실패하는 테스트 추가** — `influencerStore.test.ts` 끝에

```ts
test('9) updatePricing: 병합 저장 + 변경분만 auto 로그', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'price', createdBy: null });

  const r1 = await updatePricing(sql, row.id, { rt: 100000, post: 300000 }, null);
  assert.deepEqual(r1.pricing, { rt: 100000, post: 300000 });
  assert.equal(r1.logs.length, 2);
  assert.ok(r1.logs.every((l) => l.kind === 'auto' && l.eventType === 'pricing_changed'));

  // 부분 패치: post만 변경 — rt는 보존, 로그는 1건만
  const r2 = await updatePricing(sql, row.id, { post: 350000 }, null);
  assert.deepEqual(r2.pricing, { rt: 100000, post: 350000 });
  assert.equal(r2.logs.length, 1);
  assert.deepEqual(r2.logs[0].payload, { priceType: 'post', from: 300000, to: 350000, currency: 'KRW' });

  // 같은 값 재전송 = 로그 없음
  const r3 = await updatePricing(sql, row.id, { post: 350000 }, null);
  assert.equal(r3.logs.length, 0);

  // 상세에 pricing이 실려 온다
  const detail = await getInfluencerDetail(sql, row.id);
  assert.deepEqual(detail!.pricing, { rt: 100000, post: 350000 });
  assert.equal(detail!.logs.filter((l) => l.eventType === 'pricing_changed').length, 3);
});

test('10) saveAnalysis: 저장·조회 왕복', async () => {
  const { row } = await createInfluencer(sql, { handle: P + 'anal', createdBy: null });
  const analysis = {
    sample: { count: 2, classified: 2, since: '2026-05-24T00:00:00.000Z', until: '2026-08-24T00:00:00.000Z', months: 3 },
    stats: { perWeek: 0.2, medianViews: 200, medianLikes: 20,
             mix: { original: 1, retweet: 0, quote: 1 }, typeDist: { info: 2 }, sponsoredCount: 0 },
    topics: [{ tag: '미용의료', count: 2, medianViews: 200 }],
    summary: { tone: '톤', patterns: '패턴', sponsorship: '관찰되지 않음' },
    models: { classify: 'claude-haiku-4-5', synth: 'claude-sonnet-5' },
  };
  await saveAnalysis(sql, row.id, analysis);
  const detail = await getInfluencerDetail(sql, row.id);
  assert.deepEqual(detail!.analysis, analysis);
  assert.ok(detail!.analyzedAt);
});
```

import 줄에 `updatePricing, saveAnalysis` 추가.

- [ ] **Step 2: 실패 확인 (이 파일만)**

Run: `npx tsx --test src/lib/influencerStore.test.ts`
Expected: 기존 테스트 PASS, 새 테스트 FAIL. (실 DB 사용 — .env 필요, 이미 있음)

- [ ] **Step 3: 구현**

`influencerStore.ts` 수정 지점:

(1) import·타입:
```ts
import { diffPricing, mergePricing, type Pricing, type PricingChange } from './influencerPricing.ts';
import type { ContentType, TopicStat } from './analysisStats.ts';

export type InfluencerAutoEvent =
  'draft_assigned' | 'draft_unassigned' | 'draft_delivered' | 'handle_changed' | 'pricing_changed';

export type LogPayload = { from?: string; to?: string } | PricingChange;
// InfluencerLogRow.payload: LogPayload | null 로 교체 (LRow.payload도 동일)

export interface InfluencerAnalysis { /* 위 Interfaces 블록 그대로 */ }
```

(2) `InfluencerDetail`에 `pricing: Pricing; analysis: InfluencerAnalysis | null; analyzedAt: string | null` 추가. `getInfluencerDetail`에서 별도 select:
```ts
  const extra = await sql<Array<{ pricing: Pricing; analysis: InfluencerAnalysis | null; analyzed_at: Date | null }>>`
    select pricing, analysis, analyzed_at from influencer where id = ${id}`;
```
return에 `pricing: extra[0].pricing, analysis: extra[0].analysis, analyzedAt: extra[0].analyzed_at ? new Date(extra[0].analyzed_at).toISOString() : null` 추가.

(3) `insertAutoLog`의 `payload?: { from: string; to: string }` → `payload?: LogPayload`.

(4) 신규 함수 (파일 끝):
```ts
// 단가 병합 저장 — 행 잠금 후 diff라 동시 blur가 겹쳐도 로그·값이 어긋나지 않는다(스펙 §2).
// 로그는 유형별 한 줄씩: 단가 칸 옆 이력 펼침이 priceType 단위로 필터하기 때문.
export async function updatePricing(
  sql: postgres.Sql, id: string, patch: Pricing, actorId: string | null,
): Promise<{ pricing: Pricing; logs: InfluencerLogRow[] }> {
  return await sql.begin(async (tx) => {
    const rows = await tx<Array<{ pricing: Pricing }>>`
      select pricing from influencer where id = ${id} for update`;
    if (rows.length === 0) throw new Error(`influencer not found: ${id}`);
    const base = rows[0].pricing ?? {};
    const changes = diffPricing(base, patch);
    const merged = mergePricing(base, patch);
    await tx`update influencer set pricing = ${tx.json(merged as object)} where id = ${id}`;
    const logIds: string[] = [];
    for (const c of changes) {
      const ins = await tx<Array<{ id: string }>>`
        insert into influencer_log (influencer_id, kind, event_type, payload, author_id)
        values (${id}, 'auto', 'pricing_changed', ${tx.json(c as unknown as object)}, ${actorId})
        returning id`;
      logIds.push(ins[0].id);
    }
    const logs = logIds.length
      ? (await tx<LRow[]>`${LOG_SELECT(tx)} where l.id in ${tx(logIds)} order by l.created_at desc, l.id desc`).map(toLog)
      : [];
    return { pricing: merged, logs };
  });
}

export async function saveAnalysis(
  sql: postgres.Sql, id: string, analysis: InfluencerAnalysis,
): Promise<void> {
  await sql`update influencer set analysis = ${sql.json(analysis as unknown as object)}, analyzed_at = now()
    where id = ${id}`;
}
```

주의: `LOG_SELECT`는 `postgres.Sql`을 받는데 트랜잭션 핸들도 같은 타입 호환이다(기존 `renameInfluencer`가 tx 안에서 `insertAutoLog(sql=tx)`를 쓰는 관례와 동일).

- [ ] **Step 4: 통과 확인**

Run: `npx tsx --test src/lib/influencerStore.test.ts`
Expected: 전부 PASS (기존 8개 + 신규 2개).

- [ ] **Step 5: 타입 전파 확인** — payload 타입 확장이 UI(`InfluencerProfile.tsx`의 `l.payload?.from`)를 깨는지:

Run: `npx tsc --noEmit 2>&1 | head -20`
`payload.from` 접근이 유니언 때문에 에러가 나면 `InfluencerProfile.tsx`의 `handle_changed` 케이스를 다음으로 좁힌다(이 태스크에서 고쳐도 된다 — 한 줄):
```ts
case 'handle_changed': {
  const p = l.payload as { from?: string; to?: string } | null;
  return <>핸들 변경 @{p?.from ?? '?'} → @{p?.to ?? '?'}</>;
}
```
Expected: 에러 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/influencerStore.ts src/lib/influencerStore.test.ts src/app/influencers/InfluencerProfile.tsx
git commit -m "feat(influencer): 스토어 확장 — updatePricing(잠금·diff·로그)·saveAnalysis·Detail에 pricing/analysis"
```

---

### Task 7: LLM 분석 파이프라인 (`influencerAnalysis.ts`)

**Files:**
- Create: `src/lib/influencerAnalysis.ts`
- Modify: `src/lib/usageFeatures.ts` (라벨 2줄)
- Test: `src/lib/influencerAnalysis.test.ts`

**Interfaces:**
- Consumes: `AnalysisTweet`·`ClassifiedTweet`·`ContentType`·통계 함수 전부 (T3 `./analysisStats.ts`), `TweetSource`·`FetchRecentResult` (T5 `./tweetSource.ts`), `InfluencerAnalysis` (T6 `./influencerStore.ts`), `callLLM`·`LLMResponse` (`./llm.ts`).
- Produces:

```ts
export interface AnalysisChat {
  complete(req: { operation: string; model: string; system: string; user: string; maxTokens: number; schema?: object }): Promise<string>;
} // 반환 = 응답 text 블록. OpenRouter 등은 이 인터페이스 구현으로 교체(스펙 §4)
export function makeAnthropicChat(): AnalysisChat;                       // callLLM 래핑(usage 기록·거절 승격 포함)
export const CLASSIFY_MODEL: () => string;   // process.env.ANALYSIS_CLASSIFY_MODEL ?? 'claude-haiku-4-5'
export const SYNTH_MODEL: () => string;      // process.env.ANALYSIS_SYNTH_MODEL ?? 'claude-sonnet-5'
export const ANALYSIS_MONTHS = 3;
export const ANALYSIS_MAX_TWEETS = 100;
export class AnalysisFormatError extends Error {}   // LLM 출력 파싱 실패(종합 단계) — 라우트가 "형식을 맞추지 못했어요"로
export async function analyzeAccount(
  deps: { source: TweetSource; chat: AnalysisChat },
  userId: string,
  opts?: { now?: Date },
): Promise<InfluencerAnalysis>;
```

**파이프라인 순서(스펙 §3, 반드시 이 구조):** 수집 → computeStats → (분류 대상 = kind!=='retweet') 25건 청크 분류(+누락 1회 재시도, 그래도 빠지면 제외) → 태그 정규화 1콜 → topicStats/typeDist/sponsoredCount → 종합 1콜. 표본 0건이거나 분류 대상 0건이면 LLM 단계 전부 생략, `summary: null`, `topics: []`. **DB 접근 금지** — 이 모듈은 순수 오케스트레이션(저장은 라우트가).

- [ ] **Step 1: 실패하는 테스트 작성** — `src/lib/influencerAnalysis.test.ts` (페이크 주입 — DB·네트워크 없음)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAccount, AnalysisFormatError, type AnalysisChat } from './influencerAnalysis.ts';
import type { TweetSource } from './tweetSource.ts';
import type { AnalysisTweet } from './analysisStats.ts';

const NOW = new Date('2026-08-24T00:00:00.000Z');
const tw = (over: Partial<AnalysisTweet>): AnalysisTweet => ({
  id: 't1', text: '本文', createdAt: '2026-08-20T00:00:00.000Z', kind: 'original',
  views: 100, likes: 10, hasMedia: false, ...over,
});
const sourceOf = (tweets: AnalysisTweet[], truncated = false): TweetSource => ({
  fetchRecent: async () => ({ tweets, truncatedByCount: truncated }),
});

// 페이크 chat: operation으로 단계를 구분해 답한다
function chatOf(handlers: Record<string, (user: string) => string>): AnalysisChat & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async complete({ operation, user }) {
      calls.push(operation);
      return handlers[operation](user);
    },
  };
}

test('전체 흐름: 분류→정규화→통계→종합', async () => {
  const tweets = [
    tw({ id: 'a', views: 100 }), tw({ id: 'b', views: 300, kind: 'quote' }),
    tw({ id: 'r', views: 900, kind: 'retweet' }),
  ];
  const chat = chatOf({
    'anthropic.influencerClassify': (user) => JSON.stringify({
      items: (JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>).map(({ id }) => (
        { id, contentType: 'review', sponsored: id === 'b', evidence: id === 'b' ? '#PR' : null, topics: ['미용 의료'] }
      )),
    }),
    'anthropic.influencerNormalize': () => JSON.stringify({
      topics: [{ tag: '미용의료', absorbs: ['미용 의료'] }],
    }),
    'anthropic.influencerSynth': () => JSON.stringify({
      tone: '친근한 후기 톤', patterns: '후기 글 반응 좋음', sponsorship: '#PR 1건 관찰',
    }),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });

  assert.equal(a.sample.count, 3);
  assert.equal(a.sample.classified, 2);              // RT 제외 2건 분류
  assert.equal(a.sample.months, 3);
  assert.deepEqual(a.stats.mix, { original: 1, retweet: 1, quote: 1 });
  assert.equal(a.stats.medianViews, 200);            // RT 900 제외
  assert.equal(a.stats.sponsoredCount, 1);
  assert.deepEqual(a.stats.typeDist, { review: 2 });
  assert.deepEqual(a.topics, [{ tag: '미용의료', count: 2, medianViews: 200 }]);
  assert.equal(a.summary!.tone, '친근한 후기 톤');
  assert.deepEqual(chat.calls, ['anthropic.influencerClassify', 'anthropic.influencerNormalize', 'anthropic.influencerSynth']);
});

test('표본 0건: LLM 안 부르고 summary null', async () => {
  const chat = chatOf({});
  const a = await analyzeAccount({ source: sourceOf([]), chat }, 'u1', { now: NOW });
  assert.equal(a.sample.count, 0);
  assert.equal(a.summary, null);
  assert.deepEqual(a.topics, []);
  assert.deepEqual(chat.calls, []);
});

test('분류 누락: 1회 재시도, 그래도 빠지면 classified에 반영', async () => {
  const tweets = [tw({ id: 'a' }), tw({ id: 'b' })];
  let classifyCalls = 0;
  const chat = chatOf({
    'anthropic.influencerClassify': () => {
      classifyCalls++;
      // 항상 a만 답한다 → b는 재시도에도 누락
      return JSON.stringify({ items: [{ id: 'a', contentType: 'info', sponsored: false, evidence: null, topics: [] }] });
    },
    'anthropic.influencerNormalize': () => JSON.stringify({ topics: [] }),
    'anthropic.influencerSynth': () => JSON.stringify({ tone: 't', patterns: 'p', sponsorship: 's' }),
  });
  const a = await analyzeAccount({ source: sourceOf(tweets), chat }, 'u1', { now: NOW });
  assert.equal(classifyCalls, 2);          // 본 호출 + 누락 재시도 1회
  assert.equal(a.sample.classified, 1);
});

test('종합 JSON 불량이면 AnalysisFormatError (반쪽 저장 방지 — 라우트가 실패 처리)', async () => {
  const chat = chatOf({
    'anthropic.influencerClassify': () => JSON.stringify({ items: [{ id: 'a', contentType: 'info', sponsored: false, evidence: null, topics: [] }] }),
    'anthropic.influencerNormalize': () => JSON.stringify({ topics: [] }),
    'anthropic.influencerSynth': () => 'JSON 아님',
  });
  await assert.rejects(
    analyzeAccount({ source: sourceOf([tw({ id: 'a' })]), chat }, 'u1', { now: NOW }),
    AnalysisFormatError,
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx tsx --test src/lib/influencerAnalysis.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현** — `src/lib/influencerAnalysis.ts`

```ts
// 계정 분석 오케스트레이션(스펙 §3) — 숫자는 analysisStats(코드)가, 해석만 LLM이.
// TweetSource·AnalysisChat 두 경계만 의존(교체 가능, 스펙 §4). DB 접근 없음 — 저장은 라우트가.
import { callLLM } from './llm.ts';
import {
  chunk, computeStats, missingIds, sponsoredCount, topByViews, topicStats, typeDist,
  CONTENT_TYPE_LABEL,
  type AnalysisTweet, type ClassifiedTweet, type ContentType,
} from './analysisStats.ts';
import type { TweetSource } from './tweetSource.ts';
import type { InfluencerAnalysis } from './influencerStore.ts';

export const ANALYSIS_MONTHS = 3;
export const ANALYSIS_MAX_TWEETS = 100;
const CHUNK_SIZE = 25;
const TOP_SAMPLE = 10;

export const CLASSIFY_MODEL = () => process.env.ANALYSIS_CLASSIFY_MODEL ?? 'claude-haiku-4-5';
export const SYNTH_MODEL = () => process.env.ANALYSIS_SYNTH_MODEL ?? 'claude-sonnet-5';

export interface AnalysisChat {
  complete(req: {
    operation: string; model: string; system: string; user: string;
    maxTokens: number; schema?: object;
  }): Promise<string>;
}

// 구현 1호 — callLLM 경유(usage 기록·lone surrogate 제거·거절 승격이 그 안에 있다).
// sampling 파라미터는 보내지 않는다(최신 모델 400) — 결정성은 스키마·프롬프트로.
export function makeAnthropicChat(): AnalysisChat {
  return {
    async complete({ operation, model, system, user, maxTokens, schema }) {
      const res = await callLLM(operation, {
        model, max_tokens: maxTokens, system,
        messages: [{ role: 'user', content: user }],
        ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
      });
      return res.content.find((b) => b.type === 'text')?.text ?? '';
    },
  };
}

export class AnalysisFormatError extends Error {
  constructor() { super('분석 응답 형식이 맞지 않아요'); this.name = 'AnalysisFormatError'; }
}

// ---- 분류 (Haiku, 25건 청크) ----

const CLASSIFY_SYSTEM = [
  '너는 X(트위터) 게시물 분류기다. 게시물 목록(JSON 배열)을 받아 각 항목을 분류해 JSON으로만 답한다.',
  '- contentType: info(정보·팁) | review(후기·체험) | daily(일상·잡담) | promo(홍보·협찬 고지) | other',
  '- sponsored: 협찬·광고 표기(#PR·#AD·広告·提供 등)나 명백한 유상 홍보면 true. 확실할 때만 true.',
  '- evidence: sponsored=true일 때 근거가 된 원문 조각(해시태그·문구)을 그대로 인용. false면 null.',
  '- topics: 게시물의 주제 1~3개, 짧은 한국어 명사구(예: "미용의료", "다이어트"). 게시물이 일본어라도 태그는 한국어로.',
  '- 입력의 모든 id를 빠짐없이 items에 포함할 것.',
].join('\n');

const classifySchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          contentType: { type: 'string', enum: ['info', 'review', 'daily', 'promo', 'other'] },
          sponsored: { type: 'boolean' },
          evidence: { type: ['string', 'null'] },
          topics: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'contentType', 'sponsored', 'evidence', 'topics'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function parseClassified(text: string): ClassifiedTweet[] {
  try {
    const j = JSON.parse(text) as { items?: unknown };
    if (!Array.isArray(j.items)) return [];
    return j.items.filter((it): it is ClassifiedTweet =>
      typeof it === 'object' && it !== null &&
      typeof (it as ClassifiedTweet).id === 'string' &&
      ['info', 'review', 'daily', 'promo', 'other'].includes((it as ClassifiedTweet).contentType) &&
      typeof (it as ClassifiedTweet).sponsored === 'boolean' &&
      Array.isArray((it as ClassifiedTweet).topics),
    ).map((it) => ({ ...it, evidence: typeof it.evidence === 'string' ? it.evidence : null }));
  } catch { return []; }
}

function classifyInput(tweets: AnalysisTweet[]): string {
  return '게시물 목록:\n' + JSON.stringify(tweets.map((t) => ({
    id: t.id, text: t.text, quote: t.kind === 'quote', hasMedia: t.hasMedia,
  })));
}

async function classifyAll(chat: AnalysisChat, targets: AnalysisTweet[]): Promise<ClassifiedTweet[]> {
  const out: ClassifiedTweet[] = [];
  for (const c of chunk(targets, CHUNK_SIZE)) {
    let got = parseClassified(await chat.complete({
      operation: 'anthropic.influencerClassify', model: CLASSIFY_MODEL(),
      system: CLASSIFY_SYSTEM, user: classifyInput(c), maxTokens: 8000, schema: classifySchema,
    }));
    // id 대조 → 누락분만 1회 재호출(배치 분류의 알려진 실패 모드, 스펙 §3-3)
    const missing = missingIds(c, got);
    if (missing.length > 0) {
      const retryTargets = c.filter((t) => missing.includes(t.id));
      got = [...got, ...parseClassified(await chat.complete({
        operation: 'anthropic.influencerClassify', model: CLASSIFY_MODEL(),
        system: CLASSIFY_SYSTEM, user: classifyInput(retryTargets), maxTokens: 8000, schema: classifySchema,
      }))];
    }
    const ids = new Set(c.map((t) => t.id));
    out.push(...got.filter((g) => ids.has(g.id)));   // 지어낸 id 방어
  }
  // 같은 id가 두 번 오면 첫 번째만
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

// ---- 태그 정규화 (1콜) — 자유 태그를 그대로 두면 동의어가 흩어진다(스펙 §3-4) ----

const NORMALIZE_SYSTEM = [
  '너는 태그 정리기다. 태그 목록(등장 횟수 포함)을 받아 동의어·표기 변형을 병합해',
  '이 계정을 대표하는 태그 3~5개로 정리해 JSON으로만 답한다.',
  '- topics: [{ tag: 대표 태그(한국어), absorbs: [병합된 원태그 전부 — 대표 태그 자신도 포함] }]',
  '- 등장 횟수가 많은 주제 우선. 1~2회뿐인 잡다한 태그는 버려도 된다.',
].join('\n');

const normalizeSchema = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tag: { type: 'string' }, absorbs: { type: 'array', items: { type: 'string' } } },
        required: ['tag', 'absorbs'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

async function normalizeTags(chat: AnalysisChat, classified: ClassifiedTweet[]): Promise<Record<string, string>> {
  const counts = new Map<string, number>();
  for (const c of classified) for (const t of c.topics) {
    const k = t.trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size === 0) return {};
  const text = await chat.complete({
    operation: 'anthropic.influencerNormalize', model: CLASSIFY_MODEL(),
    system: NORMALIZE_SYSTEM,
    user: '태그 목록:\n' + JSON.stringify([...counts.entries()].map(([tag, count]) => ({ tag, count }))),
    maxTokens: 2000, schema: normalizeSchema,
  });
  const canonicalOf: Record<string, string> = {};
  try {
    const j = JSON.parse(text) as { topics?: Array<{ tag?: unknown; absorbs?: unknown }> };
    for (const t of j.topics ?? []) {
      if (typeof t.tag !== 'string' || !Array.isArray(t.absorbs)) continue;
      canonicalOf[t.tag.trim().toLowerCase()] = t.tag;   // 대표 태그 자신
      for (const a of t.absorbs) if (typeof a === 'string') canonicalOf[a.trim().toLowerCase()] = t.tag;
    }
  } catch { /* 정규화 실패는 태그 없음으로 강등 — 분석 전체를 죽이지 않는다 */ }
  return canonicalOf;
}

// ---- 종합 서술 (Sonnet 1콜) — 통계 + 원문 샘플 동시 투입(map 압축으로 잃는 뉘앙스 보전) ----

const SYNTH_SYSTEM = [
  '너는 인플루언서 계정 분석가다. 집계 통계와 반응 상위 게시물 원문을 받아 한국어로 JSON만 출력한다.',
  '- tone: 이 계정의 성향·톤·문체 요약 2~3문장. 팔로워와의 관계가 보이면 함께.',
  '- patterns: 어떤 글이 반응이 좋은지 1~2문장 — 반드시 준 통계·원문을 근거로, 수치를 지어내지 말 것.',
  '- sponsorship: 협찬 관찰 1~2문장 — 협찬 건수·근거 문구를 언급, 관찰이 없으면 "관찰되지 않음"이라고 쓸 것.',
  '읽는 사람은 비개발 콘텐츠 기획자다 — 내부 용어 없이 평이하게.',
].join('\n');

const synthSchema = {
  type: 'object',
  properties: {
    tone: { type: 'string' }, patterns: { type: 'string' }, sponsorship: { type: 'string' },
  },
  required: ['tone', 'patterns', 'sponsorship'],
  additionalProperties: false,
};

// ---- 오케스트레이터 ----

export async function analyzeAccount(
  deps: { source: TweetSource; chat: AnalysisChat },
  userId: string,
  opts?: { now?: Date },
): Promise<InfluencerAnalysis> {
  const now = opts?.now ?? new Date();
  const until = now.toISOString();
  const sinceDate = new Date(now);
  sinceDate.setMonth(sinceDate.getMonth() - ANALYSIS_MONTHS);
  const since = sinceDate.toISOString();

  const { tweets, truncatedByCount } = await deps.source.fetchRecent(userId, {
    maxCount: ANALYSIS_MAX_TWEETS, since,
  });
  const stats = computeStats(tweets, { since, until, truncatedByCount });
  const targets = tweets.filter((t) => t.kind !== 'retweet');   // RT 본문은 원작자 것 — 분류 제외
  const models = { classify: CLASSIFY_MODEL(), synth: SYNTH_MODEL() };

  const base = {
    sample: {
      count: tweets.length, classified: 0,
      since: truncatedByCount && tweets.length
        ? tweets.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), tweets[0].createdAt)
        : since,
      until, months: ANALYSIS_MONTHS,
    },
    models,
  };

  if (targets.length === 0) {
    return {
      ...base,
      stats: { ...stats, typeDist: {}, sponsoredCount: 0 },
      topics: [], summary: null,
    };
  }

  const classified = await classifyAll(deps.chat, targets);
  const canonicalOf = await normalizeTags(deps.chat, classified);
  const topics = topicStats(classified, tweets, canonicalOf);

  const top = topByViews(tweets, TOP_SAMPLE);
  const synthText = await deps.chat.complete({
    operation: 'anthropic.influencerSynth', model: SYNTH_MODEL(),
    system: SYNTH_SYSTEM,
    user: [
      '집계 통계(코드가 계산한 사실):',
      JSON.stringify({
        표본: `${tweets.length}건 (분류 ${classified.length}건)`,
        주당_게시: stats.perWeek,
        조회_중앙값: stats.medianViews, 좋아요_중앙값: stats.medianLikes,
        구성: stats.mix,
        유형별_건수: Object.fromEntries(Object.entries(typeDist(classified)).map(
          ([k, v]) => [CONTENT_TYPE_LABEL[k as ContentType], v])),
        협찬_표기_건수: sponsoredCount(classified),
        협찬_근거: classified.filter((c) => c.sponsored).map((c) => c.evidence).filter(Boolean).slice(0, 10),
        주제별: topics,
      }),
      '',
      '반응 상위 게시물 원문:',
      JSON.stringify(top.map((t) => ({ text: t.text, views: t.views, likes: t.likes }))),
    ].join('\n'),
    maxTokens: 2000, schema: synthSchema,
  });

  let summary: { tone: string; patterns: string; sponsorship: string };
  try {
    const j = JSON.parse(synthText) as { tone?: unknown; patterns?: unknown; sponsorship?: unknown };
    if (typeof j.tone !== 'string' || typeof j.patterns !== 'string' || typeof j.sponsorship !== 'string') {
      throw new Error('shape');
    }
    summary = { tone: j.tone, patterns: j.patterns, sponsorship: j.sponsorship };
  } catch {
    throw new AnalysisFormatError();   // 반쪽 결과를 저장하지 않는다(스펙 §7)
  }

  return {
    ...base,
    sample: { ...base.sample, classified: classified.length },
    stats: { ...stats, typeDist: typeDist(classified), sponsoredCount: sponsoredCount(classified) },
    topics, summary,
  };
}
```

- [ ] **Step 4: usageFeatures 라벨 추가** — `src/lib/usageFeatures.ts`의 FEATURE에 3줄:

```ts
  'anthropic.influencerClassify': '계정 분석',
  'anthropic.influencerNormalize': '계정 분석',
  'anthropic.influencerSynth': '계정 분석',
```

- [ ] **Step 5: 통과 확인**

Run: `npx tsx --test src/lib/influencerAnalysis.test.ts && npx tsx --test src/lib/usageFeatures.test.ts`
Expected: 전부 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/influencerAnalysis.ts src/lib/influencerAnalysis.test.ts src/lib/usageFeatures.ts
git commit -m "feat(influencer): 계정 분석 파이프라인 — 청크 분류·태그 정규화·종합 서술, AnalysisChat 경계"
```

---

### Task 8: analyze 라우트 + 계정 판정 공유화

**Files:**
- Create: `src/lib/influencerAccount.ts`
- Modify: `src/app/api/influencers/[id]/refresh/route.ts` (판정 로직을 공유 함수로 대체)
- Create: `src/app/api/influencers/[id]/analyze/route.ts`

**Interfaces:**
- Consumes: `analyzeAccount`·`makeAnthropicChat`·`AnalysisFormatError` (T7), `makeGetxapiTweetSource` (T5), `saveAnalysis`·`findInfluencerById`·`findDuplicateByXUserId`·`applyProfileSnapshot`·`getInfluencerDetail` (T6/기존), `LLMRefusalError` (`@/lib/llm`), `makeClient`·`GetxapiAuthError` (`@/lib/getxapi`), `requireMember`·`isUuidLike`.
- Produces:

```ts
// src/lib/influencerAccount.ts
export type AccountResolution =
  | { status: 'ok'; info: UserInfo; duplicateOf: string | null }
  | { status: 'not_found' } | { status: 'handle_taken' };
export async function resolveAccount(
  sql: postgres.Sql, inf: InfluencerRow, client: Pick<GetxapiClient, 'getUserInfo'>,
): Promise<AccountResolution>;   // refresh의 3분기(스펙 v1 §5)를 그대로 옮긴 것 — 스냅샷 저장은 하지 않는다(호출자 몫)
```
- analyze 응답: 200 `{ analysis: InfluencerAnalysis, analyzedAt: string }` / 502 `{ error }` / 409 `{ error }` (handle_taken·not_found — 몸통 문구는 refresh와 동일 워딩).

- [ ] **Step 1: 판정 공유 함수 추출** — `src/lib/influencerAccount.ts`

```ts
// refresh·analyze가 같은 3분기 규칙을 쓴다(스펙 §3) — 같은 사실을 두 문구로 말하지 않기.
import type postgres from 'postgres';
import type { GetxapiClient, UserInfo } from './getxapi.ts';
import { findDuplicateByXUserId, type InfluencerRow } from './influencerStore.ts';

export type AccountResolution =
  | { status: 'ok'; info: UserInfo; duplicateOf: string | null }
  | { status: 'not_found' }
  | { status: 'handle_taken' };

export async function resolveAccount(
  sql: postgres.Sql, inf: InfluencerRow, client: Pick<GetxapiClient, 'getUserInfo'>,
): Promise<AccountResolution> {
  const info = await client.getUserInfo(inf.handle);   // 실패(throw)는 호출자가 502로
  if (!info.id) return { status: 'not_found' };
  if (inf.xUserId && info.id !== inf.xUserId) return { status: 'handle_taken' };
  const duplicateOf = await findDuplicateByXUserId(sql, info.id, inf.id);
  return { status: 'ok', info, duplicateOf };
}
```

- [ ] **Step 2: refresh 라우트를 공유 함수로 교체** — 기존 판정 부분(`route.ts:20-41`)을:

```ts
  let resolution: AccountResolution;
  try {
    resolution = await resolveAccount(sql, inf, makeClient());
  } catch (e) {
    console.error('[influencer] 프로필 갱신 실패', {
      handle: inf.handle, err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
  }
  if (resolution.status !== 'ok') return NextResponse.json({ status: resolution.status });

  await applyProfileSnapshot(sql, inf.id, resolution.info);
  return NextResponse.json({
    status: 'ok', duplicateOf: resolution.duplicateOf, influencer: await findInfluencerById(sql, id),
  });
```

동작 불변 확인: 기존 응답 형태(`{status:'not_found'}`·`{status:'handle_taken'}`·`{status:'ok', duplicateOf, influencer}`·502)와 완전히 같아야 한다.

- [ ] **Step 3: analyze 라우트 작성** — `src/app/api/influencers/[id]/analyze/route.ts`

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { makeClient } from '@/lib/getxapi';
import { LLMRefusalError } from '@/lib/llm';
import { applyProfileSnapshot, findInfluencerById, saveAnalysis } from '@/lib/influencerStore';
import { resolveAccount, type AccountResolution } from '@/lib/influencerAccount';
import { makeGetxapiTweetSource } from '@/lib/tweetSource';
import { analyzeAccount, makeAnthropicChat, AnalysisFormatError } from '@/lib/influencerAnalysis';

// 수집(최대 ~10콜) + LLM 6콜이라 1~2분 걸릴 수 있다 — 코드베이스 첫 maxDuration 사용.
// Vercel 플랜별 상한이 다르므로 배포 전 플랜 확인(스펙 §3 저장).
export const maxDuration = 300;

const notFound = () => NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();

  const sql = getSql();
  const inf = await findInfluencerById(sql, id);
  if (!inf) return notFound();
  const client = makeClient();

  // x_user_id가 없으면 여기서 해결하고 진행 — 버튼을 두 번 누르게 하지 않는다(스펙 §3).
  // 판정·문구는 refresh와 동일 규칙(resolveAccount 공유).
  let userId = inf.xUserId;
  if (!userId) {
    let r: AccountResolution;
    try {
      r = await resolveAccount(sql, inf, client);
    } catch (e) {
      console.error('[influencer] 분석 전 계정 확인 실패', {
        handle: inf.handle, err: e instanceof Error ? e.message : String(e),
      });
      return NextResponse.json(
        { error: '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
    }
    if (r.status === 'not_found') {
      return NextResponse.json(
        { error: 'X에서 이 핸들을 찾을 수 없어요 — 개명했다면 새 핸들로 추가하면 이 기록에 이어져요' },
        { status: 409 });
    }
    if (r.status === 'handle_taken') {
      return NextResponse.json(
        { error: '이 핸들은 현재 다른 계정이 쓰고 있어요 — 분석하지 않았어요' }, { status: 409 });
    }
    await applyProfileSnapshot(sql, inf.id, r.info);
    userId = r.info.id;
  }

  // 수집·LLM 동안 DB 커넥션을 잡지 않는다(풀 고갈 전례) — 저장은 성공 시 마지막 1회.
  try {
    const analysis = await analyzeAccount(
      { source: makeGetxapiTweetSource(client), chat: makeAnthropicChat() }, userId as string);
    await saveAnalysis(sql, id, analysis);
    return NextResponse.json({ analysis, analyzedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof LLMRefusalError) {
      return NextResponse.json({ error: '분석 요청이 거절됐어요 — 내용을 바꿔 다시 시도해 주세요' }, { status: 400 });
    }
    if (e instanceof AnalysisFormatError) {
      return NextResponse.json({ error: 'AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해 주세요' }, { status: 502 });
    }
    console.error('[influencer] 계정 분석 실패', {
      handle: inf.handle, err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: 'X에서 글을 가져오지 못했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
  }
}
```

- [ ] **Step 4: 타입·기존 테스트 확인**

Run: `npx tsc --noEmit 2>&1 | head -10 && npx tsx --test src/lib/influencerStore.test.ts`
Expected: 타입 에러 0, 스토어 테스트 PASS. (라우트 하네스는 없다 — 관례. 로직은 T5·T7 테스트가 덮는다.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/influencerAccount.ts "src/app/api/influencers/[id]/refresh/route.ts" "src/app/api/influencers/[id]/analyze/route.ts"
git commit -m "feat(influencer): 계정 분석 라우트 + 계정 3분기 판정 공유화(refresh와 동일 규칙)"
```

---

### Task 9: pricing PATCH 라우트

**Files:**
- Modify: `src/app/api/influencers/[id]/route.ts` (PATCH 확장)

**Interfaces:**
- Consumes: `parsePricingPatch` (T2 `@/lib/influencerPricing`), `updatePricing` (T6 `@/lib/influencerStore`).
- Produces: PATCH body에 `pricing`(바뀐 키만) 수용. 응답: 기존 Row에 더해 `pricing`·`pricingLogs`를 싣는다 — `{ ...influencerRow, pricing: Pricing, pricingLogs: InfluencerLogRow[] }`. `pricingLogs`는 이번 PATCH가 만든 auto 로그(타임라인에 즉시 붙일 것, 없으면 빈 배열).

- [ ] **Step 1: PATCH 확장** — 기존 검증 블록 아래에 추가:

```ts
import { parsePricingPatch } from '@/lib/influencerPricing';
import { updatePricing } from '@/lib/influencerStore';
```

```ts
  // pricing: 바뀐 키만 온다 — 서버가 병합(스펙 §2 부분 병합). 검증 실패는 400.
  let pricingPatch = null;
  if (body.pricing !== undefined) {
    pricingPatch = parsePricingPatch(body.pricing);
    if (pricingPatch === null) {
      return NextResponse.json({ error: '단가 형식이 올바르지 않아요' }, { status: 400 });
    }
  }
```

기존 `updateInfluencer` 호출 뒤(같은 PATCH에 note·tags·pricing이 섞여 와도 동작):

```ts
  let pricingResult: Awaited<ReturnType<typeof updatePricing>> | null = null;
  if (pricingPatch !== null) {
    pricingResult = await updatePricing(sql, id, pricingPatch, gate.member.id);
  }
  const row = await findInfluencerById(sql, id);
  return NextResponse.json(pricingResult
    ? { ...row, pricing: pricingResult.pricing, pricingLogs: pricingResult.logs }
    : row);
```

주의: `gate.member.id` — requireMember의 반환 형태를 파일 상단에서 확인하고 실제 필드명을 쓴다(다른 라우트에서 author_id를 어떻게 얻는지 `src/app/api/influencers/[id]/logs/route.ts` POST를 그대로 따라할 것).
`body` 타입 캐스트에 `pricing?: unknown` 추가.

- [ ] **Step 2: 타입 확인 + 스토어 테스트 회귀**

Run: `npx tsc --noEmit 2>&1 | head -10 && npx tsx --test src/lib/influencerStore.test.ts`
Expected: 에러 0, PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/influencers/[id]/route.ts"
git commit -m "feat(influencer): PATCH에 단가 부분 병합 수용 — 변경 로그를 응답에 동봉"
```

---

### Task 10: 협찬 단가 섹션 UI

**Files:**
- Create: `src/app/influencers/PricingSection.tsx`
- Modify: `src/app/influencers/InfluencerProfile.tsx` (섹션 배치 + autoText/groupText 케이스 + 로그 상태 배선)

**Interfaces:**
- Consumes: `Pricing`·`PRICE_TYPES`·`PRICE_TYPE_LABEL`·`CURRENCY_LABEL`·`normalizeCurrency`·`formatMoney`·`Currency`·`PriceType`·`PricingChange` (T2 `@/lib/influencerPricing`), `InfluencerLogRow`·`LogPayload` (T6), PATCH 응답 `pricingLogs` (T9).
- Produces: `<PricingSection id={id} pricing={detail.pricing} logs={data.logs} onSaved={(pricing, newLogs) => ...} />` — 부모(InfluencerProfile)가 `data.pricing` 갱신 + `newLogs`를 `data.logs` 앞에 붙인다.

**UI 규칙(스펙 §2, AGENTS.md 원칙):**
- 제목 "협찬 단가", 도움말 "유형별 1건당 단가예요. 바꾸면 아래 기록에 변경 이력이 남아요."
- 통화 select(₩ 원화/¥ 엔화) — 바꾸면 즉시 PATCH `{currency}`.
- 유형 4행: 라벨 + 금액 input(`inputMode="numeric"`, 공란 placeholder "미정"). blur 시 값이 바뀐 경우만 PATCH `{[type]: value|null}`. 저장 중 중복 전송 금지(태그 패턴 — busy ref). 실패 시 role="alert" 빨간 문구 + 입력값 유지(거짓 성공 방지).
- 각 행 ▸ 버튼(aria-expanded): 그 유형의 `pricing_changed` 로그만 필터해 "300,000원 → 350,000원 · 8/24" 줄 나열. 이력 없으면 버튼 자체를 두지 않는다(거짓 어포던스 방지).
- 입력 파싱: 콤마·공백 제거 후 정수, 비우면 null. 잘못된 입력(음수·문자)은 저장하지 않고 "숫자만 입력해 주세요" 안내.

- [ ] **Step 1: PricingSection 구현** — `src/app/influencers/PricingSection.tsx`

```tsx
'use client';
import { useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { kstMonthDay } from '@/lib/datetime';
import {
  CURRENCY_LABEL, PRICE_TYPES, PRICE_TYPE_LABEL, formatMoney, normalizeCurrency,
  type Currency, type Pricing, type PriceType, type PricingChange,
} from '@/lib/influencerPricing';
import type { InfluencerLogRow } from '@/lib/influencerStore';

// 입력 문자열 → 금액. 비움=null(미정으로 되돌림), 불량은 undefined(저장 안 함).
function parseAmount(s: string): number | null | undefined {
  const t = s.replace(/[,\s]/g, '');
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return undefined;
  return Number(t);
}

export function PricingSection({ id, pricing, logs, onSaved }: {
  id: string;
  pricing: Pricing;
  logs: InfluencerLogRow[];
  onSaved: (pricing: Pricing, newLogs: InfluencerLogRow[]) => void;
}) {
  const currency = normalizeCurrency(pricing);
  // 입력 중 텍스트는 로컬, 확정값은 부모 pricing이 단일 출처 — blur 저장 성공 시 부모가 갱신한다.
  const [drafts, setDrafts] = useState<Partial<Record<PriceType, string>>>({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  async function save(patch: Pricing) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const r = await apiFetch(`/api/influencers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricing: patch }),
      });
      if (!r.ok) {
        setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
        return;
      }
      const body = (await r.json()) as { pricing: Pricing; pricingLogs: InfluencerLogRow[] };
      setErr('');
      onSaved(body.pricing, body.pricingLogs);
    } catch {
      setErr('단가를 저장하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function onBlur(t: PriceType) {
    const raw = drafts[t];
    if (raw === undefined) return;                 // 만진 적 없음
    const amount = parseAmount(raw);
    if (amount === undefined) { setErr('숫자만 입력해 주세요'); return; }
    setDrafts((d) => { const n = { ...d }; delete n[t]; return n; });
    if (amount === (pricing[t] ?? null)) return;   // 값이 안 바뀌면 보내지 않는다
    save({ [t]: amount });
  }

  return (
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-ui font-bold">협찬 단가</h2>
        <select value={currency} aria-label="통화"
                onChange={(e) => { const c = e.target.value as Currency; if (c !== currency) save({ currency: c }); }}
                className="rounded-lg border border-x-border-strong bg-white px-1.5 py-0.5 text-caption outline-none focus:border-x-blue">
          {(Object.keys(CURRENCY_LABEL) as Currency[]).map((c) => (
            <option key={c} value={c}>{c === 'KRW' ? '₩ 원화' : '¥ 엔화'}</option>
          ))}
        </select>
        {saving && <span className="text-caption text-x-muted">저장 중…</span>}
      </div>
      <p className="text-caption text-x-muted">유형별 1건당 단가예요. 바꾸면 아래 기록에 변경 이력이 남아요.</p>
      <ul className="mt-1.5 space-y-1">
        {PRICE_TYPES.map((t) => (
          <PriceRow key={t} type={t} currency={currency}
                    value={drafts[t] ?? (pricing[t] != null ? String(pricing[t]) : '')}
                    history={logs.filter((l) => l.eventType === 'pricing_changed'
                      && (l.payload as PricingChange | null)?.priceType === t)}
                    onChange={(v) => setDrafts((d) => ({ ...d, [t]: v }))}
                    onBlur={() => onBlur(t)} />
        ))}
      </ul>
      {err && <p role="alert" className="mt-1 text-caption text-red-500">{err}</p>}
    </section>
  );
}

function PriceRow({ type, currency, value, history, onChange, onBlur }: {
  type: PriceType; currency: Currency; value: string;
  history: InfluencerLogRow[];
  onChange: (v: string) => void; onBlur: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-ui text-x-secondary">{PRICE_TYPE_LABEL[type]}</span>
        <input value={value} inputMode="numeric" placeholder="미정"
               aria-label={`${PRICE_TYPE_LABEL[type]} 단가`}
               onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
               className="w-32 rounded-lg border border-x-border-strong px-2 py-1 text-right text-ui outline-none focus:border-x-blue" />
        <span className="text-ui text-x-muted">{CURRENCY_LABEL[currency]}</span>
        {history.length > 0 && (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
                  className="text-caption text-x-muted hover:text-x-secondary">
            {open ? '▾' : '▸'} 이력 {history.length}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-0.5 pl-[72px]">
          {history.map((l) => {
            const p = l.payload as PricingChange;
            const fmt = (v: number | string | null) =>
              v === null ? '미정' : formatMoney(v as number, p.currency);
            return (
              <li key={l.id} className="text-caption text-x-muted">
                {fmt(p.from)} → {fmt(p.to)} · {kstMonthDay(l.createdAt)}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 2: InfluencerProfile 배선**

(1) import: `PricingSection`, `formatMoney`·`CURRENCY_LABEL`·`PRICE_TYPE_LABEL` 등은 autoText용으로 `@/lib/influencerPricing`에서, `PricingChange` 타입도.
(2) `NoteEditor` 아래에 배치:
```tsx
      <PricingSection id={id} pricing={data.pricing} logs={data.logs}
                      onSaved={(pricing, newLogs) => {
                        setData((d) => (d ? { ...d, pricing, logs: [...newLogs, ...d.logs] } : d));
                      }} />
```
(3) `autoText`에 케이스 추가 (switch 안):
```tsx
    case 'pricing_changed': {
      const p = l.payload as PricingChange | null;
      if (!p) return <>단가 변경</>;
      if (p.priceType === 'currency') {
        return <>단가 통화 {p.from === 'JPY' ? '엔화' : '원화'} → {p.to === 'JPY' ? '엔화' : '원화'}</>;
      }
      const fmt = (v: number | string | null) => (v === null ? '미정' : formatMoney(v as number, p.currency));
      return <>{PRICE_TYPE_LABEL[p.priceType]} 단가 {fmt(p.from)} → {fmt(p.to)}</>;
    }
```
(4) `groupText`에 `case 'pricing_changed': return `단가 변경 ${n}건`;` 추가.
(5) `InfluencerDetail`의 pricing은 T6에서 추가됨 — `data.pricing`으로 접근.

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit 2>&1 | head -10 && npm run lint 2>&1 | tail -3`
Expected: 타입 에러 0, 경고 수 기존 기준선(24) 유지.

- [ ] **Step 4: Commit**

```bash
git add src/app/influencers/PricingSection.tsx src/app/influencers/InfluencerProfile.tsx
git commit -m "feat(influencer): 협찬 단가 섹션 — 유형 4행·통화 선택·blur 저장·유형별 이력 펼침·타임라인 문구"
```

---

### Task 11: 계정 분석 섹션 UI

**Files:**
- Create: `src/app/influencers/AnalysisSection.tsx`
- Modify: `src/app/influencers/InfluencerProfile.tsx` (현황 스트립 아래 배치)

**Interfaces:**
- Consumes: `InfluencerAnalysis` (T6 `@/lib/influencerStore`), `judgeCadence`·`judgeEngagement` (T4 `@/lib/influencerJudgment`), `CONTENT_TYPE_LABEL` (T3 `@/lib/analysisStats`), `formatCount` (`@/lib/format`), `kstMonthDay` (`@/lib/datetime`), `relTime` (`@/lib/relTime`), analyze 라우트 (T8: POST → `{analysis, analyzedAt}` | `{error}`).
- Produces: `<AnalysisSection id={id} analysis={data.analysis} analyzedAt={data.analyzedAt} followers={inf.followersCount} onAnalyzed={(analysis, analyzedAt) => ...} />` — 부모가 `data.analysis`/`data.analyzedAt` 갱신.

**UI 규칙(스펙 §3):**
- 제목 "계정 분석".
- 미분석: primary 버튼 "계정 분석" + 도움말 "최근 3개월 글(최대 100건)을 X에서 받아와 주제·반응 수준을 분석해요 — 1~2분 걸려요."
- 실행 중: 버튼 disabled "분석 중… (1~2분)".
- 실패: role="alert" 안내띠(서버 error 문구 그대로) + 기존 결과 보존.
- 분석됨(위→아래):
  - 캡션: "최근 {count}건 · {kstMonthDay(since)}~{kstMonthDay(until)} 기준 · {relTime(analyzedAt,'분석')}" + count>classified면 " · 이 중 {classified}건 분석됨" + subtle 버튼 "다시 분석".
  - 수치 줄 3개: ① `judgeCadence(perWeek, count)` — caution이면 앰버 배경 칩(색만으로 전하지 않기 — 문구가 판단을 담고 있음) ② `judgeEngagement(medianViews, followers)` + 좋아요 중앙값 병기 ③ 구성 "원글 {n} · RT {n} · 인용 {n}" (건수 그대로 — 라벨-값 일치).
  - 주제 칩: `topics.map` — "{tag} {count}건 · 조회 중앙값 {formatCount(medianViews)}" (medianViews null이면 건수만).
  - 서술 3블록(제목 굵게 + 본문): "성향·톤" tone / "반응이 좋은 글" patterns / "협찬 관찰" sponsorship. summary null이면(0건) "최근 3개월 게시물이 없어요 — 활동이 없는 계정일 수 있어요"만.
  - typeDist 표시: "유형: 후기·체험 30 · 정보 18 …" 한 줄(건수, `CONTENT_TYPE_LABEL` 라벨).
- 분석 결과는 읽기 전용 — 수정 UI 없음(사람 판단은 태그·고정 메모, 스펙 §3).

- [ ] **Step 1: AnalysisSection 구현** — `src/app/influencers/AnalysisSection.tsx`

```tsx
'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatCount } from '@/lib/format';
import { kstMonthDay } from '@/lib/datetime';
import { relTime } from '@/lib/relTime';
import { judgeCadence, judgeEngagement } from '@/lib/influencerJudgment';
import { CONTENT_TYPE_LABEL, type ContentType } from '@/lib/analysisStats';
import type { InfluencerAnalysis } from '@/lib/influencerStore';

export function AnalysisSection({ id, analysis, analyzedAt, followers, onAnalyzed }: {
  id: string;
  analysis: InfluencerAnalysis | null;
  analyzedAt: string | null;
  followers: number | null;
  onAnalyzed: (analysis: InfluencerAnalysis, analyzedAt: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

  // X 수집 + LLM 분석 = 비용 액션 — 버튼으로만(AGENTS.md ⑥). 실패해도 기존 결과는 지우지 않는다.
  async function run() {
    if (running) return;
    setRunning(true);
    setErr('');
    try {
      const r = await apiFetch(`/api/influencers/${id}/analyze`, { method: 'POST' });
      const body = (await r.json().catch(() => ({}))) as {
        analysis?: InfluencerAnalysis; analyzedAt?: string; error?: string;
      };
      if (!r.ok || !body.analysis) {
        setErr(body.error ?? `분석하지 못했어요 (오류 ${r.status})`);
        return;
      }
      onAnalyzed(body.analysis, body.analyzedAt ?? new Date().toISOString());
    } catch {
      setErr('분석하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-ui font-bold">계정 분석</h2>
        {analysis && (
          <>
            <span className="text-caption text-x-muted">
              최근 {analysis.sample.count}건 · {kstMonthDay(analysis.sample.since)}~{kstMonthDay(analysis.sample.until)} 기준
              {analyzedAt && <> · {relTime(analyzedAt, '분석')}</>}
              {analysis.sample.count > analysis.sample.classified &&
                <> · 이 중 {analysis.sample.classified}건 분석됨</>}
            </span>
            <Button variant="subtle" className="ml-auto shrink-0" onClick={run} disabled={running}>
              {running ? '분석 중… (1~2분)' : '다시 분석'}
            </Button>
          </>
        )}
      </div>

      {!analysis && (
        <div className="mt-1">
          <p className="text-caption text-x-muted">
            최근 3개월 글(최대 100건)을 X에서 받아와 주제·반응 수준을 분석해요 — 1~2분 걸려요.
          </p>
          <Button variant="primary" className="mt-1.5" onClick={run} disabled={running}>
            {running ? '분석 중… (1~2분)' : '계정 분석'}
          </Button>
        </div>
      )}

      {err && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">{err}</p>}

      {analysis && <AnalysisResult analysis={analysis} followers={followers} />}
    </section>
  );
}

function AnalysisResult({ analysis, followers }: { analysis: InfluencerAnalysis; followers: number | null }) {
  const { stats, sample, topics, summary } = analysis;
  const cadence = judgeCadence(stats.perWeek, sample.count);
  const types = (Object.entries(stats.typeDist) as Array<[ContentType, number]>)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mt-2 space-y-2">
      <p className={`inline-block rounded-full px-2.5 py-0.5 text-ui ${
        cadence.caution ? 'bg-amber-50 text-amber-800' : 'bg-x-surface text-x-secondary'
      }`}>{cadence.label}</p>

      {sample.count > 0 && (
        <>
          <p className="text-ui text-x-secondary">
            {judgeEngagement(stats.medianViews, followers)}
            {stats.medianLikes !== null && <> · 좋아요 중앙값 {formatCount(stats.medianLikes)}</>}
          </p>
          <p className="text-ui text-x-secondary">
            구성: 원글 {stats.mix.original} · RT {stats.mix.retweet} · 인용 {stats.mix.quote}
            {types.length > 0 && <> · 유형: {types.map(([k, v]) => `${CONTENT_TYPE_LABEL[k]} ${v}`).join(' · ')}</>}
          </p>
        </>
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <span key={t.tag} className="rounded-full border border-x-border-strong px-2 py-0.5 text-ui">
              {t.tag} <span className="text-x-muted">{t.count}건{t.medianViews !== null &&
                ` · 조회 중앙값 ${formatCount(t.medianViews)}`}</span>
            </span>
          ))}
        </div>
      )}

      {summary && (
        <dl className="space-y-1.5 text-ui">
          <div><dt className="font-bold">성향·톤</dt><dd className="text-x-secondary">{summary.tone}</dd></div>
          <div><dt className="font-bold">반응이 좋은 글</dt><dd className="text-x-secondary">{summary.patterns}</dd></div>
          <div><dt className="font-bold">협찬 관찰</dt><dd className="text-x-secondary">{summary.sponsorship}</dd></div>
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 2: InfluencerProfile 배선** — 현황 스트립 div 바로 아래(msg 위):

```tsx
      <AnalysisSection id={id} analysis={data.analysis} analyzedAt={data.analyzedAt}
                       followers={inf.followersCount}
                       onAnalyzed={(analysis, analyzedAt) => {
                         setData((d) => (d ? { ...d, analysis, analyzedAt } : d));
                       }} />
```

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit 2>&1 | head -10 && npm run lint 2>&1 | tail -3`
Expected: 타입 에러 0, 경고 기준선 유지.

- [ ] **Step 4: Commit**

```bash
git add src/app/influencers/AnalysisSection.tsx src/app/influencers/InfluencerProfile.tsx
git commit -m "feat(influencer): 계정 분석 섹션 — opt-in 버튼·판단문 수치·주제 칩·서술 3블록"
```

---

### Task 12: 통합 검증

**Files:** 없음(검증만). 발견된 결함은 이 태스크에서 고친다.

- [ ] **Step 1: 전체 테스트**

Run: `npm test 2>&1 | tail -15`
Expected: 전부 PASS (~4분, 실 DB).

- [ ] **Step 2: 린트 기준선**

Run: `npm run lint 2>&1 | tail -5`
Expected: 기존 24개 경고에서 증가 없음(표 컨테이너 예외 2건 포함 기준선).

- [ ] **Step 3: 빌드**

Run: `npm run build 2>&1 | tail -10`
Expected: 성공. `/api/influencers/[id]/analyze` 라우트가 목록에 보임.

- [ ] **Step 4: 로컬 실동작 스모크 (관례: next dev 금지)**

Run: `npm run build && (npx next start -p 3001 &) && sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/influencers`
Expected: 200 또는 307(OAuth 리다이렉트 — 게이팅 때문에 화면 확인은 koo만 가능).
종료: `kill %1` 또는 `pkill -f "next start -p 3001"`.

- [ ] **Step 5: Commit (수정이 있었으면)**

```bash
git add -A && git commit -m "fix(influencer): 통합 검증 반영"
```

---

## 배포 메모 (구현 완료 후, koo 승인 뒤에만)

1. `.vercel/project.json`이 cb-x-deck인지 확인(링크 함정 메모) — 이 워크트리는 확인됨.
2. main 머지 → `vercel --prod`(CLI 배포 관례) 또는 push 후 Vercel 자동 배포.
3. Vercel 프로젝트 env에 `ANALYSIS_CLASSIFY_MODEL`/`ANALYSIS_SYNTH_MODEL`은 **설정하지 않아도 된다**(코드 기본값). 설정 시 모델 ID 유효성 주의.
4. maxDuration=300이 플랜 상한 내인지 확인(첫 사용).
5. 마이그레이션 028은 T1에서 이미 프로덕션 적용됨.
