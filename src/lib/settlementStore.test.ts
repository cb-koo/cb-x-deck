import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, updateTask } from './campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods } from './influencerStore.ts';
import { SETTLEMENT_DEFAULTS } from './settlementSettings.ts';
import {
  getSettlementSettings, saveSettlementSettings, listSettlementVersions, lastQuoteRtCategory, listCandidates,
} from './settlementStore.ts';

const sql = getSql();
const P = 'tstl' + process.pid;
const H = (s: string) => `${P}_${s}`;   // 핸들도 접두어 — 명부 정리를 위해
after(async () => {
  await sql`delete from payment_request where influencer_handle like ${P + '%'}`;
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});
const base = (clientId: string, clientName: string, suffix: string, kind: 'content' | 'visit' | null = 'content') => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind, note: '', createdBy: null,
});
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
async function influencerWithPaypal(handle: string) {
  const { row } = await createInfluencer(sql, { handle, createdBy: null });
  await updatePaymentMethods(sql, row.id, { kind: 'add', input: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: `${handle}@x.com`, fee: { mode: 'grossUp', percent: 5 } }, makeDefault: true }, null);
  return row;
}

test('설정 — 행 없으면 기본값, 저장하면 마지막 행이 현재값, 버전 목록', async () => {
  // 다른 세션이 이미 저장한 행이 있을 수 있어 "기본값과 같다"는 단정 대신 모양만 본다
  const before = await getSettlementSettings(sql);
  assert.ok(before.categories.length >= 1 && before.rateKrwPerJpy >= 1);
  const mine = { ...SETTLEMENT_DEFAULTS, rateKrwPerJpy: 11, marker: P } as typeof SETTLEMENT_DEFAULTS & { marker: string };
  await saveSettlementSettings(sql, mine, null);
  const cur = await getSettlementSettings(sql);
  assert.equal(cur.rateKrwPerJpy, 11);
  const versions = await listSettlementVersions(sql, 1);
  assert.equal(versions.length, 1);
  // 원상복구 — 프로덕션 설정을 테스트 값으로 남기지 않는다
  await saveSettlementSettings(sql, { ...before, marker: P } as typeof before & { marker: string }, null);
  assert.equal((await getSettlementSettings(sql)).rateKrwPerJpy, before.rateKrwPerJpy);
});

test('후보 — 게시됨+비용+인플만, 명부/결제 수단 유무가 신호등, 활성 요청 있으면 제외', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, base(c.id, c.name, 'a'));
  await influencerWithPaypal(H('pay'));
  const { row: noPm } = await createInfluencer(sql, { handle: H('nopm'), createdBy: null });
  assert.ok(noPm);
  const [tPay, tNoPm, tNoRoster, tNoCost, tNotPosted] = await createTasks(sql, camp.id, {
    ...tin, type: 'quoteRt',
    items: [
      { handle: H('pay'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('nopm'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('ghost'), cost: { amount: 30000, currency: 'KRW' } },
      { handle: H('pay'), cost: null },
      { handle: H('pay'), cost: { amount: 1000, currency: 'KRW' } },
    ],
  });
  for (const t of [tPay, tNoPm, tNoRoster, tNoCost]) await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/a/status/1' });
  const list = (await listCandidates(sql, SETTLEMENT_DEFAULTS, null, '2026-08-28')).filter((x) => x.influencerHandle.startsWith(P));
  const ids = list.map((x) => x.taskId);
  assert.ok(ids.includes(tPay.id) && ids.includes(tNoPm.id) && ids.includes(tNoRoster.id));
  assert.ok(!ids.includes(tNoCost.id) && !ids.includes(tNotPosted.id));
  const pay = list.find((x) => x.taskId === tPay.id)!;
  assert.equal(pay.money?.amountGross, 3158); assert.equal(pay.method?.type, 'paypal');
  assert.equal(pay.readiness, 'blocked');   // 인용RT 첫 요청 — 분류 빈칸
  assert.equal(pay.categoryDefault, null);
  assert.equal(list.find((x) => x.taskId === tNoPm.id)!.issues[0].code, 'no-payment-method');
  assert.equal(list.find((x) => x.taskId === tNoRoster.id)!.issues[0].code, 'no-influencer');
  assert.equal(pay.clientName, c.name); assert.equal(pay.campaignName, camp.name); assert.equal(pay.deadlineDefault, '2026-08-28');
});

test('lastQuoteRtCategory — 없으면 null', async () => {
  assert.equal(await lastQuoteRtCategory(sql, '00000000-0000-0000-0000-000000000000'), null);
  assert.equal(await lastQuoteRtCategory(sql, null), null);
});
