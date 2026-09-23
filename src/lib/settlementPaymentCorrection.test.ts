import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentInfoCorrection, mergePaymentMethodCorrection, planRosterOverwrite, maskQrInRawBody } from './settlementPaymentCorrection.ts';
import type { PaymentMethodSnapshot } from './settlementCalc.ts';
import type { PaymentMethod } from './influencerPayment.ts';
import { applyPaymentOp } from './influencerPayment.ts';
import { MAX_PAYMENT_QR_BYTES } from './paymentQrInput.ts';

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

// 058: qr 병합 시 fee·memo·isDefault가 사라지는 회귀를 막는다 — 09-22에 정산 정정이 명부를 덮으며
// 명부에만 있는 값(수수료 설정)을 지울 뻔한 것과 같은 종류의 버그라 별도 테스트로 남긴다.
test('planRosterOverwrite: qr만 고쳐도 fee·memo는 보존한다', () => {
  const pmPaypay: PaymentMethod = {
    id: 'p1', type: 'paypay', isDefault: true, holder: '山田', currency: 'JPY',
    identifier: 'ident-1', qr: 'inf-1/old.png',
    fee: { mode: 'fixed', amount: 165 }, memo: '유지', updatedAt: '2026-01-01T00:00:00Z',
  };
  const beforePaypay: PaymentMethodSnapshot = {
    type: 'paypay', holder: '山田', currency: 'JPY', identifier: 'ident-1', qr: 'inf-1/old.png',
  };
  const plan = planRosterOverwrite([pmPaypay], beforePaypay, { qr: 'inf-1/new.png' });
  assert.ok('op' in plan);
  assert.equal(plan.op.input.qr, 'inf-1/new.png');                                    // 고친 항목은 반영
  assert.deepEqual(plan.op.input.fee, { mode: 'fixed', amount: 165 });                // 명부에만 있던 fee 보존
  assert.equal(plan.op.input.memo, '유지');                                            // 명부에만 있던 memo 보존

  // isDefault는 planRosterOverwrite가 아니라 applyPaymentOp(update)가 지킨다 — 그 경로까지 확인해야
  // "값은 안 사라졌지만 기본 수단 표시가 풀렸다" 같은 회귀를 놓치지 않는다.
  const { list } = applyPaymentOp([pmPaypay], plan.op, '2026-09-22T00:00:00.000Z', () => 'unused');
  assert.equal(list[0].isDefault, true);
});

test('mergePaymentMethodCorrection — holder만 고쳐도 기존 qr이 남는다 (스펙 §3-1)', () => {
  const before = { type: 'paypay' as const, holder: '옛 이름', currency: 'JPY' as const,
                   identifier: 'ident-1', qr: 'inf-1/aaa.png' };
  const r = mergePaymentMethodCorrection(before, { holder: '새 이름' });
  assert.ok(r.ok);
  assert.equal(r.after.holder, '새 이름');
  assert.equal(r.after.qr, 'inf-1/aaa.png');       // ← 사라지면 안 된다
  assert.equal(r.after.identifier, 'ident-1');
});

test('mergePaymentMethodCorrection — qr을 바꾸고 지울 수 있다', () => {
  const before = { type: 'paypay' as const, holder: '이름', currency: 'JPY' as const, qr: 'inf-1/old.png' };
  const changed = mergePaymentMethodCorrection(before, { qr: 'inf-1/new.png' });
  assert.ok(changed.ok);
  assert.equal(changed.after.qr, 'inf-1/new.png');

  const removed = mergePaymentMethodCorrection(before, { qr: null });
  assert.ok(removed.ok);
  assert.equal(removed.after.qr, undefined);
});

test('mergePaymentMethodCorrection — PayPal·계좌 수단에 qr은 거절', () => {
  const paypal = { type: 'paypal' as const, holder: '이름', currency: 'JPY' as const, email: 'a@b.com' };
  const r = mergePaymentMethodCorrection(paypal, { qr: 'x/y.png' });
  assert.ok(!r.ok);
  assert.equal(r.field, 'payment_method.qr');
});

test('mergePaymentMethodCorrection — qr 변경이 활동 기록 fields에 남는다', () => {
  const before = { type: 'paypay' as const, holder: '이름', currency: 'JPY' as const, qr: 'inf-1/old.png' };
  const r = mergePaymentMethodCorrection(before, { qr: 'inf-1/new.png' });
  assert.ok(r.ok);
  assert.ok(r.fields.some((f) => f.field === 'qr' && f.to === 'inf-1/new.png'));
});

// ── 리뷰 2026-09-23 Critical 1: qr은 200자 제한이 아니라 MAX_PAYMENT_QR_BYTES에서 파생된 별도 상한을 쓴다 ──
const dataUri = (kb: number) => `data:image/png;base64,${'A'.repeat(kb * 1024)}`;
test('parsePaymentInfoCorrection — 수 KB짜리 qr data URI는 200자 제한에 막히지 않는다', () => {
  const r = parsePaymentInfoCorrection(body({ payment_method: { qr: dataUri(3) } }));   // 3KB 본문, data URI로는 수 KB
  assert.ok(r.ok);
  assert.equal(r.correction.patch.qr, dataUri(3));
});
test('parsePaymentInfoCorrection — 다른 키(holder 등)는 여전히 200자에서 막힌다', () => {
  const r = parsePaymentInfoCorrection(body({ payment_method: { holder: 'x'.repeat(201) } }));
  assert.ok(!r.ok); assert.equal(r.field, 'payment_method.holder');
});
test('parsePaymentInfoCorrection — qr도 MAX_PAYMENT_QR_BYTES를 훨씬 넘는 길이는 거절한다', () => {
  // base64 길이가 바이트 상한의 4/3배를 넉넉히 넘도록 — data URI 접두어를 빼도 상한을 넘는다.
  const tooBig = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_PAYMENT_QR_BYTES * 4) / 3) + 10000)}`;
  const r = parsePaymentInfoCorrection(body({ payment_method: { qr: tooBig } }));
  assert.ok(!r.ok); assert.equal(r.field, 'payment_method.qr');
});

// ── 리뷰 2026-09-23 Critical 2: 호출 기록 본문에 base64가 남으면 안 된다 ──
test('maskQrInRawBody — payment_method.qr의 base64를 길이 표시로 치환하고 다른 값은 그대로 둔다', () => {
  const raw = JSON.stringify({ correction_id: 'x', payment_method: { qr: dataUri(2), holder: '山田' }, reason: '테스트' });
  const masked = maskQrInRawBody(raw);
  assert.ok(!masked.includes('AAAA'), 'base64 본문이 남아있으면 안 된다');
  const parsed = JSON.parse(masked);
  assert.equal(parsed.payment_method.holder, '山田');   // 다른 값은 그대로
  assert.equal(parsed.correction_id, 'x');
  assert.match(parsed.payment_method.qr, /qr 이미지/);
});
test('maskQrInRawBody — qr이 없으면 원본 그대로 돌려준다', () => {
  const raw = JSON.stringify({ payment_method: { account: '1234567' } });
  assert.equal(maskQrInRawBody(raw), raw);
});
test('maskQrInRawBody — 빈 문자열은 그대로', () => {
  assert.equal(maskQrInRawBody(''), '');
});
test('maskQrInRawBody — JSON 파싱이 안 되는 본문도 base64를 남기지 않는다', () => {
  const raw = `{not json but "qr":"${dataUri(1)}", broken`;
  const masked = maskQrInRawBody(raw);
  assert.ok(!masked.includes('AAAA'), '깨진 JSON이어도 base64가 남으면 안 된다');
  assert.match(masked, /qr 이미지/);
});
