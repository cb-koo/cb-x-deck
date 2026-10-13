import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, updateTask, markPosted } from './campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';
import { SETTLEMENT_DEFAULTS, type SettlementSettings } from './settlementSettings.ts';
import { getSettlementSettings, saveSettlementSettings, cancelRequest, listRequests, getForExport } from './settlementStore.ts';
import { toExternalItem } from './settlementExternal.ts';
import { listPending, sendTask, runAutoSend, holdTask, ackRemoval, AUTO_REQUESTER_FALLBACK } from './settlementAutoStore.ts';
import { nextMondaySeven } from './settlementAuto.ts';

const sql = getSql();
const P = 'tsta' + process.pid;
const H = (s: string) => `${P}_${s}`;
let savedBefore: SettlementSettings | null = null;
// 인용RT 기본 분류가 있는 설정 — 운영(09-18)과 같은 모양. 마커로 표시하고 after가 원래 설정으로 되돌린다(settlementStore.test와 같은 방식)
const SETTINGS = {
  ...SETTLEMENT_DEFAULTS,
  categories: SETTLEMENT_DEFAULTS.categories.map((c) => (c.id === 'fee' ? { ...c, defaultFor: ['quoteRt', 'post', 'visit'] as const } : c)),
  marker: P,
} as unknown as SettlementSettings;
let member = { id: '', name: P + '멤버' };
let creator = { id: '', name: P + '만든사람' };
let clientId = '', clientName = '';
const runIds: string[] = [];   // 이 파일의 스윕 실행 기록 — after가 지운다(화면의 '마지막 확인'이 테스트 실행으로 바뀌지 않게)

before(async () => {
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  savedBefore = await getSettlementSettings(sql);
  await saveSettlementSettings(sql, SETTINGS, null);
  const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${member.name}, '#000') returning id`;
  member = { ...member, id: m.id };
  const [c] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${creator.name}, '#000') returning id`;
  creator = { ...creator, id: c.id };
  const cl = await createClient(sql, P + '클라');
  clientId = cl.id; clientName = cl.name;
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
  if (runIds.length) await sql`delete from settlement_auto_run where id in ${sql(runIds)}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

let seq = 0;
async function campaign(createdBy: string | null = null) {
  seq++;
  return createCampaign(sql, { clientId, clientName, name: `${P}c${seq}`, nameEn: `${P}-c${seq}`, startsOn: '2026-10-05', endsOn: '2026-10-11', kind: 'content', note: '', createdBy });
}
async function influencer(handle: string, withMethod = true) {
  const { row } = await createInfluencer(sql, { handle, createdBy: null });
  if (withMethod) await updatePaymentMethods(sql, row.id, { kind: 'add', input: { type: 'paypal', holder: 'K', currency: 'JPY', email: `${handle}@x.com` }, makeDefault: true }, null);
  return row;
}
async function postedQuote(campId: string, handle: string, createdBy: string | null) {
  const [t] = await createTasks(sql, campId, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy, type: 'quoteRt', items: [{ handle, cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-10-09', postedSource: 'manual', postUrl: `https://x.com/${handle}/status/1${seq}` });
  return t;
}
async function sweep(now: Date, opts: Parameters<typeof runAutoSend>[2]) { const r = await runAutoSend(sql, now, opts); runIds.push(r.runId); return r; }
const afterNextMonday = () => new Date(nextMondaySeven(new Date()).getTime() + 60_000);

test('게시 확인 시각 — 트리거가 처음 확인할 때만 찍고, 날짜를 고쳐도 그대로', async () => {
  const camp = await campaign();
  await influencer(H('stamp'));
  const [t] = await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'quoteRt', items: [{ handle: H('stamp'), cost: { amount: 1, currency: 'KRW' } }] });
  const read = async () => (await sql<Array<{ at: Date | null }>>`select posted_confirmed_at as at from campaign_task where id = ${t.id}`)[0].at;
  assert.equal(await read(), null);
  await markPosted(sql, [t.id], '2026-10-09', 'manual');
  const first = await read();
  assert.ok(first);
  await updateTask(sql, t.id, { postedAt: '2026-10-08' });
  await updateTask(sql, t.id, { note: 'x' });
  assert.equal((await read())?.toISOString(), first.toISOString());
});

test('정산 요청 대기 묶음 — 기다림(보내는 때)·막힘·확인 필요·멈춤', async () => {
  const camp = await campaign();
  await influencer(H('ok')); await influencer(H('nopm'), false); await influencer(H('rm')); await influencer(H('hold'));
  const ok = await postedQuote(camp.id, H('ok'), creator.id);
  const nopm = await postedQuote(camp.id, H('nopm'), null);
  const rm = await postedQuote(camp.id, H('rm'), null);
  await updateTask(sql, rm.id, { removedAt: '2026-10-11', removedReason: '협의 후 내림' });
  const hold = await postedQuote(camp.id, H('hold'), null);
  assert.equal(await holdTask(sql, hold.id, member, '인플과 금액 협의 중'), true);
  const { rows, summary } = await listPending(sql, new Date(), camp.id);
  const g = (id: string) => rows.find((r) => r.cand.taskId === id)!;
  assert.equal(g(ok.id).group, 'waiting');
  assert.equal(g(ok.id).sendAt, nextMondaySeven(new Date()).toISOString());
  assert.equal(g(ok.id).cand.categoryDefault, SETTLEMENT_DEFAULTS.categories.find((c) => c.id === 'fee')!.sendAs);
  assert.equal(g(nopm.id).group, 'blocked');
  assert.deepEqual(g(nopm.id).blocking.map((i) => i.code), ['no-payment-method']);
  assert.equal(g(rm.id).group, 'attention');
  assert.equal(g(hold.id).group, 'stopped');
  assert.equal(g(hold.id).state.hold?.reason, '인플과 금액 협의 중');
  assert.equal(summary.needsAction, 2); assert.equal(summary.waiting, 1); assert.equal(summary.stopped, 1);
});

test('주간 스윕 — 월요일 7시 전엔 안 보내고, 지나면 기다림만 보낸다(요청자 = 작업 만든 사람, 자동 표식)', async () => {
  const camp = await campaign();
  await influencer(H('s1')); await influencer(H('s2'), false); await influencer(H('s3'));
  const t1 = await postedQuote(camp.id, H('s1'), creator.id);
  const t2 = await postedQuote(camp.id, H('s2'), creator.id);
  const t3 = await postedQuote(camp.id, H('s3'), creator.id);
  await updateTask(sql, t3.id, { removedAt: '2026-10-11' });
  const early = await sweep(new Date(), { campaignIds: [camp.id] });
  assert.equal(early.sent, 0);
  const r = await sweep(afterNextMonday(), { campaignIds: [camp.id] });
  assert.equal(r.sent, 1); assert.equal(r.failed, 0);
  const reqs = await listRequests(sql, { campaignId: camp.id });
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].taskId, t1.id);
  assert.equal(reqs[0].createdVia, 'auto');
  assert.equal(reqs[0].requesterMemberId, creator.id);
  assert.equal(reqs[0].requesterName, creator.name);
  assert.ok(![t2.id, t3.id].includes(reqs[0].taskId!));
  // 다시 돌려도 같은 건을 또 만들지 않는다
  assert.equal((await sweep(afterNextMonday(), { campaignIds: [camp.id] })).sent, 0);
  // 정산팀이 가져가는 데이터에는 자동 표식이 없다(10-07 엄격 스키마)
  const exp = await getForExport(sql, reqs[0].id);
  assert.ok(exp);
  const item = JSON.stringify(toExternalItem(exp, 'https://x'));
  for (const k of ['created_via', 'createdVia', 'auto', 'removal_ack']) assert.ok(!item.includes(`"${k}"`), k);
});

test('요청 취소된 작업은 자동으로 다시 보내지 않고 멈춘 작업 — 사람이 [보내기]로 보낸다', async () => {
  const camp = await campaign(creator.id);
  await influencer(H('cx'));
  const t = await postedQuote(camp.id, H('cx'), null);   // 작업 만든 사람 없음 → 캠페인 만든 사람
  const sent = await sendTask(sql, t.id, { via: 'auto', now: afterNextMonday() });
  assert.ok(sent.ok);
  assert.equal(sent.request.requesterName, creator.name);
  assert.equal(typeof (await cancelRequest(sql, sent.request.id, '금액 잘못 적음', member)) === 'object', true);
  assert.equal((await sweep(afterNextMonday(), { campaignIds: [camp.id] })).sent, 0);
  const { rows } = await listPending(sql, new Date(), camp.id);
  assert.equal(rows[0].group, 'stopped');
  assert.equal(rows[0].state.cancelled?.reason, '금액 잘못 적음');
  const again = await sendTask(sql, t.id, { via: 'manual', member });
  assert.ok(again.ok);
  assert.equal(again.request.requesterName, member.name);
  assert.equal(again.request.createdVia, 'manual');
});

test('[확인하고 보내기]·[보내지 않기]·막힘 — 사람은 확인 필요·멈춤을 보낼 수 있지만 막힌 건은 못 보낸다', async () => {
  const camp = await campaign();
  await influencer(H('at')); await influencer(H('bl'), false); await influencer(H('hd'));
  const at = await postedQuote(camp.id, H('at'), null);
  await updateTask(sql, at.id, { removedAt: '2026-10-11' });
  const bl = await postedQuote(camp.id, H('bl'), null);
  const hd = await postedQuote(camp.id, H('hd'), null);
  await holdTask(sql, hd.id, member, '게시 내용 확인 중');
  assert.equal((await sendTask(sql, at.id, { via: 'auto', now: afterNextMonday() })).ok, false);
  const a = await sendTask(sql, at.id, { via: 'manual', member });
  assert.ok(a.ok);
  const b = await sendTask(sql, bl.id, { via: 'manual', member });
  assert.equal(b.ok, false);
  if (!b.ok) assert.equal(b.code, 'blocked');
  const h = await sendTask(sql, hd.id, { via: 'manual', member });
  assert.ok(h.ok);
  const held = await sql<Array<{ at: Date | null }>>`select settle_hold_at as at from campaign_task where id = ${hd.id}`;
  assert.equal(held[0].at, null);   // 보내는 순간 멈춤이 풀린다
  assert.equal(await holdTask(sql, hd.id, member, 'x'), false);   // 이미 보낸 작업은 멈출 수 없다(요청 내역에서 취소)
});

test('동시에 보내도 한 건만 — 자동 스윕과 [지금 보내기]가 겹쳐도', async () => {
  const camp = await campaign();
  await influencer(H('race'));
  const t = await postedQuote(camp.id, H('race'), null);
  const [x, y] = await Promise.all([
    sendTask(sql, t.id, { via: 'auto', now: afterNextMonday() }),
    sendTask(sql, t.id, { via: 'manual', member }),
  ]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  const lost = [x, y].find((r) => !r.ok);
  assert.ok(lost && !lost.ok && lost.code === 'already');
  const reqs = await listRequests(sql, { taskId: t.id });
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].requesterName, x.ok ? AUTO_REQUESTER_FALLBACK : member.name);
});

test('보낸 뒤 내려감 — 요청 행이 지금 작업의 내림을 보여 주고, [그대로 두기]는 정산팀 폴링 시각을 바꾸지 않는다', async () => {
  const camp = await campaign();
  await influencer(H('after'));
  const t = await postedQuote(camp.id, H('after'), null);
  const s = await sendTask(sql, t.id, { via: 'manual', member });
  assert.ok(s.ok);
  await updateTask(sql, t.id, { removedAt: '2026-10-14', removedReason: '이슈로 내림' });
  const [row] = await listRequests(sql, { taskId: t.id });
  assert.equal(row.taskRemovedAt, '2026-10-14'); assert.equal(row.taskRemovedReason, '이슈로 내림');
  assert.equal(await ackRemoval(sql, row.id, member), true);
  assert.equal(await ackRemoval(sql, row.id, member), false);
  const [after1] = await listRequests(sql, { taskId: t.id });
  assert.equal(after1.removalAckByName, member.name);
  assert.equal(after1.updatedAt, row.updatedAt);
});

test('게시 확인을 비우면 확인 시각도 비고, 다시 확인하면 새로 찍힌다', async () => {
  const camp = await campaign();
  await influencer(H('reset'));
  const t = await postedQuote(camp.id, H('reset'), null);
  await sql`update campaign_task set posted_confirmed_at = '2026-01-01T00:00:00Z' where id = ${t.id}`;
  await sql`update campaign_task set posted_at = null where id = ${t.id}`;
  const [a] = await sql<Array<{ at: Date | null }>>`select posted_confirmed_at as at from campaign_task where id = ${t.id}`;
  assert.equal(a.at, null);
  await markPosted(sql, [t.id], '2026-10-12', 'manual');
  const [b] = await sql<Array<{ at: Date | null }>>`select posted_confirmed_at as at from campaign_task where id = ${t.id}`;
  assert.ok(b.at && b.at.getTime() > Date.parse('2026-10-01'));
});

test('막힌 작업이 앞에 쌓여도 뒤의 보낼 작업은 나간다', async () => {
  const camp = await campaign();
  await influencer(H('front'), false); await influencer(H('back'));
  await postedQuote(camp.id, H('front'), null);   // 결제 수단 없음 — 먼저 게시됨
  await sql`update campaign_task set posted_at = '2026-10-01' where campaign_id = ${camp.id}`;
  const back = await postedQuote(camp.id, H('back'), null);
  const r = await sweep(afterNextMonday(), { campaignIds: [camp.id], limit: 1 });
  assert.equal(r.sent, 1);
  assert.equal((await listRequests(sql, { taskId: back.id })).length, 1);
});

test('[확인하고 보내기]로 보낸 건 — 보낼 때 있던 내림은 다시 알리지 않고, 그 뒤 새로 적은 내림은 알린다', async () => {
  const camp = await campaign();
  await influencer(H('seen'));
  const t = await postedQuote(camp.id, H('seen'), null);
  await updateTask(sql, t.id, { removedAt: '2026-10-11' });
  const s = await sendTask(sql, t.id, { via: 'manual', member });
  assert.ok(s.ok);
  assert.equal(s.request.sentRemovedOn, '2026-10-11');
  await updateTask(sql, t.id, { removedAt: '2026-10-09' });   // 나중에 더 이른 날짜로 고쳐 적음
  const [row] = await listRequests(sql, { taskId: t.id });
  assert.equal(row.taskRemovedAt, '2026-10-09');
  assert.equal(row.sentRemovedOn, '2026-10-11');
});
