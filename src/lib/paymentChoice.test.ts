import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaymentChoices, resolvePaymentChoice, choiceToStored, canChoosePayment } from './paymentChoice.ts';
import type { PaymentMethod } from './influencerPayment.ts';

const pm = (p: Partial<PaymentMethod>): PaymentMethod => ({
  id: 'm1', type: 'paypal', isDefault: true, holder: 'Sakura', currency: 'JPY', email: 's@x.com', updatedAt: '2026-09-01T00:00:00Z', ...p,
});
const list = [pm({ id: 'a' }), pm({ id: 'b', isDefault: false, type: 'paypay', fee: { mode: 'grossUp', percent: 3 } })];

test('1) 고를 목록 — 요약 한 줄 + 수수료 칩 + 기본 여부(계좌번호 같은 식별값은 describeMethod가 정한 만큼만)', () => {
  const c = toPaymentChoices(list);
  assert.deepEqual(c.map((x) => [x.id, x.isDefault]), [['a', true], ['b', false]]);
  assert.ok(c[0].label.startsWith('PayPal'));
  assert.deepEqual(c[1].fee, { text: '수수료 3% 부담', cb: true });
});

test('2) 이 작업의 수단 — 고른 것 / 없으면 기본 / 고른 게 지워졌으면 기본 + fallback', () => {
  const c = toPaymentChoices(list);
  assert.deepEqual(resolvePaymentChoice(c, 'b'), { choice: c[1], fallback: false });
  assert.deepEqual(resolvePaymentChoice(c, null), { choice: c[0], fallback: false });
  assert.deepEqual(resolvePaymentChoice(c, 'gone'), { choice: c[0], fallback: true });
});

test('3) 고른 값 → 저장 값 — 기본 수단을 고르면 null(= 기본을 따른다), 그 밖엔 id', () => {
  const c = toPaymentChoices(list);
  assert.equal(choiceToStored(c, 'a'), null);
  assert.equal(choiceToStored(c, 'b'), 'b');
  assert.equal(choiceToStored(c, 'nope'), null);
});

test('4) 고를 수 있을 때 — 수단 2개 이상인 ok 상태만(드롭다운과 소제목의 \'· 이 작업에만 적용\'이 같은 판정을 쓴다)', () => {
  const c = toPaymentChoices(list);
  const ok = (choices: typeof c) => ({ state: 'ok' as const, label: 'x', fee: c[0].fee, influencerId: 'i', choices, fallback: false });
  assert.equal(canChoosePayment(ok(c)), true);
  assert.equal(canChoosePayment(ok([c[0]])), false);
  assert.equal(canChoosePayment({ state: 'requested', label: 'x', fee: c[0].fee, paid: false }), false);
  assert.equal(canChoosePayment({ state: 'none', influencerId: 'i' }), false);
  assert.equal(canChoosePayment({ state: 'notInRoster' }), false);
  assert.equal(canChoosePayment(null), false);
});
