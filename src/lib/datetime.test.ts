import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asDateOnly, kstDate, kstDateTime, kstShort, kstMonthDay, kstMonthDayKo,
  kstToday, kstDaysAgo, kstTodayStart, kstDaysAgoStart, kstMonthStart,
  dateOnlyMonthDay, weekRangeLabel,
} from './datetime.ts';

// 한국 시간은 UTC+9 고정이므로 UTC 15:00이 KST 다음 날 00:00이다. 이 경계가 모듈 전체의 축이다.
test('instant 계열: UTC 15:00을 넘으면 한국 날짜가 하루 앞선다', () => {
  assert.equal(kstDate('2026-07-10T14:59:59.000Z'), '2026-07-10');
  assert.equal(kstDate('2026-07-10T15:00:00.000Z'), '2026-07-11');   // 경계 정각
  assert.equal(kstDateTime('2026-07-10T15:00:00.000Z'), '2026-07-11 00:00');
  assert.equal(kstDateTime('2026-07-11T01:02:03.000Z'), '2026-07-11 10:02');
});

test('instant 계열: 표기 변형', () => {
  assert.equal(kstShort('2026-07-06T23:29:44.000Z'), "'26.07.07");   // UTC 7/6 23:29 = KST 7/7 08:29
  assert.equal(kstMonthDay('2026-07-06T23:29:44.000Z'), '7/7');
  assert.equal(kstMonthDayKo('2026-07-06T23:29:44.000Z'), '7월 7일');
  assert.equal(kstMonthDay('2026-12-31T15:00:00.000Z'), '1/1');      // 연말 걸침
});

test('instant 계열: 값이 없거나 못 읽으면 화면을 죽이지 않는다', () => {
  assert.equal(kstDate(null), '');
  assert.equal(kstDate('not-a-date'), '');
  assert.equal(kstShort(null), '–');            // 카드에서 '모름' 자리를 지키던 기존 표기
  assert.equal(kstMonthDay(null), '');
});

test('오늘/기간: 한국 자정을 기준으로 만든다', () => {
  // 실제 '지금'에 의존하지 않도록, 만들어진 값들 사이의 관계만 단정한다.
  assert.match(kstToday(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(kstDaysAgo(0), kstToday());
  // 7일 전은 오늘보다 정확히 7일 앞선 한국 날짜다
  const ms = (d: string) => Date.parse(d + 'T00:00:00Z');
  assert.equal(ms(kstToday()) - ms(kstDaysAgo(7)), 7 * 86_400_000);
  // 00:00 KST의 순간은 그 날짜의 UTC 자정보다 9시간 이르다
  assert.equal(ms(kstToday()) - kstTodayStart().getTime(), 9 * 3_600_000);
  assert.equal(kstDaysAgoStart(3).getTime(), kstTodayStart().getTime() - 3 * 86_400_000);
  // 이번 달 1일 00:00 KST
  assert.equal(kstMonthStart().getTime(), ms(kstToday().slice(0, 7) + '-01') - 9 * 3_600_000);
});

test('date-only 계열: 시간대 시프트를 하지 않는다', () => {
  assert.equal(dateOnlyMonthDay(asDateOnly('2026-07-13')), '7/13');
  assert.equal(dateOnlyMonthDay(asDateOnly('2026-01-01')), '1/1');   // 시프트가 들어가면 12/31이 된다
  assert.equal(weekRangeLabel(asDateOnly('2026-06-15')), '6/15~21');
  assert.equal(weekRangeLabel(asDateOnly('2026-06-29')), '6/29~7/5'); // 월이 바뀌면 월까지 적는다
});
