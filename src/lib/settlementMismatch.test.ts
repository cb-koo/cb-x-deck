// 정산팀 지급 금액 ≠ 작업 금액 판정(스펙 2026-10-07 §4·§10) — 순수. 실례 2건(17dsy·saachan)과 정상 환율 건·경계를 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameTaskCost } from './campaignCost.ts';
import {
  paidMismatch, taskPaidMismatch, FX_RATIO_BAND, composeKeepReason, KEEP_REASONS, requestCostOf, paidFxRateText,
  partnerNameLabel, isPaidBadge, pendingRequestCost, type MismatchSource,
  PEER_RATIO_TOLERANCE, PEER_MIN_COUNT, bandRatio, payRoute, peerRatios, withPeerRatios,
} from './settlementDisplay.ts';

// @17dsy_ 더스퀘어치과_10월1주차 인용RT — 작업 4,000엔, 정산팀 엔화 6,000엔 지급(메모 "인용 6000엔")
const dsy: MismatchSource = {
  status: 'requested', externalStatus: 'paid', taskId: 't1', taskCost: { amount: 4000, currency: 'JPY' },
  payoutCurrency: 'JPY', fee: null, rateKrwPerJpy: 10, paidAmountKrw: 51000, paidAmountJpy: 6000,
  diffAckKind: null, diffAckTaskCost: null, paidAmountUsd: null, paidAt: null,
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

// ── 같은 날 지급분과 비교(koo 10-07, 스펙 §4-3 개정) ──
// 달러 지급: 작업 5,000엔·수수료 없음·환율 10 → 기대 50,000원. 비율 = 지급 원화 ÷ 50,000.
const usdRow = (id: string, ratio: number, paidAt: string = '2026-10-06T03:00:00Z', over: Partial<MismatchSource> = {}): MismatchSource & { id: string } => ({
  ...dsy, id, taskId: 't-' + id, taskCost: { amount: 5000, currency: 'JPY' }, paidAmountJpy: null, paidAmountUsd: 300,
  paidAmountKrw: Math.round(ratio * 50000), paidAt, ...over,
});
const judged = (rows: Array<MismatchSource & { id: string }>) => withPeerRatios(rows).map((r) => paidMismatch(r) !== null);

test('PEER 상수 — 한 곳(±3%, 3건)', () => {
  assert.equal(PEER_RATIO_TOLERANCE, 0.03);
  assert.equal(PEER_MIN_COUNT, 3);
});

test('bandRatio·payRoute — band 대상만 비율을 낸다, 지급 방식은 달러 값 유무', () => {
  assert.equal(bandRatio(usdRow('a', 0.885)), 0.885);
  assert.equal(bandRatio({ ...usdRow('a', 0.885), paidAmountJpy: 4000 }), null);        // 엔화 금액 있음 = exact 분기
  assert.equal(bandRatio({ ...usdRow('a', 0.885), externalStatus: 'scheduled' }), null);
  assert.equal(bandRatio({ ...usdRow('a', 0.885), status: 'cancelled' }), null);
  assert.equal(bandRatio({ ...usdRow('a', 0.885), taskCost: null }), null);
  assert.equal(payRoute(usdRow('a', 0.885)), 'usd');
  assert.equal(payRoute({ ...usdRow('a', 0.885), paidAmountUsd: null }), 'jpy-no-amount');
});

test('같은 날 달러 4건 — 0.885 정상 3건 + 2.655: 2.655 행만 다름', () => {
  assert.deepEqual(judged([usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 0.885), usdRow('d', 2.655)]), [false, false, false, true]);
});

test('같은 날 정상 3건 0.885 + 0.92(+4%): 0.92 행이 다름 — 고정 범위로는 통과했을 값', () => {
  const rows = [usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 0.885), usdRow('d', 0.92)];
  assert.equal(paidMismatch(rows[3]), null, '고정 범위만으로는 같음');
  assert.deepEqual(judged(rows), [false, false, false, true]);
});

test('같은 날 정상 3건 0.885 + 0.90(+1.7%): 다르지 않음', () => {
  assert.deepEqual(judged([usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 0.885), usdRow('d', 0.90)]), [false, false, false, false]);
});

test('같은 날 다른 건이 2건뿐 — peerRatio null → 고정 범위(0.92 같음, 1.05 다름)', () => {
  const rows = [usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 0.92)];
  assert.equal(withPeerRatios(rows)[2].peerRatio, null);
  assert.deepEqual(judged(rows), [false, false, false]);
  assert.deepEqual(judged([usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 1.05)]), [false, false, true]);
});

test('날짜는 서울 기준 — UTC로는 같은 날이어도 서울 23:59와 다음날 00:01은 다른 날', () => {
  // 서울 10-06 23:59 = 10-06 14:59Z, 서울 10-07 00:01 = 10-06 15:01Z
  const night = ['a', 'b', 'c', 'd'].map((id) => usdRow(id, 0.885, '2026-10-06T14:59:00Z'));
  const next = usdRow('e', 0.92, '2026-10-06T15:01:00Z');
  const m = peerRatios([...night, next]);
  assert.equal(m.get('e'), null);                    // 다음 날 행은 비교 대상이 없다
  assert.equal(m.get('a'), 0.885);                   // 앞 4건은 서로만 본다(e의 0.92가 끼지 않는다)
  assert.equal(paidMismatch(withPeerRatios([...night, next])[4]), null, '고정 범위로 떨어져 통과');
});

test('paidAt이 없으면 비교 대상 없음', () => {
  const m = peerRatios([usdRow('a', 0.885, null as unknown as string), usdRow('b', 0.885), usdRow('c', 0.885), usdRow('d', 0.885)]);
  assert.equal(m.get('a'), null);
  assert.equal(m.get('b'), null);   // 비교 가능한 다른 건이 2건뿐(paidAt 없는 a는 제외)
});

test('지급 방식이 다른 행은 peers에 안 들어간다', () => {
  const rows = [usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 0.885), usdRow('j', 0.885, undefined, { paidAmountUsd: null })];
  const m = peerRatios(rows);
  assert.equal(m.get('a'), null);   // 달러 방식 다른 건은 2건뿐
  assert.equal(m.get('j'), null);   // 엔화금액없음 방식은 혼자
});

test('band 대상이 아닌 행(엔화 금액 있음·취소)은 peers에 안 들어간다', () => {
  const rows = [usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 0.885), usdRow('x', 0.885, undefined, { paidAmountJpy: 4000 }), usdRow('y', 0.885, undefined, { status: 'cancelled' })];
  const m = peerRatios(rows);
  assert.equal(m.get('a'), null);
  assert.equal(m.get('x'), null);
});

test('자기 자신은 peers에서 제외 — 이상치 행의 기준은 나머지 3건', () => {
  const rows = [usdRow('a', 0.8), usdRow('b', 0.8), usdRow('c', 0.9), usdRow('d', 1.0)];
  const m = peerRatios(rows);
  assert.equal(m.get('d'), 0.8);    // [0.8,0.8,0.9] 중앙값 — 자기를 넣었다면 0.85
  assert.equal(m.get('a'), 0.9);    // [0.8,0.9,1.0]
});

test('짝수 개 중앙값 — 가운데 두 값의 평균', () => {
  const rows = [usdRow('a', 0.8), usdRow('b', 0.86), usdRow('c', 0.88), usdRow('d', 0.9), usdRow('e', 0.5)];
  assert.ok(Math.abs((peerRatios(rows).get('e') as number) - 0.87) < 1e-9);   // 다른 4건 [0.8,0.86,0.88,0.9] → (0.86+0.88)/2
});

test('peerRatio가 있으면 고정 범위 밖이어도 그 기준을 따른다(전부 0.95인 날 0.95는 같음)', () => {
  const rows = [usdRow('a', 0.7), usdRow('b', 0.7), usdRow('c', 0.7), usdRow('d', 0.7)];
  assert.deepEqual(judged(rows), [false, false, false, false]);
});

test('기대 원화 0(작업 금액 0) — 비율 무한대는 peer 계산에서 빠지고 판정은 다름', () => {
  const zero = usdRow('z', 1, undefined, { taskCost: { amount: 0, currency: 'JPY' }, paidAmountKrw: 1000 });
  const rows = [usdRow('a', 0.885), usdRow('b', 0.885), usdRow('c', 0.885), zero];
  assert.equal(peerRatios(rows).get('a'), null);   // 비교 가능한 다른 건은 b·c 2건뿐
  assert.deepEqual(judged(rows), [false, false, false, true]);
});
