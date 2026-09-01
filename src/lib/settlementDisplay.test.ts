// src/lib/settlementDisplay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, inGroup, paidText, paidDiff, needsDiffAck, settlementDetail, type StatusSource } from './settlementDisplay.ts';

const base: StatusSource = { status: 'requested', externalStatus: null, externalNote: null, externalUpdatedAt: null, createdAt: '2026-08-28T03:00:00Z', cancelledAt: null,
  paidAmountKrw: null, grossKrw: 31650, diffAckAt: null };
const ext = (externalStatus: StatusSource['externalStatus'], note: string | null = null): StatusSource => ({ ...base, externalStatus, externalNote: note, externalUpdatedAt: '2026-08-29T03:00:00Z' });

test('displayStatus — 우리·그쪽 조합 → 라벨 하나(요청 내역)', () => {
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
  // 우리가 취소했고 그쪽 상태가 뭐든 취소가 이긴다
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
test('settlementDetail — 펼침 한 줄', () => {
  assert.equal(settlementDetail({ ...base, paidAmountKrw: null, paidAt: null, grossKrw: 30000 }), '아직 정산 쪽에서 확인 전이에요');
  assert.match(settlementDetail({ ...ext('on_hold', '계좌 확인'), paidAmountKrw: null, paidAt: null, grossKrw: 30000 }), /^보류 · .+ · 계좌 확인$/);
  assert.match(settlementDetail({ ...ext('paid', '환율'), paidAmountKrw: 29700, paidAt: '2026-08-30T05:10:00Z', grossKrw: 30000 }), /^지급 완료 · .+ · 실지급 29,700원 \(송금액 30,000원, −300\) · 메모: 환율$/);
  assert.match(settlementDetail({ ...ext('scheduled'), paidAmountKrw: null, paidAt: null, grossKrw: 30000 }), /^지급 예정 · /);
});

test('paidText — 실제 송금액과 비교한다(수수료를 차액으로 오해하지 않는다)', () => {
  // 8/31 실제 건: 순액 30,000 / 송금액 31,650 / 실지급 31,650 → 차액 없음
  assert.equal(paidText(31650, 31650), '실지급 31,650원');
  assert.equal(paidText(31650, 30000), '실지급 30,000원 (송금액 31,650원, −1,650)');
  assert.equal(paidText(31650, 33000), '실지급 33,000원 (송금액 31,650원, +1,350)');
});

test('settlementDetail — 지급 완료 줄도 송금액과 비교한다', () => {
  const s = { ...ext('paid'), paidAmountKrw: 31650, paidAt: '2026-08-31T10:59:00Z', grossKrw: 31650 };
  assert.ok(settlementDetail(s).includes('실지급 31,650원'));
  assert.ok(!settlementDetail(s).includes('송금액'), '차액이 없으면 비교값을 쓰지 않는다');
});

const paidWith = (paidAmountKrw: number, diffAckAt: string | null = null): StatusSource =>
  ({ ...ext('paid'), paidAmountKrw, diffAckAt });

test('차액 확인 — 실지급액이 송금액과 다르고 미확인이면 확인 필요', () => {
  assert.equal(displayStatus(paidWith(30000), 'list').key, 'paid_diff');
  assert.equal(displayStatus(paidWith(30000), 'list').label, '지급 완료 · 차액 확인 필요');
  assert.equal(displayStatus(paidWith(30000), 'list').tone, 'warn');
  assert.equal(displayStatus(paidWith(30000), 'campaign').label, '정산 차액 확인 필요');
});

test('차액 확인 — 차액 0이거나 이미 확인했으면 그냥 지급 완료', () => {
  assert.equal(displayStatus(paidWith(31650), 'list').key, 'paid');
  assert.equal(displayStatus(paidWith(30000, '2026-09-01T05:00:00Z'), 'list').key, 'paid');
  assert.equal(displayStatus(paidWith(30000, '2026-09-01T05:00:00Z'), 'list').label, '지급 완료 8/29');
});

test('차액 확인 — 취소된 요청에는 뜨지 않는다', () => {
  const s = { ...paidWith(30000), status: 'cancelled' as const, cancelledAt: '2026-08-30T03:00:00Z' };
  assert.equal(displayStatus(s, 'list').key, 'cancelled');
});

test('차액 확인 — 지급 완료 필터에 차액 건도 포함된다', () => {
  assert.ok(inGroup('paid_diff', 'paid'), '차액 건도 지급 완료다 — 필터에서 사라지면 안 된다');
  assert.ok(inGroup('paid_diff', 'paid_diff'));
  assert.ok(!inGroup('paid', 'paid_diff'));
  assert.ok(inGroup('paid_diff', ''));
});

test('paidDiff / needsDiffAck', () => {
  assert.equal(paidDiff({ paidAmountKrw: null, grossKrw: 31650 }), null);
  assert.equal(paidDiff({ paidAmountKrw: 30000, grossKrw: 31650 }), -1650);
  assert.equal(needsDiffAck(paidWith(30000)), true);
  assert.equal(needsDiffAck(paidWith(31650)), false);
  assert.equal(needsDiffAck(ext('scheduled')), false);
});
