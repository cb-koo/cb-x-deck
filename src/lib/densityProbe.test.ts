import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestMinFaves } from './densityProbe.ts';

test('희소(20건 미만) → 저밀도, 제안 100', () => {
  assert.deepEqual(suggestMinFaves([5, 300, 1200], 3), { suggested: 100, density: 'low' });
});

test('꽉 참(20건) → 고밀도, p25 기반 제안(최소 100)', () => {
  const likes = Array.from({ length: 20 }, (_, i) => (i + 1) * 500); // 500..10000
  const r = suggestMinFaves(likes, 20);
  assert.equal(r.density, 'high');
  assert.ok(r.suggested >= 500 && r.suggested <= 3000, `p25 근처여야: ${r.suggested}`);
});

test('꽉 찼지만 전반적으로 낮으면 최소 100 하한', () => {
  const r = suggestMinFaves(Array(20).fill(20), 20);
  assert.equal(r.suggested, 100);
});
