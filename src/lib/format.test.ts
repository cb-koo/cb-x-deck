import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, formatDate } from './format.ts';

test('formatCount: 만 단위 일본식 축약', () => {
  assert.equal(formatCount(null), '–');
  assert.equal(formatCount(883), '883');
  assert.equal(formatCount(12000), '1.2万');
  assert.equal(formatCount(10940000), '1,094万');
});

test('formatDate: ISO → 짧은 표기', () => {
  assert.equal(formatDate(null), '–');
  assert.equal(formatDate('2026-07-06T23:29:44.000Z'), "'26.07.06");
});
