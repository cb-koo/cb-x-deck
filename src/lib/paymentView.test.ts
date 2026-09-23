import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentView, loadPaymentView } from './paymentView.ts';
import { type PaymentMethod, type PaymentMethodInput } from './influencerPayment.ts';
import { getSql } from './db.ts';
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';

const pm = (p: Partial<PaymentMethod>): PaymentMethod => ({
  id: 'm1', type: 'paypal', isDefault: true, holder: 'Sakura', currency: 'JPY', email: 's@x.com', updatedAt: '2026-09-01T00:00:00Z', ...p,
});

// feeShortLabel 자체 테스트는 influencerPayment.test.ts에 있다(브리프: 있으면 거기).

test('2) 요청 스냅샷이 있으면 그것이 우선(단계 정산·완료)', () => {
  const v = buildPaymentView({
    request: { method: { type: 'paypal', holder: 'Sakura', currency: 'JPY', email: 'old@x.com' }, fee: null, paid: false },
    roster: { methods: [pm({ email: 'new@x.com' })] },
  });
  assert.equal(v.state, 'requested');
  assert.ok(v.state === 'requested' && v.label.includes('old@x.com'));
  assert.ok(v.state === 'requested' && v.paid === false);
});

test('2b) 정산 프로덕트가 지급 완료를 보낸 요청이면 paid(단계 완료와 같은 판정)', () => {
  const v = buildPaymentView({
    request: { method: { type: 'paypal', holder: 'Sakura', currency: 'JPY', email: 'old@x.com' }, fee: null, paid: true },
    roster: null,
  });
  assert.ok(v.state === 'requested' && v.paid === true);
});

test('3) 명부 밖 / 수단 없음 / 기본 수단', () => {
  assert.deepEqual(buildPaymentView({ request: null, roster: null }), { state: 'notInRoster' });
  assert.deepEqual(buildPaymentView({ request: null, roster: { methods: [] } }), { state: 'none' });
  const v = buildPaymentView({ request: null, roster: { methods: [pm({ id: 'a', isDefault: false, type: 'paypay', currency: 'JPY', email: undefined, fee: { mode: 'grossUp', percent: 3 } }), pm({ id: 'b' })] } });
  assert.equal(v.state, 'ok');
  assert.ok(v.state === 'ok' && v.label.startsWith('PayPal') && v.fee.text === '인플 부담');
});

// ── loadPaymentView: 연습용 DB ──
const sql = getSql();
const P = 'tpv' + process.pid;

after(async () => {
  await sql`delete from influencer where lower(handle) like ${P.toLowerCase() + '%'}`;
  await sql.end();
});

const paypalInput = (holder: string): PaymentMethodInput =>
  ({ type: 'paypal', holder, currency: 'JPY', email: 'a@b.c' });

test('4) loadPaymentView: 인플 1명 + 기본 수단 1개 → ok, 대문자 조회도 ok, 없는 핸들 → notInRoster', async () => {
  const handle = P + 'Roster';
  const { row } = await createInfluencer(sql, { handle, createdBy: null });
  await updatePaymentMethods(sql, row.id, { kind: 'add', input: paypalInput('ゆい') }, null);

  const v1 = await loadPaymentView(sql, { handle, taskId: null });
  assert.equal(v1.state, 'ok');

  const v2 = await loadPaymentView(sql, { handle: handle.toUpperCase(), taskId: null });
  assert.equal(v2.state, 'ok');

  const v3 = await loadPaymentView(sql, { handle: P + 'NoSuchHandle', taskId: null });
  assert.deepEqual(v3, { state: 'notInRoster' });

  // taskId 경로 — 매치되는 요청 행이 없으면(존재하지 않는 uuid) 명부 기본값으로 떨어진다. SQL의 컬럼명(status·created_at·task_id)이
  // 실제로 있는지는 이 경로를 한 번이라도 실행해야만 검증된다(요청 스냅샷 자체는 순수 함수 테스트 2)로 이미 커버).
  const v4 = await loadPaymentView(sql, { handle, taskId: crypto.randomUUID() });
  assert.equal(v4.state, 'ok');
});
