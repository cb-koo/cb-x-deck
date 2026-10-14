import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, describe, changeRank, seasonalFactors } from './searchTrend.ts';

// 2022-09 ~ 2026-08, 48개월
const MONTHS = Array.from({ length: 48 }, (_, i) => {
  const m = 8 + i;  // 0-based month index from 2022-01
  return `${2022 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
});
const flat = (v: number) => Array(48).fill(v) as number[];
// 끝 k개월을 바꾼다
const tail = (base: number, ...last: number[]) => { const v = flat(base); v.splice(48 - last.length, last.length, ...last); return v; };

test('데이터 없음·짧은 데이터', () => {
  assert.equal(summarize(null, MONTHS).state, 'nodata');
  assert.equal(summarize([1, 2, 3], MONTHS.slice(0, 3)).state, 'nodata');
});

test('최근 평균 100 미만이면 소량 — 추세는 보지 않는다', () => {
  const s = summarize(tail(10, 90, 90, 90), MONTHS);
  assert.equal(s.state, 'low');
  assert.equal(s.recent, null);
});

test('태그는 최근 3개월 vs 직전 3개월 — ±20% 안쪽은 보합', () => {
  assert.equal(summarize(tail(1000, 1150, 1150, 1150), MONTHS).state, 'flat');
  assert.equal(summarize(tail(1000, 1300, 1300, 1300), MONTHS).state, 'up');
  assert.equal(summarize(tail(1000, 700, 700, 700), MONTHS).state, 'down');
});

test('급상승은 +50% 이상이고 월 300 이상', () => {
  assert.equal(summarize(tail(1000, 2000, 2000, 2000), MONTHS).state, 'surge');
  assert.equal(summarize(tail(150, 250, 250, 250), MONTHS).state, 'up');  // +67%지만 월 300 미만
});

test('오른 뒤 6개월째 제자리면 1년 전보다 많아도 보합(10-14 세르프)', () => {
  const v = flat(10000);
  v.splice(36, 12, 11000, 13000, 15000, 17000, 19000, 20000, 20400, 20200, 20900, 19900, 19700, 19200);
  const s = summarize(v, MONTHS);
  assert.equal(s.state, 'flat');
  assert.ok(s.change! > 0.3);
  assert.match(describe(s), /^최근 4개월 제자리 .* 1년 전보다 \d+% 많음/);
});

test('줄었다가 최근 반등하면 1년 전보다 적어도 상승(10-14 울트라콜)', () => {
  const v = flat(800);
  v.splice(36, 12, 700, 650, 600, 550, 500, 450, 440, 450, 420, 540, 520, 620);
  const s = summarize(v, MONTHS);
  assert.equal(s.state, 'up');
  assert.match(describe(s), /1년 전보다 \d+% 적음/);
});

test('해마다 같은 달 오르내리는 계절은 계절을 지우고 본다 — 여름 성수기가 매년 상승이 되지 않게', () => {
  const v = MONTHS.map((m) => (/-0[678]$/.test(m) ? 2000 : 1000));  // 매년 6~8월 두 배
  assert.ok(seasonalFactors(v, MONTHS));
  const s = summarize(v, MONTHS);
  assert.equal(s.state, 'flat');
  assert.match(describe(s), /계절 감안/);
});

test('한 해만 튄 달은 계절이 아니다', () => {
  const v = flat(1000);
  v[MONTHS.indexOf('2024-12')] = 3000;
  assert.equal(seasonalFactors(v, MONTHS), null);
});

test('한 달만 튀고 지난달 꺾였으면 일시 급등(10-14 네오빔)', () => {
  const s = summarize(tail(150, 120, 130, 150, 130, 120, 150, 1320, 470), MONTHS);
  assert.equal(s.state, 'spiked');
  assert.equal(s.spike?.month, '2026-07');
  assert.match(describe(s), /^7월에 한 달만 급등 후 하락 중/);
});

test('두 달 올랐다가 지난달 크게 꺾였으면 하락 전환(10-14 애교필러)', () => {
  const s = summarize(tail(340, 360, 320, 330, 680, 690, 350), MONTHS);
  assert.equal(s.state, 'peaked');
  assert.match(describe(s), /^오르다 최근 꺾임 \(최근 6개월 고점 월 690 → 지난달 350\)/);
});

test('1년 새 크게 오른 채로 최근 3개월 줄면 하락이 아니라 하락 전환', () => {
  const v = flat(1000);
  v.splice(36, 12, 1500, 2000, 3000, 4000, 5000, 6000, 7000, 7000, 7000, 5000, 4800, 4600);
  assert.equal(summarize(v, MONTHS).state, 'peaked');
});

test('지난달까지 오르는 중이면 급상승(10-13 엠페이스)', () => {
  const v = flat(150);
  v.splice(24, 24, 110, 190, 110, 110, 600, 1100, 280, 300, 300, 1050, 1160, 1090, 910, 1300, 1790, 1930, 1950, 2850, 3740, 3870, 4670, 6130, 8550, 26970);
  assert.equal(summarize(v, MONTHS).state, 'surge');
});

test('1년 전 소량이면 1년 변화율 대신 신규 — 태그는 여전히 최근 방향', () => {
  const s = summarize(tail(50, 50, 50, 3000, 3000, 3000, 3000, 3000, 3000), MONTHS);
  assert.equal(s.change, null);
  assert.equal(s.state, 'flat');  // 반년째 같은 수준
  assert.match(describe(s), /1년 전엔 거의 없던 새 검색/);
});

test('추세 한 줄 — 지금 방향 먼저, 근거는 괄호, 1년 흐름은 뒤에', () => {
  assert.equal(describe(summarize(tail(1000, 1300, 1300, 1300), MONTHS)), '최근 3개월 증가 (직전 3개월보다 +30%) · 1년 전보다 30% 많음');
  assert.equal(describe(summarize(tail(1000, 3000, 3000, 3000), MONTHS)), '최근 3개월 급증 (직전 3개월보다 +200%) · 1년 전보다 3배');
  assert.match(describe(summarize(tail(10, 90, 90, 90), MONTHS)), /^검색 적음/);
});

test('예전에 한 번 내려앉고 최근 4개월 제자리면 하락이 아니라 보합(10-14 필러)', () => {
  const s = summarize(tail(5000, 5490, 3490, 3470, 3200, 3140, 3200), MONTHS);
  assert.equal(s.state, 'flat');
  assert.match(describe(s), /^최근 4개월 제자리 \(월 3,140~3,470\)/);
});

test('경계값은 보이는 반올림 값으로 — −19.9%는 −20%로 보이므로 하락', () => {
  const s = summarize(tail(1000, 1000, 1000, 1000, 790, 810, 803), MONTHS);
  assert.equal(s.recent, -0.2);
  assert.equal(s.state, 'down');
});

test('지난달 하나만 크게 움직이면 태그는 두고 문장에 알림(10-14 스킨부스터)', () => {
  const s = summarize(tail(5000, 5200, 4780, 5130, 5190, 4750, 7730), MONTHS);
  assert.equal(s.state, 'flat');
  assert.match(describe(s), /지난달 월 7,730으로 급증, 다음 달 확인 필요/);
});

test('정렬 — 지금 늘어나는 쪽 먼저, 소량·데이터 없음은 아래', () => {
  const up = summarize(tail(1000, 1500, 1500, 1500), MONTHS);
  const down = summarize(tail(1000, 500, 500, 500), MONTHS);
  const low = summarize(tail(10, 20, 20, 20), MONTHS);
  const none = summarize(null, MONTHS);
  const sorted = [none, low, down, up].sort((a, b) => changeRank(b) - changeRank(a));
  assert.deepEqual(sorted.map((s) => s.state), ['surge', 'down', 'low', 'nodata']);
});
