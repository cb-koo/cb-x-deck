import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, formatDate } from './format.ts';

test('formatCount: X식 K/M 축약', () => {
  assert.equal(formatCount(null), '–');
  assert.equal(formatCount(883), '883');
  assert.equal(formatCount(2474), '2,474');       // 1만 미만은 콤마 표기 (X와 동일)
  assert.equal(formatCount(12000), '12K');        // .0은 생략
  assert.equal(formatCount(15300), '15.3K');
  assert.equal(formatCount(153000), '153K');      // 100K 이상은 정수
  assert.equal(formatCount(999940), '999K');
  assert.equal(formatCount(1200000), '1.2M');
  assert.equal(formatCount(13740000), '13.7M');
  assert.equal(formatCount(196000000), '196M');   // 100M 이상은 정수
});

test('formatDate: ISO → 짧은 표기', () => {
  assert.equal(formatDate(null), '–');
  assert.equal(formatDate('2026-07-06T23:29:44.000Z'), "'26.07.06");
});
