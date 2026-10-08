import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueCheckpoint, tweetIdToDate, CHECKPOINTS_MS, LAST_CHECKPOINT_MS } from './autoMeasure';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const posted = new Date('2026-10-08T10:00:00Z');
const at = (ms: number) => new Date(posted.getTime() + ms);

test('일정은 두 배씩 늘다가 하루 한 번, 7일에서 끝난다(14개)', () => {
  assert.equal(CHECKPOINTS_MS.length, 14);
  assert.deepEqual(CHECKPOINTS_MS.slice(0, 8), [15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR, 12 * HOUR, DAY]);
  assert.equal(LAST_CHECKPOINT_MS, 7 * DAY);
});

test('첫 시점(15분) 전에는 잴 게 없다', () => {
  assert.equal(dueCheckpoint(posted, null, at(14 * MIN)), null);
});

test('시점이 지났고 그 뒤로 잰 적이 없으면 그 시점을 잰다', () => {
  assert.equal(dueCheckpoint(posted, null, at(16 * MIN)), 15 * MIN);
  assert.equal(dueCheckpoint(posted, at(5 * MIN), at(31 * MIN)), 30 * MIN);
});

test('그 시점 뒤에 이미 쟀으면(등록 즉시 측정·수동 ↻) 다시 재지 않는다', () => {
  assert.equal(dueCheckpoint(posted, at(16 * MIN), at(20 * MIN)), null);
  assert.equal(dueCheckpoint(posted, at(30 * MIN), at(31 * MIN)), null); // 정확히 그 시각에 잰 것도 인정
});

test('늦게 등록되면 지난 시점은 건너뛰고 가장 최근 시점 하나만 잰다', () => {
  // 14시간 뒤 등록(그때 즉시 측정) → 다음은 24시간
  assert.equal(dueCheckpoint(posted, at(14 * HOUR), at(15 * HOUR)), null);
  assert.equal(dueCheckpoint(posted, at(14 * HOUR), at(DAY + 3 * MIN)), DAY);
  // 등록 즉시 측정이 없었다면 밀린 것 중 가장 최근(12시간) 하나만
  assert.equal(dueCheckpoint(posted, null, at(14 * HOUR)), 12 * HOUR);
});

test('7일 시점을 잰 뒤에는 더 재지 않는다', () => {
  assert.equal(dueCheckpoint(posted, at(7 * DAY + MIN), at(8 * DAY)), null);
  assert.equal(dueCheckpoint(posted, at(6 * DAY), at(7 * DAY + 2 * MIN)), 7 * DAY);
});

test('게시물 번호에서 게시 시각을 꺼낸다', () => {
  // 백수약국 9월 2주차 @eveniffen 게시물 — 2026-09-08 19:21 KST
  const d = tweetIdToDate('2097269160736706597');
  assert.ok(d);
  assert.equal(d!.toISOString().slice(0, 16), '2026-09-08T10:21');
  assert.equal(tweetIdToDate('abc'), null);
});
