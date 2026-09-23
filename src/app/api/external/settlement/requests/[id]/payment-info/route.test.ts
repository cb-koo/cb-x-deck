import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from '@/lib/db';
import { createClient } from '@/lib/clientStore';
import { createCampaign } from '@/lib/campaignStore';
import { createTasks, updateTask } from '@/lib/campaignTaskStore';
import { createInfluencer, updatePaymentMethods } from '@/lib/influencerStore';
import type { PaymentMethodInput } from '@/lib/influencerPayment';
import { MAX_PAYMENT_QR_BYTES } from '@/lib/paymentQrInput';
import { listExternalLog } from '@/lib/externalApiLog';
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
// method를 주면 (예: PayPay + identifier) 그 수단을 명부 기본 수단으로 심는다 — QR 테스트용(리뷰 2026-09-23).
// 인자를 안 주면 지금까지와 똑같이 계좌 수단을 쓴다(기존 테스트 그대로 통과).
async function requestFor(handle: string, suffix: string, method?: Partial<PaymentMethodInput> & { type: PaymentMethodInput['type'] }) {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라' + suffix);
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: 'visit' as const, note: '', createdBy: null });
  const { row: inf } = await createInfluencer(sql, { handle: H(handle), createdBy: null });
  const input: PaymentMethodInput = method
    ? { holder: 'KEIKO', currency: method.type === 'paypay' ? 'JPY' : 'KRW', ...(method.type === 'paypay' ? { identifier: H(handle) } : {}), ...method }
    : { type: 'bank', holder: '山田 太郎', currency: 'JPY', bank: 'みずほ', branch: '渋谷', account: '1234567' };
  await updatePaymentMethods(sql, inf.id, { kind: 'add', input, makeDefault: true }, null);
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
  await sql`delete from external_api_log where request_id in (select id from payment_request where influencer_handle like ${P + '%'})`;
  await sql`delete from payment_request_payment_correction where request_id in (select id from payment_request where influencer_handle like ${P + '%'})`;
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
  // 057: 명부(원본) 기본 수단도 정산이 보낸 계좌번호로 함께 덮인다(무조건 반영).
  const roster = (await sql<Array<{ payment_methods: Array<{ isDefault: boolean; account?: string }> }>>`select payment_methods from influencer where handle = ${H('b')}`)[0].payment_methods;
  assert.equal(roster.find((m) => m.isDefault)!.account, '7654321', '명부 기본 수단 계좌번호가 정정 값으로 반영된다');
  const again = await call(req.id, body());
  assert.equal(again.status, 200); assert.deepEqual(Object.keys(await again.json()).sort(), ['applied', 'correction_id', 'request']);
  // 판 불일치 → 409 revision-mismatch + 최신 request
  const stale = await call(req.id, body({ correction_id: '22222222-3333-4444-8555-000000000002', base_source_revision: 3 }));
  assert.equal(stale.status, 409);
  const sj = await stale.json();
  assert.equal(sj.code, 'revision-mismatch'); assert.ok(sj.request && sj.request.request_id === req.id); assert.equal(typeof sj.error, 'string');
});

// ── 리뷰 2026-09-23: 실제 base64로 라우트를 때린다 ──
// 여태 store 계층 테스트만 있었다(짧은 경로 문자열 'seed/old.png'을 직접 넣음) — 200자 제한이 진짜 base64로
// 라우트에 들어올 때 막는지, 호출 기록에 base64가 새는지는 이 테스트가 생기기 전까지 아무 것도 확인하지 않았다.
// 호출 기록(external_api_log) insert는 recordExternalCallSafe 안에서 await 없이 fire-and-forget으로 실행된다
// (요청 컨텍스트 밖이라 next/server의 after()를 못 쓰고 그냥 던진다, 별도 풀 getUsageSql로) — 응답이 와도 insert가
// 끝났다는 보장이 없다. 조회는 같은 DB를 보는 앱 풀(sql)로 해도 된다(연결 풀만 다를 뿐 같은 테이블).
async function waitForLog(requestId: string, statusCode: number): Promise<{ body: string | null }> {
  for (let i = 0; i < 40; i++) {
    const rows = await listExternalLog(sql, { requestId, method: 'POST' });
    const hit = rows.find((r) => r.statusCode === statusCode);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`external_api_log에 requestId=${requestId} statusCode=${statusCode} 행이 안 나타났다`);
}
// 실제 이미지는 아니지만(내용은 임의 바이트) data URI 모양·크기는 진짜 QR 스크린샷과 같은 자릿수(수 KB) —
// parseQrDataUri는 이미지 내용을 검사하지 않고 base64 디코드 가능 여부·mime·크기만 본다.
const qrDataUri = (kb: number) => `data:image/png;base64,${Buffer.alloc(kb * 1024, 65).toString('base64')}`;

test('POST payment-info — 수 KB짜리 QR data URI가 200자 제한에 막히지 않고 경로로 저장된다, 정정 이력·호출 기록 어디에도 base64가 안 남는다', async () => {
  const req = await requestFor('qr1', 'qr1', { type: 'paypay' });
  const qrCid = '22222222-3333-4444-8555-000000000010';
  const qr = qrDataUri(4);   // 4KB — 200자 제한이면 즉시 400이 났을 크기
  const res = await call(req.id, body({ correction_id: qrCid, payment_method: { qr }, reason: 'QR 갱신' }));
  assert.equal(res.status, 200, `200이어야 하는데 ${res.status}: ${JSON.stringify(await res.clone().json().catch(() => null))}`);
  const j = await res.json();
  assert.equal(j.applied, true);
  // 응답에는 qr 원본이 아예 없다 — settlementExternal.toExternalItem이 저장소 경로 대신 qr_url(서명 URL 발급용
  // 라우트)만 내보낸다(§77-78 참고, "저장소 경로가 그대로 새지 않는다"). 여기서는 그 경로가 base64가 아님을
  // DB에서 직접 확인한다.
  assert.equal(j.request.payment_method.qr, undefined, '응답에 qr 원본 경로가 노출되면 안 된다');
  assert.ok(typeof j.request.payment_method.qr_url === 'string' && j.request.payment_method.qr_url.includes('/payment-qr'));

  // 정정 이력(payment_request_payment_correction)의 patch·before·after 어디에도 base64가 없다 — 경로만 있다.
  const [corr] = await sql<Array<{ patch: { qr?: string }; before: { qr?: string }; after: { qr?: string } }>>`
    select patch, before, after from payment_request_payment_correction where id = ${qrCid}`;
  const savedQr = corr.patch.qr;
  assert.ok(savedQr && !savedQr.startsWith('data:') && savedQr.length < 200, `저장된 값은 짧은 경로여야 한다: ${savedQr}`);
  assert.equal(corr.after.qr, savedQr);
  assert.ok(!JSON.stringify(corr).includes('base64'), '정정 이력에 base64가 남으면 안 된다');

  // 호출 기록(external_api_log.body)에도 base64가 없다 — 경로 또는 마스킹 표시만 있어야 한다.
  const log = await waitForLog(req.id, 200);
  assert.ok(log.body, '기록에 본문이 남아야 한다(마스킹된 채로)');
  assert.ok(!log.body!.includes('base64'), `호출 기록에 base64가 남으면 안 된다: ${log.body!.slice(0, 100)}`);
  assert.match(log.body!, /qr 이미지/);

  // 명부(원본) 기본 수단도 경로로 반영된다(057과 같은 경로) — 여기도 base64가 아니다.
  const roster = (await sql<Array<{ payment_methods: Array<{ isDefault: boolean; qr?: string }> }>>`select payment_methods from influencer where handle = ${H('qr1')}`)[0].payment_methods;
  assert.equal(roster.find((m) => m.isDefault)!.qr, savedQr);

  // Important 2: 같은 correction_id로 다시 보내면(멱등 재전송) 저장된 경로가 안 바뀐다.
  // 주의(재리뷰 2026-09-23): 이 assert는 "재전송이 이력을 새로 안 쓴다"만 확인한다 — applyPaymentMethodCorrection의
  // replayed 분기가 patch를 아예 안 쓰기 때문에, 재전송 때 실제로 업로드를 건너뛰었든 안 뛰었든(새 경로를 만들고
  // 버렸든) 여기 결과는 똑같다. 즉 이 테스트는 precheckCorrectionForQrUpload(업로드 자체를 생략하는 최적화)를
  // 검증하지 못한다 — 그 최적화는 settlementStore.test.ts의 precheckCorrectionForQrUpload 단위 테스트가 직접 본다.
  const replay = await call(req.id, body({ correction_id: qrCid, payment_method: { qr: qrDataUri(6) }, reason: 'QR 갱신' }));
  assert.equal(replay.status, 200);
  const [corrAfterReplay] = await sql<Array<{ patch: { qr?: string } }>>`select patch from payment_request_payment_correction where id = ${qrCid}`;
  assert.equal(corrAfterReplay.patch.qr, savedQr, '재전송이 이력을 새로 쓰지 않는다(멱등) — 경로가 그대로');
});

test('POST payment-info — QR이 5MB를 넘으면 400으로 거절하고 저장하지 않는다', async () => {
  const req = await requestFor('qr2', 'qr2', { type: 'paypay' });
  const tooBig = qrDataUri(Math.ceil(MAX_PAYMENT_QR_BYTES / 1024) + 1024);   // 상한보다 1MB 더 크게
  const res = await call(req.id, body({ correction_id: '22222222-3333-4444-8555-000000000011', payment_method: { qr: tooBig }, reason: 'QR 갱신' }));
  assert.equal(res.status, 400);
  const j = await res.json();
  assert.equal(j.field, 'payment_method.qr');
  const [row] = await sql<Array<{ payment_method: { qr?: string } }>>`select payment_method from payment_request where id = ${req.id}`;
  assert.equal(row.payment_method.qr, undefined, '거절된 정정은 요청에 반영되면 안 된다');
});

test('POST payment-info — 취소된 요청이면 QR 정정을 반영하지 않고 409로 거절한다(Important 1)', async () => {
  const req = await requestFor('qr3', 'qr3', { type: 'paypay' });
  await sql`update payment_request set status = 'cancelled' where id = ${req.id}`;
  const before = (await sql<Array<{ payment_methods: unknown[] }>>`select payment_methods from influencer where handle = ${H('qr3')}`)[0];
  const res = await call(req.id, body({ correction_id: '22222222-3333-4444-8555-000000000012', payment_method: { qr: qrDataUri(3) }, reason: 'QR 갱신' }));
  assert.equal(res.status, 409);
  const j = await res.json();
  assert.equal(j.code, 'request-cancelled');
  // 명부가 그대로다 — 거절될 정정이 요청·명부 어느 쪽도 바꾸지 않았다는 확인. 주의(재리뷰 2026-09-23): 이 assert는
  // applyPaymentMethodCorrection이 취소 상태면 애초에 patch/명부를 안 쓰기 때문에 항상 성립한다 — precheck로
  // 업로드 자체를 건너뛰었는지는 이걸로 못 가린다(precheckCorrectionForQrUpload를 지워 매번 업로드해도 이 assert는
  // 그대로 통과한다). 업로드 생략은 settlementStore.test.ts의 precheckCorrectionForQrUpload 단위 테스트가 직접 본다.
  const after = (await sql<Array<{ payment_methods: unknown[] }>>`select payment_methods from influencer where handle = ${H('qr3')}`)[0];
  assert.deepEqual(after.payment_methods, before.payment_methods);
});
