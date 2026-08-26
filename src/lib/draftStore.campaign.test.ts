import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  insertDraft, getDraft, updateDraft, updateDraftsBulk, listDraftsByCampaign, listUnassignedDrafts,
} from './draftStore.ts';
import { createClient } from './clientStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'tdcp' + process.pid;
const content: DraftContent = { posts: [{ text: '캠페인 원고', media: [] }] };

after(async () => {
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

// campaignStore는 다음 Task — 여기서는 033 스키마만 직접 쓴다
async function mkCampaign(clientId: string, clientName: string, suffix: string): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into campaign (client_id, client_name, name, name_en, starts_on, ends_on)
    values (${clientId}, ${clientName}, ${P + suffix}, ${'c-' + P.toLowerCase() + suffix}, '2026-08-24', '2026-08-30')
    returning id`;
  return rows[0].id;
}
const mkDraft = (clientId: string | null, clientName: string | null, extra: { campaignId?: string | null } = {}) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, ...extra,
  });

test('1) 새 필드 — 캠페인 없으면 전부 null, insertDraft(campaignId)면 name/name_en이 조인으로 파생된다', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await mkCampaign(c.id, c.name, 'a');
  const plain = await getDraft(sql, await mkDraft(c.id, c.name));
  assert.equal(plain!.campaignId, null);
  assert.equal(plain!.campaignName, null);
  assert.equal(plain!.campaignCode, null);
  assert.equal(plain!.scheduledOn, null);
  assert.equal(plain!.cost, null);
  const inCamp = await getDraft(sql, await mkDraft(c.id, c.name, { campaignId: camp }));
  assert.equal(inCamp!.campaignId, camp);
  assert.equal(inCamp!.campaignName, P + 'a');
  assert.equal(inCamp!.campaignCode, 'c-' + P.toLowerCase() + 'a');
});

test('2) updateDraft — 세 필드 설정·null=지움·undefined=유지, 예정일은 문자열 그대로 왕복(시간대 시프트 없음)', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await mkCampaign(c.id, c.name, 'b');
  const id = await mkDraft(c.id, c.name);
  await updateDraft(sql, id, {
    campaignId: camp, scheduledOn: '2026-08-26', cost: { type: 'post', amount: 300000, currency: 'KRW' },
  });
  const set = await getDraft(sql, id);
  assert.equal(set!.campaignId, camp);
  assert.equal(set!.scheduledOn, '2026-08-26');           // Date가 아니라 'YYYY-MM-DD' 문자열 — 8/25로 밀리면 to_char 누락
  assert.deepEqual(set!.cost, { type: 'post', amount: 300000, currency: 'KRW' });

  await updateDraft(sql, id, { title: P + '제목' });       // 다른 필드만 건드리면 셋은 유지(undefined)
  const kept = await getDraft(sql, id);
  assert.equal(kept!.campaignId, camp);
  assert.equal(kept!.scheduledOn, '2026-08-26');
  assert.deepEqual(kept!.cost, set!.cost);

  await updateDraft(sql, id, { campaignId: null, scheduledOn: null, cost: null }); // null = 지움(coalesce였다면 불가능)
  const cleared = await getDraft(sql, id);
  assert.equal(cleared!.campaignId, null);
  assert.equal(cleared!.campaignName, null);
  assert.equal(cleared!.scheduledOn, null);
  assert.equal(cleared!.cost, null);
  assert.equal(cleared!.title, P + '제목');               // 무관한 필드는 그대로
});

test('3) updateDraftsBulk campaignId — 일괄 설정·해제, status·influencer는 건드리지 않는다', async () => {
  const c = await createClient(sql, P + '클라3');
  const camp = await mkCampaign(c.id, c.name, 'c');
  const ids = [await mkDraft(c.id, c.name), await mkDraft(c.id, c.name)];
  await updateDraft(sql, ids[0], { status: 'review', influencerHandle: 'hana_kim' });
  await updateDraftsBulk(sql, ids, { campaignId: camp });
  for (const id of ids) assert.equal((await getDraft(sql, id))!.campaignId, camp);
  const first = await getDraft(sql, ids[0]);
  assert.equal(first!.status, 'review');
  assert.equal(first!.influencerHandle, 'hana_kim');
  await updateDraftsBulk(sql, [ids[1]], { campaignId: null });
  assert.equal((await getDraft(sql, ids[1]))!.campaignId, null);
  assert.equal((await getDraft(sql, ids[0]))!.campaignId, camp); // 대상 밖은 유지
});

test('4) listDraftsByCampaign(예정일 순, 없음 마지막)·listUnassignedDrafts(클라 기준 미소속만)', async () => {
  const c = await createClient(sql, P + '클라4');
  const other = await createClient(sql, P + '클라4b');
  const camp = await mkCampaign(c.id, c.name, 'd');
  const late = await mkDraft(c.id, c.name, { campaignId: camp });
  const early = await mkDraft(c.id, c.name, { campaignId: camp });
  const none = await mkDraft(c.id, c.name, { campaignId: camp });
  await updateDraft(sql, late, { scheduledOn: '2026-08-29' });
  await updateDraft(sql, early, { scheduledOn: '2026-08-25' });
  const free = await mkDraft(c.id, c.name);
  await mkDraft(other.id, other.name);           // 다른 클라 — 후보에 안 나온다
  const noClient = await mkDraft(null, null);

  assert.deepEqual((await listDraftsByCampaign(sql, camp)).map((d) => d.id), [early, late, none]);
  const cands = await listUnassignedDrafts(sql, c.id);
  assert.deepEqual(cands.map((d) => d.id), [free]);           // 소속 원고·다른 클라 제외
  assert.ok((await listUnassignedDrafts(sql, null)).some((d) => d.id === noClient)); // 클라 없는 캠페인 → 클라 없는 원고
});

test('5) 캠페인 삭제 → campaign_id null(FK set null), 예정일·비용은 원고에 남는다', async () => {
  const c = await createClient(sql, P + '클라5');
  const camp = await mkCampaign(c.id, c.name, 'e');
  const id = await mkDraft(c.id, c.name, { campaignId: camp });
  await updateDraft(sql, id, { scheduledOn: '2026-08-27', cost: { type: 'rt', amount: 100, currency: 'JPY' } });
  await sql`delete from campaign where id = ${camp}`;
  const d = await getDraft(sql, id);
  assert.ok(d, '원고는 지워지지 않는다');
  assert.equal(d!.campaignId, null);
  assert.equal(d!.scheduledOn, '2026-08-27');
  assert.deepEqual(d!.cost, { type: 'rt', amount: 100, currency: 'JPY' });
});
