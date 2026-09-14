import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatKoCount } from './formatKo.ts';

test('999 이하는 그대로 — 천단위 콤마도 붙이지 않는다', () => {
  assert.equal(formatKoCount(0), '0');
  assert.equal(formatKoCount(7), '7');
  assert.equal(formatKoCount(999), '999');
});

test('1,000~9,999는 천 단위', () => {
  assert.equal(formatKoCount(1000), '1천');
  assert.equal(formatKoCount(6100), '6.1천');
  assert.equal(formatKoCount(6000), '6천');
});

test('10,000 이상은 만 단위', () => {
  assert.equal(formatKoCount(10000), '1만');       // .0 생략
  assert.equal(formatKoCount(12000), '1.2만');
  assert.equal(formatKoCount(578000), '57.8만');
  assert.equal(formatKoCount(10_000_000), '1000만');
});

test('1억 이상은 억 단위', () => {
  assert.equal(formatKoCount(100_000_000), '1억');
  assert.equal(formatKoCount(120_000_000), '1.2억');
});

test('반올림은 소수 1자리에서', () => {
  assert.equal(formatKoCount(6150), '6.2천');
  assert.equal(formatKoCount(6140), '6.1천');
  assert.equal(formatKoCount(57_849), '5.8만');
});

test('반올림이 다음 단위에 닿으면 승격 — 9,999는 10천이 아니라 1만', () => {
  assert.equal(formatKoCount(9999), '1만');
  assert.equal(formatKoCount(99_999_999), '1억');
});

test('음수·NaN은 String(n) 폴백', () => {
  assert.equal(formatKoCount(-5), '-5');
  assert.equal(formatKoCount(NaN), 'NaN');
});
