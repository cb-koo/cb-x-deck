import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { insertDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import { createTasks, getTask, markPosted, listTargetCandidates, listTargetingHandles } from './campaignTaskStore.ts';
import { linkTrackedPost, addTrackedPost, TrackingLinkError } from './trackingStore.ts';
import { CANCEL_REASONS } from './campaignTaskInput.ts';

const sql = getSql();
const P = 'tcv2' + process.pid;
const content: DraftContent = { posts: [{ text: '취소 테스트', media: [] }] };

after(async () => {
  await sql`delete from tracked_post where author_handle like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

export const mkCampaign = async (suffix: string) => {
  const c = await createClient(sql, P + '클라' + suffix);
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
    startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null,
  });
  return { c, camp };
};
export const mkDraft = (clientId: string, clientName: string, title: string | null = null) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, title,
  });
export const baseInput = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 취소 5필드 왕복 — 기본 null/빈 문자열, SQL로 찍은 값이 그대로 읽힌다', async () => {
  const { camp } = await mkCampaign('a');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: P + '_a', cost: null }] });
  assert.equal(t.cancelledAt, null);
  assert.equal(t.cancelReason, null);
  assert.equal(t.cancelNote, '');
  assert.equal(t.cancelledDraftId, null);
  assert.equal(t.cancelledDraftTitle, null);
  await sql`update campaign_task set cancelled_at = '2026-09-16', cancel_reason = 'declined', cancel_note = '일정', cancelled_draft_title = '제목' where id = ${t.id}`;
  const r = await getTask(sql, t.id);
  assert.equal(r?.cancelledAt, '2026-09-16');
  assert.equal(r?.cancelReason, 'declined');
  assert.equal(r?.cancelNote, '일정');
  assert.equal(r?.cancelledDraftTitle, '제목');
  assert.deepEqual([...CANCEL_REASONS], ['declined', 'no_response', 'other']);
});

test('2) 상호 배제 check — 게시된 작업에 cancelled_at을 찍으면 23514', async () => {
  const { camp } = await mkCampaign('b');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_b', cost: null }] });
  await sql`update campaign_task set posted_at = '2026-09-15' where id = ${t.id}`;
  await assert.rejects(
    sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${t.id}`,
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
});

test('3) 게시 확인 경로 — markPosted는 취소 작업을 건너뛰고, 트래킹 연결은 취소 작업을 거절한다', async () => {
  const { camp } = await mkCampaign('c');
  const [a, b] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: P + '_c1', cost: null }, { handle: P + '_c2', cost: null }] });
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${b.id}`;
  const n = await markPosted(sql, [a.id, b.id], '2026-09-16', 'auto');
  assert.equal(n, 1);
  assert.equal((await getTask(sql, b.id))?.postedAt, null);
  const [post] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_c3', cost: null }] });
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${post.id}`;
  const { row: tp } = await addTrackedPost(sql, {
    tweetId: P + '001', authorHandle: P + '_c3', text: 'x', postedAt: null, createdBy: null,
    metrics: { views: null, likes: null, retweets: null, replies: null, bookmarks: null, quotes: null }, raw: null,
  });
  await assert.rejects(
    sql.begin((tx) => linkTrackedPost(tx as unknown as typeof sql, tp.id, { taskId: post.id })),
    (e: unknown) => e instanceof TrackingLinkError && e.code === 'cancelled-task',
  );
  assert.equal((await sql`select task_id from tracked_post where id = ${tp.id}`)[0].task_id, null);   // 연결 자체가 롤백
});

test('3b) 대상 — 취소된 작업은 새 대상 후보·"이미 RT하기로 한 사람"에서 빠지고, 이미 가리키던 RT는 target.cancelledAt으로 안다 (R19)', async () => {
  const { c, camp } = await mkCampaign('c2');
  const [post] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_t1', cost: null }] });
  const [rt] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', targetTaskId: post.id, items: [{ handle: P + '_t2', cost: null }] });
  assert.ok((await listTargetCandidates(sql, { clientId: c.id })).some((x) => x.taskId === post.id));
  assert.deepEqual(await listTargetingHandles(sql, { taskId: post.id }), [P + '_t2']);
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${post.id}`;
  assert.ok(!(await listTargetCandidates(sql, { clientId: c.id })).some((x) => x.taskId === post.id));
  await sql`update campaign_task set cancelled_at = '2026-09-16' where id = ${rt.id}`;
  assert.deepEqual(await listTargetingHandles(sql, { taskId: post.id }), []);          // 취소된 RT는 "이미 RT하기로 한 사람"이 아니다
  await sql`update campaign_task set cancelled_at = null where id = ${rt.id}`;
  assert.equal((await getTask(sql, rt.id))?.target?.cancelledAt, '2026-09-16');           // 대상이 취소됨 — 화면이 '대상 작업 취소됨'으로
});
