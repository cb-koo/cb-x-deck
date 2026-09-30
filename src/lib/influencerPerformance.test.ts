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
