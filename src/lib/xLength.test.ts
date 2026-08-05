import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xWeightedLength, X_MAX_WEIGHTED } from './xLength.ts';

test('라틴 1자 = 1', () => {
  assert.equal(xWeightedLength('abc'), 3);
  assert.equal(xWeightedLength(''), 0);
});
test('CJK 1자 = 2 (일본어 140자 = 280)', () => {
  assert.equal(xWeightedLength('こんにちは'), 10);
  assert.equal(xWeightedLength('施術'), 4);
  assert.equal(xWeightedLength('aこ'), 3);
});
test('이모지 = 2', () => {
  assert.equal(xWeightedLength('🙌'), 2);
});
test('URL은 길이와 무관하게 23', () => {
  assert.equal(xWeightedLength('https://example.com/very/long/path?with=query'), 23);
  // 'text ' (5) + URL(23) + ' end' (4)
  assert.equal(xWeightedLength('text https://a.io/x end'), 32);
});
test('상한 상수', () => {
  assert.equal(X_MAX_WEIGHTED, 280);
});
