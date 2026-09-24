import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';
import { rosterHandleOf, checkTaskPaymentMethod } from './taskAssignGate.ts';
import { PAYMENT_METHOD_NO_INFLUENCER_MESSAGE } from './campaignTaskInput.ts';
import { PAYMENT_NOT_FOUND } from './influencerPayment.ts';

const sql = getSql();
const P = 'tgate' + process.pid;

after(async () => {
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

test('1) 명부 판정 — 대소문자 무관, 명부 표기를 돌려준다, 없으면 null', async () => {
  await createInfluencer(sql, { handle: P + '_Sakura', createdBy: null });
  assert.equal(await rosterHandleOf(sql, P + '_sakura'), P + '_Sakura');
  assert.equal(await rosterHandleOf(sql, P + '_SAKURA'), P + '_Sakura');
  assert.equal(await rosterHandleOf(sql, P + '_nobody'), null);
});

test('2) 결제 수단 고르기 — 그 인플의 지금 목록에 있어야 한다, 사람이 없으면 문구', async () => {
  const { row } = await createInfluencer(sql, { handle: P + '_Pay', createdBy: null });
  const r = await updatePaymentMethods(sql, row.id, { kind: 'add', input: { type: 'paypal', holder: 'K', currency: 'JPY', email: 'k@x.com' } }, null);
  const id = r.paymentMethods[0].id;
  assert.equal(await checkTaskPaymentMethod(sql, P + '_pay', id), null);             // 대소문자 무관
  assert.equal(await checkTaskPaymentMethod(sql, P + '_Pay', 'gone'), PAYMENT_NOT_FOUND);
  assert.equal(await checkTaskPaymentMethod(sql, P + '_ghost', id), PAYMENT_NOT_FOUND);   // 명부 밖이면 고를 수단도 없다
  assert.equal(await checkTaskPaymentMethod(sql, null, id), PAYMENT_METHOD_NO_INFLUENCER_MESSAGE);
});
