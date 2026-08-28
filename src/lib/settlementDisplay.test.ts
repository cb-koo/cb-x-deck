// src/lib/settlementDisplay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, inGroup, paidText, settlementDetail, type StatusSource } from './settlementDisplay.ts';

const base: StatusSource = { status: 'requested', externalStatus: null, externalNote: null, externalUpdatedAt: null, createdAt: '2026-08-28T03:00:00Z', cancelledAt: null };
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
  assert.equal(paidText(30000, 29700), '실지급 29,700원 (요청 30,000원, −300)');
  assert.equal(paidText(30000, 30300), '실지급 30,300원 (요청 30,000원, +300)');
  assert.equal(paidText(30000, 30000), '실지급 30,000원');
});
test('settlementDetail — 펼침 한 줄', () => {
  assert.equal(settlementDetail({ ...base, paidAmountKrw: null, paidAt: null, amountKrw: 30000 }), '아직 정산 쪽에서 확인 전이에요');
  assert.match(settlementDetail({ ...ext('on_hold', '계좌 확인'), paidAmountKrw: null, paidAt: null, amountKrw: 30000 }), /^보류 · .+ · 계좌 확인$/);
  assert.match(settlementDetail({ ...ext('paid', '환율'), paidAmountKrw: 29700, paidAt: '2026-08-30T05:10:00Z', amountKrw: 30000 }), /^지급 완료 · .+ · 실지급 29,700원 \(요청 30,000원, −300\) · 메모: 환율$/);
  assert.match(settlementDetail({ ...ext('scheduled'), paidAmountKrw: null, paidAt: null, amountKrw: 30000 }), /^지급 예정 · /);
});
