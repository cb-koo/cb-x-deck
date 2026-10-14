import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notableOf } from './trendNotable.ts';
import { summarize } from './searchTrend.ts';

const MONTHS = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor((i + 8) / 12)}-${String(((i + 8) % 12) + 1).padStart(2, '0')}`);
const ramp = (from: number, to: number) => Array.from({ length: 24 }, (_, i) => (i < 12 ? from : Math.round(from + ((to - from) * (i - 11)) / 12)));
const flat = (v: number) => Array(24).fill(v) as number[];

test('성장 주목 — 1년 새 월 1,000건 이상·+30% 이상·지금 꺾이지 않음', () => {
  const v = ramp(3000, 6000);
  const n = notableOf(summarize(v, MONTHS), v, null);
  assert.ok(n?.growth && n.growth.abs > 1000);
});

test('큰 시술의 작은 % 증가는 주목 아님(+16%)', () => {
  const v = ramp(180000, 210000);
  assert.equal(notableOf(summarize(v, MONTHS), v, null), null);
});

test('작은 시술의 큰 % 증가도 주목 아님(늘어난 수가 1,000건 미만)', () => {
  const v = ramp(200, 900);
  assert.equal(notableOf(summarize(v, MONTHS), v, null), null);
});

test('1년 새 크게 늘었어도 지금 꺾이는 중이면 주목 아님(마운자로)', () => {
  const v = [...ramp(5000, 12000).slice(0, 21), 9000, 6000, 5500];
  const s = summarize(v, MONTHS);
  assert.ok(s.state === 'peaked' || s.state === 'down', s.state);
  assert.equal(notableOf(s, v, null)?.growth ?? null, null);
});

test('한국 수요 주목 — 1년 새 월 100건 이상 늘고 지금 100 이상', () => {
  const v = flat(5000);
  assert.ok(notableOf(summarize(v, MONTHS), v, ramp(50, 400))?.korea);
  assert.equal(notableOf(summarize(v, MONTHS), v, ramp(20, 110)), null);  // 지금 110이지만 +90
});
