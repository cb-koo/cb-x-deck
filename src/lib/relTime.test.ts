import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relTime } from './relTime.ts';

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
