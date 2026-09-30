import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeInfluencer, sortPerfRows, firstDir, parsePerfQuery, perfQueryString, DEFAULT_QUERY,
  taskEngagement, taskCpv, formatMetric, buildPerfRows, taskPerfState, perfEmptyReason,
  filterTasks, filterRows, buildFilteredRows, filterSummary, isFilterOn, EMPTY_FILTER,
  normalizeMinPosted, optionCounts, selectionLabel, toggleType,
  type PerfTask, type PerfFilter, type PerfInfluencerInput, type PerfTaskMetrics,
} from './influencerPerformance.ts';

const m = (views: number | null, x: Partial<PerfTaskMetrics> = {}): PerfTaskMetrics =>
  ({ postCount: 1, views, likes: 10, replies: 2, bookmarks: 3, retweets: 4, quotes: 1, ...x });
let seq = 0;
const task = (x: Partial<PerfTask> = {}): PerfTask => ({
  id: 't' + ++seq, campaignId: 'c1', campaignName: '캠1', type: 'quoteRt', postedAt: '2026-09-10',
  postUrl: 'https://x.com/a/status/1', cost: { amount: 10000, currency: 'KRW' }, metrics: m(1000),
  removedAt: null, removedReason: '', clientId: 'k1', clientName: '백수약국', ...x,
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
});

test('중앙값·평균 — 짝수 표본', () => {
  const r = summarizeInfluencer(inf([task({ metrics: m(100) }), task({ metrics: m(300) }), task({ metrics: m(1100) }), task({ metrics: m(500) })]));
  assert.equal(r.stats.views.median, 400);
  assert.equal(r.stats.views.mean, 500);
});

test('조회 null 작업은 표본 제외', () => {
  const r = summarizeInfluencer(inf([task({ metrics: m(1000) }), task({ metrics: m(null) }), task({ metrics: null })]));
  assert.equal(r.stats.views.n, 1);
  assert.equal(r.typeCounts.quoteRt, 3);         // 게시는 했으니 건수엔 센다
});

test('유형별 건수는 게시된 작업만(RT 포함) — 예정 작업은 안 센다(스펙 §12-3)', () => {
  const r = summarizeInfluencer(inf([
    task({ metrics: m(1000) }),
    task({ postedAt: null, postUrl: null, metrics: null }),                 // 예정
    task({ postedAt: null, postUrl: 'https://x.com/a/status/2' }),          // 링크만 있어도 게시
    task({ type: 'rt', postedAt: '2026-09-11', postUrl: null, metrics: null }),
    task({ type: 'rt', postedAt: null, postUrl: null, metrics: null }),     // 예정 RT
  ]));
  assert.equal(r.typeCounts.quoteRt, 2);
  assert.equal(r.typeCounts.rt, 1);
  assert.equal(r.tasks.length, 5);               // 펼친 목록엔 예정 작업도 그대로
});

test('삭제된 게시물 — 성과 표본에서 빠지고 건수엔 센다(스펙 §12-4)', () => {
  const r = summarizeInfluencer(inf([
    task({ metrics: m(1000) }),
    task({ metrics: m(999999), removedAt: '2026-09-15', removedReason: '광고 표기 누락' }),
  ]));
  assert.equal(r.typeCounts.quoteRt, 2);
  assert.equal(r.stats.views.n, 1);
  assert.equal(r.stats.views.median, 1000);
  assert.equal(r.stats.cpv.n, 1);
  assert.equal(r.stats.engagement.n, 1);
  assert.equal(r.stats.likes.n, 1);
});

test('대상 행 = 게시된 작업이 1건 이상인 인플(스펙 §12-3)', () => {
  const rows = buildPerfRows([
    inf([task()], { handle: 'posted' }),
    inf([task({ postedAt: null, postUrl: null, metrics: null })], { handle: 'planned' }),
    inf([task({ type: 'rt', postedAt: '2026-09-11', postUrl: null, metrics: null })], { handle: 'rtOnly' }),
  ]);
  assert.deepEqual(rows.map((r) => r.handle), ['posted', 'rtOnly']);
});

test('펼침 성과 자리 — 삭제됨이 수집 전보다 우선', () => {
  assert.equal(taskPerfState(task({ removedAt: '2026-09-15', metrics: null })), 'removed');
  assert.equal(taskPerfState(task({ removedAt: '2026-09-15', metrics: m(1000) })), 'removed');
  assert.equal(taskPerfState(task({ type: 'rt', removedAt: '2026-09-15' })), 'removed');
  assert.equal(taskPerfState(task({ type: 'rt' })), 'rt');
  assert.equal(taskPerfState(task({ postedAt: null, postUrl: null, metrics: null })), 'unposted');
  assert.equal(taskPerfState(task({ metrics: m(null) })), 'uncollected');
  assert.equal(taskPerfState(task({ metrics: null })), 'uncollected');
  assert.equal(taskPerfState(task()), 'ok');
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

test('캠페인 수는 게시된 작업이 있는 서로 다른 캠페인, 최근 게시일은 게시된 작업만', () => {
  const r = summarizeInfluencer(inf([
    task({ campaignId: 'c1', postedAt: '2026-09-03' }), task({ campaignId: 'c1', postedAt: '2026-09-20' }),
    task({ campaignId: 'c2', postedAt: null, postUrl: null, metrics: null }),
    task({ campaignId: 'c3', type: 'rt', postedAt: '2026-09-05', postUrl: null, metrics: null }),
  ]));
  assert.equal(r.campaignCount, 2);                // c1·c3 — 예정만 있는 c2는 안 센다
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
  const q = { ...DEFAULT_QUERY, sort: 'cpv' as const, dir: 'asc' as const, agg: 'mean' as const };
  const s = perfQueryString(q);
  const p = new URLSearchParams(s);
  assert.deepEqual(parsePerfQuery((k) => p.get(k)), q);
  assert.equal(perfQueryString(DEFAULT_QUERY), '');
  assert.deepEqual(parsePerfQuery((k) => ({ sort: 'zzz', dir: 'up', agg: 'x' } as Record<string, string>)[k] ?? null), DEFAULT_QUERY);
  // sort만 있고 dir이 없으면 그 열의 첫 방향
  assert.deepEqual(parsePerfQuery((k) => (k === 'sort' ? 'cpv' : null)), { ...DEFAULT_QUERY, sort: 'cpv', dir: 'asc' });
});

test('표시 포맷', () => {
  assert.equal(formatMetric('views', null), '—');
  assert.equal(formatMetric('engagement', 0.0254), '2.5%');
  assert.equal(formatMetric('cpv', 4.06), '4.1원');
  assert.equal(formatMetric('cpv', 0.0095), '0.01원');   // 1원 미만은 0.0원으로 뭉개지지 않게 둘째 자리까지
  assert.equal(formatMetric('likes', 210.5), '211');
  // 큰 수는 축약 없이 쉼표 전체 숫자(스펙 §13.3)
  assert.equal(formatMetric('views', 12000), '12,000');
  assert.equal(formatMetric('views', 528625), '528,625');
  assert.equal(formatMetric('views', 5611.4), '5,611');
  assert.equal(formatMetric('bookmarks', 1234), '1,234');
});

test('참여율 0.1% 미만은 둘째 자리 — 0으로 뭉개지지 않게(스펙 §18-2)', () => {
  assert.equal(formatMetric('engagement', 0.0003), '0.03%');
  assert.equal(formatMetric('engagement', 0.00096), '0.10%');
  assert.equal(formatMetric('engagement', 0), '0.0%');
  assert.equal(formatMetric('engagement', 0.001), '0.1%');
  assert.equal(formatMetric('engagement', 0.0123), '1.2%');
});

test('성과 없는 이유 — 성과가 있으면 null, RT만 > 삭제 > 수집 전(스펙 §18-4)', () => {
  const RT = 'RT만 진행해 성과가 없어요 — 조회는 원글에 쌓여요';
  assert.equal(perfEmptyReason(summarizeInfluencer(inf([task()]))), null);
  // 삭제된 것이 있어도 다른 게시물 성과가 있으면 이유를 말하지 않는다
  assert.equal(perfEmptyReason(summarizeInfluencer(inf([task(), task({ removedAt: '2026-09-12' })]))), null);
  assert.equal(perfEmptyReason(summarizeInfluencer(inf([task({ type: 'rt' }), task({ type: 'rt' })]))), RT);
  // 게시물 작업이 예정뿐이면 아직 RT만 한 것
  assert.equal(perfEmptyReason(summarizeInfluencer(inf([task({ type: 'rt' }), task({ postedAt: null, postUrl: null, metrics: null })]))), RT);
  assert.equal(perfEmptyReason(summarizeInfluencer(inf([task({ removedAt: '2026-09-12' }), task({ metrics: null })]))), '게시물이 삭제됐어요');
  assert.equal(perfEmptyReason(summarizeInfluencer(inf([task({ metrics: null }), task({ type: 'rt' })]))), '성과 수집 전이에요');
});

// ── 필터·검색(스펙 §15·§16·§17 — 기간 필터는 뺐다) ──
const f = (x: Partial<PerfFilter> = {}): PerfFilter => ({ ...EMPTY_FILTER, ...x });
const ids = (ts: PerfTask[]) => ts.map((t) => t.id);

test('클라이언트·유형 복수 선택 — 선택 안은 OR, 필터 사이는 AND', () => {
  const ts = [task({ id: 'a', clientId: 'k1' }), task({ id: 'b', clientId: 'k2' }), task({ id: 'c', clientId: null }),
    task({ id: 'd', clientId: 'k1', type: 'rt' }), task({ id: 'e', clientId: 'k3', type: 'visit' })];
  assert.deepEqual(ids(filterTasks(ts, f({ clientIds: ['k1'] }))), ['a', 'd']);
  assert.deepEqual(ids(filterTasks(ts, f({ clientIds: ['k1', 'k2'] }))), ['a', 'b', 'd']);
  assert.deepEqual(ids(filterTasks(ts, f({ types: ['rt'] }))), ['d']);
  assert.deepEqual(ids(filterTasks(ts, f({ types: ['rt', 'visit'] }))), ['d', 'e']);
  assert.deepEqual(ids(filterTasks(ts, f({ clientIds: ['k1', 'k3'], types: ['quoteRt', 'visit'] }))), ['a', 'e']);
  assert.deepEqual(ids(filterTasks(ts, f({ clientIds: [], types: [] }))), ['a', 'b', 'c', 'd', 'e']);
});

test('②가 걸리면 건수·캠페인 수·최근 게시일·성과·작업 목록이 모두 걸러진 작업 기준, 게시 0건이 된 인플은 빠진다', () => {
  const rows = buildFilteredRows([
    inf([
      task({ id: 'a', campaignId: 'c1', clientId: 'k1', postedAt: '2026-09-20', metrics: m(1000) }),
      task({ id: 'b', campaignId: 'c2', clientId: 'k2', postedAt: '2026-09-25', metrics: m(9000) }),
      task({ id: 'c', campaignId: 'c3', clientId: 'k1', type: 'rt', postedAt: '2026-09-10', postUrl: null, metrics: null }),
    ], { handle: 'rio' }),
    inf([task({ clientId: 'k2' })], { handle: 'other' }),
  ], f({ clientIds: ['k1'] }));
  assert.deepEqual(rows.map((r) => r.handle), ['rio']);
  const r = rows[0];
  assert.deepEqual(r.typeCounts, { post: 0, quoteRt: 1, rt: 1, visit: 0 });
  assert.equal(r.campaignCount, 2);
  assert.equal(r.lastPostedAt, '2026-09-20');
  assert.equal(r.stats.views.median, 1000);
  assert.equal(r.stats.views.n, 1);
  assert.deepEqual(r.tasks.map((t) => t.id), ['a', 'c']);
});

test('필터 없음 = 기존 buildPerfRows와 같다', () => {
  const inputs = [inf([task(), task({ postedAt: null, postUrl: null, metrics: null })]), inf([task({ postedAt: null, postUrl: null })], { handle: 'planned' })];
  assert.deepEqual(buildFilteredRows(inputs, EMPTY_FILTER), buildPerfRows(inputs));
});

test('검색 — 핸들·표시 이름, 대소문자 무시, 앞뒤 공백·앞 @ 무시, 부분 일치', () => {
  const rows = buildPerfRows([
    inf([task()], { handle: 'RioSeoul', displayName: '리오' }),
    inf([task()], { handle: 'mina', displayName: '미나 Kim' }),
    inf([task()], { handle: 'ghost', displayName: null }),
  ]);
  const hs = (q: string) => filterRows(rows, f({ q })).map((r) => r.handle);
  assert.deepEqual(hs('rios'), ['RioSeoul']);
  assert.deepEqual(hs('  @RIO '), ['RioSeoul']);
  assert.deepEqual(hs('리오'), ['RioSeoul']);
  assert.deepEqual(hs('kim'), ['mina']);
  assert.deepEqual(hs('   '), ['RioSeoul', 'mina', 'ghost']);
  assert.deepEqual(hs('zzz'), []);
});

test('최소 게시 수 정규화 — 비움·0·음수·소수는 1, 정수는 그대로', () => {
  for (const raw of ['', '0', '-1', '1.5', 'abc', '1', ' ']) assert.equal(normalizeMinPosted(raw), 1, `'${raw}'`);
  assert.equal(normalizeMinPosted('3'), 3);
  assert.equal(normalizeMinPosted(' 12 '), 12);
  assert.equal(normalizeMinPosted(null), 1);
});

test('최소 게시 수 — 필터 적용 후 게시한 작업 수 기준', () => {
  const inputs = [
    inf([task({ clientId: 'k1' }), task({ clientId: 'k2' }), task({ clientId: 'k2', type: 'rt' })], { handle: 'three' }),
    inf([task(), task({ postedAt: null, postUrl: null, metrics: null })], { handle: 'onePosted' }),
  ];
  assert.deepEqual(buildFilteredRows(inputs, f({ minPosted: 2 })).map((r) => r.handle), ['three']);
  assert.deepEqual(buildFilteredRows(inputs, f({ minPosted: 3 })).map((r) => r.handle), ['three']);
  assert.deepEqual(buildFilteredRows(inputs, f({ minPosted: 4 })).map((r) => r.handle), []);
  // 클라이언트 k2로 거르면 three는 2건 → 3건 이상에서 빠진다
  assert.deepEqual(buildFilteredRows(inputs, f({ clientIds: ['k2'], minPosted: 3 })).map((r) => r.handle), []);
  assert.deepEqual(buildFilteredRows(inputs, f({ clientIds: ['k2'], minPosted: 2 })).map((r) => r.handle), ['three']);
});

test('항목별 숫자 — 다른 필터(다른 쪽 선택·검색) 기준 게시된 작업 수, 자기 선택은 무시', () => {
  const inputs = [
    inf([
      task({ clientId: 'k1', type: 'quoteRt', postedAt: '2026-09-20' }),
      task({ clientId: 'k1', type: 'visit', postedAt: '2026-09-21' }),
      task({ clientId: 'k2', type: 'quoteRt', postedAt: '2026-08-01' }),
      task({ clientId: 'k2', type: 'quoteRt', postedAt: null, postUrl: null, metrics: null }), // 게시 전 — 안 센다
    ], { handle: 'rio' }),
    inf([task({ clientId: 'k2', type: 'rt', postedAt: '2026-09-25', postUrl: null })], { handle: 'mina' }),
  ];
  const all = optionCounts(inputs, f());
  assert.deepEqual(all.client, { k1: 2, k2: 2 });
  assert.deepEqual(all.type, { post: 0, quoteRt: 2, rt: 1, visit: 1 });
  // 유형을 고르면 클라이언트 숫자가 그 유형 기준으로, 유형 숫자는 자기 선택과 무관
  const byType = optionCounts(inputs, f({ types: ['quoteRt'] }));
  assert.deepEqual(byType.client, { k1: 1, k2: 1 });
  assert.deepEqual(byType.type, { post: 0, quoteRt: 2, rt: 1, visit: 1 });
  // 클라이언트를 고르면 유형 숫자가 그 클라이언트 기준
  assert.deepEqual(optionCounts(inputs, f({ clientIds: ['k1'] })).type, { post: 0, quoteRt: 1, rt: 0, visit: 1 });
  // 검색도 반영
  assert.deepEqual(optionCounts(inputs, f({ q: 'mina' })).client, { k2: 1 });
});

test('선택 문구 — 없음=전체, 클라이언트는 2개부터 외 N, 유형은 2개까지 나열', () => {
  assert.equal(selectionLabel([], 1), '전체');
  assert.equal(selectionLabel(['백수약국'], 1), '백수약국');
  assert.equal(selectionLabel(['백수약국', '더스퀘어치과'], 1), '백수약국 외 1');
  assert.equal(selectionLabel(['인용RT', '방문협찬'], 2), '인용RT, 방문협찬');
  assert.equal(selectionLabel(['투고', '인용RT', '방문협찬'], 2), '투고 외 2');
});

test('유형 토글은 표시 순서를 지킨다', () => {
  assert.deepEqual(toggleType(['visit'], 'quoteRt'), ['quoteRt', 'visit']);
  assert.deepEqual(toggleType(['quoteRt', 'visit'], 'quoteRt'), ['visit']);
});

test('주소 쿼리 — 필터 키 왕복·기본값 생략·정렬 키와 함께', () => {
  const q = { ...DEFAULT_QUERY, sort: 'cpv' as const, dir: 'asc' as const, q: '리오',
    clientIds: ['k2', 'k1'], types: ['quoteRt', 'visit'] as PerfFilter['types'], minPosted: 3 };
  const s = perfQueryString(q);
  assert.match(s, /client=k2,k1/);                 // 쉼표 그대로(스펙 §16 주소 모양)
  assert.match(s, /type=quoteRt,visit/);
  const p = new URLSearchParams(s);
  assert.deepEqual(parsePerfQuery((k) => p.get(k)), q);
  assert.equal(p.get('min'), '3');
  // 기본값은 생략
  assert.equal(perfQueryString(DEFAULT_QUERY), '');
  assert.equal(perfQueryString({ ...DEFAULT_QUERY, q: '   ', minPosted: 1, clientIds: [], types: [] }), '');
});

test('주소 쿼리 — 모르는 값은 버린다', () => {
  const bad: Record<string, string> = { type: 'story,visit,,visit', min: '0', client: ',k1,,k1' };
  const got = parsePerfQuery((k) => bad[k] ?? null);
  assert.deepEqual(got, { ...DEFAULT_QUERY, types: ['visit'], clientIds: ['k1'] });
  assert.deepEqual(parsePerfQuery((k) => ({ type: 'visit,quoteRt' } as Record<string, string>)[k] ?? null).types, ['quoteRt', 'visit']);
  assert.deepEqual(parsePerfQuery((k) => (k === 'min' ? '1.5' : null)), DEFAULT_QUERY);
  assert.equal(parsePerfQuery((k) => (k === 'min' ? '4' : null)).minPosted, 4);
});

test('옛 주소의 period·from·to는 조용히 무시한다(스펙 §17) — 결과는 기본 쿼리와 같다', () => {
  const old: Record<string, string> = { period: '30', from: '2026-09-01', to: '2026-09-10' };
  assert.deepEqual(parsePerfQuery((k) => old[k] ?? null), DEFAULT_QUERY);
  const oldWithFilter: Record<string, string> = { period: '7', client: 'k1' };
  assert.deepEqual(parsePerfQuery((k) => oldWithFilter[k] ?? null), { ...DEFAULT_QUERY, clientIds: ['k1'] });
});

test('필터 켜짐 여부·요약 문구', () => {
  assert.equal(isFilterOn(EMPTY_FILTER), false);
  assert.equal(isFilterOn(f({ q: '  ' })), false);
  assert.equal(isFilterOn(f({ minPosted: 2 })), true);
  assert.equal(isFilterOn(f({ types: ['rt'] })), true);
  assert.equal(filterSummary(f({ clientIds: ['k1', 'k2'], types: ['quoteRt'] }), ['백수약국', '더스퀘어치과'], 12),
    '백수약국 외 1 · 인용RT 게시물만으로 계산했어요 · 12명');
  assert.equal(filterSummary(f({ clientIds: ['k1'], types: ['post'] }), ['백수약국'], 4),
    '백수약국 · 투고 게시물만으로 계산했어요 · 4명');
  assert.equal(filterSummary(f({ types: ['quoteRt', 'visit'] }), [], 3), '인용RT, 방문협찬 게시물만으로 계산했어요 · 3명');
  assert.equal(filterSummary(f({ q: ' 리오 ', minPosted: 2 }), [], 1), "'리오' 검색 · 게시 2건 이상 · 1명");
  assert.equal(filterSummary(f({ types: ['rt'], minPosted: 3 }), [], 2), 'RT 게시물만으로 계산했어요 · 게시 3건 이상 · 2명');
});
