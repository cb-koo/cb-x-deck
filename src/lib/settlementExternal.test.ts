import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, clampLimit, toExternalItem, parseStatusUpdate, type ExportRow } from './settlementExternal.ts';
import type { PaymentRequestRow } from './settlementStore.ts';

const ID = '11111111-2222-4333-8444-555555555555';
test('커서 — 왕복, 깨진 값은 null', () => {
  const s = encodeCursor({ updatedAtUs: '1756368000123456', id: ID });
  assert.deepEqual(decodeCursor(s), { updatedAtUs: '1756368000123456', id: ID });
  assert.equal(decodeCursor('not-base64!!'), null);
  assert.equal(decodeCursor(Buffer.from('abc:def').toString('base64url')), null);      // µs가 숫자 아님
  assert.equal(decodeCursor(Buffer.from('123:nope').toString('base64url')), null);     // uuid 아님
  assert.equal(decodeCursor(Buffer.from('99999999999999999:' + ID).toString('base64url')), null); // 17자리 — bigint 넘침 방지
});
test('limit — 기본 100, 최대 500, 잘못된 값은 기본', () => {
  assert.equal(clampLimit(null), 100); assert.equal(clampLimit('50'), 50); assert.equal(clampLimit('9999'), 500);
  assert.equal(clampLimit('0'), 100); assert.equal(clampLimit('abc'), 100);
});

const row: PaymentRequestRow = {
  id: ID, taskId: 't', campaignId: 'c', campaignName: '캠', clientId: 'cl', clientName: '마인드피부과', influencerHandle: 'sawada_k', taskType: 'post',
  category: '마케팅비 > 원고료', categoryDefault: null, itemText: '항목', purposeText: '목적', amountKrw: 30000, costCurrency: 'KRW', payoutCurrency: 'JPY',
  rateKrwPerJpy: 10, amountNet: 3000, fee: { mode: 'grossUp', percent: 5 }, feeAmount: 158, amountGross: 3158, deadlineOn: '2026-08-29', referenceUrl: null, proof: null,
  paymentMethod: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', paypalId: 'keiko' }, requesterMemberId: 'm', requesterName: '모에카',
  status: 'requested', cancelledAt: null, cancelledByName: null, cancelReason: null, sentAt: null, externalId: null, note: '',
  createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
  externalStatus: null, paidAmountKrw: null, paidAt: null, externalNote: null, externalUpdatedAt: null, influencerId: 'inf', categoryOptionId: 'fee',
};
test('toExternalItem — 금액 분리·snake_case·되비침 null', () => {
  const e: ExportRow = { row, updatedAtUs: '1', requester: { email: 'a@b.c', slackId: null } };
  const it = toExternalItem(e);
  assert.equal(it.request_id, ID); assert.equal(it.revision, 0); assert.equal(it.status, 'requested');
  assert.equal(it.amount_krw, 30000); assert.equal(it.cost_currency, 'KRW');
  assert.deepEqual(it.payout, { currency: 'JPY', net: 3000, fee: { mode: 'grossUp', percent: 5 }, fee_amount: 158, gross: 3158, rate_krw_per_jpy: 10, gross_krw: 31580 });
  assert.deepEqual(it.influencer, { id: 'inf', handle: 'sawada_k' });
  assert.deepEqual(it.clinic, { id: 'cl', name: '마인드피부과' });
  assert.deepEqual(it.category, { code: 'fee', label: '마케팅비 > 원고료' });
  assert.deepEqual(it.payment_method, { type: 'paypal', holder: 'KEIKO', currency: 'JPY', paypal_id: 'keiko' });
  assert.deepEqual(it.requester, { name: '모에카', email: 'a@b.c', slack_id: null });
  assert.equal(it.cancelled, null);
  assert.deepEqual(it.settlement, { status: null, paid_amount_krw: null, paid_at: null, note: null, updated_at: null, external_id: null });
  assert.equal(it.deadline, '2026-08-29'); assert.equal(it.reference_url, null);
  // 증빙은 정산 프로덕트 계약에 칸이 없다(스펙 결정 6) — toExternalItem 출력에 proof가 어떤 키로도 섞여 나가면 안 된다
  assert.equal(JSON.stringify(it).includes('proof'), false);
});
test('toExternalItem — 취소·지급 완료 되비침', () => {
  const r2: PaymentRequestRow = { ...row, status: 'cancelled', cancelledAt: '2026-08-29T01:00:00.000Z', cancelledByName: '정산 프로덕트', cancelReason: '중복',
    externalStatus: 'paid', paidAmountKrw: 29700, paidAt: '2026-08-30T05:00:00.000Z', externalNote: '환율', externalUpdatedAt: '2026-08-30T05:00:00.000Z', externalId: 'X-1', requesterMemberId: null };
  const it = toExternalItem({ row: r2, updatedAtUs: '1', requester: { email: null, slackId: null } });
  assert.equal(it.revision, 1);
  assert.deepEqual(it.cancelled, { at: '2026-08-29T01:00:00.000Z', by_name: '정산 프로덕트', reason: '중복' });
  assert.deepEqual(it.settlement, { status: 'paid', paid_amount_krw: 29700, paid_at: '2026-08-30T05:00:00.000Z', note: '환율', updated_at: '2026-08-30T05:00:00.000Z', external_id: 'X-1' });
});

test('parseStatusUpdate — 정상·정규화', () => {
  const r = parseStatusUpdate({ status: 'paid', updated_at: '2026-08-30T05:00:00Z', paid_amount_krw: 29700, paid_at: '2026-08-30T05:00:00+09:00', note: ' 환율 ', external_id: 'X-1' });
  assert.ok(r.ok);
  assert.deepEqual(r.update, { status: 'paid', updatedAt: '2026-08-30T05:00:00.000Z', paidAmountKrw: 29700, paidAt: '2026-08-29T20:00:00.000Z', note: '환율', externalId: 'X-1' });
  const h = parseStatusUpdate({ status: 'on_hold', updated_at: '2026-08-29T00:00:00Z', note: '계좌 확인' });
  assert.ok(h.ok); assert.equal(h.update.paidAmountKrw, null); assert.equal(h.update.externalId, null);
});
test('parseStatusUpdate — 거절 사유는 필드 단위', () => {
  const bad = (body: unknown, field: string) => { const r = parseStatusUpdate(body); assert.ok(!r.ok); assert.equal(r.field, field); };
  bad(null, 'body'); bad([], 'body');
  bad({ updated_at: '2026-08-29T00:00:00Z' }, 'status');
  bad({ status: 'done', updated_at: '2026-08-29T00:00:00Z' }, 'status');
  bad({ status: 'received' }, 'updated_at');
  bad({ status: 'received', updated_at: 'yesterday' }, 'updated_at');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: 100 }, 'paid_at');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: -1, paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: 1.5, paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', note: 'x'.repeat(501) }, 'note');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', external_id: 'x'.repeat(101) }, 'external_id');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', note: 5 }, 'note');
});

test('toExternalItem — 원화 지급이면 gross_krw는 환산 없이 gross 그대로', () => {
  const krw: PaymentRequestRow = { ...row, payoutCurrency: 'KRW', amountNet: 20000, fee: null, feeAmount: 0, amountGross: 20000, amountKrw: 20000 };
  const it = toExternalItem({ row: krw, updatedAtUs: '1', requester: { email: null, slackId: null } });
  assert.deepEqual(it.payout, { currency: 'KRW', net: 20000, fee: null, fee_amount: 0, gross: 20000, rate_krw_per_jpy: 10, gross_krw: 20000 });
});

test('toExternalItem — 수수료가 붙으면 gross_krw가 amount_krw보다 크다(실제 나간 돈 ≠ 단가)', () => {
  const it = toExternalItem({ row, updatedAtUs: '1', requester: { email: null, slackId: null } });
  assert.equal(it.amount_krw, 30000);
  assert.equal(it.payout.gross_krw, 31580);   // 수수료 158엔 × 환율 10 = 1,580원 더
});
