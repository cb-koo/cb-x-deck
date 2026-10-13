import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWeekHours,
  DEFAULT_HOURS,
  groupWeek,
  operatingOn,
  readHours,
  timeGuidance,
  validIntervals,
  weekdayLabel,
  writeHours,
  type ClinicDateException,
  type ClinicHoursSettings,
  type HolidayCalendar,
} from './clinicHours.ts';

const WEEKDAY = { closed: false, intervals: '10:00-13:00, 14:00-19:00' };
const settings: ClinicHoursSettings = {
  week: [{ closed: true, intervals: '' }, WEEKDAY, WEEKDAY, { closed: true, intervals: '' }, WEEKDAY, WEEKDAY, { closed: false, intervals: '10:00-15:00' }],
  holidayPolicy: 'closed',
  holidayIntervals: '',
};
// 테스트 고정값 — 운영 공휴일 데이터가 아니다.
const holidays: HolidayCalendar = { names: { '2026-10-05': '대체공휴일', '2026-10-09': '한글날' }, coveredYears: [2026] };
const exceptions: ClinicDateException[] = [{ date: '2026-10-09', closed: false, intervals: '10:00-14:00', note: '한글날 단축 운영' }];

test('판정 순서: 날짜 예외 → 공휴일 → 요일', () => {
  assert.equal(operatingOn(settings, exceptions, holidays, '2026-10-09').state, 'operating');
  assert.equal(operatingOn(settings, exceptions, holidays, '2026-10-09').source, 'exception');
  assert.equal(operatingOn(settings, exceptions, holidays, '2026-10-05').state, 'closed');   // 월요일이지만 공휴일
  assert.equal(operatingOn(settings, exceptions, holidays, '2026-10-07').state, 'closed');   // 수요일 정기 휴무
  assert.equal(operatingOn(settings, exceptions, holidays, '2026-10-08').intervals, WEEKDAY.intervals);
});

test('공휴일 방침: 별도 운영은 공휴일 시간, 미설정은 확인 필요', () => {
  const special = { ...settings, holidayPolicy: 'special' as const, holidayIntervals: '11:00-16:00' };
  assert.equal(operatingOn(special, [], holidays, '2026-10-05').intervals, '11:00-16:00');
  assert.equal(operatingOn({ ...settings, holidayPolicy: 'unknown' }, [], holidays, '2026-10-05').state, 'unknown');
  // 날짜 예외는 방침을 바꿔도 보존된다
  assert.equal(operatingOn(special, exceptions, holidays, '2026-10-09').intervals, '10:00-14:00');
});

test('공휴일 자료가 없는 연도는 평일로 단정하지 않고, 직접 지정한 날짜만 확정 안내한다', () => {
  assert.equal(operatingOn(settings, [], holidays, '2027-01-04').state, 'unknown');
  assert.equal(operatingOn(settings, [], holidays, '2027-01-04').source, 'holiday_data_missing');
  const missing: HolidayCalendar = { names: {}, coveredYears: [] };
  assert.equal(operatingOn(settings, exceptions, missing, '2026-10-09').state, 'operating');
  assert.equal(operatingOn(settings, exceptions, missing, '2026-10-08').state, 'unknown');
});

test('요일 시간이 비어 있으면 확인 필요', () => {
  const unset = { ...settings, week: settings.week.map(() => ({ closed: false, intervals: '' })) };
  assert.equal(operatingOn(unset, [], holidays, '2026-10-08').state, 'unknown');
});

test('예약 시각 안내: 운영시간 안·점심·운영시간 밖·휴무·모름을 판단과 함께 말한다', () => {
  const day = operatingOn(settings, [], holidays, '2026-10-08');
  assert.equal(timeGuidance(day, '2026-10-08T14:00')?.tone, 'ok');
  assert.match(timeGuidance(day, '2026-10-08T13:30')!.text, /점심시간이라 운영 여부를 확인/);
  assert.match(timeGuidance(day, '2026-10-08T19:00')!.text, /운영시간 밖/);
  assert.match(timeGuidance(operatingOn(settings, [], holidays, '2026-10-05'), '2026-10-05T11:00')!.text, /휴무일/);
  assert.match(timeGuidance(operatingOn(settings, [], holidays, '2027-01-04'), '2027-01-04T11:00')!.text, /운영 여부를 알 수 없어요/);
  assert.equal(timeGuidance(day, '2026-10-08'), null);
});

test('운영 구간은 겹침·뒤집힘·없는 시각을 거부한다', () => {
  assert.equal(validIntervals('10:00-13:00, 14:00-19:00'), true);
  for (const text of ['', '25:00-26:00', '14:00-10:00', '10:00-14:00, 13:00-17:00']) assert.equal(validIntervals(text), false);
});

test('점심을 고르면 운영시간을 둘로 나누고, 점심 없음은 숨긴 점심 값과 무관하다', () => {
  assert.equal(writeHours(DEFAULT_HOURS), '10:00-13:00, 14:00-19:00');
  assert.equal(writeHours({ ...DEFAULT_HOURS, lunch: false, lunchStarts: '99:99' }), '10:00-19:00');
  assert.deepEqual(readHours('10:00-13:00, 14:00-19:00'), DEFAULT_HOURS);
  for (const changes of [{ closes: '09:00' }, { lunchStarts: '09:00' }, { lunchEnds: '19:00' }]) {
    assert.throws(() => writeHours({ ...DEFAULT_HOURS, ...changes }));
  }
});

test('선택한 요일만 바꾸고 휴무로 바꿔도 다른 요일과 기존 시간은 보존한다', () => {
  const next = applyWeekHours(settings.week, [1, 2], true, DEFAULT_HOURS);
  assert.deepEqual(next[1], { closed: true, intervals: WEEKDAY.intervals });
  assert.deepEqual(next[4], WEEKDAY);
  assert.throws(() => applyWeekHours(settings.week, [], false, DEFAULT_HOURS));
  assert.throws(() => applyWeekHours(settings.week, [7], false, DEFAULT_HOURS));
  assert.equal(weekdayLabel([1, 2, 3, 4, 5]), '월–금');
  assert.deepEqual(groupWeek(settings.week).map((g) => weekdayLabel(g.days)), ['월·화·목·금', '수·일', '토']);
});
