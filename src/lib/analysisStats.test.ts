import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median, computeStats, chunk, missingIds, topicStats, typeDist, sponsoredCount, topByViews,
  dailyCounts, computeActivity, medianEngagement,
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

test('dailyCounts: 한국 자정(UTC 15:00)이 날짜를 가른다', () => {
  const counts = dailyCounts([
    tw({ id: 'a', createdAt: '2026-08-23T14:59:59Z' }),  // 한국 8/23 23:59
    tw({ id: 'b', createdAt: '2026-08-23T15:00:00Z' }),  // 한국 8/24 00:00 — 다음 날
    tw({ id: 'c', createdAt: '2026-08-23T23:00:00Z' }),  // 한국 8/24 08:00
  ]);
  assert.deepEqual(counts, { '2026-08-23': 1, '2026-08-24': 2 });
});

test('dailyCounts: 모든 kind를 센다(RT도 계정 활동) · 게시 없는 날은 키 없음 · 빈 입력은 {}', () => {
  const counts = dailyCounts([
    tw({ id: 'a', createdAt: '2026-08-01T03:00:00Z' }),
    tw({ id: 'r', kind: 'retweet', createdAt: '2026-08-01T04:00:00Z' }),
    tw({ id: 'q', kind: 'quote', createdAt: '2026-08-03T04:00:00Z' }),
  ]);
  assert.deepEqual(counts, { '2026-08-01': 2, '2026-08-03': 1 });   // 8/02는 키 자체가 없다
  assert.deepEqual(dailyCounts([]), {});
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
  assert.equal(a.reachedActivitySince, false);  // 캡션이 '상한' / '글이 그만큼'을 가르는 근거
});

test('medianEngagement: 직접 글만 넣는 함수 — null 지표 제외', () => {
  assert.deepEqual(medianEngagement([tw({ views: 100, likes: null }), tw({ views: 300, likes: 4 })]), { medianViews: 200, medianLikes: 4 });
  assert.deepEqual(medianEngagement([]), { medianViews: null, medianLikes: null });
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
