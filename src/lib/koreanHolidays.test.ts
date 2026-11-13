import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidayOn } from './koreanHolidays.ts';

test('공휴일과 대체공휴일, 평일, 목록 없는 해', () => {
  assert.deepEqual(holidayOn('2026-12-25'), { name: '기독탄신일' });
  assert.deepEqual(holidayOn('2026-03-02'), { name: '대체공휴일(3.1절)' });
  assert.deepEqual(holidayOn('2026-06-03'), { name: '전국동시지방선거' });
  assert.deepEqual(holidayOn('2027-02-09'), { name: '대체공휴일(설날)' });
  assert.deepEqual(holidayOn('2027-09-15'), { name: '추석' });
  assert.equal(holidayOn('2026-11-13'), null);
  assert.equal(holidayOn('2027-12-24'), null);
  assert.equal(holidayOn('2028-01-03'), 'unknown-year');
});

test('연휴는 모든 날이 공휴일', () => {
  for (const d of ['2026-02-16', '2026-02-17', '2026-02-18']) assert.deepEqual(holidayOn(d), { name: '설날' });
  for (const d of ['2027-09-14', '2027-09-16']) assert.deepEqual(holidayOn(d), { name: '추석' });
});
