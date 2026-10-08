import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks } from './campaignTaskStore.ts';
import { addTrackedPost, linkTrackedPost } from './trackingStore.ts';
import { listDueMeasurements } from './autoMeasureStore.ts';

const sql = getSql();
const P = 'tam' + process.pid;
const M = { views: 100, likes: 5, retweets: 2, replies: 1, bookmarks: 3, quotes: 0 };
const MIN = 60_000;

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

async function setup() {
  const c = await createClient(sql, P + 'cl');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'c', nameEn: `${P}-c`, startsOn: '2026-10-01', endsOn: '2026-10-31', kind: null, note: '', createdBy: null });
  const mk = async (handle: string) => (await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'post', items: [{ handle, cost: null }] }))[0];
  return { mk };
}
const ids = (rows: Array<{ tweetId: string }>) => rows.map((r) => r.tweetId).filter((t) => t.startsWith(P)).sort();

test('시점이 온 본 게시물만 고르고, 내려진 글·본인 댓글·7일 지난 글·사라진 글은 뺀다', async () => {
  const { mk } = await setup();
  const now = Date.now();
  const postedAt = (agoMin: number) => new Date(now - agoMin * MIN).toISOString();

  // 1) 게시 20분 전, 방금 등록(즉시 측정) → 지금은 잴 것 없음, 15분 뒤(게시 35분)엔 30분 시점
  const t1 = await mk('a');
  const { row: p1 } = await addTrackedPost(sql, { tweetId: P + '1', authorHandle: 'a', text: '', postedAt: postedAt(20), createdBy: null, metrics: M, raw: null });
  await linkTrackedPost(sql, p1.id, { taskId: t1.id });

  // 2) 같은 작업에 붙은 본인 댓글 — 작업 post_url과 번호가 달라 대상 아님
  const { row: reply } = await addTrackedPost(sql, { tweetId: P + '1r', authorHandle: 'a', text: '', postedAt: postedAt(20), createdBy: null, metrics: M, raw: null });
  await sql`update tracked_post set task_id = ${t1.id} where id = ${reply.id}`;

  // 3) 내려진 게시물(작업에 내림 표시) — 취소는 게시와 함께 있을 수 없어(DB 제약) 쿼리 조건은 방어용
  const t3 = await mk('c');
  const { row: p3 } = await addTrackedPost(sql, { tweetId: P + '3', authorHandle: 'c', text: '', postedAt: postedAt(20), createdBy: null, metrics: M, raw: null });
  await linkTrackedPost(sql, p3.id, { taskId: t3.id });
  await sql`update campaign_task set removed_at = now() where id = ${t3.id}`;

  // 4) 8일 전 게시물
  const t4 = await mk('d');
  const { row: p4 } = await addTrackedPost(sql, { tweetId: P + '4', authorHandle: 'd', text: '', postedAt: postedAt(8 * 24 * 60), createdBy: null, metrics: M, raw: null });
  await linkTrackedPost(sql, p4.id, { taskId: t4.id });
  await sql`update post_metric_snapshot set captured_at = ${postedAt(8 * 24 * 60 - 10)} where tracked_post_id = ${p4.id}`;

  // 5) 사라진 게시물
  const t5 = await mk('e');
  const { row: p5 } = await addTrackedPost(sql, { tweetId: P + '5', authorHandle: 'e', text: '', postedAt: postedAt(20), createdBy: null, metrics: M, raw: null });
  await linkTrackedPost(sql, p5.id, { taskId: t5.id });
  await sql`update tracked_post set unavailable_at = now() where id = ${p5.id}`;
  await sql`update post_metric_snapshot set captured_at = ${postedAt(19)} where tracked_post_id = ${p5.id}`;

  assert.deepEqual(ids(await listDueMeasurements(sql, new Date(now), 500)), []);
  const later = await listDueMeasurements(sql, new Date(now + 15 * MIN), 500);
  assert.deepEqual(ids(later), [P + '1']);
  assert.equal(later.find((r) => r.tweetId === P + '1')!.checkpointMs, 30 * MIN);
});
