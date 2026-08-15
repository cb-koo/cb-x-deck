import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relTime, relTimeFine } from './relTime.ts';

const NOW = Date.parse('2026-08-09T12:00:00+09:00');
const DAY = 86400000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test('relTime: 오늘·N일·N주·N달 단계', () => {
  assert.equal(relTime(iso(0), '수정', NOW), '오늘 수정');
  assert.equal(relTime(iso(3 * DAY), '수정', NOW), '3일 전 수정');
  assert.equal(relTime(iso(14 * DAY), '활동', NOW), '2주 전 활동');
  assert.equal(relTime(iso(65 * DAY), '활동', NOW), '2달 전 활동');
});

test('relTime: 미래 시각(시계 오차·서버 skew)은 오늘로 — 음수 일수 방지', () => {
  assert.equal(relTime(iso(-2 * DAY), '수정', NOW), '오늘 수정');
});

test('relTimeFine: 방금·N분·N시간·N일 경계 — Column.tsx의 옛 lastRefreshedLabel과 동일 문구', () => {
  const MIN = 60000;
  assert.equal(relTimeFine(iso(0), '측정', NOW), '방금 측정');
  assert.equal(relTimeFine(iso(30 * MIN), '측정', NOW), '30분 전 측정');
  assert.equal(relTimeFine(iso(59 * MIN), '측정', NOW), '59분 전 측정');
  assert.equal(relTimeFine(iso(60 * MIN), '측정', NOW), '1시간 전 측정');
  assert.equal(relTimeFine(iso(23 * 60 * MIN), '측정', NOW), '23시간 전 측정');
  assert.equal(relTimeFine(iso(DAY), '측정', NOW), '1일 전 측정');
  assert.equal(relTimeFine(iso(3 * DAY), '측정', NOW), '3일 전 측정');
});

test('relTimeFine: 미래 시각은 방금으로 — relTime의 오늘-처리와 같은 철학(음수 방지)', () => {
  assert.equal(relTimeFine(iso(-5 * 60000), '측정', NOW), '방금 측정');
});

test('relTimeFine: 접미사 없이 쓰면(trim) Column.tsx의 미조회 이외 라벨과 정확히 일치', () => {
  assert.equal(relTimeFine(iso(0), '', NOW).trim(), '방금');
  assert.equal(relTimeFine(iso(5 * 60000), '', NOW).trim(), '5분 전');
  assert.equal(relTimeFine(iso(3 * 3600000), '', NOW).trim(), '3시간 전');
  assert.equal(relTimeFine(iso(2 * DAY), '', NOW).trim(), '2일 전');
});
