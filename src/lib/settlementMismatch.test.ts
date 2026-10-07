// 정산팀 지급 금액 ≠ 작업 금액 판정(스펙 2026-10-07 §4·§10) — 순수. 실례 2건(17dsy·saachan)과 정상 환율 건·경계를 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameTaskCost } from './campaignCost.ts';
import {
  paidMismatch, taskPaidMismatch, FX_RATIO_BAND, composeKeepReason, KEEP_REASONS, requestCostOf, paidFxRateText,
  partnerNameLabel, isPaidBadge, pendingRequestCost, type MismatchSource,
} from './settlementDisplay.ts';

// @17dsy_ 더스퀘어치과_10월1주차 인용RT — 작업 4,000엔, 정산팀 엔화 6,000엔 지급(메모 "인용 6000엔")
const dsy: MismatchSource = {
  status: 'requested', externalStatus: 'paid', taskId: 't1', taskCost: { amount: 4000, currency: 'JPY' },
  payoutCurrency: 'JPY', fee: null, rateKrwPerJpy: 10, paidAmountKrw: 51000, paidAmountJpy: 6000,
  diffAckKind: null, diffAckTaskCost: null,
};
// @saachan0013 더스퀘어치과_9월2주차 인용RT — 작업 50,000원, PayPal(5%) 달러 지급 $104.08 = 139,758원, 엔화 값 없음
const saachan: MismatchSource = {
  ...dsy, taskCost: { amount: 50000, currency: 'KRW' }, fee: { mode: 'grossUp', percent: 5 }, paidAmountKrw: 139758, paidAmountJpy: null,
};
// 정상 엔화 지급(엔화 값 없음) — 작업 5,000엔, 수수료 없음 → 기대 송금 5,000엔 × 요청 환율 10 = 50,000원
const band = (paidAmountKrw: number): MismatchSource => ({ ...dsy, taskCost: { amount: 5000, currency: 'JPY' }, paidAmountJpy: null, paidAmountKrw });

test('sameTaskCost — 둘 다 없음은 같다, 금액·통화가 모두 같아야 같다', () => {
  assert.equal(sameTaskCost(null, null), true);
  assert.equal(sameTaskCost({ amount: 1, currency: 'KRW' }, null), false);
  assert.equal(sameTaskCost({ amount: 1, currency: 'KRW' }, { amount: 1, currency: 'KRW' }), true);
  assert.equal(sameTaskCost({ amount: 1, currency: 'KRW' }, { amount: 1, currency: 'JPY' }), false);
});

test('FX_RATIO_BAND — 범위는 한 곳(0.80~1.00)', () => {
  assert.deepEqual(FX_RATIO_BAND, { min: 0.8, max: 1 });
});

test('실례 17dsy — 엔화 지급 + 엔화 값 있음: 엔화끼리 정확히 비교, 작업 금액을 6,000엔으로 고치면 풀린다', () => {
  assert.deepEqual(paidMismatch(dsy), { kind: 'exact', expectedGross: 4000, paid: 6000, diff: 2000, currency: 'JPY' });
  assert.equal(taskPaidMismatch({ ...dsy, taskCost: { amount: 6000, currency: 'JPY' } }), null);
});

test('실례 saachan — 달러 지급(엔화 값 없음): 비율 2.66이 범위 밖이라 다름, 맞는 금액이면 범위 안', () => {
  const m = paidMismatch(saachan);
  assert.ok(m && m.kind === 'band');
  assert.equal(m.expectedGross, 5263);              // round(5,000 ÷ 0.95)
  assert.equal(m.diff, 139758 - 52630);
  assert.ok(m.ratio > 2.65 && m.ratio < 2.66);
  // 150,000원이면 기대 15,789엔 × 10 = 157,890원, 비율 0.885 — 환율로 설명된다
  assert.equal(taskPaidMismatch({ ...saachan, taskCost: { amount: 150000, currency: 'KRW' } }), null);
});

test('정상 환율 건(0.85·0.90)과 경계(0.80·1.00)는 같음, 그 바깥은 다름', () => {
  assert.equal(paidMismatch(band(42500)), null);   // 0.85
  assert.equal(paidMismatch(band(45000)), null);   // 0.90
  assert.equal(paidMismatch(band(40000)), null);   // 0.80 — 경계 포함
  assert.equal(paidMismatch(band(50000)), null);   // 1.00 — 경계 포함
  assert.equal(paidMismatch(band(39999))?.kind, 'band');
  assert.equal(paidMismatch(band(50001))?.kind, 'band');
  assert.equal(paidMismatch(band(50001))?.diff, 1);
});

test('원화 지급 — 정액 수수료: 작업 30,000원 + 1,650원 = 기대 31,650원', () => {
  const krw: MismatchSource = { ...dsy, taskCost: { amount: 30000, currency: 'KRW' }, payoutCurrency: 'KRW', fee: { mode: 'fixed', amount: 1650 }, paidAmountJpy: null, paidAmountKrw: 31650 };
  assert.equal(paidMismatch(krw), null);
  assert.deepEqual(paidMismatch({ ...krw, paidAmountKrw: 30000 }), { kind: 'exact', expectedGross: 31650, paid: 30000, diff: -1650, currency: 'KRW' });
});

test('작업 원화 → 엔화 지급(비율 수수료 5%): 30,000원 → 3,000엔 → 송금 3,158엔', () => {
  const s: MismatchSource = { ...dsy, taskCost: { amount: 30000, currency: 'KRW' }, fee: { mode: 'grossUp', percent: 5 }, paidAmountJpy: 3158, paidAmountKrw: 27000 };
  assert.equal(paidMismatch(s), null);
  assert.deepEqual(paidMismatch({ ...s, paidAmountJpy: 4000 }), { kind: 'exact', expectedGross: 3158, paid: 4000, diff: 842, currency: 'JPY' });
});

test('작업 엔화 → 원화 지급: 3,000엔 × 10 = 30,000원', () => {
  const s: MismatchSource = { ...dsy, taskCost: { amount: 3000, currency: 'JPY' }, payoutCurrency: 'KRW', paidAmountJpy: null, paidAmountKrw: 30000 };
  assert.equal(paidMismatch(s), null);
});

test('판정 대상 아님 — 취소된 요청·지급 전·작업 없음·작업 금액 없음', () => {
  assert.equal(paidMismatch({ ...dsy, status: 'cancelled' }), null);
  assert.equal(paidMismatch({ ...dsy, externalStatus: 'scheduled' }), null);
  assert.equal(paidMismatch({ ...dsy, taskId: null }), null);
  assert.equal(paidMismatch({ ...dsy, taskCost: null }), null);
});

test('처리 기록 — 처리 때 작업 금액이 지금과 같으면 숨기고, 바뀌면 다시 뜬다. 옛 확인(종류 없음)은 숨기지 않는다', () => {
  const kept: MismatchSource = { ...dsy, diffAckKind: 'kept', diffAckTaskCost: { amount: 4000, currency: 'JPY' } };
  assert.equal(taskPaidMismatch(kept), null);
  assert.notEqual(paidMismatch(kept), null);                                                        // 차이 자체는 그대로 있다
  assert.equal(taskPaidMismatch({ ...kept, taskCost: { amount: 5000, currency: 'JPY' } })?.kind, 'exact');   // 누가 다시 고쳤다
  assert.equal(taskPaidMismatch({ ...dsy, diffAckKind: null, diffAckTaskCost: null })?.kind, 'exact');
});

test('composeKeepReason — 선택지 + 메모, 기타는 메모 필수, 모르는 선택지·200자 초과는 거절', () => {
  assert.deepEqual([...KEEP_REASONS], ['환율·송금 수수료 차이', '추가 지급(별도 합의)', '기타']);
  assert.equal(composeKeepReason('환율·송금 수수료 차이', ''), '환율·송금 수수료 차이');
  assert.equal(composeKeepReason('추가 지급(별도 합의)', ' 인용 6000엔 '), '추가 지급(별도 합의) — 인용 6000엔');
  assert.equal(composeKeepReason('기타', '  '), null);
  assert.equal(composeKeepReason('기타', '중복 지급'), '기타 — 중복 지급');
  assert.equal(composeKeepReason('아무거나', 'x'), null);
  assert.equal(composeKeepReason('기타', 'x'.repeat(200)), null);
});

test('requestCostOf — 요청에 담긴 작업 금액(엔화는 원화 ÷ 요청 환율)', () => {
  assert.deepEqual(requestCostOf({ costCurrency: 'JPY', amountKrw: 40000, rateKrwPerJpy: 10 }), { amount: 4000, currency: 'JPY' });
  assert.deepEqual(requestCostOf({ costCurrency: 'KRW', amountKrw: 50000, rateKrwPerJpy: 10 }), { amount: 50000, currency: 'KRW' });
});

test('paidFxRateText — 엔화로 보낸 건의 실제 환율(펼침 전용)', () => {
  assert.equal(paidFxRateText({ payoutCurrency: 'JPY', paidAmountKrw: 42450, paidAmountJpy: 5000, amountGross: 5000 }), '1엔 = 8.49원');
  assert.equal(paidFxRateText({ payoutCurrency: 'JPY', paidAmountKrw: 42450, paidAmountJpy: null, amountGross: 5000 }), '1엔 = 8.49원');
  assert.equal(paidFxRateText({ payoutCurrency: 'KRW', paidAmountKrw: 30000, paidAmountJpy: null, amountGross: 30000 }), null);
  assert.equal(paidFxRateText({ payoutCurrency: 'JPY', paidAmountKrw: null, paidAmountJpy: null, amountGross: 5000 }), null);
});

test('partnerNameLabel — 저장된 옛 이름(정산 프로덕트)은 화면에서 정산팀으로', () => {
  assert.equal(partnerNameLabel('정산 프로덕트'), '정산팀');
  assert.equal(partnerNameLabel('박구건'), '박구건');
  assert.equal(partnerNameLabel(null), null);
});

test('isPaidBadge / pendingRequestCost — 지급 전 살아 있는 요청의 금액이 작업 금액과 다를 때만 안내', () => {
  const badge = { status: 'requested' as const, externalStatus: 'received' as const, costCurrency: 'JPY' as const, amountKrw: 40000, rateKrwPerJpy: 10 };
  assert.deepEqual(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: badge }), { amount: 4000, currency: 'JPY' });
  assert.equal(pendingRequestCost({ cost: { amount: 4000, currency: 'JPY' }, settlement: badge }), null);
  assert.equal(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: { ...badge, externalStatus: 'paid' } }), null);
  assert.equal(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: { ...badge, status: 'cancelled' } }), null);
  assert.equal(pendingRequestCost({ cost: { amount: 6000, currency: 'JPY' }, settlement: null }), null);
  assert.equal(isPaidBadge({ ...badge, externalStatus: 'paid' }), true);
  assert.equal(isPaidBadge({ ...badge, status: 'cancelled', externalStatus: 'paid' }), false);
  assert.equal(isPaidBadge(badge), false);
  assert.equal(isPaidBadge(null), false);
});
