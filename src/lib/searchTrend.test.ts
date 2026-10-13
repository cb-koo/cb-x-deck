import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, season, describe, changeRank } from './searchTrend.ts';

// 2022-09 ~ 2026-08, 48개월
const MONTHS = Array.from({ length: 48 }, (_, i) => {
  const m = 8 + i;  // 0-based month index from 2022-01
  return `${2022 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
});
const flat = (v: number) => Array(48).fill(v) as number[];
// 마지막 15개월만 바꾼다: 1년 전 3개월 = a, 최근 3개월 = b
const shift = (a: number, b: number, base = a) => { const v = flat(base); v.splice(33, 3, a, a, a); v.splice(45, 3, b, b, b); return v; };

test('데이터 없음·짧은 데이터', () => {
  assert.equal(summarize(null, MONTHS).state, 'nodata');
  assert.equal(summarize([1, 2, 3], MONTHS.slice(0, 3)).state, 'nodata');
});

test('최근 평균 100 미만이면 수요 적음 — 변화율은 내지 않는다', () => {
  const s = summarize(shift(10, 90), MONTHS);
  assert.equal(s.state, 'low');
  assert.equal(s.change, null);
});

test('±30% 안쪽은 유지(반올림 한 단계 ≈ 20%는 잡음)', () => {
  assert.equal(summarize(shift(1000, 1290), MONTHS).state, 'flat');
  assert.equal(summarize(shift(1000, 720), MONTHS).state, 'flat');
});

test('상승·하락 문턱 30%', () => {
  assert.equal(summarize(shift(1000, 1300), MONTHS).state, 'up');
  assert.equal(summarize(shift(1000, 700), MONTHS).state, 'down');
});

test('급상승은 두 배 이상이고 월 1,000 이상일 때만', () => {
  assert.equal(summarize(shift(400, 1000, 400), MONTHS).state, 'surge');
  assert.equal(summarize(shift(300, 900, 300), MONTHS).state, 'up');  // 세 배지만 1,000 미만
});

test('1년 전 0에서 새로 생긴 수요', () => {
  const s = summarize(shift(0, 2000, 0), MONTHS);
  assert.equal(s.state, 'surge');
  assert.equal(s.change, null);
  assert.match(describe(s), /거의 찾지 않던/);
});

test('꺾임 — 2년 전보다 크게 올랐지만 지난 12개월 최고치의 70% 이하로 내려옴', () => {
  const v = flat(1000);
  v.splice(36, 12, 1000, 2000, 5000, 8000, 9000, 6000, 5000, 4000, 3000, 2500, 2500, 2500);
  const s = summarize(v, MONTHS);
  assert.equal(s.state, 'peaked');
  assert.equal(s.peak12, 9000);
});

test('계절 — 3년 중 2년 이상 같은 달(±1) 정점이 평균 1.5배 이상', () => {
  const v = flat(1000);
  for (let i = 0; i < 48; i++) if (MONTHS[i].endsWith('-12')) v[i] = 3000;
  assert.equal(season(v, MONTHS), 12);
  assert.equal(summarize(v, MONTHS).seasonMonth, 12);
  assert.equal(season(flat(1000), MONTHS), null);
});

test('계절 — 12월과 1월은 ±1로 이어진 달', () => {
  const v = flat(1000);
  v[MONTHS.indexOf('2024-12')] = 3000;
  v[MONTHS.indexOf('2026-01')] = 3000;
  assert.notEqual(season(v, MONTHS), null);
});

test('판정 문장에 숫자와 판정이 같이 들어간다', () => {
  const s = summarize(shift(31100, 53167, 31100), MONTHS);
  assert.equal(s.state, 'up');
  assert.equal(describe(s), '1년 새 31,100 → 53,167로 늘고 있어요(+71%).');
});

test('숫자 뒤 조사 — 끝자리 0·3·6은 으로', () => {
  assert.match(describe(summarize(shift(1000, 2000), MONTHS)), /2,000으로/);
  assert.match(describe(summarize(shift(1000, 1300), MONTHS)), /1,300으로/);
  assert.match(describe(summarize(shift(1000, 1302), MONTHS)), /1,302로/);
});

test('정렬 — 늘어난 쪽 먼저, 수요 적음·데이터 없음은 아래', () => {
  const up = summarize(shift(1000, 1500), MONTHS);
  const down = summarize(shift(1000, 500), MONTHS);
  const low = summarize(shift(10, 20), MONTHS);
  const none = summarize(null, MONTHS);
  const sorted = [none, low, down, up].sort((a, b) => changeRank(b) - changeRank(a));
  assert.deepEqual(sorted.map((s) => s.state), ['up', 'down', 'low', 'nodata']);
});
