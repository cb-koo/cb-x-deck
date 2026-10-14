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

test('급상승 = 가속 — 최근에 오르기 시작함', () => {
  const s = summarize(shift(400, 1000, 400), MONTHS);
  assert.equal(s.state, 'surge');
  assert.match(describe(s), /증가 속도/);
});

test('꾸준히 오르기만 하면 급상승이 아니라 상승(속도가 1년 전과 같음)', () => {
  const v = Array.from({ length: 48 }, (_, i) => Math.round(1000 * 1.04 ** i));  // 매달 4%씩, 1년 +60%
  const s = summarize(v, MONTHS);
  assert.ok(s.change! > 0.5);
  assert.equal(s.state, 'up');
});

test('계절 정점은 급상승이 아님 — 매년 같은 시기에 같은 만큼 오르면 가속 1', () => {
  const v = flat(1000);
  for (let i = 0; i < 48; i++) if (/-0[678]$/.test(MONTHS[i])) v[i] = 3000;  // 매년 6~8월
  const s = summarize(v, MONTHS);
  assert.notEqual(s.state, 'surge');
});

test('작은 시술(최근 6개월 월 300 미만)은 가속이어도 상승까지만', () => {
  assert.equal(summarize(shift(120, 400, 120), MONTHS).state, 'up');
});

test('1년 전 소량(월 100 미만)이면 변화율 대신 신규', () => {
  const t = summarize(shift(93, 8433, 93), MONTHS);
  assert.equal(t.state, 'surge');
  assert.equal(t.change, null);
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

test('지금이 1년 전의 20배 이상이면 신규(리투오 137 → 12,473)', () => {
  const t = summarize(shift(137, 12473, 137), MONTHS);
  assert.equal(t.state, 'surge');
  assert.equal(t.change, null);
});

test('고점 대비 내려왔어도 지금 다시 오르는 중이면 하락 전환 아님(울쎄라 출렁임)', () => {
  const v = flat(10000);
  v.splice(24, 24, 20000, 20000, 20000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 46000, 30000, 30000, 30000, 30000, 30000, 32000, 32000, 32000);
  assert.notEqual(summarize(v, MONTHS).state, 'peaked');
});

test('지난달이 최고치면 하락 전환이 아니라 상승 — 정점이 최근 3개월 앞에 있어야 꺾임(엠페이스 사례)', () => {
  const v = flat(150);
  v.splice(24, 24, 110, 190, 110, 110, 600, 1100, 280, 300, 300, 1050, 1160, 1090, 910, 1300, 1790, 1930, 1950, 2850, 3740, 3870, 4670, 6130, 8550, 26970);
  const s = summarize(v, MONTHS);
  assert.equal(s.state, 'surge');
  assert.equal(s.seasonMonth, null);  // 꾸준히 오르는 해의 마지막 달 정점은 계절이 아님
});

test('계절 — 3년 중 2년 이상 같은 달(±1) 정점이 평균 1.5배 이상', () => {
  const v = flat(1000);
  for (let i = 0; i < 48; i++) if (MONTHS[i].endsWith('-12')) v[i] = 3000;
  assert.equal(season(v, MONTHS), 12);
  assert.equal(summarize(v, MONTHS).seasonMonth, 12);
  assert.equal(season(flat(1000), MONTHS), null);
});

test('계절 — 여름 시술(7월 정점)은 해마다 같으면 성수기', () => {
  const v = flat(1000);
  for (let i = 0; i < 48; i++) if (MONTHS[i].endsWith('-07')) v[i] = 2500;
  assert.equal(season(v, MONTHS), 7);
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
