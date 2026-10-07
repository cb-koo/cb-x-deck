// src/lib/settlementDisplay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, inGroup, paidText, usdText, EXTERNAL_STATUS_LABEL, STATUS_GROUP_OPTIONS, type StatusSource } from './settlementDisplay.ts';

// 원화 지급·수수료 없음 기준 — 작업 31,650원 = 송금 31,650원
const base: StatusSource = { status: 'requested', externalStatus: null, externalNote: null, externalUpdatedAt: null, createdAt: '2026-08-28T03:00:00Z', cancelledAt: null,
  paidAmountKrw: null, grossKrw: 31650, diffAckAt: null, payoutCurrency: 'KRW', amountGross: 31650, paidAmountJpy: null,
  taskId: 't1', taskCost: { amount: 31650, currency: 'KRW' }, fee: null, rateKrwPerJpy: 10, diffAckKind: null, diffAckTaskCost: null };
const ext = (externalStatus: StatusSource['externalStatus'], note: string | null = null): StatusSource => ({ ...base, externalStatus, externalNote: note, externalUpdatedAt: '2026-08-29T03:00:00Z' });

test('displayStatus — 우리·정산팀 조합 → 라벨 하나(요청 내역)', () => {
  assert.deepEqual([displayStatus(base, 'list').key, displayStatus(base, 'list').label, displayStatus(base, 'list').tone], ['requested', '요청됨 8/28', 'blue']);
  assert.equal(displayStatus(ext('received'), 'list').label, '정산 접수 8/29');
  assert.equal(displayStatus(ext('scheduled'), 'list').label, '지급 예정');
  const hold = displayStatus(ext('on_hold', '계좌번호 다시 확인해 주세요 — 지점 코드가 없어요'), 'list');
  assert.equal(hold.key, 'on_hold'); assert.equal(hold.tone, 'warn'); assert.equal(hold.label, '보류 · 계좌번호 다시 확인해 주세요 — 지점…');
  assert.equal(displayStatus(ext('on_hold'), 'list').label, '보류');
  const paid = displayStatus(ext('paid'), 'list');
  assert.equal(paid.label, '지급 완료 8/29'); assert.equal(paid.tone, 'done');
  const cancelled = displayStatus({ ...ext('cancelled'), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list');
  assert.equal(cancelled.label, '취소됨 8/30'); assert.equal(cancelled.tone, 'gray');
  assert.equal(displayStatus({ ...ext('scheduled'), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list').key, 'cancelled');
});
test('displayStatus — 캠페인 표 라벨', () => {
  assert.equal(displayStatus(base, 'campaign').label, '정산 요청됨 8/28');
  assert.equal(displayStatus(ext('received'), 'campaign').label, '정산 접수 8/29');
  assert.equal(displayStatus(ext('scheduled'), 'campaign').label, '지급 예정');
  assert.equal(displayStatus(ext('on_hold', '계좌'), 'campaign').label, '정산 보류 — 확인 필요');
  assert.equal(displayStatus(ext('paid'), 'campaign').label, '지급 완료 8/29');
  assert.equal(displayStatus({ ...base, status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'campaign').label, '취소됨');
});
test('상태 라벨 — 정산팀 이름으로(§8-2)', () => {
  assert.equal(EXTERNAL_STATUS_LABEL.cancelled, '정산팀이 취소');
  assert.equal(STATUS_GROUP_OPTIONS.find((o) => o.value === 'paid_diff')?.label, '지급 금액 다름');
  for (const s of [base, ext('received'), ext('scheduled'), ext('on_hold')]) assert.doesNotMatch(displayStatus(s, 'list').title, /정산 쪽|그쪽|정산 프로덕트/);
});
test('inGroup — 진행 중은 요청됨·접수·지급 예정', () => {
  assert.ok(inGroup('requested', 'active') && inGroup('received', 'active') && inGroup('scheduled', 'active'));
  assert.ok(!inGroup('on_hold', 'active') && !inGroup('paid', 'active') && !inGroup('cancelled', 'active'));
  assert.ok(inGroup('on_hold', 'on_hold') && inGroup('paid', 'paid') && inGroup('cancelled', 'cancelled'));
  assert.ok(inGroup('paid', ''));
});
test('paidText — 차이 해석까지', () => {
  assert.equal(paidText(30000, 29700), '실지급 29,700원 (송금액 30,000원, −300)');
  assert.equal(paidText(30000, 30300), '실지급 30,300원 (송금액 30,000원, +300)');
  assert.equal(paidText(30000, 30000), '실지급 30,000원');
});

const paidWith = (paidAmountKrw: number): StatusSource => ({ ...ext('paid'), paidAmountKrw });

test('지급 금액 다름 — 작업 금액과 정산팀 지급이 다르면 paid_diff(요청 내역·캠페인 같은 라벨)', () => {
  assert.equal(displayStatus(paidWith(30000), 'list').key, 'paid_diff');
  assert.equal(displayStatus(paidWith(30000), 'list').label, '지급 금액 다름');
  assert.equal(displayStatus(paidWith(30000), 'list').tone, 'warn');
  assert.equal(displayStatus(paidWith(30000), 'campaign').label, '지급 금액 다름');
});
test('지급 금액 다름 — 작업 금액을 지급에 맞추면 그냥 지급 완료(요청 금액은 그대로여도)', () => {
  assert.equal(displayStatus({ ...paidWith(30000), taskCost: { amount: 30000, currency: 'KRW' } }, 'list').key, 'paid');
});
test('처리 기록 — 맞춤/그대로 둠은 요청 내역에 "지급 완료 · …", 캠페인 배지는 날짜', () => {
  const kept: StatusSource = { ...paidWith(30000), diffAckAt: '2026-10-07T04:00:00Z', diffAckKind: 'kept', diffAckTaskCost: { amount: 31650, currency: 'KRW' } };
  assert.equal(displayStatus(kept, 'list').key, 'paid');
  assert.equal(displayStatus(kept, 'list').label, '지급 완료 · 그대로 둠');
  assert.equal(displayStatus(kept, 'campaign').label, '지급 완료 8/29');
  const matched: StatusSource = { ...paidWith(30000), taskCost: { amount: 30000, currency: 'KRW' }, diffAckAt: '2026-10-07T04:00:00Z', diffAckKind: 'matched', diffAckTaskCost: { amount: 30000, currency: 'KRW' } };
  assert.equal(displayStatus(matched, 'list').label, '지급 완료 · 맞춤');
  // 옛 확인(종류 없음)은 판정을 숨기지 않는다 — 작업 금액이 지급과 다르면 다시 처리할 일이다
  assert.equal(displayStatus({ ...paidWith(30000), diffAckAt: '2026-09-01T05:00:00Z' }, 'list').key, 'paid_diff');
});
test('지급 금액 다름 — 취소된 요청에는 뜨지 않는다 · 지급 완료 필터에 포함', () => {
  assert.equal(displayStatus({ ...paidWith(30000), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list').key, 'cancelled');
  assert.ok(inGroup('paid_diff', 'paid'));
  assert.ok(inGroup('paid_diff', 'paid_diff'));
  assert.ok(!inGroup('paid', 'paid_diff'));
  assert.ok(inGroup('paid_diff', ''));
});
test('displayStatus — 고친 요청은 "요청됨 · 2판 M/D"(revised_at), 안 고쳤으면 그대로', () => {
  assert.equal(displayStatus({ ...base, externalStatus: null }, 'list').label, '요청됨 8/28');
  const revised = displayStatus({ ...base, externalStatus: null, revision: 1, revisedAt: '2026-09-07T03:50:14.000Z' }, 'list');
  assert.equal(revised.label, '요청됨 · 2판 9/7');
  assert.match(revised.title, /고쳐서 다시 보낸 요청/);
  assert.equal(displayStatus({ ...base, externalStatus: null, revision: 1, revisedAt: '2026-09-07T03:50:14.000Z' }, 'campaign').label, '정산 요청됨 8/28');
});
test('usdText — PayPal 달러 실지급액 표기(소수 둘째 자리, 천 단위 쉼표)', () => {
  assert.equal(usdText(18.62), '$18.62');
  assert.equal(usdText(1234.5), '$1,234.50');
  assert.equal(usdText(20), '$20.00');
});
test('엔화로 보낸 건 — 엔화 값이 요청대로면 원화가 달라도(환율) 지급 완료, 엔화가 다르면 지급 금액 다름', () => {
  const jpy: StatusSource = { ...ext('paid'), payoutCurrency: 'JPY', amountGross: 5000, grossKrw: 50000, paidAmountKrw: 42993, paidAmountJpy: 5000, taskCost: { amount: 5000, currency: 'JPY' } };
  assert.equal(displayStatus(jpy, 'list').key, 'paid');
  assert.equal(displayStatus({ ...jpy, paidAmountJpy: 4500 }, 'list').key, 'paid_diff');
  // 달러 지급(엔화 값 없음) — 비율 42,993 ÷ 50,000 = 0.86, 환율로 설명된다
  assert.equal(displayStatus({ ...jpy, paidAmountJpy: null }, 'list').key, 'paid');
});
