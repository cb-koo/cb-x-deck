import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOURS, applyWeekHours, readHours, writeHours, groupWeek } from './hours';
import { seedData } from './data';
import { operating, timeGuidance } from './policy';

test('점심시간을 고르면 해당 시간은 운영시간에서 제외한다', () => {
  const hours = {
    ...DEFAULT_HOURS,
    opens: '09:30',
    closes: '18:30',
    lunchStarts: '12:30',
    lunchEnds: '13:30',
  };
  const intervals = writeHours(hours);
  assert.deepEqual(readHours(intervals), hours);
  const branch = seedData().branches[0];
  branch.week = applyWeekHours(branch.week, [3], false, hours);
  assert.match(timeGuidance(branch, '2026-10-07T12:29'), /운영시간 내/);
  assert.match(timeGuidance(branch, '2026-10-07T12:30'), /운영시간 밖/);
  assert.match(timeGuidance(branch, '2026-10-07T13:30'), /운영시간 내/);
  assert.match(timeGuidance(branch, '2026-10-07T18:30'), /운영시간 밖/);
});
test('점심시간 없음은 숨긴 점심 입력값과 무관하게 연속 운영한다', () => {
  const hours = { ...DEFAULT_HOURS, lunch: false, lunchStarts: '', lunchEnds: '' };
  const branch = seedData().branches[0];
  branch.week = applyWeekHours(branch.week, [3], false, hours);
  assert.match(timeGuidance(branch, '2026-10-07T13:30'), /운영시간 내/);
  assert.equal(readHours(writeHours(hours))?.lunch, false);
});
test('선택한 요일만 바꾸고 휴무로 바꾸어도 다른 요일과 기존 시간은 보존한다', () => {
  const week = seedData().branches[0].week;
  const result = applyWeekHours(week, [2, 4], false, { ...DEFAULT_HOURS, opens: '11:00' });
  assert.equal(result[1], week[1]);
  assert.equal(result[6], week[6]);
  assert.equal(result[2].intervals, '11:00-13:00, 14:00-19:00');
  assert.equal(week[2].intervals, '10:00-13:00, 14:00-19:00');
  const closed = applyWeekHours(result, [2], true, { ...DEFAULT_HOURS, opens: '' });
  assert.equal(closed[2].closed, true);
  assert.equal(closed[2].intervals, result[2].intervals);
  assert.deepEqual(
    groupWeek(week).map((g) => g.days),
    [[1, 2, 3, 4, 5], [6], [0]],
  );
});
test('빈 요일·뒤집힌 시간·운영시간 밖 점심은 적용하지 않는다', () => {
  const week = seedData().branches[0].week;
  assert.throws(() => applyWeekHours(week, [], false, DEFAULT_HOURS), /요일/);
  for (const changes of [
    { opens: '' },
    { opens: '19:00' },
    { lunchStarts: '09:00' },
    { lunchEnds: '20:00' },
    { lunchStarts: '14:00', lunchEnds: '13:00' },
    { lunchEnds: '19:00' },
  ])
    assert.throws(() => writeHours({ ...DEFAULT_HOURS, ...changes }));
});
test('일부 공휴일만 운영하고 기본 방침을 바꿔도 날짜별 설정을 보존한다', () => {
  const branch = seedData().branches[0];
  assert.equal(operating(branch, '2026-10-03').state, '휴무');
  assert.equal(operating(branch, '2026-10-09').hours, '10:00-14:00');
  const changed = {
    ...branch,
    holiday: 'special' as const,
    holidayHours: writeHours({ ...DEFAULT_HOURS, opens: '11:00', closes: '16:00', lunch: false }),
  };
  assert.equal(operating(changed, '2026-10-03').hours, '11:00-16:00');
  assert.equal(operating(changed, '2026-10-09').hours, '10:00-14:00');
  const restored = { ...changed, exceptions: changed.exceptions.filter((e) => e.date !== '2026-10-09') };
  assert.equal(operating(restored, '2026-10-09').hours, '11:00-16:00');
});
test('공휴일 정보 갱신 실패 때 직접 지정한 날짜만 확정된 안내를 제공한다', () => {
  const branch = seedData().branches[0];
  assert.match(timeGuidance(branch, '2026-10-07T11:00', false), /확인 필요/);
  assert.match(timeGuidance(branch, '2026-10-09T11:00', false), /운영시간 내/);
});
