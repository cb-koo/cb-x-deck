import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks } from './campaignTaskStore.ts';
import { addTrackedPost, linkTrackedPost } from './trackingStore.ts';
import { listDueMeasurements, type DueMeasurement } from './autoMeasureStore.ts';

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
const reasons = (rows: DueMeasurement[]) => Object.fromEntries(rows.filter((r) => r.tweetId.startsWith(P)).map((r) => [r.tweetId.slice(P.length), r.due]));

test('본 게시물은 시점대로, 링크 댓글은 하루 한 번, 안 보이는 글은 확인 일정대로 — 링크 없는 댓글·7일 지난 글은 뺀다', async () => {
  const { mk } = await setup();
  const now = Date.now();
  const postedAt = (agoMin: number) => new Date(now - agoMin * MIN).toISOString();
  const attach = async (taskId: string, suffix: string, agoMin: number, text = '') => {
    const { row } = await addTrackedPost(sql, { tweetId: P + suffix, authorHandle: 'a', text, postedAt: postedAt(agoMin), createdBy: null, metrics: M, raw: null });
    return row;
  };

  // 1) 게시 20분 전, 방금 등록(즉시 측정) → 지금은 잴 것 없음, 15분 뒤(게시 35분)엔 30분 시점
  const t1 = await mk('a');
  const p1 = await attach(t1.id, '1', 20);
  await linkTrackedPost(sql, p1.id, { taskId: t1.id });

  // 2) 같은 작업에 붙은 링크 없는 본인 댓글 — 대상 아님
  const reply = await attach(t1.id, '1r', 20, '감사합니다');
  await sql`update tracked_post set task_id = ${t1.id} where id = ${reply.id}`;
  // 2-b) 링크가 든 본인 댓글 — 하루 한 번(방금 측정했으니 하루 뒤)
  const linkReply = await attach(t1.id, '1l', 20, '예약은 여기서 → https://s.gy/abc');
  await sql`update tracked_post set task_id = ${t1.id} where id = ${linkReply.id}`;

  // 3) 내림 표시된 작업 — 내림 뒤에 다시 보이는지 알기 위해 계속 본다
  const t3 = await mk('c');
  const p3 = await attach(t3.id, '3', 20);
  await linkTrackedPost(sql, p3.id, { taskId: t3.id });
  await sql`update campaign_task set removed_at = now() where id = ${t3.id}`;

  // 4) 8일 전 게시물
  const t4 = await mk('d');
  const p4 = await attach(t4.id, '4', 8 * 24 * 60);
  await linkTrackedPost(sql, p4.id, { taskId: t4.id });
  await sql`update post_metric_snapshot set captured_at = ${postedAt(8 * 24 * 60 - 10)} where tracked_post_id = ${p4.id}`;

  // 5) 안 보임 확정(10분 전 확인) — 하루 뒤 다시
  const t5 = await mk('e');
  const p5 = await attach(t5.id, '5', 20);
  await linkTrackedPost(sql, p5.id, { taskId: t5.id });
  await sql`update tracked_post set unavailable_at = ${postedAt(15)}, missing_since = ${postedAt(15)}, missing_checked_at = ${postedAt(10)} where id = ${p5.id}`;
  await sql`update post_metric_snapshot set captured_at = ${postedAt(19)} where tracked_post_id = ${p5.id}`;

  // 6) 처음 "없음"(5분 전, 확정 전) — 1시간 뒤 다시
  const t6 = await mk('f');
  const p6 = await attach(t6.id, '6', 20);
  await linkTrackedPost(sql, p6.id, { taskId: t6.id });
  await sql`update tracked_post set missing_since = ${postedAt(5)}, missing_checked_at = ${postedAt(5)} where id = ${p6.id}`;

  assert.deepEqual(ids(await listDueMeasurements(sql, new Date(now), 500)), []);
  assert.deepEqual(reasons(await listDueMeasurements(sql, new Date(now + 15 * MIN), 500)), {
    1: { reason: 'checkpoint', checkpointMs: 30 * MIN }, 3: { reason: 'checkpoint', checkpointMs: 30 * MIN },
  });
  assert.deepEqual(reasons(await listDueMeasurements(sql, new Date(now + 60 * MIN), 500)), {
    1: { reason: 'checkpoint', checkpointMs: 60 * MIN }, 3: { reason: 'checkpoint', checkpointMs: 60 * MIN }, 6: { reason: 'confirm' },
  });
  const dayLater = reasons(await listDueMeasurements(sql, new Date(now + 24 * 60 * MIN + MIN), 500));
  assert.deepEqual(dayLater['1l'], { reason: 'daily' });
  assert.deepEqual(dayLater['5'], { reason: 'recheck' });
  assert.equal(dayLater['1r'], undefined);
  assert.equal(dayLater['4'], undefined);
});
