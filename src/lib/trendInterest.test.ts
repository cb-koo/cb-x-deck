import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interestShares, interestBaseline, interestOf } from './trendInterest.ts';

const P = (info: number, effect: number, worry: number, cost: number, place: number, concern = 0, korea = 0) => ({ info, effect, worry, cost, place, concern, korea, dose: 0 });

test('부위·한국을 빼고 다섯 관심사로 다시 100%', () => {
  const s = interestShares(P(0.1, 0.2, 0.1, 0.05, 0.05, 0.4, 0.1))!;
  assert.equal(Math.round(s.effect * 100), 40);
  assert.equal(interestShares(null), null);
});

test('평균보다 1.3배 이상 많이 찾는 것이 두드러진 관심사 — 비중 1위가 아니어도', () => {
  const base = interestBaseline([interestShares(P(0.2, 0.3, 0.2, 0.15, 0.15)), interestShares(P(0.2, 0.3, 0.2, 0.15, 0.15))]);
  const r = interestOf(interestShares(P(0.2, 0.3, 0.15, 0.3, 0.05)), base);  // 효과가 1위(30%)지만 평균과 같고, 가격이 평균의 2배
  assert.equal(r?.kind, 'standout');
  assert.equal(r?.kind === 'standout' && r.key, 'cost');
  assert.equal(r?.kind === 'standout' && Math.round(r.ratio * 10) / 10, 2);
});

test('두드러진 게 없으면 고르게, 비중이 없으면 null', () => {
  const base = interestBaseline([interestShares(P(0.2, 0.2, 0.2, 0.2, 0.2))]);
  assert.equal(interestOf(interestShares(P(0.22, 0.2, 0.2, 0.19, 0.19)), base)?.kind, 'even');
  assert.equal(interestOf(null, base), null);
});
