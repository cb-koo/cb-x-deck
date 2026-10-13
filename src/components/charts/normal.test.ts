import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalRange, typical, spikeThreshold, verdictOf } from './normal';

test('평소 범위는 가운데 절반, 빈 값은 빼고 계산', () => {
  assert.deepEqual(normalRange([42, 19, 12, 18, 39, 54, 21, 44]), [19, 43]);
  assert.deepEqual(normalRange([1, 2, 3, 4, null, 5]), [2, 4]);
});

test('평소 하루는 가운데값, 크게 튄 값은 위쪽 끝의 2배 초과', () => {
  assert.equal(typical([1, 3, 2, 10, 4]), 3);
  assert.equal(spikeThreshold([2, 5]), 10);
});

test('판정: 범위 위·안·아래', () => {
  assert.equal(verdictOf(44, [19, 43]), 'above');
  assert.equal(verdictOf(19, [19, 43]), 'normal');
  assert.equal(verdictOf(14, [19, 43]), 'below');
});
