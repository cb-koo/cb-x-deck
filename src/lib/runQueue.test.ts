import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runQueue } from './runQueue.ts';

test('runQueue: 동시 실행 상한과 결과 집계', async () => {
  let active = 0, peak = 0;
  const seen: number[] = [];
  const r = await runQueue([1, 2, 3, 4, 5], async (n) => {
    active++; peak = Math.max(peak, active);
    await new Promise((res) => setTimeout(res, 5));
    active--; seen.push(n);
    if (n === 3) throw new Error('boom');
  }, 2);
  assert.equal(peak, 2);
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5]);
  assert.equal(r.ok, 4);
  assert.deepEqual(r.failed, [3]);
});
