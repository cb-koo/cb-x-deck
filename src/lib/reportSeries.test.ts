import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inclusiveDays, recommendUnit, bucketRanges, isCalendarMonth, addDays,
  ratio, movingAverage, toSeriesPoint,
} from './reportSeries.ts';
import type { ReportBundles } from './reportApi.ts';

test('inclusiveDays·addDays·isCalendarMonth', () => {
  assert.equal(inclusiveDays('2026-07-01', '2026-07-31'), 31);
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.ok(isCalendarMonth('2026-07-01', '2026-07-31'));
  assert.ok(!isCalendarMonth('2026-07-01', '2026-07-30'));
  assert.ok(!isCalendarMonth('2026-07-02', '2026-07-31'));
});

test('recommendUnit — ≤31 일간, ≤120 주간, 초과 월간', () => {
  assert.equal(recommendUnit('2026-07-01', '2026-07-31'), 'day');
  assert.equal(recommendUnit('2026-04-01', '2026-07-29'), 'week');  // 120일
  assert.equal(recommendUnit('2026-01-01', '2026-07-31'), 'month');
});

test('bucketRanges day — 하루씩, 양끝 포함', () => {
  const b = bucketRanges('2026-07-30', '2026-08-01', 'day');
  assert.deepEqual(b, [
    { start: '2026-07-30', end: '2026-07-30' },
    { start: '2026-07-31', end: '2026-07-31' },
    { start: '2026-08-01', end: '2026-08-01' },
  ]);
});

test('bucketRanges week — 월요일 시작 정규 주로 스냅', () => {
  // 2026-07-15는 수요일 → 그 주는 7/13(월)~7/19(일)
  const b = bucketRanges('2026-07-15', '2026-07-21', 'week');
  assert.deepEqual(b, [
    { start: '2026-07-13', end: '2026-07-19' },
    { start: '2026-07-20', end: '2026-07-26' },
  ]);
});

test('bucketRanges month — 달력 월로 스냅', () => {
  const b = bucketRanges('2026-06-10', '2026-08-05', 'month');
  assert.deepEqual(b, [
    { start: '2026-06-01', end: '2026-06-30' },
    { start: '2026-07-01', end: '2026-07-31' },
    { start: '2026-08-01', end: '2026-08-31' },
  ]);
});

test('ratio — 분모 0·null이면 null (0 아님)', () => {
  assert.equal(ratio(5, 10), 0.5);
  assert.equal(ratio(5, 0), null);
  assert.equal(ratio(null, 10), null);
  assert.equal(ratio(5, null), null);
});

test('movingAverage — null은 건너뛰고 창 안 실측만 평균, 실측 0개면 null', () => {
  assert.deepEqual(movingAverage([2, 4, null, 6], 2), [2, 3, 4, 6]);
  assert.deepEqual(movingAverage([null, null], 2), [null, null]);
});

const PAYLOAD: ReportBundles = {
  followers: { total_at_end: 8742, snapshot_date: '2026-07-15', total_at_baseline: 8700,
    baseline_date: '2026-07-14', change: 42, blocked: 1024, reachable: 7718 },
  funnel: { active_customers: 40, new_customers: 12, consulted_customers: 20,
    reservers: { by_line_id: 14, by_name: 18 }, visitors: { by_line_id: 10, by_name: 12 } },
  reservations: { upcoming_confirmed: 99, reservation_date: null,
    created_at: { reservation_count: 16, revenue: { total: 4200000, first_visit: 2600000, repeat_visit: 1600000 },
      visit_type_counts: { first_visit: 10, repeat_visit: 6 },
      reservers: { by_line_id: 14, by_name: 18 }, visitors: { by_line_id: 10, by_name: 12 },
      status_counts: { reviewing: 1, confirmed: 12, visited: 4, cancelled: 2, lost: 0, noshow: 1 } } },
  costs: { marketing_cost: { total: 120000, by_media: [{ media: '메타', amount: 120000 }] },
    x_views: { cumulative_at_end: 100, change: 10 }, roas: 35, cpa: { by_line_id: 8571, by_name: 6667 } },
};

test('toSeriesPoint — 정상 payload에서 파생값', () => {
  const p = toSeriesPoint({ start: '2026-07-15', end: '2026-07-15' },
    { payload: PAYLOAD, fetchedAt: '2026-07-16T00:00:00Z' }, '2026-08-24');
  assert.equal(p.missing, false);
  assert.equal(p.inProgress, false);
  assert.equal(p.inflow, 40);
  assert.equal(p.convInflowToConsult, 0.5);           // 20/40
  assert.equal(p.convConsultToReserve, 0.7);          // 14/20
  assert.equal(p.reservationCount, 16);
  assert.equal(p.revenueTotal, 4200000);
  // 취소·노쇼율 = (cancelled+noshow) ÷ status 6종 합 = 3/20
  assert.equal(p.cancelNoshowRate, 0.15);
  assert.equal(p.followersTotal, 8742);
  assert.equal(p.marketingCost, 120000);
  assert.equal(p.roas, 35);
  assert.equal(p.xViewsChange, 10);
});

test('toSeriesPoint — 결손 규칙: missing / followers null / 광고비 0이면 ROAS null', () => {
  const missing = toSeriesPoint({ start: '2026-07-01', end: '2026-07-01' }, null, '2026-08-24');
  assert.equal(missing.missing, true);
  assert.equal(missing.inflow, null);

  const noFollowers: ReportBundles = { ...PAYLOAD, followers: null,
    costs: { marketing_cost: { total: 0, by_media: [] }, x_views: null, roas: null, cpa: { by_line_id: null, by_name: null } } };
  const p = toSeriesPoint({ start: '2026-07-15', end: '2026-07-15' },
    { payload: noFollowers, fetchedAt: 'x' }, '2026-08-24');
  assert.equal(p.followersTotal, null);      // SNAPSHOT_MISSING — 0으로 읽으면 안 됨
  assert.equal(p.marketingCost, 0);          // 0은 그대로 0 (경고는 화면 몫)
  assert.equal(p.roas, null);
});

test('toSeriesPoint — 진행 중 버킷 판정 (end ≥ 오늘)', () => {
  const p = toSeriesPoint({ start: '2026-08-24', end: '2026-08-30' }, null, '2026-08-24');
  assert.equal(p.inProgress, true);
});
