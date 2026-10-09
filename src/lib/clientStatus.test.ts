import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mondayOf, baseWeekStart, weekStarts, suggestDecision, weeklyX, sum4 } from './clientStatus';

test('주 경계: 월요일 시작, 기준 주는 지난 완결 주', () => {
  assert.equal(mondayOf('2026-10-09'), '2026-10-05'); // 목
  assert.equal(mondayOf('2026-10-05'), '2026-10-05'); // 월
  assert.equal(mondayOf('2026-10-04'), '2026-09-28'); // 일
  assert.equal(baseWeekStart('2026-10-09'), '2026-09-28');
  assert.deepEqual(weekStarts('2026-09-28', 3), ['2026-09-14', '2026-09-21', '2026-09-28']);
});

test('판정 규칙 v1 — 위에서부터 처음 맞는 규칙', () => {
  const base = { reservers4: 10, reserversPrev4: 10, posts2w: 3 };
  assert.equal(suggestDecision({ ...base, newInflow: [null, null, 10, 12, 11] }).decision, 'hold');
  // 평소 범위 [19,43] — 마지막 두 주가 아래
  assert.equal(suggestDecision({ ...base, newInflow: [42, 19, 12, 18, 39, 54, 10, 9] }).decision, 'adjust');
  assert.equal(suggestDecision({ ...base, newInflow: [42, 19, 12, 18, 39, 54, 21, 44], reservers4: 4, reserversPrev4: 9 }).reason, '최근 4주 예약이 직전 4주의 절반 이하예요');
  assert.equal(suggestDecision({ ...base, newInflow: [42, 19, 12, 18, 39, 54, 21, 30], posts2w: 0 }).decision, 'watch');
  const keep = suggestDecision({ ...base, newInflow: [42, 19, 12, 18, 39, 54, 21, 44] });
  assert.equal(keep.decision, 'keep');
  assert.equal(keep.reason, '신규 인입이 평소보다 많아요');
  assert.deepEqual(keep.band, [19, 43]);
});

test('예약 규칙은 직전 4주가 적으면(4명 미만) 걸지 않는다', () => {
  const s = suggestDecision({ newInflow: [10, 10, 10, 10, 10], reservers4: 0, reserversPrev4: 3, posts2w: 2 });
  assert.equal(s.decision, 'keep');
});

test('주별 X 집계: 게시일 주로 묶고 북마크당 비용', () => {
  const w = ['2026-09-21', '2026-09-28'];
  const r = weeklyX(w, [{ date: '2026-09-28', views: 100, bookmarks: 10 }, { date: '2026-10-04', views: 50, bookmarks: 0 }, { date: '2026-09-01', views: 1, bookmarks: 1 }],
    [{ date: '2026-09-29', krw: 3000 }, { date: '2026-09-22', krw: 500 }]);
  assert.deepEqual(r.views, [0, 150]);
  assert.deepEqual(r.postCount, [0, 2]);
  assert.deepEqual(r.costPerBookmark, [null, 300]);
  assert.deepEqual(sum4([1, 1, 1, 1, 2, null, 2, 2]), { recent: 6, prev: 4 });
});

import { valueAtHorizon, shareAt, ACCRUAL_DEFAULT, H_BOOKMARKS, H_VIEWS } from './clientStatus';
test('기준 시점 값: 보간·지난 값·예상값', () => {
  // 앞뒤 측정 → 직선 보간
  assert.equal(valueAtHorizon([[48, 80], [96, 100]], H_BOOKMARKS, 'bookmarks', ACCRUAL_DEFAULT)?.value, 90);
  // 기준 시점 뒤 측정만 → 그 값(예상 아님)
  assert.deepEqual(valueAtHorizon([[300, 500]], H_VIEWS, 'views', ACCRUAL_DEFAULT), { value: 500, est: false });
  // 1일 측정만 → 조회 61% 지점이므로 예상 = 610/0.61
  assert.deepEqual(valueAtHorizon([[24, 610]], H_VIEWS, 'views', ACCRUAL_DEFAULT), { value: 1000, est: true });
  assert.equal(shareAt(ACCRUAL_DEFAULT, 200, 'views'), 1);
  assert.equal(valueAtHorizon([], H_VIEWS, 'views', ACCRUAL_DEFAULT), null);
});
