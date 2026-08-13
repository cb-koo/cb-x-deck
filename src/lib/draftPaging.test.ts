import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_STEP, remaining, atCap } from './draftPaging.ts';

test('PAGE_STEP: 한 번에 늘리는 개수', () => {
  assert.equal(PAGE_STEP, 50);
});

test('remaining: 아직 안 그린 개수 — 음수가 되지 않는다', () => {
  assert.equal(remaining(312, 50), 262);
  assert.equal(remaining(40, 50), 0, '전체가 표시 개수보다 적으면 0');
  assert.equal(remaining(50, 50), 0);
  assert.equal(remaining(0, 50), 0);
});

test('atCap: 로드된 수가 상한과 같으면 더 있을 수 있다는 뜻', () => {
  assert.equal(atCap(1000, 1000), true);
  assert.equal(atCap(999, 1000), false);
  assert.equal(atCap(0, 1000), false);
});
