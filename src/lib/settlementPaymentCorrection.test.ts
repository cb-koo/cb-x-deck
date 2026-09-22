import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentInfoCorrection, mergePaymentMethodCorrection, planRosterOverwrite } from './settlementPaymentCorrection.ts';
import type { PaymentMethodSnapshot } from './settlementCalc.ts';
import type { PaymentMethod } from './influencerPayment.ts';

const CID = '22222222-3333-4444-8555-666666666666';
const op = { id: '8f2c9e10-1b2a-4c3d-9e4f-000000000001', name: '정산 담당' };
const body = (over: Record<string, unknown> = {}) => ({
  correction_id: CID, base_source_revision: 0, base_source_updated_at: '2026-09-21T05:00:00.000Z',
  payment_method: { account: '1234567' }, operator: op, reason: '계좌번호 오타', idempotency_key: 'k-1', ...over,
});

test('parsePaymentInfoCorrection — 정상 본문: 값 trim·null 키 제거 표시·idempotency_key 선택', () => {
  const r = parsePaymentInfoCorrection(body({ payment_method: { account: ' 1234567 ', branch: null, holder: '山田' }, idempotency_key: null }));
  assert.ok(r.ok);
  assert.equal(r.correction.correctionId, CID); assert.equal(r.correction.baseRevision, 0);
  assert.deepEqual(r.correction.patch, { account: '1234567', branch: null, holder: '山田' });
  assert.deepEqual(r.correction.operator, op); assert.equal(r.correction.reason, '계좌번호 오타'); assert.equal(r.correction.idempotencyKey, null);
  // 모르는 최상위 키는 무시(상태 POST와 같은 관례)
  assert.ok(parsePaymentInfoCorrection(body({ something_new: 1 })).ok);
});

test('parsePaymentInfoCorrection — 첫 오류 필드 하나만: 필수·형식·허용 키·비울 수 없는 키', () => {
  const field = (b: unknown) => { const r = parsePaymentInfoCorrection(b); return r.ok ? 'ok' : r.field; };
  assert.equal(field(null), 'body'); assert.equal(field([]), 'body');
  assert.equal(field(body({ correction_id: 'abc' })), 'correction_id');
  assert.equal(field(body({ base_source_revision: -1 })), 'base_source_revision'); assert.equal(field(body({ base_source_revision: '0' })), 'base_source_revision');
  assert.equal(field(body({ base_source_updated_at: 'yesterday' })), 'base_source_updated_at');
  assert.equal(field(body({ payment_method: [] })), 'payment_method'); assert.equal(field(body({ payment_method: {} })), 'payment_method');
  assert.equal(field(body({ payment_method: { type: 'bank' } })), 'payment_method.type');       // 수단 종류·통화는 이 API로 못 바꾼다
  assert.equal(field(body({ payment_method: { currency: 'KRW' } })), 'payment_method.currency');
  assert.equal(field(body({ payment_method: { memo: 'x' } })), 'payment_method.memo');          // 7키 밖
  assert.equal(field(body({ payment_method: { account: 12345 } })), 'payment_method.account');
  assert.equal(field(body({ payment_method: { account: '' } })), 'payment_method.account');     // 계좌번호는 비울 수 없다
  assert.equal(field(body({ payment_method: { holder: null } })), 'payment_method.holder');
  assert.equal(field(body({ payment_method: { account: 'x'.repeat(201) } })), 'payment_method.account');
  assert.equal(field(body({ operator: undefined })), 'operator'); assert.equal(field(body({ operator: null })), 'operator');   // 정정은 사람이 하므로 필수
  assert.equal(field(body({ operator: { id: '', name: 'x' } })), 'operator');
  assert.equal(field(body({ reason: '   ' })), 'reason'); assert.equal(field(body({ reason: 'x'.repeat(501) })), 'reason');
  assert.equal(field(body({ idempotency_key: 5 })), 'idempotency_key');
});

const bank: PaymentMethodSnapshot = { type: 'bank', holder: '山田 太郎', currency: 'JPY', bank: 'みずほ', branch: '渋谷', account: '1234567' };
const paypal: PaymentMethodSnapshot = { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: 'k@x.com' };

test('mergePaymentMethodCorrection — 바뀐 키만 덮고 나머지는 그대로, 지점은 비울 수 있고 diff는 camelCase 필드명', () => {
  const r = mergePaymentMethodCorrection(bank, { account: '7654321', branch: null });
  assert.ok(r.ok);
  assert.deepEqual(r.after, { type: 'bank', holder: '山田 太郎', currency: 'JPY', bank: 'みずほ', account: '7654321' });
  assert.deepEqual(r.fields, [{ field: 'branch', from: '渋谷', to: null }, { field: 'account', from: '1234567', to: '7654321' }]);
  // 같은 값이면 바뀐 항목 0건이지만 실패는 아니다(재전송·정규화 차이는 흔하다)
  const same = mergePaymentMethodCorrection(bank, { account: '1234567' });
  assert.ok(same.ok && same.fields.length === 0);
});

test('mergePaymentMethodCorrection — 수단 종류에 없는 키는 조용히 버리지 않고 거절, 합친 결과는 새 요청과 같은 검사를 통과해야 한다', () => {
  const wrongType = mergePaymentMethodCorrection(paypal, { bank: 'みずほ' });
  assert.ok(!wrongType.ok && wrongType.field === 'payment_method.bank');
  // PayPal은 이메일·아이디 중 하나는 남아야 한다 — 이메일을 지우면서 아이디를 안 주면 거절(influencerPayment 규칙)
  const noneLeft = mergePaymentMethodCorrection(paypal, { email: null });
  assert.ok(!noneLeft.ok && noneLeft.field === 'payment_method');
  const swap = mergePaymentMethodCorrection(paypal, { email: null, paypal_id: 'paypal.me/keiko' });
  assert.ok(swap.ok); assert.deepEqual(swap.after, { type: 'paypal', holder: 'KEIKO', currency: 'JPY', paypalId: 'keiko' });   // paypal.me/ 접두어 정규화도 같은 경로
  const badEmail = mergePaymentMethodCorrection(paypal, { email: 'not-an-email' });
  assert.ok(!badEmail.ok && badEmail.field === 'payment_method');
  const longHolder = mergePaymentMethodCorrection(bank, { holder: 'x'.repeat(81) });
  assert.ok(!longHolder.ok);
});

// ---- planRosterOverwrite (057: 정산 정정을 명부에 "고친 항목만" 반영) ----
const pmPaypal = (over: Partial<PaymentMethod> = {}): PaymentMethod => ({
  id: 'm1', type: 'paypal', isDefault: true, holder: 'KEIKO', currency: 'JPY', email: 'old@x.com', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const pmBank = (over: Partial<PaymentMethod> = {}): PaymentMethod => ({
  id: 'b1', type: 'bank', isDefault: true, holder: '山田', currency: 'JPY', bank: 'みずほ', account: '1234567', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
const beforePaypal: PaymentMethodSnapshot = { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: 'old@x.com' };

test('planRosterOverwrite: 명부에 수단이 없으면 no_method', () => {
  assert.deepEqual(planRosterOverwrite([], beforePaypal, { email: 'new@x.com' }), { skip: 'no_method' });
});

test('planRosterOverwrite: 고친 항목만 병합하고 fee·memo·id는 보존한다', () => {
  const plan = planRosterOverwrite([pmPaypal({ fee: { mode: 'fixed', amount: 165 }, memo: '유지' })], beforePaypal, { email: 'new@x.com' });
  assert.ok('op' in plan);
  assert.equal(plan.op.id, 'm1'); assert.equal(plan.op.input.email, 'new@x.com');
  assert.equal(plan.op.input.holder, 'KEIKO');                            // 안 고친 항목 그대로
  assert.deepEqual(plan.op.input.fee, { mode: 'fixed', amount: 165 }); assert.equal(plan.op.input.memo, '유지');
});

test('planRosterOverwrite: 명부가 요청 스냅샷과 달라도 patch 키만 바꾸고 명부의 다른 값은 되돌리지 않는다', () => {
  const list = [pmPaypal({ holder: 'ROSTER 이름', email: 'roster@x.com' })];   // 명부가 그 사이 달라짐
  const before: PaymentMethodSnapshot = { type: 'paypal', holder: 'REQ 이름', currency: 'JPY', email: 'req@x.com' };
  const plan = planRosterOverwrite(list, before, { email: 'fixed@x.com' });     // email만 정정
  assert.ok('op' in plan);
  assert.equal(plan.op.input.email, 'fixed@x.com');    // 고친 항목은 반영
  assert.equal(plan.op.input.holder, 'ROSTER 이름');    // 명부의 현재 값 보존(요청 스냅샷 값으로 되돌리지 않는다)
});

test('planRosterOverwrite: 같은 종류가 여럿이면 요청 스냅샷(before)의 식별값과 일치하는 하나를 고른다', () => {
  const list = [pmPaypal({ id: 'a', email: 'a@x.com' }), pmPaypal({ id: 'b', isDefault: false, email: 'b@x.com' })];
  const before: PaymentMethodSnapshot = { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: 'b@x.com' };
  const plan = planRosterOverwrite(list, before, { holder: 'NEW' });
  assert.ok('op' in plan); assert.equal(plan.op.id, 'b', '식별값(email)이 일치하는 b를 고른다');
});

test('planRosterOverwrite: 같은 종류가 여럿인데 일치가 유일하지 않으면 ambiguous', () => {
  const list = [pmPaypal({ id: 'a', email: 'a@x.com' }), pmPaypal({ id: 'b', isDefault: false, email: 'b@x.com' })];
  const before: PaymentMethodSnapshot = { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: 'none@x.com' };
  assert.deepEqual(planRosterOverwrite(list, before, { holder: 'NEW' }), { skip: 'ambiguous' });
});

test('planRosterOverwrite: patch가 명부 수단과 안 맞으면 invalid(같은 종류가 없어 기본 수단에 얹었으나 검사 실패)', () => {
  const plan = planRosterOverwrite([pmBank()], beforePaypal, { email: 'new@x.com' });   // 계좌 수단만 있는데 paypal 정정
  assert.deepEqual(plan, { skip: 'invalid' });
});
