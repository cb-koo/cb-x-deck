// 같은 방문의 게시물(089, ISSUE-016) — 저장소 동작(연습용 DB). 만들기·체인 금지·함께 지우기·함께 취소·DB 제약.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign, deleteCampaign } from './campaignStore.ts';
import { createTasks, createSameVisitTask, deleteTask, cancelTask, getTask, sameVisitLinkedIds, updateTask } from './campaignTaskStore.ts';
import { ProductError } from './productCommand.ts';
import { SAME_VISIT_CREATE_MESSAGE, SAME_VISIT_CANCEL_POSTED_MESSAGE } from './sameVisit.ts';

const sql = getSql();
const P = 'tsvp' + process.pid;

after(async () => {
  await sql`delete from campaign_task where same_visit_of is not null and campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign_task_deletion where influencer_handle like ${P + '%'}`.catch(() => {});
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

async function setup(suffix: string) {
  const c = await createClient(sql, P + '클라' + suffix);
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + suffix, nameEn: `${P}-${suffix}`,
    startsOn: '2026-11-01', endsOn: '2026-11-30', kind: 'visit', note: '', createdBy: null,
  });
  const [o] = await createTasks(sql, camp.id, {
    type: 'visit', targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: '2026-09-02', note: '', createdBy: null,
    visitTime: '10:30', items: [{ handle: P + 'sara', cost: { amount: 15000, currency: 'JPY' } }],
  });
  return { camp, o };
}
const rejects = (p: Promise<unknown>, message: string) =>
  assert.rejects(p, (e: unknown) => e instanceof ProductError && e.message === message);

test('만들기 — 같은 캠페인·인플·방문협찬, 비용 없음 고정, 방문일·금액·예정일은 비움, 게시 전 원래 작업에도 된다', async () => {
  const { camp, o } = await setup('a');
  const a = await createSameVisitTask(sql, camp.id, o.id, null);
  assert.equal(a.sameVisitOf, o.id);
  assert.equal(a.campaignId, camp.id);
  assert.equal(a.influencerHandle, o.influencerHandle);
  assert.equal(a.type, 'visit');
  assert.equal(a.noCost, true);
  assert.equal(a.cost, null);
  assert.equal(a.visitOn, null);
  assert.equal(a.scheduledOn, null);
  // 원래 작업은 그대로
  const o2 = await getTask(sql, o.id);
  assert.deepEqual(o2!.cost, { amount: 15000, currency: 'JPY' });
  assert.equal(o2!.sameVisitOf, null);
  // 같은 원래 작업에 여러 개
  await createSameVisitTask(sql, camp.id, o.id, null);
  assert.equal((await sameVisitLinkedIds(sql, o.id)).length, 2);
});

test('만들기 거절 — 체인 금지, 다른 캠페인, 취소된 작업, 방문협찬 아님', async () => {
  const { camp, o } = await setup('b');
  const a = await createSameVisitTask(sql, camp.id, o.id, null);
  await rejects(createSameVisitTask(sql, camp.id, a.id, null), SAME_VISIT_CREATE_MESSAGE.linked);
  const { camp: other } = await setup('b2');
  await assert.rejects(createSameVisitTask(sql, other.id, o.id, null), (e: unknown) => e instanceof ProductError && e.status === 404);
  const [post] = await createTasks(sql, camp.id, { type: 'post', targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, items: [{ handle: P + 'x', cost: null }] });
  await rejects(createSameVisitTask(sql, camp.id, post.id, null), SAME_VISIT_CREATE_MESSAGE.notVisit);
});

test('DB 제약 — 연결 작업에 금액을 넣거나 비용 없음을 풀 수 없다', async () => {
  const { camp, o } = await setup('c');
  const a = await createSameVisitTask(sql, camp.id, o.id, null);
  await assert.rejects(sql`update campaign_task set cost = ${sql.json({ amount: 1, currency: 'JPY' } as never)} where id = ${a.id}`, (e: { code?: string }) => e.code === '23514');
  await assert.rejects(sql`update campaign_task set no_cost = false where id = ${a.id}`, (e: { code?: string }) => e.code === '23514');
  await assert.rejects(sql`update campaign_task set type = 'post' where id = ${a.id}`, (e: { code?: string }) => e.code === '23514');
  // 게시 예정일 같은 다른 편집은 된다
  assert.equal(await updateTask(sql, a.id, { scheduledOn: '2026-11-12' }), true);
  assert.equal((await getTask(sql, a.id))!.scheduledOn, '2026-11-12');
});

test('삭제 — 연결 작업이 있으면 확인 없이는 거절, withSameVisit면 함께 지우고 둘 다 삭제 기록', async () => {
  const { camp, o } = await setup('d');
  const a = await createSameVisitTask(sql, camp.id, o.id, null);
  await assert.rejects(deleteTask(sql, o.id), (e: unknown) => e instanceof ProductError && e.code === 'SAME_VISIT_DELETE_CONFIRM');
  assert.ok(await getTask(sql, o.id));
  // 원래 작업만 SQL로 지우면 FK가 막는다(조용한 연쇄 삭제 없음)
  await assert.rejects(sql`delete from campaign_task where id = ${o.id}`, (e: { code?: string }) => e.code === '23503');
  assert.equal(await deleteTask(sql, o.id, { withSameVisit: true, actor: null }), true);
  assert.equal(await getTask(sql, o.id), null);
  assert.equal(await getTask(sql, a.id), null);
  const logs = await sql`select task_id from campaign_task_deletion where task_id in ${sql([o.id, a.id])}`;
  assert.equal(logs.length, 2);
  // 연결 작업 하나만 지우는 건 평소대로
  const { camp: c2, o: o2 } = await setup('d2');
  const b = await createSameVisitTask(sql, c2.id, o2.id, null);
  assert.equal(await deleteTask(sql, b.id), true);
  assert.ok(await getTask(sql, o2.id));
});

test('캠페인 삭제 — 원래 작업·연결 작업이 한 번에 지워진다(FK no action)', async () => {
  const { camp, o } = await setup('e');
  await createSameVisitTask(sql, camp.id, o.id, null);
  await deleteCampaign(sql, camp.id);
  assert.equal(await getTask(sql, o.id), null);
});

test('취소 — 원래 작업을 취소하면 게시 전 연결 작업도 함께, 게시된 연결 작업이 있으면 막는다', async () => {
  const { camp, o } = await setup('f');
  const a = await createSameVisitTask(sql, camp.id, o.id, null);
  assert.equal(await cancelTask(sql, o.id, { reason: 'declined', note: '', actorId: null, today: '2026-11-09' }), 'ok');
  assert.equal((await getTask(sql, a.id))!.cancelledAt, '2026-11-09');
  assert.equal((await getTask(sql, a.id))!.cancelReason, 'declined');

  const { camp: c2, o: o2 } = await setup('f2');
  const b = await createSameVisitTask(sql, c2.id, o2.id, null);
  await sql`update campaign_task set posted_at = '2026-11-08' where id = ${b.id}`;
  await rejects(cancelTask(sql, o2.id, { reason: null, note: '', actorId: null, today: '2026-11-09' }), SAME_VISIT_CANCEL_POSTED_MESSAGE);
  assert.equal((await getTask(sql, o2.id))!.cancelledAt, null);
  // 연결 작업 자체는 게시 전이면 따로 취소할 수 있다
  const c = await createSameVisitTask(sql, c2.id, o2.id, null);
  assert.equal(await cancelTask(sql, c.id, { reason: null, note: '', actorId: null, today: '2026-11-09' }), 'ok');
});
