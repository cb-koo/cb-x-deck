import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, getTask, updateTask } from './campaignTaskStore.ts';
import { runCheckPosted } from './checkPostedRun.ts';

const sql = getSql();
const P = 'tchk' + process.pid;
after(async () => {
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('run — 트윗당 1회(+페이지), 확인은 저장(auto), 사라짐은 보고만, 대상 미정 건너뜀, 읽기 실패는 그 트윗만', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'a', nameEn: `${P.toLowerCase()}-a`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const [post] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: 'mika', cost: null }] });
  await updateTask(sql, post.id, { postUrl: 'https://x.com/mika/status/1001' });
  const [rtA, rtB] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'Rio', cost: null }, { handle: 'sora', cost: null }] });
  const [rtDone] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTaskId: post.id, items: [{ handle: 'hana', cost: null }] });
  await updateTask(sql, rtDone.id, { postedAt: '2026-09-01', postedSource: 'manual' });
  const [rtNone] = await createTasks(sql, camp.id, { ...tin, type: 'rt', items: [{ handle: 'ten', cost: null }] });
  const [rtBad] = await createTasks(sql, camp.id, { ...tin, type: 'rt', targetTweetUrl: 'https://x.com/i/status/4040', items: [{ handle: 'kei', cost: null }] });
  await createTasks(sql, camp.id, { ...tin, type: 'quoteRt', targetTaskId: post.id, items: [{ handle: 'yuna', cost: null }] });   // 인용RT는 대상 아님

  const calls: string[] = [];
  const source = {
    async getTweetRetweeters(tweetId: string, cursor?: string) {
      calls.push(`${tweetId}:${cursor ?? ''}`);
      if (tweetId === '4040') throw Object.assign(new Error('not found'), { status: 404 });
      if (!cursor) return { has_more: true, next_cursor: 'c2', users: [{ userName: 'someone' }] };
      return { has_more: false, next_cursor: null, users: [{ userName: 'RIO' }, { screen_name: 'other' }] };
    },
  };
  const r = await runCheckPosted(sql, camp.id, { source, today: '2026-09-03' });
  assert.deepEqual(calls, ['1001:', '1001:c2', '4040:']);   // 트윗당 묶음, 페이지 넘김, 실패 트윗은 1회
  assert.deepEqual(r.confirmed, [{ taskId: rtA.id, handle: 'Rio' }]);
  assert.deepEqual(r.pending, [{ taskId: rtB.id, handle: 'sora' }]);
  assert.deepEqual(r.missing, [{ taskId: rtDone.id, handle: 'hana' }]);
  assert.deepEqual(r.skipped, [{ taskId: rtNone.id, handle: 'ten', reason: 'no_target' }]);
  assert.equal(r.unreadable.length, 1); assert.equal(r.unreadable[0].tweetId, '4040');
  assert.equal(r.partial.length, 0);
  const a = (await getTask(sql, rtA.id))!;
  assert.equal(a.postedAt, '2026-09-03'); assert.equal(a.postedSource, 'auto');
  assert.equal((await getTask(sql, rtB.id))!.postedAt, null);
  assert.equal((await getTask(sql, rtDone.id))!.postedAt, '2026-09-01');   // 사라졌다고 되돌리지 않는다
  assert.equal((await getTask(sql, rtBad.id))!.postedAt, null);
  // 페이지 상한 — maxPages 1이면 partial에 트윗이 든다
  const r2 = await runCheckPosted(sql, camp.id, { source, today: '2026-09-03', maxPages: 1 });
  assert.deepEqual(r2.partial, ['1001']);
});
