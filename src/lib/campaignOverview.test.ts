import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWeek, plannedCount, quantityOf, cardStatus, CARD_STATUS_LABEL, type Quantity, perfOf, formatCpv, chartDays, flowChart, type DayPoint, type FlowChart } from './campaignOverview.ts';
import type { CampaignTaskItem } from './campaignStore.ts';

let n = 0;
const task = (p: Partial<CampaignTaskItem>): CampaignTaskItem => ({
  id: `t${++n}`, campaignId: 'c', influencerHandle: null, type: 'post', draftId: null, targetTaskId: null, targetTweetUrl: null,
  postUrl: null, postedAt: null, postedSource: null, removedAt: null, removedReason: '', scheduledOn: null, visitOn: null, cost: null, note: '', otherKind: '', doneNote: '',
  proof: null, visitTime: null, scheduledTime: null, agreement: null, paymentMethodId: null, cancelledAt: null, cancelReason: null, cancelNote: '', cancelledDraftId: null, cancelledDraftTitle: null, settledElsewhereAt: null, settledElsewhereNote: '', settledElsewhereByName: null, costChangeCount: 0,
  createdAt: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`, updatedAt: '', draftStatus: null, draftLabel: null, draftFirstLine: null,
  draftPreview: null, draftFirstImage: null, target: null,
  published: false, perf: null, replies: [], linkClicks: null, settlement: null, unseenSince: null, seenAfterRemovedAt: null, ...p,
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
  assert.equal(formatCpv(free.cpv), '무상');
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
