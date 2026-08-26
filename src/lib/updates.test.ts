import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortUpdates, groupByMonth, isMonthOpen, OPEN_MONTHS, monthLabel, formatDay, isValidDate,
  resolveHref, WS_TOKEN,
} from './updates.ts';
import { UPDATES, type UpdateEntry } from '../content/updates.ts';

const e = (date: string, title = date): UpdateEntry => ({ date, type: '개선', title, summary: 's' });

test('sortUpdates: 날짜 내림차순, 같은 날은 입력 순서 유지', () => {
  const sorted = sortUpdates([e('2026-08-01', 'a'), e('2026-08-25', 'b1'), e('2026-07-19', 'c'), e('2026-08-25', 'b2')]);
  assert.deepEqual(sorted.map((x) => x.title), ['b1', 'b2', 'a', 'c']);
});

test('sortUpdates: 입력 배열을 바꾸지 않는다', () => {
  const input = [e('2026-08-01'), e('2026-08-25')];
  sortUpdates(input);
  assert.equal(input[0].date, '2026-08-01');
});

test('groupByMonth: 월 경계로 묶고 최신 월이 앞, 라벨은 한국어', () => {
  const groups = groupByMonth([e('2026-07-19'), e('2026-08-25'), e('2026-08-05'), e('2026-06-30')]);
  assert.deepEqual(groups.map((g) => g.ym), ['2026-08', '2026-07', '2026-06']);
  assert.deepEqual(groups.map((g) => g.label), ['2026년 8월', '2026년 7월', '2026년 6월']);
  assert.deepEqual(groups[0].entries.map((x) => x.date), ['2026-08-25', '2026-08-05']);
});

test('groupByMonth: 빈 입력은 빈 배열', () => {
  assert.deepEqual(groupByMonth([]), []);
});

test('isMonthOpen: 최신 3개 월만 펼침 (달력이 아니라 월 개수 기준)', () => {
  assert.equal(OPEN_MONTHS, 3);
  assert.equal(isMonthOpen(0), true);
  assert.equal(isMonthOpen(2), true);
  assert.equal(isMonthOpen(3), false);
});

test('monthLabel / formatDay: 앞자리 0을 뗀 한국어 표기', () => {
  assert.equal(monthLabel('2026-08'), '2026년 8월');
  assert.equal(monthLabel('2026-12'), '2026년 12월');
  assert.equal(formatDay('2026-08-05'), '8월 5일');
  assert.equal(formatDay('2026-12-31'), '12월 31일');
});

test('isValidDate: 형식과 실제 달력 날짜를 모두 본다', () => {
  assert.equal(isValidDate('2026-08-25'), true);
  assert.equal(isValidDate('2026-8-25'), false);      // 자릿수
  assert.equal(isValidDate('2026-02-30'), false);     // 없는 날
  assert.equal(isValidDate('2026-13-01'), false);     // 없는 달
  assert.equal(isValidDate('20260825'), false);
});

test('resolveHref: {ws} 토큰은 마지막 워크스페이스로, 없으면 null(링크 숨김)', () => {
  assert.equal(WS_TOKEN, '{ws}');
  assert.equal(resolveHref('/tracking', null), '/tracking');
  assert.equal(resolveHref('/w/{ws}/library?view=table', 'abc'), '/w/abc/library?view=table');
  assert.equal(resolveHref('/w/{ws}', null), null);
});

// ---- 데이터 검사: 타입으로 못 잡는 것(형식·빈 문자열·링크 모양)을 UPDATES 전체에 대해 확인 ----
test('UPDATES: 날짜 형식·빈 문자열·링크 모양', () => {
  for (const u of UPDATES) {
    assert.ok(isValidDate(u.date), `날짜 형식: ${u.date} (${u.title})`);
    assert.ok(u.title.trim().length > 0, `제목 비어 있음: ${u.date}`);
    assert.ok(u.summary.trim().length > 0, `요약 비어 있음: ${u.title}`);
    for (const b of u.bullets ?? []) assert.ok(b.trim().length > 0, `빈 불릿: ${u.title}`);
    if (u.link) {
      assert.ok(u.link.label.trim().length > 0, `링크 라벨 비어 있음: ${u.title}`);
      assert.ok(u.link.href.startsWith('/'), `링크는 앱 안 경로(/로 시작): ${u.title} → ${u.link.href}`);
    }
  }
});
