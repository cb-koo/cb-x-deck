import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagYakkiho } from './complianceFlags.ts';

test('리스크 용어 매칭', () => {
  assert.deepEqual(flagYakkiho('このクリームでシミが消える！'), ['シミが消える']);
  assert.ok(flagYakkiho('ニキビが治る').includes('治る'));
});
test('여러 용어 매칭', () => {
  const f = flagYakkiho('効果がある医薬品');
  assert.ok(f.includes('効果がある') && f.includes('医薬品'));
});
test('리스크 없으면 빈 배열', () => {
  assert.deepEqual(flagYakkiho('新作コスメを試してみた'), []);
  assert.deepEqual(flagYakkiho(''), []);
});
