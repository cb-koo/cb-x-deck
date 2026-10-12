import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueCheckpoint, dueWatch, tweetIdToDate, CHECKPOINTS_MS, LAST_CHECKPOINT_MS, type WatchState } from './autoMeasure';

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

// ── 안 보임 확인(2026-10-12) ──
const st = (p: Partial<WatchState>): WatchState => ({ kind: 'main', postedAt: posted, lastCapturedAt: null, missingCheckedAt: null, unavailableAt: null, ...p });

test('보이는 본 게시물은 측정 시점 일정 그대로', () => {
  assert.deepEqual(dueWatch(st({ lastCapturedAt: at(5 * MIN) }), at(31 * MIN)), { reason: 'checkpoint', checkpointMs: 30 * MIN });
  assert.equal(dueWatch(st({ lastCapturedAt: at(30 * MIN) }), at(40 * MIN)), null);
});

test('처음 "없음" 뒤엔 1시간 뒤에 한 번 더 본다(확정 전) — 그 사이엔 측정 시점이 와도 부르지 않는다', () => {
  const s = st({ lastCapturedAt: at(3 * HOUR), missingCheckedAt: at(4 * HOUR + MIN) });
  assert.equal(dueWatch(s, at(4 * HOUR + 30 * MIN)), null);
  assert.deepEqual(dueWatch(s, at(5 * HOUR + MIN)), { reason: 'confirm' });
});

test('확정된 뒤엔 하루 한 번 다시 본다', () => {
  const s = st({ missingCheckedAt: at(DAY), unavailableAt: at(DAY - HOUR) });
  assert.equal(dueWatch(s, at(DAY + 23 * HOUR)), null);
  assert.deepEqual(dueWatch(s, at(2 * DAY)), { reason: 'recheck' });
  // 이 기능 전에 한 번의 "없음"으로 찍힌 옛 값(확인 시각 없음)은 그 시각부터 하루
  assert.deepEqual(dueWatch(st({ unavailableAt: at(DAY) }), at(2 * DAY)), { reason: 'recheck' });
});

test('링크 댓글은 측정 시점 대신 하루 한 번 살아 있나 본다', () => {
  assert.deepEqual(dueWatch(st({ kind: 'link' }), at(MIN)), { reason: 'daily' });
  assert.equal(dueWatch(st({ kind: 'link', lastCapturedAt: at(HOUR) }), at(DAY)), null);
  assert.deepEqual(dueWatch(st({ kind: 'link', lastCapturedAt: at(HOUR) }), at(DAY + HOUR)), { reason: 'daily' });
});

test('게시 후 7일+1시간이 지나면 아무것도 보지 않는다 — 끝 무렵에 처음 본 "없음"의 확정 확인 한 번만 예외', () => {
  assert.equal(dueWatch(st({ unavailableAt: at(5 * DAY) }), at(7 * DAY + 2 * HOUR)), null);
  assert.equal(dueWatch(st({ kind: 'link' }), at(7 * DAY + 2 * HOUR)), null);
  // 7일+50분에 처음 "없음" → 7일+1시간50분에 확정 확인(그 뒤로는 끝)
  const late = st({ missingCheckedAt: at(7 * DAY + 50 * MIN) });
  assert.deepEqual(dueWatch(late, at(7 * DAY + 111 * MIN)), { reason: 'confirm' });
  assert.equal(dueWatch(late, at(7 * DAY + 2 * HOUR + MIN)), null);
});
