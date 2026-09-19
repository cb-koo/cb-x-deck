import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks } from './campaignTaskStore.ts';
import { insertDraft } from './draftStore.ts';
import { listDraftCandidates } from './campaignDraftStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'tcdr' + process.pid;
const content: DraftContent = { posts: [{ text: '후보 테스트', media: [] }] };
after(async () => {
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});
const mkDraft = (clientId: string, clientName: string, taskId: string | null, batchId: string | null) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, taskId, batchId,
  });

test('1) 형제 시안 = 이 캠페인에 붙은 원고와 같은 배치의 안 붙은 원고, 작업 없는 원고 = 나머지 같은 클라', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + '캠', nameEn: `${P.toLowerCase()}-camp`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  const [t] = await createTasks(sql, camp.id, {
    type: 'post', targetTaskId: null, targetTweetUrl: null, draftId: null,
    scheduledOn: null, visitOn: null, note: '', createdBy: null, items: [{ handle: null, cost: null }],
  });
  const batch = crypto.randomUUID();
  const attached = await mkDraft(c.id, c.name, t.id, batch);   // 이 캠페인 작업에 붙은 원고
  const sibling = await mkDraft(c.id, c.name, null, batch);    // 같은 배치, 안 붙음 → 형제
  const loose = await mkDraft(c.id, c.name, null, null);       // 배치 없음, 안 붙음 → 작업 없는 원고

  const r = await listDraftCandidates(sql, camp.id);
  assert.deepEqual(r.siblings.map((d) => d.id), [sibling]);
  assert.deepEqual(r.others.map((d) => d.id), [loose]);
  assert.ok(!r.siblings.some((d) => d.id === attached) && !r.others.some((d) => d.id === attached));  // 붙은 것은 후보가 아니다
});

test('2) 다른 클라이언트 원고는 후보가 아니다 · 캠페인에 클라가 없으면 두 묶음 모두 빈다', async () => {
  const c1 = await createClient(sql, P + '클라1');
  const c2 = await createClient(sql, P + '클라2');
  const camp = await createCampaign(sql, {
    clientId: c1.id, clientName: c1.name, name: P + '캠2', nameEn: `${P.toLowerCase()}-camp2`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  await mkDraft(c2.id, c2.name, null, null);
  const r = await listDraftCandidates(sql, camp.id);
  assert.equal(r.siblings.length, 0);
  assert.equal(r.others.length, 0);

  const noClient = await createCampaign(sql, {
    clientId: null, clientName: null, name: P + '캠3', nameEn: `${P.toLowerCase()}-camp3`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  const r2 = await listDraftCandidates(sql, noClient.id);
  assert.equal(r2.siblings.length, 0);
  assert.equal(r2.others.length, 0);
});
