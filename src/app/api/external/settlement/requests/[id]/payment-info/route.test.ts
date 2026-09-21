import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from '@/lib/db';
import { createClient } from '@/lib/clientStore';
import { createCampaign } from '@/lib/campaignStore';
import { createTasks, updateTask } from '@/lib/campaignTaskStore';
import { createInfluencer, updatePaymentMethods } from '@/lib/influencerStore';
import { SETTLEMENT_DEFAULTS, type SettlementSettings } from '@/lib/settlementSettings';
import { listCandidates, createRequests, getSettlementSettings, saveSettlementSettings } from '@/lib/settlementStore';
import { POST } from './route.ts';

// 그쪽 파서가 응답 모양을 엄격히 받으므로(200은 { applied, correction_id, request } 세 키, 409는 code 세 가지) HTTP 매핑을 라우트 수준에서 못박는다.
// 하네스는 proof/route.test.ts와 같다 — 핸들러를 직접 import해 Request로 호출.
const sql = getSql();
const P = 'tstpi' + process.pid;
const H = (s: string) => `${P}_${s}`;
const TEST_KEY = P + '_key';
process.env.SETTLEMENT_API_KEY = TEST_KEY;
process.env.SETTLEMENT_REVISION_V2 = 'on';
const AUTH = { Authorization: `Bearer ${TEST_KEY}`, 'Content-Type': 'application/json' };
const CID = '22222222-3333-4444-8555-000000000001';

// 09-11 분류 개편 뒤 현재 설정에서는 SETTLEMENT_DEFAULTS의 분류가 숨김이라 createRequests가 '목록에 없는 분류'로 튕긴다(settlementStore.test.ts와 같은 사정) —
// 시작할 때 기본 설정(+마커)을 깔고 after()가 원래 설정으로 되돌린다.
let savedBefore: SettlementSettings | null = null;
before(async () => {
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  savedBefore = await getSettlementSettings(sql);
  await saveSettlementSettings(sql, { ...SETTLEMENT_DEFAULTS, marker: P } as SettlementSettings & { marker: string }, null);
});

let memberId = '';
async function ensureMember() {
  if (memberId) return { id: memberId, name: P + '멤버' };
  const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${P + '멤버'}, '#000') returning id`;
  memberId = m.id;
  return { id: memberId, name: P + '멤버' };
}
async function requestFor(handle: string, suffix: string) {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라' + suffix);
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: 'visit' as const, note: '', createdBy: null });
  const { row: inf } = await createInfluencer(sql, { handle: H(handle), createdBy: null });
  await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'bank', holder: '山田 太郎', currency: 'JPY', bank: 'みずほ', branch: '渋谷', account: '1234567' }, makeDefault: true }, null);
  const [t] = await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'post', items: [{ handle: H(handle), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/r/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [created] = await createRequests(sql, [{ taskId: cand.taskId, category: fee.sendAs, deadlineOn: cand.deadlineDefault, referenceUrl: cand.referenceDefault, expected: { amountGross: cand.money!.amountGross, payoutCurrency: cand.money!.payoutCurrency, paymentMethodId: cand.method!.id } }], m, '2026-08-28');
  return created;
}
const call = (id: string, body: unknown, headers: Record<string, string> = AUTH) =>
  POST(new Request(`https://cb-x-deck.test/api/external/settlement/requests/${id}/payment-info`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const body = (over: Record<string, unknown> = {}) => ({
  correction_id: CID, base_source_revision: 0, base_source_updated_at: '2026-09-21T05:00:00.000Z',
  payment_method: { account: '7654321' }, operator: { id: '8f2c9e10-1b2a-4c3d-9e4f-000000000001', name: '정산 담당' }, reason: '계좌번호 오타', idempotency_key: null, ...over,
});

after(async () => {
  if (savedBefore) await saveSettlementSettings(sql, savedBefore, null);
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  await sql`delete from payment_request where influencer_handle like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('POST payment-info — 401 본문 없음, 400은 { error, field }, 404는 { error }', async () => {
  const req = await requestFor('a', 'a');
  const unauth = await call(req.id, body(), { 'Content-Type': 'application/json' });
  assert.equal(unauth.status, 401); assert.equal(await unauth.text(), '');
  const bad = await call(req.id, body({ payment_method: { type: 'paypal' } }));
  assert.equal(bad.status, 400); assert.deepEqual(Object.keys(await bad.json()).sort(), ['error', 'field']);
  const badJson = await call(req.id, '{not json');
  assert.equal(badJson.status, 400); assert.equal((await badJson.json()).field, 'body');
  const missing = await call('00000000-0000-0000-0000-000000000000', body());
  assert.equal(missing.status, 404); assert.deepEqual(Object.keys(await missing.json()), ['error']);
  // 행을 읽어야 아는 검증(수단에 없는 키)은 요청을 찾은 뒤 400
  const wrongKey = await call(req.id, body({ payment_method: { email: 'a@b.c' } }));
  assert.equal(wrongKey.status, 400); assert.equal((await wrongKey.json()).field, 'payment_method.email');
});

test('POST payment-info — 200은 { applied: true, correction_id, request } 세 키뿐(version 없음), 재전송도 같은 모양, 409는 code + request', async () => {
  const req = await requestFor('b', 'b');
  const ok = await call(req.id, body());
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.deepEqual(Object.keys(j).sort(), ['applied', 'correction_id', 'request']);
  assert.equal(j.applied, true); assert.equal(j.correction_id, CID);
  assert.equal(j.request.payment_method.account, '7654321'); assert.equal(j.request.payment_method.branch, '渋谷');
  assert.equal(j.request.revision, 0); assert.equal(j.request.payment_method_correction.correction_id, CID); assert.equal(j.request.payment_method_correction.by_name, '정산 담당');
  const again = await call(req.id, body());
  assert.equal(again.status, 200); assert.deepEqual(Object.keys(await again.json()).sort(), ['applied', 'correction_id', 'request']);
  // 판 불일치 → 409 revision-mismatch + 최신 request
  const stale = await call(req.id, body({ correction_id: '22222222-3333-4444-8555-000000000002', base_source_revision: 3 }));
  assert.equal(stale.status, 409);
  const sj = await stale.json();
  assert.equal(sj.code, 'revision-mismatch'); assert.ok(sj.request && sj.request.request_id === req.id); assert.equal(typeof sj.error, 'string');
});
