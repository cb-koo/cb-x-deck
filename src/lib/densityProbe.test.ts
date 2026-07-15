import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestMinFaves } from './densityProbe.ts';

test('희소(20건 미만) → 저밀도, 제안 100', () => {
  assert.deepEqual(suggestMinFaves([5, 300, 1200], 3), { suggested: 100, density: 'low' });
});

test('꽉 참 + 높은 분포 → 고밀도, 제안도 크게(라벨↔숫자 일치)', () => {
  const likes = Array.from({ length: 20 }, (_, i) => (i + 1) * 500); // 500..10000
  const r = suggestMinFaves(likes, 20);
  assert.equal(r.density, 'high');
  assert.ok(r.suggested >= 800, `고밀도면 제안도 800↑: ${r.suggested}`);
});

test('꽉 참 + 낮은 분포 → 제안 100이면 density도 low(모순 없음)', () => {
  const r = suggestMinFaves(Array(20).fill(20), 20);
  assert.equal(r.suggested, 100);
  assert.equal(r.density, 'low');
});

test('중간 분포 → moderate', () => {
  const likes = Array.from({ length: 20 }, (_, i) => 200 + i * 20); // 200..580, p25≈290
  const r = suggestMinFaves(likes, 20);
  assert.equal(r.density, 'moderate');
  assert.ok(r.suggested > 150 && r.suggested < 800);
});
