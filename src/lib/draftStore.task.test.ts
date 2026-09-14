import { test, after } from 'node:test';
import type postgres from 'postgres';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, getDraft, listDrafts, updateDraft } from './draftStore.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, TaskAttachError } from './campaignTaskStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'tdtk' + process.pid;
const content: DraftContent = { posts: [{ text: '작업 원고', media: [] }] };
after(async () => {
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});
// 브리프 초안은 insertDraft(sql, …)를 그대로 불렀지만, "붙이기 실패 = 삽입도 없던 일" 보장은
// 호출자가 트랜잭션을 줄 때만 성립한다(postgres.js는 중첩 begin을 지원하지 않아 insertDraft가 스스로 감쌀 수 없다).
// 실제 호출부(원고 생성 POST·직접 쓰기 POST)가 sql.begin으로 감싸므로 테스트도 같은 방식으로 부른다.
const mkDraft = (clientId: string | null, clientName: string | null, extra: { taskId?: string | null } = {}) =>
  sql.begin(async (tx0) => insertDraft(tx0 as unknown as postgres.Sql, { clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [], content, model: null, memberId: null, ...extra })) as unknown as Promise<string>;
const base = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 캠페인 파생 필드 — 작업이 없으면 전부 null, 붙으면 작업의 캠페인·예정일·비용·유형이 조인으로 온다', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'a', nameEn: `${P.toLowerCase()}-a`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const plain = (await getDraft(sql, await mkDraft(c.id, c.name)))!;
  assert.equal(plain.taskId, null); assert.equal(plain.taskType, null); assert.equal(plain.campaignId, null);
  assert.equal(plain.campaignName, null); assert.equal(plain.scheduledOn, null); assert.equal(plain.cost, null);
  const [t] = await createTasks(sql, camp.id, { ...base, type: 'quoteRt', scheduledOn: '2026-09-03', items: [{ handle: 'yuna', cost: { amount: 8000, currency: 'JPY' } }] });
  const id = await mkDraft(c.id, c.name, { taskId: t.id });
  const d = (await getDraft(sql, id))!;
  assert.equal(d.taskId, t.id); assert.equal(d.taskType, 'quoteRt'); assert.equal(d.campaignId, camp.id);
  assert.equal(d.campaignName, P + 'a'); assert.equal(d.campaignCode, `${P.toLowerCase()}-a`);
  assert.equal(d.scheduledOn, '2026-09-03'); assert.deepEqual(d.cost, { amount: 8000, currency: 'JPY' });
  assert.equal(d.influencerHandle, 'yuna');   // 작업 인플이 원고에 채워졌다(attachDraft)
  // 이미 원고가 붙은 작업에 또 붙이면 실패 — insert도 함께 롤백된다
  const before = (await listDrafts(sql, { clientId: c.id })).length;
  await assert.rejects(mkDraft(c.id, c.name, { taskId: t.id }), (e: unknown) => e instanceof TaskAttachError && e.code === 'task-has-draft');
  assert.equal((await listDrafts(sql, { clientId: c.id })).length, before);
});

test('2) 미부착 원고 목록 — listDrafts unattached 옵션이 작업에 붙은 원고를 뺀다', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'b', nameEn: `${P.toLowerCase()}-b`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const free = await mkDraft(c.id, c.name);
  const [t] = await createTasks(sql, camp.id, { ...base, type: 'post', items: [] });
  const attached = await mkDraft(c.id, c.name, { taskId: t.id });
  const ids = (await listDrafts(sql, { clientId: c.id, unattached: true })).map((d) => d.id);
  assert.ok(ids.includes(free)); assert.ok(!ids.includes(attached));
  // 클라 없는 원고도 같은 규칙 — 붙은 원고는 클라 유무와 무관하게 빠진다
  const noClient = (await listDrafts(sql, { unattached: true })).filter((d) => d.clientId === null);
  assert.ok(!noClient.some((d) => d.id === attached));
});

test('3) updateDraft — 캠페인 3필드는 더 받지 않는다(타입 수준) · status/influencer는 그대로', async () => {
  const c = await createClient(sql, P + '클라3');
  const id = await mkDraft(c.id, c.name);
  await updateDraft(sql, id, { status: 'review', influencerHandle: 'kei' });
  const d = (await getDraft(sql, id))!;
  assert.equal(d.status, 'review'); assert.equal(d.influencerHandle, 'kei');
  // campaignId/scheduledOn/cost는 updateDraft patch 타입에서 제거됐다(스펙 §5) — 컴파일이 막는다(tsc가 검증)
});
