import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeInfluencer, sortPerfRows, firstDir, parsePerfQuery, perfQueryString, DEFAULT_QUERY,
  taskEngagement, taskCpv, formatMetric, buildPerfRows, taskPerfState,
  periodSince, filterTasks, filterRows, buildFilteredRows, filterSummary, isFilterOn, EMPTY_FILTER,
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

// ── 필터·검색(스펙 §15) ──
const NOW = () => Date.parse('2026-09-30T03:00:00Z');   // 서울 2026-09-30 12:00
const f = (x: Partial<PerfFilter> = {}): PerfFilter => ({ ...EMPTY_FILTER, ...x });

test('기간 — 오늘 포함 N일: 오늘·N-1일 전은 들고 N일 전은 빠진다, 게시 전 작업도 빠진다', () => {
  assert.equal(periodSince('all', NOW), null);
  assert.equal(periodSince('30', NOW), '2026-09-01');
  assert.equal(periodSince('90', NOW), '2026-07-03');
  const ts = [
    task({ id: 'today', postedAt: '2026-09-30' }), task({ id: 'edge', postedAt: '2026-09-01' }),
    task({ id: 'out', postedAt: '2026-08-31' }), task({ id: 'planned', postedAt: null, postUrl: null, metrics: null }),
    task({ id: 'linkOnly', postedAt: null }),      // 링크만 있어 '게시됨'이지만 게시일이 없다 → 기간 기준으로 판단 불가라 뺀다
  ];
  assert.deepEqual(filterTasks(ts, f({ period: '30' }), periodSince('30', NOW)).map((t) => t.id), ['today', 'edge']);
  // 기간 전체면 게시 전 작업도 그대로(펼친 목록에 보인다)
  assert.equal(filterTasks(ts, f(), null).length, 5);
});

test('클라이언트·유형 필터 — 작업을 거른다', () => {
  const ts = [task({ id: 'a', clientId: 'k1' }), task({ id: 'b', clientId: 'k2' }), task({ id: 'c', clientId: null }),
    task({ id: 'd', clientId: 'k1', type: 'rt' })];
  assert.deepEqual(filterTasks(ts, f({ client: 'k1' }), null).map((t) => t.id), ['a', 'd']);
  assert.deepEqual(filterTasks(ts, f({ type: 'rt' }), null).map((t) => t.id), ['d']);
  assert.deepEqual(filterTasks(ts, f({ client: 'k1', type: 'quoteRt' }), null).map((t) => t.id), ['a']);
});

test('②가 걸리면 건수·캠페인 수·최근 게시일·성과·작업 목록이 모두 걸러진 작업 기준, 게시 0건이 된 인플은 빠진다', () => {
  const rows = buildFilteredRows([
    inf([
      task({ id: 'a', campaignId: 'c1', clientId: 'k1', postedAt: '2026-09-20', metrics: m(1000) }),
      task({ id: 'b', campaignId: 'c2', clientId: 'k2', postedAt: '2026-09-25', metrics: m(9000) }),
      task({ id: 'c', campaignId: 'c3', clientId: 'k1', type: 'rt', postedAt: '2026-09-10', postUrl: null, metrics: null }),
    ], { handle: 'rio' }),
    inf([task({ clientId: 'k2' })], { handle: 'other' }),
  ], f({ client: 'k1' }), null);
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
  assert.deepEqual(buildFilteredRows(inputs, EMPTY_FILTER, null), buildPerfRows(inputs));
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

test('최소 게시 수 — 필터 적용 후 게시한 작업 수 기준', () => {
  const inputs = [
    inf([task({ clientId: 'k1' }), task({ clientId: 'k2' }), task({ clientId: 'k2', type: 'rt' })], { handle: 'three' }),
    inf([task(), task({ postedAt: null, postUrl: null, metrics: null })], { handle: 'onePosted' }),
  ];
  assert.deepEqual(buildFilteredRows(inputs, f({ min: 2 }), null).map((r) => r.handle), ['three']);
  assert.deepEqual(buildFilteredRows(inputs, f({ min: 3 }), null).map((r) => r.handle), ['three']);
  // 클라이언트 k2로 거르면 three는 2건 → 3건 이상에서 빠진다
  assert.deepEqual(buildFilteredRows(inputs, f({ client: 'k2', min: 3 }), null).map((r) => r.handle), []);
  assert.deepEqual(buildFilteredRows(inputs, f({ client: 'k2', min: 2 }), null).map((r) => r.handle), ['three']);
});

test('주소 쿼리 — 필터 키 왕복·기본값 생략·틀린 값은 기본값·정렬 키와 함께', () => {
  const q = { ...DEFAULT_QUERY, sort: 'cpv' as const, dir: 'asc' as const, q: '리오', period: '90' as const, client: 'k1', type: 'visit' as const, min: 3 as const };
  const s = perfQueryString(q);
  const p = new URLSearchParams(s);
  assert.deepEqual(parsePerfQuery((k) => p.get(k)), q);
  assert.equal(p.get('period'), '90');
  assert.equal(p.get('min'), '3');
  assert.equal(perfQueryString({ ...DEFAULT_QUERY, q: '   ' }), '');   // 공백뿐인 검색은 주소에 안 남긴다
  const bad: Record<string, string> = { period: '7', type: 'story', min: '9', client: '' };
  assert.deepEqual(parsePerfQuery((k) => bad[k] ?? null), DEFAULT_QUERY);
  assert.deepEqual(parsePerfQuery((k) => (k === 'min' ? '1' : null)), DEFAULT_QUERY);
});

test('필터 켜짐 여부·요약 문구', () => {
  assert.equal(isFilterOn(EMPTY_FILTER), false);
  assert.equal(isFilterOn(f({ q: '  ' })), false);
  assert.equal(isFilterOn(f({ min: 2 })), true);
  assert.equal(filterSummary(f({ client: 'k1', period: '30', type: 'post' }), '백수약국', 4),
    '백수약국 · 최근 30일 · 투고 게시물만으로 계산했어요 · 4명');
  assert.equal(filterSummary(f({ period: '90' }), '', 12), '최근 90일 게시물만으로 계산했어요 · 12명');
  assert.equal(filterSummary(f({ q: ' 리오 ', min: 2 }), '', 1), "'리오' 검색 · 게시 2건 이상 · 1명");
  assert.equal(filterSummary(f({ type: 'rt', min: 3 }), '', 2), 'RT 게시물만으로 계산했어요 · 게시 3건 이상 · 2명');
});
