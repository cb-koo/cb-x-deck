import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentInfoCorrection, mergePaymentMethodCorrection } from './settlementPaymentCorrection.ts';
import type { PaymentMethodSnapshot } from './settlementCalc.ts';

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
