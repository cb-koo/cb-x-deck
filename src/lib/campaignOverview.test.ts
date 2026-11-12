import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWeek, plannedCount, quantityOf, cardStatus, CARD_STATUS_LABEL, type Quantity, perfOf, formatCpv, chartDays, flowChart, type DayPoint, type FlowChart,
  pickWeekly, pickLong, buildOverview, type OverviewInput } from './campaignOverview.ts';
import type { CampaignTaskItem, CampaignRow } from './campaignStore.ts';
import { weekLabel } from './campaignListView.ts';

let n = 0;
const task = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: null, type: 'post', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '', otherKind: '', doneNote: '',
  proof: null, visitTime: null, scheduledTime: null, agreement: null, paymentMethodId: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null, settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null, costChangeCount: 0,
  createdAt: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null,
  draftPreview: null, draftFirstImage: null, target: null,
  published: false, perf: null, replies: [], linkClicks: null, settlement: null, unseenSince: null, seenAfterRemovedAt: null, ...p,
});

const camp = (over: Partial<CampaignRow>): CampaignRow => ({
  id: 'c', clientId: null, clientName: null, name: '캠페인', nameEn: '', startsOn: '2026-11-09', endsOn: '2026-11-15',
  kind: null, note: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', closedAt: null, closedByName: null,
  taskCount: 0, progress: { planned: 0, posted: 0, assigned: 0, unassigned: 0 }, total: {}, influencerHandles: [], ...over,
});

test('resolveWeek: 주 중 날짜는 그 주 월요일로, 틀린 값과 미래 주는 이번 주', () => {
  const today = '2026-11-12';
  assert.deepEqual(resolveWeek(null, today), { weekStart: '2026-11-09', weekEnd: '2026-11-15', isCurrent: true });
  assert.deepEqual(resolveWeek('2026-11-05', today), { weekStart: '2026-11-02', weekEnd: '2026-11-08', isCurrent: false });
  assert.equal(resolveWeek('2026-11-16', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('garbage', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('2026-13-40', today).weekStart, '2026-11-09');
  assert.equal(resolveWeek('2026-02-30', today).weekStart, '2026-11-09');
  // 이번 주 안의 다른 날도 이번 주
  assert.deepEqual(resolveWeek('2026-11-15', today), { weekStart: '2026-11-09', weekEnd: '2026-11-15', isCurrent: true });
});

test('quantityOf: 취소는 계획에서 빼고 따로 센다, 예정일 지난 것과 미정을 가른다', () => {
  const today = '2026-11-12';
  const tasks = [
    task({ postedAt: '2026-11-10' }),
    task({ scheduledOn: '2026-11-10' }),            // 예정일 지남
    task({ scheduledOn: '2026-11-14' }),
    task({ scheduledOn: null }),                    // 미정
    task({ cancelledAt: '2026-11-09' }),
  ];
  const q = quantityOf(tasks, today);
  assert.deepEqual(q, { planned: 4, posted: 1, overdue: 1, open: 3, undated: 1, cancelled: 1 });
  assert.equal(plannedCount(tasks), 4);
});

test('quantityOf: 게시된 작업은 예정일이 지났거나 없어도 밀림·미정이 아니다', () => {
  const q = quantityOf([task({ postedAt: '2026-11-10', scheduledOn: '2026-11-01' })], '2026-11-12');
  assert.deepEqual(q, { planned: 1, posted: 1, overdue: 0, open: 0, undated: 0, cancelled: 0 });
});

test('cardStatus 네 가지와 문구', () => {
  const q = (o: Partial<Quantity>) => ({ planned: 5, posted: 2, overdue: 0, open: 3, undated: 0, cancelled: 0, ...o });
  assert.equal(cardStatus(q({ planned: 0, posted: 0, open: 0 })), 'unset');
  assert.equal(cardStatus(q({ posted: 5, open: 0 })), 'done');
  assert.equal(cardStatus(q({ overdue: 2 })), 'late');
  assert.equal(cardStatus(q({})), 'onTrack');
  assert.equal(CARD_STATUS_LABEL('late', 2), '예정일 지난 2건');
  assert.equal(CARD_STATUS_LABEL('done', 0), '✓ 계획 완료');
  assert.equal(CARD_STATUS_LABEL('unset', 0), '세팅 전');
  assert.equal(CARD_STATUS_LABEL('onTrack', 0), '예정대로');
});

test('perfOf: 엔화 비용은 원으로 환산, 측정값 없으면 none, 전부 비용 없음이면 free', () => {
  const a = perfOf([
    task({ postedAt: '2026-11-10', cost: { amount: 10000, currency: 'JPY' }, perf: { postCount: 1, views: 100000, likes: 10, bookmarks: 300 } }),
    task({ postedAt: '2026-11-11', cost: { amount: 50000, currency: 'KRW' }, perf: { postCount: 1, views: 50000, likes: 5, bookmarks: 100 } }),
  ]);
  assert.equal(a.views.value, 150000); assert.equal(a.bookmarks.value, 400);
  assert.deepEqual(a.cpv, { kind: 'value', krw: 1 });           // (100,000원 + 50,000원) ÷ 150,000
  assert.equal(formatCpv(a.cpv), '1.0원');
  const noSnap = perfOf([task({ postedAt: '2026-11-12', cost: { amount: 50000, currency: 'KRW' }, perf: null })]);
  assert.equal(noSnap.views.value, null); assert.equal(formatCpv(noSnap.cpv), '-');
  const free = perfOf([task({ postedAt: '2026-11-10', noCost: true, cost: null, perf: { postCount: 1, views: 9000, likes: 1, bookmarks: 20 } })]);
  assert.equal(free.cpv.kind, 'free');
  assert.equal(formatCpv(free.cpv), '0.0원');   // koo 11-12: 무상도 '0.0원'으로(캠페인 화면 표의 0원 표기와 같게)
});
test('perfOf: 비용 0원이 섞이지 않은 무비용·게시 없음은 none, 0원 비용만이면 free', () => {
  // 조회는 있는데 비용 미입력(null) — flowStats는 cpvKrw 0을 주지만 '무상'이 아니다
  const unknown = perfOf([task({ postedAt: '2026-11-10', cost: null, perf: { postCount: 1, views: 9000, likes: 1, bookmarks: 20 } })]);
  assert.deepEqual(unknown.cpv, { kind: 'none' });
  assert.equal(unknown.spentKrw, 0);
  const zero = perfOf([task({ postedAt: '2026-11-10', cost: { amount: 0, currency: 'KRW' }, perf: { postCount: 1, views: 9000, likes: 1, bookmarks: 20 } })]);
  assert.deepEqual(zero.cpv, { kind: 'free' });
  assert.deepEqual(perfOf([task({ noCost: true })]).cpv, { kind: 'none' });   // 게시 전
  assert.equal(formatCpv({ kind: 'value', krw: 12.46 }), '12.5원');
  assert.equal(perfOf([]).views.judgment, null);
});
test('chartDays: 이번 주는 7칸에 오늘까지, 지난 주는 일요일+14일 또는 오늘까지', () => {
  assert.deepEqual(chartDays('2026-11-09', '2026-11-12'), { days: ['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-14','2026-11-15'], todayIndex: 3 });
  const past = chartDays('2026-11-02', '2026-11-12');
  assert.equal(past.days.at(-1), '2026-11-12'); assert.equal(past.todayIndex, past.days.length - 1);
  assert.equal(chartDays('2026-10-05', '2026-11-12').days.at(-1), '2026-10-25');
});
// 모든 차트의 선 끝(todayIndex)은 카드 숫자와 같아야 한다(카드가 '-'면 0)
const assertEndsAtCard = (c: FlowChart, tasks: CampaignTaskItem[]) => {
  const p = perfOf(tasks);
  assert.equal(c.views[c.todayIndex], p.views.value ?? 0);
  assert.equal(c.bookmarks[c.todayIndex], p.bookmarks.value ?? 0);
};
test('flowChart: 측정 없는 날은 앞 값을 잇고, 측정 전은 0, 오늘 뒤는 null, 마지막 점은 최신값', () => {
  const tasks = [
    task({ id: 'a', postedAt: '2026-11-09', perf: { postCount: 1, views: 5200, likes: 0, bookmarks: 52 } }),
    task({ id: 'b', postedAt: '2026-11-11', perf: { postCount: 1, views: 800, likes: 0, bookmarks: 8 } }),
    task({ id: 'c', cancelledAt: '2026-11-09', postedAt: '2026-11-09', perf: { postCount: 1, views: 99999, likes: 0, bookmarks: 0 } }),
  ];
  const pts: DayPoint[] = [
    { taskId: 'a', day: '2026-11-09', views: 1000, bookmarks: 10 },
    { taskId: 'a', day: '2026-11-11', views: 4000, bookmarks: 40 },   // 11/10은 측정 없음
    { taskId: 'b', day: '2026-11-11', views: 500, bookmarks: 5 },
    { taskId: 'c', day: '2026-11-09', views: 99999, bookmarks: 0 },   // 취소 — 제외
  ];
  const c = flowChart(tasks, pts, '2026-11-09', '2026-11-12')!;
  assert.deepEqual(c.views, [1000, 1000, 4500, 6000, null, null, null]);
  assert.deepEqual(c.postedPerDay, [1, 0, 1, 0, 0, 0, 0]);
  assertEndsAtCard(c, tasks);
  assert.equal(flowChart([task({ postedAt: '2026-11-12', perf: null })], [], '2026-11-09', '2026-11-12'), null);
});
test('flowChart: null 점은 건너뛰고 앞 값, 오늘 칸은 카드와 같다(최신값 null인 게시물은 0)', () => {
  const tasks = [task({ id: 'x', postedAt: '2026-11-09', perf: { postCount: 1, views: null, likes: 0, bookmarks: 30 } })];
  const pts: DayPoint[] = [
    { taskId: 'x', day: '2026-11-09', views: 100, bookmarks: 10 },
    { taskId: 'x', day: '2026-11-10', views: null, bookmarks: 20 },
  ];
  const c = flowChart(tasks, pts, '2026-11-09', '2026-11-11')!;
  // 조회 최신값이 null이라 카드 조회는 '-' → 오늘 칸 0(이어온 100을 쓰지 않는다)
  assert.deepEqual(c.views, [100, 100, 0, null, null, null, null]);
  assert.deepEqual(c.bookmarks, [10, 20, 30, null, null, null, null]);
  assertEndsAtCard(c, tasks);
  // 점은 없어도 최신값이 있으면 차트를 그린다
  const only = flowChart(tasks, [], '2026-11-09', '2026-11-11')!;
  assert.deepEqual(only.bookmarks, [0, 0, 30, null, null, null, null]);
  assertEndsAtCard(only, tasks);
  // 점은 있어도 카드에 숫자가 없으면 그리지 않는다
  const blank = [task({ id: 'y', postedAt: '2026-11-09', perf: { postCount: 1, views: null, likes: null, bookmarks: null } })];
  assert.equal(flowChart(blank, [{ taskId: 'y', day: '2026-11-09', views: 50, bookmarks: 1 }], '2026-11-09', '2026-11-11'), null);
});
test('flowChart: 지난 주는 오늘(마지막 칸)에서 선이 끝나고 그 값은 최신값', () => {
  const tasks = [
    task({ id: 'p', postedAt: '2026-11-03', perf: { postCount: 1, views: 7000, likes: 0, bookmarks: 70 } }),
    task({ id: 'q', postedAt: '2026-11-05', perf: { postCount: 1, views: 3000, likes: 0, bookmarks: 30 } }),
  ];
  const pts: DayPoint[] = [
    { taskId: 'p', day: '2026-11-03', views: 2000, bookmarks: 20 },
    { taskId: 'q', day: '2026-11-06', views: 1000, bookmarks: 10 },
    { taskId: 'p', day: '2026-11-10', views: 6000, bookmarks: 60 },
  ];
  const c = flowChart(tasks, pts, '2026-11-02', '2026-11-12')!;
  assert.equal(c.days.at(-1), '2026-11-12');
  assert.equal(c.todayIndex, c.days.length - 1);
  assert.equal(c.views[c.todayIndex], 10000); assert.equal(c.bookmarks[c.todayIndex], 100);
  assert.equal(c.views[c.days.indexOf('2026-11-09')], 3000);   // 2000 + 1000 이어옴
  assert.equal(c.views.filter((v) => v === null).length, 0);
  assert.equal(c.postedPerDay[c.days.indexOf('2026-11-03')], 1);
  assertEndsAtCard(c, tasks);
});

test('pickWeekly, pickLong: 그 주에 시작한 주차 캠페인과 장기 캠페인을 가른다', () => {
  const cs = [
    camp({ id: 'w', startsOn: '2026-11-09', endsOn: '2026-11-15' }),
    camp({ id: 'prev', startsOn: '2026-11-02', endsOn: '2026-11-08' }),
    camp({ id: 'long', startsOn: '2026-10-01', endsOn: '2026-12-31' }),
  ];
  assert.deepEqual(pickWeekly(cs, '2026-11-09').map((c) => c.id), ['w']);
  assert.deepEqual(pickLong(cs, '2026-11-12').map((c) => c.id), ['long']);
});
const input = (c: Partial<CampaignRow>, tasks: CampaignTaskItem[], visitPhases: OverviewInput['visitPhases'] = {}): OverviewInput =>
  ({ campaign: camp(c), tasks, points: [], visitPhases, perfUpdatedAt: null });
test('buildOverview: 네 칸 합계, 카드 순서, 같은 클라이언트 둘이면 캠페인 이름', () => {
  const week = resolveWeek(null, '2026-11-12');
  const o = buildOverview([
    input({ id: '1', clientId: 'A', clientName: '가', name: '가_11월2주차' }, [task({ postedAt: '2026-11-10' }), task({ scheduledOn: '2026-11-14' })]),
    input({ id: '2', clientId: 'B', clientName: '나', name: '나_11월2주차' }, [task({ scheduledOn: '2026-11-10' }), task({ scheduledOn: null })]),
    input({ id: '3', clientId: 'C', clientName: '다', name: '다_11월2주차' }, []),
    input({ id: '4', clientId: 'A', clientName: '가', name: '가_추가' }, [task({ postedAt: '2026-11-11' })]),
  ], [], week, '2026-11-12');
  assert.deepEqual(o.cards.map((c) => c.campaignId), ['2', '1', '4', '3']);          // 지연 → 이름순 → 세팅 전
  assert.deepEqual(o.cards.map((c) => c.title), ['나', '가_11월2주차', '가_추가', '다']);
  assert.deepEqual({ ...o.tiles, overdueBy: undefined }, { campaignCount: 4, unsetCount: 1, planned: 5, posted: 2, overdue: 1, remaining: 2, undated: 1, overdueBy: undefined, overdueMore: 0 });
  assert.deepEqual(o.tiles.overdueBy, [{ title: '나', count: 1 }]);
  assert.equal(o.weekName, '11월2주차');
});
test('overdueBy는 많은 순 3개, 나머지는 overdueMore', () => {
  const week = resolveWeek(null, '2026-11-12');
  const late = (k: number) => Array.from({ length: k }, () => task({ scheduledOn: '2026-11-10' }));
  const o = buildOverview([
    input({ id: '1', clientId: 'A', clientName: '가' }, late(1)),
    input({ id: '2', clientId: 'B', clientName: '나' }, late(4)),
    input({ id: '3', clientId: 'C', clientName: '다' }, late(2)),
    input({ id: '4', clientId: 'D', clientName: '라' }, late(5)),
    input({ id: '5', clientId: 'E', clientName: '마' }, late(3)),
  ], [], week, '2026-11-12');
  assert.equal(o.tiles.overdueBy.length, 3);
  assert.deepEqual(o.tiles.overdueBy, [{ title: '라', count: 5 }, { title: '나', count: 4 }, { title: '마', count: 3 }]);
  assert.equal(o.tiles.overdueMore, 2);
  assert.equal(o.tiles.overdue, 15);
});
test('패널 줄: 게시된 것은 조회수 많은 순(측정 없음은 뒤), 게시 전은 지난 것 먼저, 미정은 맨 뒤', () => {
  const week = resolveWeek(null, '2026-11-12');
  const pf = (views: number | null) => ({ postCount: 1, views, likes: 3, bookmarks: 7 });
  const o = buildOverview([input({ id: '1', clientName: '가' }, [
    task({ id: 'p100', postedAt: '2026-11-10', perf: pf(100), cost: { amount: 1000, currency: 'KRW' }, postUrl: 'https://x.com/a/status/1' }),
    task({ id: 'pnull', postedAt: '2026-11-10', perf: pf(null), cost: { amount: 1000, currency: 'KRW' } }),
    task({ id: 'p900', postedAt: '2026-11-11', perf: pf(900), cost: { amount: 900, currency: 'JPY' }, type: 'other', otherKind: '라이브' }),
    task({ id: 'o14', scheduledOn: '2026-11-14' }),
    task({ id: 'o10', scheduledOn: '2026-11-10' }),
    task({ id: 'onull', scheduledOn: null }),
  ])], [], week, '2026-11-12');
  const card = o.cards[0];
  assert.deepEqual(card.posted.map((r) => r.views), [900, 100, null]);
  assert.deepEqual(card.posted.map((r) => r.taskId), ['p900', 'p100', 'pnull']);
  assert.equal(card.posted[0].cpvKrw, 10);                 // 900엔 = 9,000원 ÷ 900
  assert.equal(card.posted[0].typeLabel, '라이브');          // 기타 협찬은 작업 내용
  assert.equal(card.posted[1].cpvKrw, 10);
  assert.equal(card.posted[1].url, 'https://x.com/a/status/1');
  assert.equal(card.posted[1].postedOn, '2026-11-10');
  assert.equal(card.posted[2].cpvKrw, null);               // 조회 없음 → CPV 없음
  assert.equal(card.posted[2].url, null);
  assert.deepEqual(card.open.map((r) => r.scheduledOn), ['2026-11-10', '2026-11-14', null]);
  assert.deepEqual(card.open.map((r) => r.overdueDays), [2, null, null]);
});
test('패널 CPV: 캠페인 화면 작업 표(taskPerfExtra)와 같은 값 — 0원은 0, 미입력은 없음, 같은 방문은 비용을 나눈다', () => {
  const week = resolveWeek(null, '2026-11-12');
  const pf = (views: number) => ({ postCount: 1, views, likes: 0, bookmarks: 0 });
  const o = buildOverview([input({ id: '1', clientName: '가' }, [
    task({ id: 'zero', postedAt: '2026-11-10', perf: pf(500), cost: { amount: 0, currency: 'KRW' } }),
    task({ id: 'unset', postedAt: '2026-11-10', perf: pf(400), cost: null }),
    task({ id: 'orig', type: 'visit', postedAt: '2026-11-10', perf: pf(1000), cost: { amount: 2000, currency: 'JPY' } }),
    task({ id: 'link', type: 'visit', sameVisitOf: 'orig', postedAt: '2026-11-11', perf: pf(200), cost: null }),
    task({ id: 'free', postedAt: '2026-11-11', perf: pf(300), cost: null, noCost: true }),
  ])], [], week, '2026-11-12');
  const cpv = Object.fromEntries(o.cards[0].posted.map((r) => [r.taskId, r.cpvKrw]));
  assert.equal(cpv.free, 0);                        // 비용 없음 표시 → 0.0원(koo 11-12, 카드의 무상과 같은 표기)
  assert.equal(cpv.zero, 0);                        // 명시한 0원 → 0.0원(캠페인 화면과 같다)
  assert.equal(cpv.unset, null);                    // 비용 미입력 → '-'
  assert.equal(cpv.orig, 10);                       // 2,000엔 = 20,000원 ÷ 2건 = 10,000원 ÷ 1,000
  assert.equal(cpv.link, 50);                       // 같은 몫 10,000원 ÷ 200
});
test('게시 후 내려간 작업도 게시로 세고 조회수도 합친다', () => {
  const tasks = [
    task({ postedAt: '2026-11-10', removedAt: '2026-11-11', perf: { postCount: 1, views: 300, likes: 0, bookmarks: 3 } }),
    task({ postedAt: '2026-11-10', perf: { postCount: 1, views: 700, likes: 0, bookmarks: 7 } }),
  ];
  assert.deepEqual(quantityOf(tasks, '2026-11-12'), { planned: 2, posted: 2, overdue: 0, open: 0, undated: 0, cancelled: 0 });
  assert.equal(perfOf(tasks).views.value, 1000);
});
test('장기 줄: 인플루언서도 방문 단계도 없는 게시 전 방문 작업은 예약 대기', () => {
  const week = resolveWeek(null, '2026-11-12');
  const o = buildOverview([], [input({ id: 'L', clientName: '장기', startsOn: '2026-10-01', endsOn: '2026-12-31' },
    [task({ id: 'bare', type: 'visit', influencerHandle: null })])], week, '2026-11-12');
  assert.deepEqual(o.long[0].stages, [{ label: '예약 대기', count: 1 }]);
});
test('월 경계 주: 11/30(월) 주는 12월 1주차, 같은 클라이언트 두 캠페인은 캠페인 이름', () => {
  const week = resolveWeek('2026-12-01', '2026-12-03');
  assert.equal(week.weekStart, '2026-11-30');
  const cs = [
    camp({ id: 'a', clientId: 'K', clientName: '경계', name: '경계_12월1주차', startsOn: '2026-11-30', endsOn: '2026-12-06' }),
    camp({ id: 'b', clientId: 'K', clientName: '경계', name: '경계_추가', startsOn: '2026-12-01', endsOn: '2026-12-06' }),
  ];
  const weekly = pickWeekly(cs, week.weekStart);
  assert.deepEqual(weekly.map((c) => c.id), ['a', 'b']);
  const o = buildOverview(weekly.map((c) => ({ campaign: c, tasks: [task({ scheduledOn: '2026-12-05' })], points: [], visitPhases: {}, perfUpdatedAt: null })),
    [], week, '2026-12-03');
  assert.deepEqual(o.cards.map((c) => c.title).sort(), ['경계_12월1주차', '경계_추가']);
  assert.equal(o.weekName, '12월1주차');
  assert.equal(weekLabel(o.week.weekStart), '12월 1주차');
});
test('지난 주를 볼 때도 예정일 지난 미게시는 실제 오늘 기준', () => {
  const week = resolveWeek('2026-11-02', '2026-11-12');
  const o = buildOverview([input({ id: '1', clientName: '가', startsOn: '2026-11-02', endsOn: '2026-11-08' }, [task({ scheduledOn: '2026-11-07' })])], [], week, '2026-11-12');
  assert.equal(o.cards[0].quantity.overdue, 1);
  assert.equal(o.cards[0].open[0].overdueDays, 5);
  assert.equal(o.tiles.overdue, 1);
});
test('장기 줄: 단계 묶음, 0건 생략, 노쇼 제외, 이 주 게시', () => {
  const week = resolveWeek(null, '2026-11-12');
  const v = (id: string, p: Partial<CampaignTaskItem> = {}) => task({ id, type: 'visit', ...p });
  const tasks = [
    v('v1'), v('v2'), v('v3'), v('v4', { postedAt: '2026-11-10' }), v('v5'),
    task({ id: 'x1', type: 'post' }),
  ];
  const o = buildOverview([], [input({ id: 'L', clientName: '장기클', startsOn: '2026-10-01', endsOn: '2026-12-31' }, tasks,
    { v1: 'waiting', v2: 'confirmed', v3: 'visited', v4: 'uploaded', v5: 'visit_no_show' })], week, '2026-11-12');
  assert.equal(o.long.length, 1);
  assert.equal(o.long[0].title, '장기클');
  assert.deepEqual(o.long[0].stages, [
    { label: '예약 대기', count: 1 }, { label: '예약 확정', count: 1 }, { label: '방문 완료', count: 1 },
    { label: '게시', count: 1 }, { label: '준비', count: 1 },
  ]);
  assert.equal(o.long[0].postedThisWeek, 1);
});
