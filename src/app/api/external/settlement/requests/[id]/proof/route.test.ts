import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { getSql } from '@/lib/db';
import { createClient } from '@/lib/clientStore';
import { createCampaign } from '@/lib/campaignStore';
import { createTasks, updateTask, deleteTask } from '@/lib/campaignTaskStore';
import { createInfluencer, updatePaymentMethods } from '@/lib/influencerStore';
import { SETTLEMENT_DEFAULTS } from '@/lib/settlementSettings';
import { listCandidates, createRequests } from '@/lib/settlementStore';
import { TASK_PROOF_BUCKET } from '@/lib/taskProof';
import { GET } from './route.ts';

// 라우트 테스트 하네스가 이 저장소에 없어(다른 외부 라우트도 마찬가지) 핸들러를 직접 import해
// Request를 만들어 호출한다 — Next 런타임(NextResponse·next/server의 after()) 밖에서도 동작하는지는
// 이 파일이 최초로 확인한다(2026-09-01 probe: import + GET() 호출이 next dev/build 없이도 성공함).

const sql = getSql();
const P = 'tstpf' + process.pid;
const H = (s: string) => `${P}_${s}`;

// bearerAuthorized는 process.env를 호출 시점에 읽는다 — 실제 운영 키를 몰라도 이 프로세스 안에서만
// 유효한 테스트용 값을 넣어 인증 경로를 검증한다(운영 시크릿은 건드리지 않는다).
const TEST_KEY = P + '_key';
process.env.SETTLEMENT_API_KEY = TEST_KEY;
const AUTH = { Authorization: `Bearer ${TEST_KEY}` };

// 1x1 투명 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

let memberId = '';
async function ensureMember() {
  if (memberId) return { id: memberId, name: P + '멤버' };
  const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${P + '멤버'}, '#000') returning id`;
  memberId = m.id;
  return { id: memberId, name: P + '멤버' };
}

const base = (clientId: string, clientName: string, suffix: string) => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06',
  kind: 'visit' as const, note: '', createdBy: null,
});
const tin = { targetTaskId: null, targetTweetUrl: 'https://x.com/target/status/1', draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

async function requestForRt(handle: string, campSuffix: string) {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라' + campSuffix);
  const camp = await createCampaign(sql, base(c.id, c.name, campSuffix));
  const { row: inf } = await createInfluencer(sql, { handle: H(handle), createdBy: null });
  await updatePaymentMethods(sql, inf.id, { kind: 'add', input: { type: 'paypal', holder: 'TEST', currency: 'JPY', email: `${H(handle)}@x.com`, fee: { mode: 'grossUp', percent: 5 } }, makeDefault: true }, null);
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: H(handle), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [{ taskId: cand.taskId, category: fee.sendAs, deadlineOn: cand.deadlineDefault, referenceUrl: cand.referenceDefault, expected: { amountGross: cand.money!.amountGross, payoutCurrency: cand.money!.payoutCurrency, paymentMethodId: cand.method!.id } }], m, '2026-08-28');
  return { row, task: t, client: c, influencer: inf };
}

const uploadedPaths: string[] = [];
async function uploadRealProof(taskId: string): Promise<{ path: string; url: string; at: string; byName: string }> {
  const admin = createSupabaseAdmin(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const path = `task/${taskId}/${crypto.randomUUID()}.png`;
  const { error } = await admin.storage.from(TASK_PROOF_BUCKET).upload(path, PNG_1PX, { contentType: 'image/png' });
  assert.equal(error, null, `테스트 픽스처 업로드 실패: ${error?.message}`);
  uploadedPaths.push(path);
  return { path, url: path, at: '2026-08-31T01:00:00.000Z', byName: P + '업로더' };
}

function req(id: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://x.example/api/external/settlement/requests/${id}/proof`, { headers });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// recordExternalCallSafe는 next/server의 after() 위에서 돈다 — 이 파일은 Next 요청 컨텍스트 밖이라
// after()가 던지고(externalApiLogAfter.ts의 catch), 그 경로는 기록을 기다리지 않는 fire-and-forget이다
// (프로덕션에서는 응답 이후에도 함수가 after()로 살아남지만, 여기는 그 보장이 없다). 그래서 응답을 받은
// 직후 바로 조회하면 아직 insert 전일 수 있다 — 최대 2초까지 짧게 폴링한다.
const loggedPaths: string[] = [];
async function lastLogFor(id: string) {
  const path = `/api/external/settlement/requests/${id}/proof`;
  if (!loggedPaths.includes(path)) loggedPaths.push(path);
  for (let i = 0; i < 20; i++) {
    const [row] = await sql<Array<{ status_code: number; outcome: string; detail: string | null; path: string; request_id: string | null }>>`
      select status_code, outcome, detail, path, request_id from external_api_log
       where path = ${path}
       order by at desc limit 1`;
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

after(async () => {
  const admin = createSupabaseAdmin(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  if (uploadedPaths.length) await admin.storage.from(TASK_PROOF_BUCKET).remove(uploadedPaths);
  if (loggedPaths.length) await sql`delete from external_api_log where path in ${sql(loggedPaths)}`;
  await sql`delete from payment_request where influencer_handle like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('GET .../proof — 키 없음/틀림 → 401, 본문 없음, 기록도 401', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const res = await GET(req(id), ctx(id));
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const wrong = await GET(req(id, { Authorization: 'Bearer nope' }), ctx(id));
  assert.equal(wrong.status, 401);
  const log = await lastLogFor(id);
  assert.ok(log);
  assert.equal(log!.status_code, 401);
  assert.equal(log!.outcome, 'unauthorized');
});

test('GET .../proof — 없는 요청 id → 404, 기록에 not-found', async () => {
  const id = '00000000-0000-0000-0000-0000000000fe';
  const res = await GET(req(id, AUTH), ctx(id));
  assert.equal(res.status, 404);
  assert.equal(await res.text(), '');
  const log = await lastLogFor(id);
  assert.ok(log);
  assert.equal(log!.status_code, 404);
  assert.equal(log!.outcome, 'not-found');
});

test('GET .../proof — 요청은 있지만 증빙 없음 → 404, detail로 구분', async () => {
  const { row } = await requestForRt('noproof', 'np1');
  const res = await GET(req(row.id, AUTH), ctx(row.id));
  assert.equal(res.status, 404);
  assert.equal(await res.text(), '');
  const log = await lastLogFor(row.id);
  assert.equal(log!.status_code, 404);
  assert.equal(log!.outcome, 'not-found');
  assert.equal(log!.detail, 'no-proof');
});

test('GET .../proof — 증빙 있으면 200 + 이미지 Content-Type, 기록에 ok', async () => {
  const { row, task } = await requestForRt('hasproof', 'hp1');
  const proof = await uploadRealProof(task.id);
  await updateTask(sql, task.id, { proof: { url: proof.url, by: null, byName: proof.byName, at: proof.at } });
  const res = await GET(req(row.id, AUTH), ctx(row.id));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.length > 0);
  assert.equal(Buffer.compare(bytes, PNG_1PX), 0, '내려받은 바이트가 올린 이미지와 같아야 한다');
  const log = await lastLogFor(row.id);
  assert.equal(log!.status_code, 200);
  assert.equal(log!.outcome, 'ok');
  assert.equal(log!.request_id, row.id);
});

test('GET .../proof — 작업이 지워져도(task_id null) 스냅샷 증빙이 있으면 200 — 라우트가 getForExport의 폴백을 그대로 쓰는지', async () => {
  const { row, task } = await requestForRt('snapshot', 'sn1');
  const proof = await uploadRealProof(task.id);
  // task_id 유무에 따른 라이브/스냅샷 판정 자체는 settlementStore.test.ts(getForExport)가 이미 상세히 검증한다.
  // 여기서는 라우트가 그 판정 결과(row.proof)를 그대로 받아 실제로 다운로드까지 성공하는지만 확인한다.
  await sql`update payment_request set proof = ${sql.json({ url: proof.url, by: null, byName: proof.byName, at: proof.at })} where id = ${row.id}`;
  await deleteTask(sql, task.id);
  const res = await GET(req(row.id, AUTH), ctx(row.id));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
});
