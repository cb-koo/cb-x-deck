// 맞추기 창(스펙 2026-10-07 §5-1) — 정확히 비교 가능한 지급만 미리 채우고, 달러·엔화 없음은 비워 둔다(null).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTaskCostFromPaid, budgetDeltaKrw, computeMoney } from './settlementCalc.ts';

const base = { payoutCurrency: 'JPY' as const, paidAmountKrw: 51000, paidAmountJpy: 6000, fee: null, rateKrwPerJpy: 10, taskCurrency: 'JPY' as const };

test('엔화 지급·수수료 없음 → 지급 엔화 그대로(17dsy 6,000엔)', () => {
  assert.deepEqual(suggestTaskCostFromPaid(base), { cost: { amount: 6000, currency: 'JPY' }, paid: 6000, paidCurrency: 'JPY', feeAmount: 0 });
});

test('원화 지급·정액 수수료 → 지급 − 수수료', () => {
  const r = suggestTaskCostFromPaid({ ...base, payoutCurrency: 'KRW', paidAmountKrw: 41650, paidAmountJpy: null, fee: { mode: 'fixed', amount: 1650 }, taskCurrency: 'KRW' });
  assert.deepEqual(r, { cost: { amount: 40000, currency: 'KRW' }, paid: 41650, paidCurrency: 'KRW', feeAmount: 1650 });
});

test('엔화 지급·비율 수수료 5%, 작업은 원화 → 지급 × 0.95 반올림 × 요청 환율', () => {
  const r = suggestTaskCostFromPaid({ ...base, paidAmountJpy: 3158, fee: { mode: 'grossUp', percent: 5 }, taskCurrency: 'KRW' });
  assert.deepEqual(r, { cost: { amount: 30000, currency: 'KRW' }, paid: 3158, paidCurrency: 'JPY', feeAmount: 158 });
  // 제안값으로 다시 계산하면 지급과 같다(맞추면 판정이 풀린다)
  assert.equal(computeMoney(r!.cost, 'JPY', { mode: 'grossUp', percent: 5 }, 10).amountGross, 3158);
});

test('원화 지급, 작업은 엔화 → 순액 ÷ 요청 환율 반올림', () => {
  const r = suggestTaskCostFromPaid({ ...base, payoutCurrency: 'KRW', paidAmountKrw: 50000, paidAmountJpy: null, taskCurrency: 'JPY' });
  assert.deepEqual(r?.cost, { amount: 5000, currency: 'JPY' });
});

test('달러 지급·엔화 값 없음 → null(창이 비워 두고 직접 적게 한다)', () => {
  assert.equal(suggestTaskCostFromPaid({ ...base, paidAmountJpy: null }), null);
});

test('budgetDeltaKrw — 예산 화면과 같은 1엔 = 10원으로 집행액 차이', () => {
  assert.equal(budgetDeltaKrw({ amount: 4000, currency: 'JPY' }, { amount: 6000, currency: 'JPY' }), 20000);
  assert.equal(budgetDeltaKrw({ amount: 50000, currency: 'KRW' }, { amount: 140000, currency: 'KRW' }), 90000);
  assert.equal(budgetDeltaKrw({ amount: 40000, currency: 'KRW' }, { amount: 3000, currency: 'JPY' }), -10000);
  assert.equal(budgetDeltaKrw(null, { amount: 3000, currency: 'KRW' }), 3000);
});
