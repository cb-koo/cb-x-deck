import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { insertDraft, updateDraft, getDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  createTasks, listTasksByCampaign, getTask, findTaskByDraft, updateTask, deleteTask, attachDraft, detachDraft,
  listTargetCandidates, listTargetingHandles, markPosted, countTasksForCampaignDelete, cutoverDraftsToTasks, TaskAttachError,
} from './campaignTaskStore.ts';

const sql = getSql();
const P = 'ttsk' + process.pid;
const content: DraftContent = { posts: [{ text: '작업 스토어', media: [] }] };

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

const mkCampaign = async (clientId: string, clientName: string, suffix: string) => createCampaign(sql, {
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
  startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null,
});
const mkDraft = (clientId: string | null, clientName: string | null, extra: Record<string, unknown> = {}) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, ...extra,
  });
const baseInput = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

test('1) 여러 명 한 번에 → 사람 수만큼, 빈 목록 → 미배정 1행, 날짜 왕복·기본값', async () => {
  const c = await createClient(sql, P + '클라1');
  const camp = await mkCampaign(c.id, c.name, 'a');
  const rows = await createTasks(sql, camp.id, {
    ...baseInput, type: 'rt', scheduledOn: '2026-09-03', note: '메모',
    items: [{ handle: 'Rio', cost: { amount: 3000, currency: 'JPY' } }, { handle: 'sora', cost: null }],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.influencerHandle), ['Rio', 'sora']);
  assert.equal(rows[0].scheduledOn, '2026-09-03');
  assert.deepEqual(rows[0].cost, { amount: 3000, currency: 'JPY' });
  assert.equal(rows[1].cost, null);
  assert.equal(rows[0].postedAt, null);
  assert.equal(rows[0].removedReason, '');
  assert.equal(rows[0].draftStatus, null);
  const solo = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [] });
  assert.equal(solo.length, 1);
  assert.equal(solo[0].influencerHandle, null);
  const listed = await listTasksByCampaign(sql, camp.id);
  assert.deepEqual(listed.map((r) => r.id), [...rows.map((r) => r.id), solo[0].id]);   // created_at asc
  assert.equal(await getTask(sql, 'not-a-uuid'), null);
});

test('2) 원고 붙이기 — 요약 파생, 원고 1개 = 작업 1개(unique), 떼기, 인플 동기화(작업 → 원고)', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await mkCampaign(c.id, c.name, 'b');
  const draftId = await mkDraft(c.id, c.name);
  await updateDraft(sql, draftId, { status: 'review', title: P + '제목' });
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: 'mika', cost: null }] });
  await attachDraft(sql, t.id, draftId);
  const got = await getTask(sql, t.id);
  assert.equal(got!.draftId, draftId);
  assert.equal(got!.draftStatus, 'review');
  assert.equal(got!.draftLabel, P + '제목');
  assert.equal((await getDraft(sql, draftId))!.influencerHandle, 'mika');   // 작업 인플이 원고에 채워진다
  assert.equal((await findTaskByDraft(sql, draftId))!.id, t.id);
  const [t2] = await createTasks(sql, camp.id, { ...baseInput, type: 'quoteRt', items: [] });
  await assert.rejects(attachDraft(sql, t2.id, draftId), (e: unknown) => e instanceof TaskAttachError && e.code === 'draft-attached');
  const other = await mkDraft(c.id, c.name);
  await assert.rejects(attachDraft(sql, t.id, other), (e: unknown) => e instanceof TaskAttachError && e.code === 'task-has-draft');
  await assert.rejects(attachDraft(sql, '00000000-0000-0000-0000-000000000000', other), (e: unknown) => e instanceof TaskAttachError && e.code === 'no-task');
  assert.equal(await detachDraft(sql, draftId), true);
  assert.equal((await getTask(sql, t.id))!.draftId, null);
  // 원고 인플이 있고 작업이 비어 있으면 붙일 때 작업 쪽으로 채운다
  await updateDraft(sql, other, { influencerHandle: 'hana' });
  await attachDraft(sql, t2.id, other);
  assert.equal((await getTask(sql, t2.id))!.influencerHandle, 'hana');
  // createTasks에 draftId를 주면 생성과 동시에 붙는다
  const third = await mkDraft(c.id, c.name);
  const [t3] = await createTasks(sql, camp.id, { ...baseInput, type: 'visit', draftId: third, items: [{ handle: 'kei', cost: null }] });
  assert.equal(t3.draftId, third);
});

test('3) 대상 — 참조는 캠페인 경계 없음, 대상 요약(post_url·캠페인명), 삭제 시 set null, 후보 목록·이미 RT하기로 한 사람', async () => {
  const c = await createClient(sql, P + '클라3');
  const camp1 = await mkCampaign(c.id, c.name, 'c1');
  const camp2 = await mkCampaign(c.id, c.name, 'c2');
  const [post] = await createTasks(sql, camp1.id, { ...baseInput, type: 'post', items: [{ handle: 'mika', cost: null }] });
  const [rt] = await createTasks(sql, camp2.id, { ...baseInput, type: 'rt', targetTaskId: post.id, items: [{ handle: 'rio', cost: null }] });
  assert.equal(rt.target!.taskId, post.id);
  assert.equal(rt.target!.campaignName, P + 'c1');
  assert.equal(rt.target!.postUrl, null);
  await updateTask(sql, post.id, { postUrl: 'https://x.com/mika/status/1' });
  assert.equal((await getTask(sql, rt.id))!.target!.postUrl, 'https://x.com/mika/status/1');
  const [rtUrl] = await createTasks(sql, camp2.id, { ...baseInput, type: 'rt', targetTweetUrl: 'https://x.com/i/status/99', items: [{ handle: 'sora', cost: null }] });
  assert.equal(rtUrl.target, null);
  assert.equal(rtUrl.targetTweetUrl, 'https://x.com/i/status/99');

  const cands = await listTargetCandidates(sql, { clientId: c.id });
  assert.ok(cands.some((x) => x.taskId === post.id && x.campaignName === P + 'c1' && x.postUrl === 'https://x.com/mika/status/1'));
  assert.ok(!cands.some((x) => x.taskId === rt.id));                         // RT는 대상이 될 수 없다
  assert.ok((await listTargetCandidates(sql, { clientId: c.id, q: 'mika' })).some((x) => x.taskId === post.id));
  assert.equal((await listTargetCandidates(sql, { clientId: c.id, q: 'zzzz-없음' })).length, 0);
  assert.deepEqual(await listTargetingHandles(sql, { taskId: post.id }), ['rio']);
  assert.deepEqual(await listTargetingHandles(sql, { tweetUrl: 'https://x.com/i/status/99' }), ['sora']);

  assert.deepEqual(await countTasksForCampaignDelete(sql, camp1.id), { taskCount: 1, detachedTargets: 1 });
  assert.equal(await deleteTask(sql, post.id), true);
  assert.equal((await getTask(sql, rt.id))!.targetTaskId, null);            // 대상 미정으로
  assert.equal(await deleteTask(sql, post.id), false);
});

test('4) 패치 3값 규칙(undefined=유지·null=지움·값=설정), 게시 확인·내림, markPosted는 비어 있을 때만', async () => {
  const c = await createClient(sql, P + '클라4');
  const camp = await mkCampaign(c.id, c.name, 'd');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'visit', scheduledOn: '2026-09-05', items: [{ handle: 'hana', cost: { amount: 1, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { visitOn: '2026-09-01', note: '방문' });
  let g = (await getTask(sql, t.id))!;
  assert.equal(g.visitOn, '2026-09-01'); assert.equal(g.scheduledOn, '2026-09-05'); assert.equal(g.note, '방문');
  await updateTask(sql, t.id, { scheduledOn: null, cost: null, influencerHandle: null });
  g = (await getTask(sql, t.id))!;
  assert.equal(g.scheduledOn, null); assert.equal(g.cost, null); assert.equal(g.influencerHandle, null); assert.equal(g.visitOn, '2026-09-01');
  await updateTask(sql, t.id, { postedAt: '2026-09-08', postedSource: 'manual', postUrl: 'https://x.com/hana/status/5' });
  g = (await getTask(sql, t.id))!;
  assert.equal(g.postedAt, '2026-09-08'); assert.equal(g.postedSource, 'manual');
  await updateTask(sql, t.id, { removedAt: '2026-09-09', removedReason: '본인 요청' });
  g = (await getTask(sql, t.id))!;
  assert.equal(g.removedAt, '2026-09-09'); assert.equal(g.removedReason, '본인 요청');
  await updateTask(sql, t.id, { removedAt: null, removedReason: '' });
  g = (await getTask(sql, t.id))!;
  assert.equal(g.removedAt, null); assert.equal(g.removedReason, '');
  assert.equal(await markPosted(sql, [t.id], '2026-09-10', 'auto'), 0);      // 이미 확인된 건 덮지 않는다
  const [t2] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: 'rio', cost: null }] });
  assert.equal(await markPosted(sql, [t2.id, t.id], '2026-09-10', 'auto'), 1);
  assert.equal((await getTask(sql, t2.id))!.postedSource, 'auto');
  assert.equal(await updateTask(sql, '00000000-0000-0000-0000-000000000000', { note: 'x' }), false);
});

test('5) 이관 — draft 3컬럼 → 작업 1행(유형=비용 유형), tracked_post 연결 이전, 재실행 안전', async () => {
  // 037은 컬럼을 남겨두므로(038 전) 여기서 옛 컬럼에 직접 값을 넣어 이관을 검증한다
  const c = await createClient(sql, P + '클라5');
  const camp = await mkCampaign(c.id, c.name, 'e');
  const draftId = await mkDraft(c.id, c.name);
  await sql`update draft set campaign_id = ${camp.id}, scheduled_on = '2026-09-09'::date, influencer_handle = 'minchan',
              cost = '{"type":"quoteRt","amount":30000,"currency":"KRW"}'::jsonb where id = ${draftId}`;
  const tp = await sql<Array<{ id: string }>>`
    insert into tracked_post (tweet_id, author_handle, text, posted_at, draft_id)
    values (${P + 'tw1'}, 'minchan', '', '2026-09-09T03:00:00Z'::timestamptz, ${draftId}) returning id`;
  const r1 = await cutoverDraftsToTasks(sql);
  assert.ok(r1.tasks >= 1);
  const t = (await findTaskByDraft(sql, draftId))!;
  assert.equal(t.type, 'quoteRt'); assert.equal(t.campaignId, camp.id); assert.equal(t.influencerHandle, 'minchan');
  assert.equal(t.scheduledOn, '2026-09-09'); assert.deepEqual(t.cost, { amount: 30000, currency: 'KRW' });
  assert.equal(t.postedAt, '2026-09-09'); assert.equal(t.postedSource, 'manual');
  assert.equal(t.postUrl, 'https://x.com/minchan/status/' + P + 'tw1');
  assert.equal((await sql`select task_id from tracked_post where id = ${tp[0].id}`)[0].task_id, t.id);
  const r2 = await cutoverDraftsToTasks(sql);                                // 재실행 → 새 작업 0
  assert.equal((await listTasksByCampaign(sql, camp.id)).length, 1);
  assert.equal(r2.tasks, 0);
});
