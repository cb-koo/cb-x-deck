import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod, periodParam, periodLabel, defaultPeriod, stepPeriod, canStepNext, isInProgress, switchKind } from './reportPeriod.ts';

const T = '2026-10-10'; // 토
test('기본값 = 끝난 가장 최근 주차/달', () => {
  const w = defaultPeriod('week', T);
  assert.equal(`${w.start}~${w.end} ${periodLabel(w)}`, '2026-10-01~2026-10-04 10월 1주차');
  assert.equal(periodLabel(defaultPeriod('month', T)), '2026년 9월');
  assert.equal(periodLabel(defaultPeriod('month', '2027-01-03')), '2026년 12월');
});
test('주소 값 왕복·잘못된 값·미래', () => {
  assert.equal(periodParam(parsePeriod('w-2026-09-29', T)), 'w-2026-09-28');   // 주차 안 아무 날 → 그 주차 첫날
  assert.equal(periodParam(parsePeriod('m-2026-08', T)), 'm-2026-08');
  assert.equal(periodParam(parsePeriod('x', T)), 'w-2026-10-01');
  assert.equal(periodParam(parsePeriod('w-2026-11-02', T)), 'w-2026-10-01');   // 미래 → 기본값
  assert.equal(periodParam(parsePeriod('m-2026-13', T)), 'm-2026-09');           // 틀린 달 → 월간 기본값
});
test('이동·진행 중·전환', () => {
  const w = parsePeriod('w-2026-10-01', T);
  assert.equal(periodParam(stepPeriod(w, -1)), 'w-2026-09-28');
  assert.equal(canStepNext(w, T), true);                       // 10월2주차는 진행 중이라 볼 수 있다
  const cur = stepPeriod(w, 1);
  assert.equal(isInProgress(cur, T), true);
  assert.equal(canStepNext(cur, T), false);
  assert.equal(periodParam(switchKind(w, 'month', T)), 'm-2026-10');
  assert.equal(periodParam(switchKind(parsePeriod('m-2026-09', T), 'week', T)), 'w-2026-09-28'); // 9월 마지막 주차
  assert.equal(periodParam(stepPeriod(parsePeriod('m-2026-01', T), -1)), 'm-2025-12');
});
