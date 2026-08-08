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
  assert.equal(kstMonthDay('2026-07-31T15:00:00.000Z'), '8/1');      // 평범한 월말 걸침(연말 아님)
});

test('instant 계열: 값이 없거나 못 읽으면 화면을 죽이지 않는다', () => {
  assert.equal(kstDate(null), '');
  assert.equal(kstDate('not-a-date'), '');
  assert.equal(kstShort(null), '–');            // 카드에서 '모름' 자리를 지키던 기존 표기
  assert.equal(kstShort('not-a-date'), '–');    // null이 아니어도 파싱 실패면 같은 자리 표기
  assert.equal(kstMonthDay(null), '');
  assert.equal(kstDateTime(null), '');
  assert.equal(kstMonthDayKo(null), '');
});

test('오늘/기간: 고정된 시계로 그 버그(월말 UTC 15시 이후 "이번 달"이 전달이 되던 것)를 재현한다', () => {
  // 2026-07-31T16:00:00Z + 9h = 2026-08-01T01:00:00Z → 한국은 이미 8/1 새벽 1시.
  // UTC로 자르면 여기서 '7/31'이 나와 이번 달이 7월로 밀린다 — 그게 고쳐진 버그다.
  const nowA = () => Date.parse('2026-07-31T16:00:00Z');
  assert.equal(kstToday(nowA), '2026-08-01');
  // 이번 달 1일 00:00 KST → UTC로는 8/1 00:00 - 9h = 7/31 15:00Z. 7월이 아니라 8월 1일에 앉는다.
  assert.equal(kstMonthStart(nowA).getTime(), Date.parse('2026-07-31T15:00:00Z'));

  // 경계 반대편에서도 같은 결과여야 한다: 2026-08-01T02:00:00Z + 9h = 2026-08-01T11:00:00Z(한국 오전 11시).
  const nowB = () => Date.parse('2026-08-01T02:00:00Z');
  assert.equal(kstToday(nowB), '2026-08-01');
  assert.equal(kstMonthStart(nowB).getTime(), Date.parse('2026-07-31T15:00:00Z'));

  // kstDaysAgo(0)은 오늘과 같다(같은 고정 시계 기준)
  assert.equal(kstDaysAgo(0, nowA), kstToday(nowA));
  // 7일 전: 2026-08-01T02:00:00Z - 7일 = 2026-07-25T02:00:00Z, +9h = 2026-07-25T11:00:00Z → '2026-07-25'
  assert.equal(kstDaysAgo(7, nowB), '2026-07-25');

  // 00:00 KST의 순간(=kstTodayStart)은 그 날짜의 UTC 자정보다 9시간 이르다
  assert.equal(kstTodayStart(nowB).getTime(), Date.parse('2026-07-31T15:00:00Z'));
  // 3일 전 00:00 KST: 2026-07-29T00:00 KST → UTC로 2026-07-28T15:00:00Z
  assert.equal(kstDaysAgoStart(3, nowB).getTime(), Date.parse('2026-07-28T15:00:00Z'));
  assert.equal(kstDaysAgoStart(3, nowB).getTime(), kstTodayStart(nowB).getTime() - 3 * 86_400_000);
});

test('date-only 계열: 시간대 시프트를 하지 않는다', () => {
  assert.equal(dateOnlyMonthDay(asDateOnly('2026-07-13')), '7/13');
  assert.equal(dateOnlyMonthDay(asDateOnly('2026-01-01')), '1/1');   // 시프트가 들어가면 12/31이 된다
  assert.equal(weekRangeLabel(asDateOnly('2026-06-15')), '6/15~21');
  assert.equal(weekRangeLabel(asDateOnly('2026-06-29')), '6/29~7/5'); // 월이 바뀌면 월까지 적는다
});
