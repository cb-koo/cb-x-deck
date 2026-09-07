// src/lib/settlementDisplay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, inGroup, paidText, paidDiff, needsDiffAck, hasPaidDiff, type StatusSource } from './settlementDisplay.ts';

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
test('paidText — 실제 송금액과 비교한다(수수료를 차액으로 오해하지 않는다)', () => {
  // 8/31 실제 건: 순액 30,000 / 송금액 31,650 / 실지급 31,650 → 차액 없음
  assert.equal(paidText(31650, 31650), '실지급 31,650원');
  assert.equal(paidText(31650, 30000), '실지급 30,000원 (송금액 31,650원, −1,650)');
  assert.equal(paidText(31650, 33000), '실지급 33,000원 (송금액 31,650원, +1,350)');
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

test('hasPaidDiff — 화면(needsDiffAck)과 서버(ackDiff)가 같은 판정을 쓴다: 확인 여부만 빼고 같다', () => {
  assert.equal(hasPaidDiff(paidWith(30000)), true);
  assert.equal(hasPaidDiff(paidWith(31650)), false);          // 차액 0
  assert.equal(hasPaidDiff(ext('scheduled')), false);          // 지급 전
  assert.equal(hasPaidDiff({ ...paidWith(30000), status: 'cancelled' }), false);
  // 이미 확인한 차액 건 — 차액은 여전히 있다(서버가 '확인할 게 없다'고 하면 안 된다), 화면 배지만 꺼진다
  const acked = { ...paidWith(30000), diffAckAt: '2026-09-01T00:00:00.000Z' };
  assert.equal(hasPaidDiff(acked), true);
  assert.equal(needsDiffAck(acked), false);
});

test('displayStatus — 고친 요청은 "요청됨 · 2판 M/D"(revised_at), 안 고쳤으면 그대로', () => {
  const plain = displayStatus({ ...base, externalStatus: null }, 'list');
  assert.equal(plain.label, '요청됨 8/28');
  const revised = displayStatus({ ...base, externalStatus: null, revision: 1, revisedAt: '2026-09-07T03:50:14.000Z' }, 'list');
  assert.equal(revised.label, '요청됨 · 2판 9/7');
  assert.match(revised.title, /고쳐서 다시 보낸 요청/);
  // 캠페인 표 배지는 짧게 유지 — 판 표시는 요청 내역에서만
  assert.equal(displayStatus({ ...base, externalStatus: null, revision: 1, revisedAt: '2026-09-07T03:50:14.000Z' }, 'campaign').label, '정산 요청됨 8/28');
});
