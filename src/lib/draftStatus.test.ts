import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAFT_STATUSES, STATUS_LABEL, isDraftStatus } from './draftStatus.ts';

test('isDraftStatus — 유효 5종 통과, 그 외 전부 거부', () => {
  for (const s of DRAFT_STATUSES) assert.ok(isDraftStatus(s), s);
  assert.equal(isDraftStatus('bogus'), false);
  assert.equal(isDraftStatus(''), false);
  assert.equal(isDraftStatus(undefined), false);
  assert.equal(isDraftStatus(3), false);
});

test('모든 상태에 한국어 라벨이 있다', () => {
  assert.deepEqual(Object.keys(STATUS_LABEL).sort(), [...DRAFT_STATUSES].sort());
  for (const s of DRAFT_STATUSES) assert.ok(STATUS_LABEL[s].length > 0);
});
