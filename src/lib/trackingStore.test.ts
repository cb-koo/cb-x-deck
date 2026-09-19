import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import { insertLink } from './linkStore.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, getTask, cancelTask } from './campaignTaskStore.ts';
import {
  addTrackedPost, listTrackedPosts, findByTweetId, findTrackedPostById,
  appendSnapshot, markUnavailable, linkTrackedPost, deleteTrackedPost, listSnapshots, setRole,
  listTrackedPostIdsForCampaign,
  TrackingLinkError,
} from './trackingStore.ts';

const sql = getSql();
const P = 'ttrk' + process.pid;
const M = { views: 100, likes: 5, retweets: 2, replies: 1, bookmarks: 3, quotes: 0 };

after(async () => {
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`; // 스냅샷은 cascade
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('1) 등록 = 명부+첫 스냅샷, 목록에 최신 지표가 붙는다', async () => {
  const { created, row } = await addTrackedPost(sql, {
    tweetId: P + '1', authorHandle: 'someone', text: '본문', postedAt: new Date().toISOString(),
    createdBy: null, metrics: M, raw: { viewCount: 100 },
  });
  assert.equal(created, true);
  assert.equal(row.metrics!.views, 100);
  const listed = (await listTrackedPosts(sql)).find((r) => r.tweetId === P + '1');
  assert.ok(listed);
  assert.equal(listed!.metrics!.likes, 5);
  assert.equal(listed!.unavailableAt, null);
});

test('2) 같은 tweet_id 재등록은 created:false + 기존 행', async () => {
  await addTrackedPost(sql, { tweetId: P + '2', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  const again = await addTrackedPost(sql, { tweetId: P + '2', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.equal(again.created, false);
  const snaps = await sql`select id from post_metric_snapshot
    where tracked_post_id = ${again.row.id}`;
  assert.equal(snaps.length, 1); // 중복 등록이 스냅샷을 또 만들지 않는다
});

test('3) 스냅샷 추가 → 최신값 갱신, 볼 수 없음 기록·복귀', async () => {
  const { row } = await addTrackedPost(sql, { tweetId: P + '3', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  await markUnavailable(sql, row.id);
  const dead = await findTrackedPostById(sql, row.id);
  assert.ok(dead!.unavailableAt);
  await markUnavailable(sql, row.id); // 두 번째 호출이 시각을 덮어쓰지 않는다
  assert.equal((await findTrackedPostById(sql, row.id))!.unavailableAt, dead!.unavailableAt);
  await appendSnapshot(sql, row.id, { ...M, views: 999 }, null); // 복귀
  const back = await findTrackedPostById(sql, row.id);
  assert.equal(back!.metrics!.views, 999);
  assert.equal(back!.unavailableAt, null);
});

test('4) 원고 연결·해제, findByTweetId, 삭제 cascade', async () => {
  const { row } = await addTrackedPost(sql, { tweetId: P + '4', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.ok(await findByTweetId(sql, P + '4'));
  assert.equal(await linkTrackedPost(sql, row.id, { draftId: null }), true);
  assert.equal(await deleteTrackedPost(sql, row.id), true);
  assert.equal(await findByTweetId(sql, P + '4'), null);
  const snaps = await sql`select id from post_metric_snapshot where tracked_post_id = ${row.id}`;
  assert.equal(snaps.length, 0);
  assert.equal(await deleteTrackedPost(sql, row.id), false);
});

test('5) 원고 연결 후 목록에서 draftLabel(title 우선)이 보인다', async () => {
  const content: DraftContent = { posts: [{ text: '트래킹 연결 테스트 본문', media: [] }] };
  const draftId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await updateDraft(sql, draftId, { title: P + '제목' });

  const { row } = await addTrackedPost(sql, {
    tweetId: P + '5', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null,
  });
  assert.equal(await linkTrackedPost(sql, row.id, { draftId }), true);

  const listed = (await listTrackedPosts(sql)).find((r) => r.tweetId === P + '5');
  assert.ok(listed);
  assert.equal(listed!.draftId, draftId);
  assert.equal(listed!.draftLabel, P + '제목');

  const found = await findTrackedPostById(sql, row.id);
  assert.equal(found!.draftLabel, P + '제목');

  assert.equal(await linkTrackedPost(sql, row.id, { draftId: null }), true);
  const unlinked = await findTrackedPostById(sql, row.id);
  assert.equal(unlinked!.draftId, null);
  assert.equal(unlinked!.draftLabel, null);
});

test('6) 측정 이력: 최신순 반환 · limit 적용 · 삭제 시 함께 사라진다', async () => {
  const { row } = await addTrackedPost(sql, {
    tweetId: P + '6', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null,
  });
  // 등록이 첫 측정이므로 이미 1건. 두 건 더 쌓아 순서를 확인한다.
  await appendSnapshot(sql, row.id, { ...M, views: 200 }, null);
  await appendSnapshot(sql, row.id, { ...M, views: 300 }, null);

  const hist = await listSnapshots(sql, row.id);
  assert.equal(hist.length, 3);
  assert.equal(hist[0].metrics.views, 300);          // 최신이 위
  assert.equal(hist[2].metrics.views, M.views);      // 등록 시 첫 측정이 맨 아래
  assert.ok(hist[0].capturedAt >= hist[1].capturedAt); // ISO 문자열은 사전순 = 시간순

  assert.equal((await listSnapshots(sql, row.id, 2)).length, 2);

  await deleteTrackedPost(sql, row.id);
  assert.deepEqual(await listSnapshots(sql, row.id), []); // cascade
});

test('7) 역할 — 원고의 링크 URL이 든 게시물은 link, 가장 이른 것 main, 저장값이 우선', async () => {
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'role', format: 'thread',
    referenceMode: 'off', refs: [], content: { posts: [{ text: '1/', media: [] }, { text: '2/', media: [] }] },
    model: null, memberId: null,
  });
  const link = await insertLink(sql, {
    code: P + 'rl', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/?utm_content=x',
    shortUrl: `https://cb.link/${P}rl`, shortioLinkId: 'lnk_' + P, utmCampaign: P + 'camp',
    influencerHandle: 'hana_kim', utmContent: `hana_kim-${P}`, draftId: d, clientId: null, clientName: null, createdBy: null,
  });
  const main = await addTrackedPost(sql, {
    tweetId: P + '71', authorHandle: 'hana_kim', text: '1/', postedAt: '2026-08-24T01:00:00.000Z',
    createdBy: null, metrics: M, raw: { isReply: false, entities: { urls: [] } },
  });
  const reply = await addTrackedPost(sql, {
    tweetId: P + '72', authorHandle: 'hana_kim', text: '링크', postedAt: '2026-08-24T01:10:00.000Z',
    createdBy: null, metrics: M, raw: { isReply: true, entities: { urls: [{ expanded_url: link.shortUrl }] } },
  });
  await linkTrackedPost(sql, main.row.id, { draftId: d });
  await linkTrackedPost(sql, reply.row.id, { draftId: d });

  const list = await listTrackedPosts(sql);
  assert.equal(list.find((r) => r.id === main.row.id)!.derivedRole, 'main');
  assert.equal(list.find((r) => r.id === reply.row.id)!.derivedRole, 'link');
  assert.equal(list.find((r) => r.id === reply.row.id)!.role, null);

  assert.equal(await setRole(sql, reply.row.id, 'thread'), true);
  const one = await findTrackedPostById(sql, reply.row.id);
  assert.equal(one!.role, 'thread');
  assert.equal(one!.derivedRole, 'thread'); // 저장값이 판정을 덮는다
  await setRole(sql, reply.row.id, null);
  assert.equal((await findTrackedPostById(sql, reply.row.id))!.derivedRole, 'link');

  await sql`delete from tracking_link where id = ${link.id}`;
});

test('8) 작업으로 연결 — task_id·draft_id 함께, 작업의 post_url/posted_at 보충(비어 있을 때만), 해제는 둘 다 null', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'c', nameEn: `${P.toLowerCase()}-c`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const [task] = await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'post', items: [{ handle: 'mika', cost: null }] });
  const draftId = await insertDraft(sql, { clientId: c.id, clientName: c.name, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [], content: { posts: [{ text: 'x', media: [] }] }, model: null, memberId: null, taskId: task.id });
  const { row } = await addTrackedPost(sql, { tweetId: P + 'L1', authorHandle: 'mika', text: '', postedAt: '2026-09-01T20:00:00Z', createdBy: null, metrics: M, raw: null });
  assert.equal(await linkTrackedPost(sql, row.id, { taskId: task.id }), true);
  const linked = (await findTrackedPostById(sql, row.id))!;
  assert.equal(linked.taskId, task.id); assert.equal(linked.draftId, draftId);
  let t = (await getTask(sql, task.id))!;
  assert.equal(t.postUrl, `https://x.com/mika/status/${P}L1`); assert.equal(t.postedAt, '2026-09-02'); assert.equal(t.postedSource, 'manual');   // 20:00Z = 서울 다음날 05:00
  // 원고로 연결(트래킹 페이지 경로)도 작업까지 채운다
  const { row: row2 } = await addTrackedPost(sql, { tweetId: P + 'L2', authorHandle: 'mika', text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  assert.equal(await linkTrackedPost(sql, row2.id, { draftId }), true);
  assert.equal((await findTrackedPostById(sql, row2.id))!.taskId, task.id);
  t = (await getTask(sql, task.id))!;
  assert.equal(t.postUrl, `https://x.com/mika/status/${P}L1`);   // 이미 있으니 덮지 않는다
  assert.equal(await linkTrackedPost(sql, row2.id, { taskId: null }), true);
  const cleared = (await findTrackedPostById(sql, row2.id))!;
  assert.equal(cleared.taskId, null); assert.equal(cleared.draftId, null);
  assert.equal((await getTask(sql, task.id))!.postedAt, '2026-09-02');       // 되돌리지 않는다
  assert.equal(await linkTrackedPost(sql, '00000000-0000-0000-0000-000000000000', { draftId: null }), false);
});

test('9) 게시물 연결 — RT 작업에는 붙일 수 없다(증빙 없이 게시됨이 되는 우회 경로 차단)', async () => {
  const c = await createClient(sql, P + 'RT클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'rtc', nameEn: `${P.toLowerCase()}-rtc`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const [rt] = await createTasks(sql, camp.id, {
    type: 'rt', targetTaskId: null, targetTweetUrl: 'https://x.com/a/status/10',
    draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: [{ handle: 'someone', cost: null }],
  });
  const { row } = await addTrackedPost(sql, {
    tweetId: P + 'RT1', authorHandle: 'someone', text: '', postedAt: null, createdBy: null, metrics: M, raw: null,
  });

  await assert.rejects(
    () => linkTrackedPost(sql, row.id, { taskId: rt.id }),
    (e: unknown) => e instanceof TrackingLinkError && e.code === 'rt-task',
  );

  // 게시 확인이 채워지지 않았음을 직접 확인한다 — 이게 이 가드의 목적이다
  assert.equal((await getTask(sql, rt.id))!.postedAt, null);
});

test('10) 원고 경로 우회 차단 — RT 작업에 원고가 붙어 있어도(비정상 상태) 그 원고로 연결하면 작업의 posted_at을 채우지 않는다', async () => {
  const c = await createClient(sql, P + 'RT2클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'rtc2', nameEn: `${P.toLowerCase()}-rtc2`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const [rt] = await createTasks(sql, camp.id, {
    type: 'rt', targetTaskId: null, targetTweetUrl: 'https://x.com/a/status/11',
    draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: [{ handle: 'someone', cost: null }],
  });
  const draftId = await insertDraft(sql, {
    clientId: c.id, clientName: c.name, procedureNames: [], direction: P + 'rt방향', format: 'single',
    referenceMode: 'off', refs: [], content: { posts: [{ text: 'x', media: [] }] }, model: null, memberId: null,
  });
  // 정상 UI로는 만들 수 없는 이상 상태: RT 작업에 원고를 직접 붙인다.
  await sql`update campaign_task set draft_id = ${draftId} where id = ${rt.id}`;

  const { row } = await addTrackedPost(sql, {
    tweetId: P + 'RT2', authorHandle: 'someone', text: '', postedAt: null, createdBy: null, metrics: M, raw: null,
  });

  // 원고 경로로 연결하는 것 자체는 허용된다(사용자 의도는 "이 게시물을 이 원고에 연결").
  assert.equal(await linkTrackedPost(sql, row.id, { draftId }), true);
  const linked = (await findTrackedPostById(sql, row.id))!;
  assert.equal(linked.draftId, draftId);
  assert.equal(linked.taskId, rt.id);

  // 그러나 RT 작업의 게시 확인(posted_at)은 여전히 채워지지 않아야 한다 — 이게 이 가드의 목적이다.
  assert.equal((await getTask(sql, rt.id))!.postedAt, null);
});

test('11) 게시물 연결 — 취소된 작업에 원고가 붙은 비정상 상태에서도 draftId 경로 연결을 거절한다(ADR 0002, C2)', async () => {
  const c = await createClient(sql, P + '취소클라');
  const camp = await createCampaign(sql, { clientId: c.id, clientName: c.name, name: P + 'cnl', nameEn: `${P.toLowerCase()}-cnl`, startsOn: '2026-08-31', endsOn: '2026-09-06', kind: null, note: '', createdBy: null });
  const [task] = await createTasks(sql, camp.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'post', items: [{ handle: 'cancelledguy', cost: null }] });
  const draftId = await insertDraft(sql, {
    clientId: c.id, clientName: c.name, procedureNames: [], direction: P + '취소방향', format: 'single',
    referenceMode: 'off', refs: [], content: { posts: [{ text: 'x', media: [] }] }, model: null, memberId: null,
  });
  // 정상 취소는 원고를 자동으로 뗀다(ADR 0002) — 이 테스트는 그 경로를 우회해 SQL로 직접 만든
  // 비정상 상태("취소된 작업에 원고가 붙어 있음")를 재현한다.
  await sql`update campaign_task set cancelled_at = '2026-09-16', draft_id = ${draftId} where id = ${task.id}`;
  const { row } = await addTrackedPost(sql, {
    tweetId: P + 'CNL1', authorHandle: null, text: '', postedAt: null, createdBy: null, metrics: M, raw: null,
  });
  await assert.rejects(
    () => linkTrackedPost(sql, row.id, { draftId }),
    (e: unknown) => e instanceof TrackingLinkError && e.code === 'cancelled-task',
  );
  assert.equal((await findTrackedPostById(sql, row.id))!.taskId, null);   // 연결되지 않았다
});

test('12) listTrackedPostIdsForCampaign — 게시 확인된·취소 아닌 작업의 게시물만, 다른 캠페인 제외', async () => {
  const c1 = await createClient(sql, P + '유입클라1');
  const camp1 = await createCampaign(sql, { clientId: c1.id, clientName: c1.name, name: P + 'camp1', nameEn: `${P.toLowerCase()}-camp1`, startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null });
  const c2 = await createClient(sql, P + '유입클라2');
  const camp2 = await createCampaign(sql, { clientId: c2.id, clientName: c2.name, name: P + 'camp2', nameEn: `${P.toLowerCase()}-camp2`, startsOn: '2026-09-14', endsOn: '2026-09-20', kind: null, note: '', createdBy: null });
  const baseTask = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, type: 'post' as const };

  // a: 게시 확인됨(취소 아님) — 포함 대상. linkTrackedPost(taskId)가 작업의 posted_at도 함께 채운다.
  const [taskA] = await createTasks(sql, camp1.id, { ...baseTask, items: [{ handle: P + '_a', cost: null }] });
  const postA = await addTrackedPost(sql, { tweetId: P + 'PA', authorHandle: P + '_a', text: '', postedAt: '2026-09-15T00:00:00Z', createdBy: null, metrics: M, raw: null });
  await linkTrackedPost(sql, postA.row.id, { taskId: taskA.id });

  // b: 취소된 작업 — DB 제약(campaign_task_cancel_xor_posted)상 취소는 게시 확인과 공존할 수 없어 posted_at은 없다.
  // 정상 경로로는 취소 작업에 게시물을 연결할 수 없으므로(linkTrackedPost가 거절) SQL로 직접 붙여 "취소 작업에 게시물이 붙어 있는" 상태를 재현한다.
  const [taskB] = await createTasks(sql, camp1.id, { ...baseTask, items: [{ handle: P + '_b', cost: null }] });
  await cancelTask(sql, taskB.id, { reason: 'declined', note: '', actorId: null, today: '2026-09-16' });
  const postB = await addTrackedPost(sql, { tweetId: P + 'PB', authorHandle: P + '_b', text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  await sql`update tracked_post set task_id = ${taskB.id} where id = ${postB.row.id}`;

  // c: 미게시 작업 — 게시물은 붙어 있지만 작업은 아직 게시 확인 전(직접 SQL로 연결해 posted_at 자동 보충을 피한다) → 제외 대상
  const [taskC] = await createTasks(sql, camp1.id, { ...baseTask, items: [{ handle: P + '_c', cost: null }] });
  const postC = await addTrackedPost(sql, { tweetId: P + 'PC', authorHandle: P + '_c', text: '', postedAt: null, createdBy: null, metrics: M, raw: null });
  await sql`update tracked_post set task_id = ${taskC.id} where id = ${postC.row.id}`;

  // d: 다른 캠페인(camp2)의 게시 확인된 작업 — 캠페인 필터로 제외
  const [taskD] = await createTasks(sql, camp2.id, { ...baseTask, items: [{ handle: P + '_d', cost: null }] });
  const postD = await addTrackedPost(sql, { tweetId: P + 'PD', authorHandle: P + '_d', text: '', postedAt: '2026-09-15T00:00:00Z', createdBy: null, metrics: M, raw: null });
  await linkTrackedPost(sql, postD.row.id, { taskId: taskD.id });

  const ids = await listTrackedPostIdsForCampaign(sql, camp1.id);
  assert.deepEqual(ids.map((x) => x.id).sort(), [postA.row.id].sort());
  assert.equal(ids[0].tweetId, P + 'PA');

  assert.deepEqual(await listTrackedPostIdsForCampaign(sql, '00000000-0000-0000-0000-000000000000'), []);
  assert.deepEqual(await listTrackedPostIdsForCampaign(sql, 'not-a-uuid'), []);
});
