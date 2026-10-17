import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDepartment, buildViewDoc, decodeViewDoc, crmStatusOf, percentileRank, type MarketClinicBase, type MarketMonth } from './marketClinic.ts';

const base = (id: string, o: Partial<MarketClinicBase> = {}): MarketClinicBase => ({
  id, dept: '피부과', name: id, address: '서울특별시 강남구 테헤란로 1 (역삼동)', sido: '서울특별시', gu: '강남구',
  sggCode: '11680', dongCode: '1168064000', dong: '역삼1동', lat: 37.5, lng: 127.03, areaM2: 100, openedOn: '2020-01-01',
  doctors: 2, specialists: 1, departments: null, brand: id, branches: 1, isChain: false, registered: false, countries: [], ...o,
});
const month = (m: string, sales: number | null, o: Partial<MarketMonth> = {}): MarketMonth => ({
  month: m, sales, salesDomestic: null, salesForeign: null, foreignPct: null, visits: null, visitsForeign: null,
  foreignArpu: null, salesPerDoctor: null, salesPerArea: null, estimateType: '정확값(단독)', ...o,
});

test('백분위 — 같은 값은 위쪽 끝까지', () => {
  assert.equal(percentileRank([1, 2, 2, 3], 2), 0.75);
  assert.equal(percentileRank([], 5), null);
  assert.equal(percentileRank([1, 2], null), null);
});

test('파생 지표 — 구 안 순위·시그널·기회 점수·신규 개원', () => {
  const rows = [
    // 매출 1위 · 유치 등록 · 외국인 5% → 등록했지만 외국인 적음 + 국내 매출 상위
    { base: base('a', { registered: true }), latest: month('2026-09', 900, { foreignPct: 5, salesPerArea: 9 }), prev: month('2026-08', 600) },
    { base: base('b'), latest: month('2026-09', 500, { foreignPct: 60, salesPerArea: 5 }), prev: month('2026-08', 500) },
    { base: base('c', { openedOn: '2026-06-01' }), latest: month('2026-09', 100, { foreignPct: 10, salesPerArea: 1 }), prev: null },
    { base: base('d', { gu: '서초구', sggCode: '11650' }), latest: null, prev: null },
  ];
  const d = deriveDepartment(rows, new Date('2026-10-17'));
  const a = d.get('a')!, b = d.get('b')!, c = d.get('c')!, x = d.get('d')!;
  assert.deepEqual([a.guRank, a.guCount, b.guRank, c.guRank], [1, 3, 2, 3]);
  assert.equal(a.growth, 50);
  assert.equal(b.growth, 0);
  assert.equal(c.growth, null);
  assert.equal(a.salesPctl, 1);
  assert.equal(a.sigUnderused, true);
  assert.equal(a.sigDomesticStrong, true);
  assert.equal(b.sigUnderused, false);              // 외국인 60%
  assert.equal(c.sigUnderused, false);              // 미등록
  assert.equal(c.isNew, true);
  assert.equal(a.isNew, false);
  assert.equal(a.effGap, 1.8);                      // 9 ÷ 중앙값 5
  // a: 0.4×1 + 0.25×0.95 + 0.15×1 + 0.2×1(성장률 최고) = 0.9875 → 99
  assert.equal(a.score, 99);
  assert.equal(x.score, null);                      // 매출 없음
  assert.equal(x.guRank, null);
});

test('외국인 구분이 없는 진료과는 외국인 시그널을 내지 않는다', () => {
  const rows = [{ base: base('a', { registered: true }), latest: month('2026-09', 900), prev: null }];
  const d = deriveDepartment(rows, new Date('2026-10-17')).get('a')!;
  assert.equal(d.sigUnderused, false);
  assert.equal(d.sigDomesticStrong, false);
  assert.equal(d.score, Math.round(100 * (0.4 * 1 + 0.25 * 0.5 + 0.15 + 0.2 * 0.5))); // 외국인·성장 모름은 중간값
});

test('완성본 — 열로 담았다 풀면 같은 값, 주소 괄호 꼬리 제거, 소표본 객단가 숨김', () => {
  const months = ['2026-08', '2026-09'];
  const series = [month('2026-08', 600), month('2026-09', 900, { foreignPct: 5, visitsForeign: 10, foreignArpu: 1_000_000, estimateType: '묶음 면적배분 추정(2곳)' })];
  const derived = { growth: 50, guRank: 1, guCount: 3, salesPctl: 1, effGap: 1.8, sigUnderused: true, sigDomesticStrong: true, score: 99, isNew: false };
  const doc = buildViewDoc('피부과', months, '2026-10-17T00:00:00Z', [{ base: base('a', { lat: 37.123456789 }), series, derived }]);
  const [c] = decodeViewDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(c.address, '서울특별시 강남구 테헤란로 1');
  assert.equal(c.lat, 37.12346);
  assert.equal(c.month, '2026-09');
  assert.equal(c.sales, 900);
  assert.equal(c.foreignArpu, null);               // 외국인 방문 30건 미만
  assert.equal(c.exact, false);
  assert.equal(c.score, 99);
  assert.deepEqual(c.series, [{ m: '2026-08', sales: 600, domestic: null, foreign: null }, { m: '2026-09', sales: 900, domestic: null, foreign: null }]);
});

test('영업 상태 — 리포트 있으면 서비스 중, 없으면 준비, 제안서 있는 리드만 발송, 계약 리드는 빼기', () => {
  assert.equal(crmStatusOf({ kind: 'clinic', reports: 3 }), 'client');
  assert.equal(crmStatusOf({ kind: 'clinic', reports: 0 }), 'onboarding');
  assert.equal(crmStatusOf({ kind: 'lead', proposals: 1, converted: false }), 'lead');
  assert.equal(crmStatusOf({ kind: 'lead', proposals: 0, converted: false }), null);
  assert.equal(crmStatusOf({ kind: 'lead', proposals: 2, converted: true }), null);
});
