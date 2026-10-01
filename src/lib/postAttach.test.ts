// 게시물 작성자 확인 입구(스펙 2026-09-30-post-author-guard-design.md §3·§7) — 연습용 DB, fetchPost는 대역.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { insertDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import { createTasks, getTask, updateTask, attachDraft, detachDraft, DraftAttachAuthorError } from './campaignTaskStore.ts';
import { addTrackedPost, findByTweetId } from './trackingStore.ts';
import type { FetchPostResult } from './postMetrics.ts';
import { postedOnFromTweetId } from './tweetPostedOn.ts';
import {
  attachPostToTask, guardTaskLink, guardDraftLink, guardFirstAssign, judgeTaskLink, judgeDraftLink,
  linkTrackedPostGuarded, TaskChangedError, TASK_CHANGED_MESSAGE, prefetchAttachAuthors, type Deps,
} from './postAttach.ts';
import { firstAssignMismatchMessage } from './postAuthor.ts';

const sql = getSql();
const P = 'tpat' + process.pid;
const M = { views: 10, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 };
const content: DraftContent = { posts: [{ text: '작성자 확인', media: [] }] };

// 트윗 id는 진짜 스노플레이크여야 한다(링크 해석·게시일 파생) — 접두어 정리 대신 만든 id를 모아 지운다.
const TWITTER_EPOCH = BigInt(1288834974657);
const BASE = (BigInt(Date.parse('2026-09-25T03:00:00Z')) - TWITTER_EPOCH) << BigInt(22);
const made: string[] = [];
let seq = 0;
const newTweetId = () => {
  const id = (BASE + BigInt(process.pid) * BigInt(1000) + BigInt(seq++)).toString();
  made.push(id);
  return id;
};
const link = (handle: string, id: string) => `https://x.com/${handle}/status/${id}`;

after(async () => {
  await sql`delete from tracked_post where tweet_id = any(${made}::text[])`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

// 대역 fetchPost — tweetId별 응답을 정하고 부른 횟수를 센다
function fakeFetch(map: Record<string, { handle: string | null; userId: string | null } | 'error' | 'unavailable'>) {
  const calls: string[] = [];
  const deps: Deps = {
    fetchPost: async (tweetId: string): Promise<FetchPostResult> => {
      calls.push(tweetId);
      const v = map[tweetId];
      if (v === undefined || v === 'error') return { kind: 'error' };
      if (v === 'unavailable') return { kind: 'unavailable' };
      return { kind: 'ok', post: {
        tweetId, authorHandle: v.handle, authorUserId: v.userId, text: '본문', postedAt: '2026-09-25T03:00:00.000Z',
        metrics: M, raw: { id: tweetId },
      } };
    },
  };
  return { deps, calls };
}

let n = 0;
async function setup(type: 'post' | 'rt' = 'post', handle: string | null = null) {
  const c = await createClient(sql, P + '클라' + n);
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + '캠' + n, nameEn: `${P}-c${n}`,
    startsOn: '2026-09-22', endsOn: '2026-09-28', kind: null, note: '', createdBy: null,
  });
  n++;
  const [t] = await createTasks(sql, camp.id, {
    type, targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: handle ? [{ handle, cost: null }] : [],
  });
  return { campaignId: camp.id, clientId: c.id, clientName: c.name, task: t };
}
async function roster(handle: string, xUserId: string | null) {
  await sql`insert into influencer (handle, x_user_id) values (${handle}, ${xUserId})`;
}

// ── ① 게시 확인 ──

test('① 작성자가 다르면 거절 — 게시 링크·게시일·트래킹 모두 안 생긴다', async () => {
  const me = P + 'a1'; const other = P + 'o1';
  await roster(me, null);
  const { task } = await setup('post', me);
  const id = newTweetId();
  const { deps } = fakeFetch({ [id]: { handle: other, userId: null } });
  const r = await attachPostToTask(sql, task.id, link(me, id), deps);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, 'author-mismatch');
  assert.match(r.error, new RegExp(`@${other}의 글`));
  assert.match(r.error, new RegExp(`인플은 @${me}`));
  const after = await getTask(sql, task.id);
  assert.equal(after!.postUrl, null);
  assert.equal(after!.postedAt, null);
  assert.equal(await findByTweetId(sql, id), null);
});

test('① 작성자가 같으면(핸들 대소문자 무시) 게시 확인 + 트래킹 등록·연결까지 한 번에', async () => {
  const me = P + 'a2';
  await roster(me, null);
  const { task } = await setup('post', me);
  const id = newTweetId();
  const { deps } = fakeFetch({ [id]: { handle: me.toUpperCase(), userId: '111' } });
  const r = await attachPostToTask(sql, task.id, link(me, id), deps, { createdBy: null });
  assert.deepEqual(r, { ok: true });
  const after = await getTask(sql, task.id);
  assert.equal(after!.postUrl, link(me, id));
  assert.equal(after!.postedAt, postedOnFromTweetId(id));   // 게시일은 링크에서(기존 규칙)
  assert.equal(after!.postedSource, 'manual');
  const tp = await findByTweetId(sql, id);
  assert.ok(tp);
  assert.equal(tp!.taskId, task.id);
  assert.equal(tp!.authorHandle, me.toUpperCase());
  assert.equal(tp!.metrics!.views, 10);   // 등록 = 첫 측정
});

test('① 명부 고유번호가 있으면 고유번호로 — 핸들이 달라도 같은 계정이면 통과(coco 사례), 같아도 번호가 다르면 거절', async () => {
  const me = P + 'a3';
  await roster(me, '900');
  const { task } = await setup('post', me);
  const idOld = newTweetId();
  const idFake = newTweetId();
  const { deps } = fakeFetch({ [idOld]: { handle: 'renamed_' + P, userId: '900' }, [idFake]: { handle: me, userId: '901' } });
  const bad = await attachPostToTask(sql, task.id, link(me, idFake), deps);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, 'author-mismatch');
  assert.equal((await getTask(sql, task.id))!.postUrl, null);
  const good = await attachPostToTask(sql, task.id, link('coco__ns_5', idOld), deps);
  assert.deepEqual(good, { ok: true });
  assert.equal((await findByTweetId(sql, idOld))!.taskId, task.id);
});

test('① X 조회 실패(오류·없음)면 막는다 — 아무것도 안 바뀐다', async () => {
  const me = P + 'a4';
  await roster(me, null);
  const { task } = await setup('post', me);
  const idErr = newTweetId(); const idGone = newTweetId();
  const { deps } = fakeFetch({ [idErr]: 'error', [idGone]: 'unavailable' });
  for (const id of [idErr, idGone]) {
    const r = await attachPostToTask(sql, task.id, link(me, id), deps);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'author-unverified');
    assert.equal(await findByTweetId(sql, id), null);
  }
  const after = await getTask(sql, task.id);
  assert.equal(after!.postUrl, null);
  assert.equal(after!.postedAt, null);
});

test('① 미배정 작업은 거절 — 누구의 게시물인지 비교할 수 없다', async () => {
  const { task } = await setup('post', null);
  const id = newTweetId();
  const { deps } = fakeFetch({ [id]: { handle: 'anyone', userId: '1' } });
  const r = await attachPostToTask(sql, task.id, link('anyone', id), deps);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'task-unassigned');
  assert.equal((await getTask(sql, task.id))!.postUrl, null);
  assert.equal(await findByTweetId(sql, id), null);
});

test('① 같은 요청의 다른 변경(apply)은 판정 전에 반영되고, 거절이면 함께 되돌린다', async () => {
  const me = P + 'a6';
  await roster(me, null);
  // 미배정 작업에 이번 요청이 인플을 넣으면서 링크까지 — 판정은 패치 후 인플 기준
  const { task } = await setup('post', null);
  const id = newTweetId();
  const { deps } = fakeFetch({ [id]: { handle: me, userId: null } });
  const ok = await attachPostToTask(sql, task.id, link(me, id), deps, {
    apply: async (tx) => { await updateTask(tx, task.id, { influencerHandle: me, postUrl: link(me, id), postedAt: postedOnFromTweetId(id)!, postedSource: 'manual', note: '같이 저장' }); },
  });
  assert.deepEqual(ok, { ok: true });
  assert.equal((await getTask(sql, task.id))!.note, '같이 저장');
  // 거절이면 apply가 쓴 메모도 남지 않는다
  const { task: t2 } = await setup('post', me);
  const id2 = newTweetId();
  const f2 = fakeFetch({ [id2]: { handle: 'someone_else', userId: null } });
  const bad = await attachPostToTask(sql, t2.id, link(me, id2), f2.deps, {
    apply: async (tx) => { await updateTask(tx, t2.id, { postUrl: link(me, id2), postedAt: postedOnFromTweetId(id2)!, postedSource: 'manual', note: '남으면 안 됨' }); },
  });
  assert.equal(bad.ok, false);
  const after2 = await getTask(sql, t2.id);
  assert.equal(after2!.note, '');
  assert.equal(after2!.postUrl, null);
});

test('① 이미 등록된 게시물이면 새로 만들지 않고 그 행을 이 작업에 연결한다', async () => {
  const me = P + 'a7';
  await roster(me, null);
  const { task } = await setup('post', me);
  const id = newTweetId();
  const pre = await addTrackedPost(sql, { tweetId: id, authorHandle: me, text: '먼저 등록', postedAt: null, createdBy: null, metrics: M, raw: null });
  const { deps } = fakeFetch({ [id]: { handle: me, userId: null } });
  const r = await attachPostToTask(sql, task.id, link(me, id), deps);
  assert.deepEqual(r, { ok: true });
  const tp = await findByTweetId(sql, id);
  assert.equal(tp!.id, pre.row.id);
  assert.equal(tp!.text, '먼저 등록');
  assert.equal(tp!.taskId, task.id);
});

// ── ②③ 게시물 연결 · ④ 원고 연결 ──

test('②③ guardTaskLink — 저장된 작성자가 다르면 mismatch, 같으면 조회 없이 ok', async () => {
  const me = P + 'b1';
  await roster(me, null);
  const { task } = await setup('post', me);
  const { deps, calls } = fakeFetch({});
  const ok = await guardTaskLink(sql, task.id, { tweetId: '1', authorHandle: me.toUpperCase() }, deps);
  assert.deepEqual(ok, { kind: 'ok' });
  assert.equal(calls.length, 0);
  // 저장된 핸들이 다르면 옛 핸들일 수 있어 한 번 다시 조회해 확인한다 — 조회 실패면 저장값의 판정
  const bad = await guardTaskLink(sql, task.id, { tweetId: '2', authorHandle: 'Qni6F' }, deps);
  assert.equal(bad.kind, 'mismatch');
  if (bad.kind === 'mismatch') { assert.equal(bad.authorHandle, 'Qni6F'); assert.equal(bad.assignedHandle, me); }
});

test('②③ guardTaskLink — 저장된 핸들이 옛 핸들이어도 다시 조회한 실제 작성자가 같으면 ok', async () => {
  const me = P + 'b2';
  await roster(me, null);
  const { task } = await setup('post', me);
  const id = newTweetId();
  const { deps, calls } = fakeFetch({ [id]: { handle: me, userId: null } });
  const v = await guardTaskLink(sql, task.id, { tweetId: id, authorHandle: 'old_handle' }, deps);
  assert.deepEqual(v, { kind: 'ok' });
  assert.deepEqual(calls, [id]);
});

test('②③ guardTaskLink — 명부에 고유번호가 있으면 조회해서 번호로 비교, 조회 실패면 unverified', async () => {
  const me = P + 'b3';
  await roster(me, '777');
  const { task } = await setup('post', me);
  const idOk = newTweetId(); const idBad = newTweetId(); const idErr = newTweetId();
  const { deps } = fakeFetch({ [idOk]: { handle: 'whatever', userId: '777' }, [idBad]: { handle: me, userId: '778' }, [idErr]: 'error' });
  assert.deepEqual(await guardTaskLink(sql, task.id, { tweetId: idOk, authorHandle: me }, deps), { kind: 'ok' });
  assert.equal((await guardTaskLink(sql, task.id, { tweetId: idBad, authorHandle: me }, deps)).kind, 'mismatch');
  assert.equal((await guardTaskLink(sql, task.id, { tweetId: idErr, authorHandle: me }, deps)).kind, 'unverified');
});

test('②③ guardTaskLink — 방금 조회한 값(authorUserId 있음)이면 다시 조회하지 않는다', async () => {
  const me = P + 'b4';
  await roster(me, '555');
  const { task } = await setup('post', me);
  const { deps, calls } = fakeFetch({});
  assert.deepEqual(await guardTaskLink(sql, task.id, { tweetId: '9', authorHandle: 'x', authorUserId: '555' }, deps), { kind: 'ok' });
  assert.equal((await guardTaskLink(sql, task.id, { tweetId: '9', authorHandle: me, authorUserId: '556' }, deps)).kind, 'mismatch');
  assert.equal(calls.length, 0);
});

test('②③ guardTaskLink — 미배정은 unassigned, RT·없는 작업은 기존 규칙에 맡긴다(ok)', async () => {
  const { task: un } = await setup('post', null);
  const { deps } = fakeFetch({});
  assert.deepEqual(await guardTaskLink(sql, un.id, { tweetId: '1', authorHandle: 'a' }, deps), { kind: 'unassigned' });
  const { task: rt } = await setup('rt', P + 'b5');
  assert.deepEqual(await guardTaskLink(sql, rt.id, { tweetId: '1', authorHandle: 'someone' }, deps), { kind: 'ok' });
  assert.deepEqual(await guardTaskLink(sql, '00000000-0000-4000-8000-000000000000', { tweetId: '1', authorHandle: 'a' }, deps), { kind: 'ok' });
});

test('④ guardDraftLink — 원고에 붙은 작업 기준으로 판정, 작업 없는 원고는 그대로 허용', async () => {
  const me = P + 'c1';
  await roster(me, null);
  const { task, clientId, clientName } = await setup('post', me);
  const draftId = await insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  const loose = await insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향2', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await attachDraft(sql, task.id, draftId);
  const { deps } = fakeFetch({});
  assert.equal((await guardDraftLink(sql, draftId, { tweetId: '1', authorHandle: 'Qni6F' }, deps)).kind, 'mismatch');
  assert.deepEqual(await guardDraftLink(sql, draftId, { tweetId: '1', authorHandle: me }, deps), { kind: 'ok' });
  assert.deepEqual(await guardDraftLink(sql, loose, { tweetId: '1', authorHandle: 'Qni6F' }, deps), { kind: 'ok' });
});

// ── ⑤ 게시된 미배정 작업의 최초 배정 ──

test('⑤ guardFirstAssign — 붙은 게시물의 작성자와 다른 인플은 거절, 같은 인플은 ok, 게시물 없으면 ok', async () => {
  const author = P + 'd1'; const other = P + 'd2';
  await roster(author, null); await roster(other, null);
  const { task } = await setup('post', null);
  const id = newTweetId();
  await updateTask(sql, task.id, { postUrl: link(author, id), postedAt: postedOnFromTweetId(id)!, postedSource: 'manual' });
  const tp = await addTrackedPost(sql, { tweetId: id, authorHandle: author, text: '옛 데이터', postedAt: null, createdBy: null, metrics: M, raw: null });
  await sql`update tracked_post set task_id = ${task.id} where id = ${tp.row.id}`;
  const { deps } = fakeFetch({});
  const bad = await guardFirstAssign(sql, task.id, other, deps);
  assert.equal(bad.kind, 'mismatch');
  if (bad.kind === 'mismatch') assert.equal(bad.authorHandle, author);
  assert.deepEqual(await guardFirstAssign(sql, task.id, author, deps), { kind: 'ok' });
  const { task: bare } = await setup('post', null);
  assert.deepEqual(await guardFirstAssign(sql, bare.id, other, deps), { kind: 'ok' });
});

// ── §9-1 판정과 연결 사이의 인플 변경(동시 작업) ──
// 판정 결과(seen)를 연결 트랜잭션에 넘기는 모양이라, 판정 → (다른 사람의 변경을 SQL로 흉내) → 연결 순서로 경합을 그대로 재현한다.

async function trackedPost(authorHandle: string | null) {
  const id = newTweetId();
  const r = await addTrackedPost(sql, { tweetId: id, authorHandle, text: '연결 대상', postedAt: null, createdBy: null, metrics: M, raw: null });
  return r.row;
}
const taskIdOf = async (tpId: string) =>
  (await sql<Array<{ task_id: string | null }>>`select task_id from tracked_post where id = ${tpId}`)[0].task_id;

test('§9-1 작업 연결 — 판정 뒤 바뀐 게 없으면 연결된다', async () => {
  const me = P + 'e1';
  await roster(me, null);
  const { task } = await setup('post', me);
  const tp = await trackedPost(me);
  const { deps } = fakeFetch({});
  const j = await judgeTaskLink(sql, task.id, { tweetId: tp.tweetId, authorHandle: tp.authorHandle }, deps);
  assert.deepEqual(j.verdict, { kind: 'ok' });
  assert.equal(await linkTrackedPostGuarded(sql, tp.id, { taskId: task.id }, j.seen), true);
  assert.equal(await taskIdOf(tp.id), task.id);
});

test('§9-1 작업 연결 — 판정 뒤 그사이 인플이 바뀌면 task-changed로 거절, 아무것도 안 바뀐다', async () => {
  const me = P + 'e2'; const other = P + 'e3';
  await roster(me, null); await roster(other, null);
  const { task } = await setup('post', me);
  const tp = await trackedPost(me);
  const { deps } = fakeFetch({});
  const j = await judgeTaskLink(sql, task.id, { tweetId: tp.tweetId, authorHandle: tp.authorHandle }, deps);
  assert.deepEqual(j.verdict, { kind: 'ok' });
  await sql`update campaign_task set influencer_handle = ${other} where id = ${task.id}`;   // 다른 사람의 변경
  await assert.rejects(linkTrackedPostGuarded(sql, tp.id, { taskId: task.id }, j.seen), (e: unknown) => {
    assert.ok(e instanceof TaskChangedError);
    assert.equal(e.code, 'task-changed');
    assert.equal(e.message, TASK_CHANGED_MESSAGE);
    return true;
  });
  assert.equal(await taskIdOf(tp.id), null);
  const after = await getTask(sql, task.id);
  assert.equal(after?.postUrl, null);
  assert.equal(after?.postedAt, null);
  // 핸들 대소문자만 다른 건 변경이 아니다(명부 표기 정규화)
  await sql`update campaign_task set influencer_handle = ${me} where id = ${task.id}`;
  const j2 = await judgeTaskLink(sql, task.id, { tweetId: tp.tweetId, authorHandle: tp.authorHandle }, deps);
  await sql`update campaign_task set influencer_handle = ${me.toUpperCase()} where id = ${task.id}`;
  assert.equal(await linkTrackedPostGuarded(sql, tp.id, { taskId: task.id }, j2.seen), true);
});

test('§9-1 작업 연결 — 없는 작업은 기존 규칙(23503)대로 올라간다', async () => {
  const tp = await trackedPost('a');
  const { deps } = fakeFetch({});
  const ghost = '00000000-0000-4000-8000-000000000000';
  const j = await judgeTaskLink(sql, ghost, { tweetId: tp.tweetId, authorHandle: 'a' }, deps);
  await assert.rejects(linkTrackedPostGuarded(sql, tp.id, { taskId: ghost }, j.seen), (e: unknown) => (e as { code?: string }).code === '23503');
});

test('§9-1 원고 연결 — 판정 뒤 원고가 다른 작업으로 옮겨 가거나 새로 붙으면 task-changed', async () => {
  const me = P + 'e4'; const other = P + 'e5';
  await roster(me, null); await roster(other, null);
  const { task: mine, clientId, clientName } = await setup('post', me);
  const { task: theirs } = await setup('post', other);
  const draftId = await insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향e', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await attachDraft(sql, mine.id, draftId);
  const tp = await trackedPost(me);
  const { deps } = fakeFetch({});
  const j = await judgeDraftLink(sql, draftId, { tweetId: tp.tweetId, authorHandle: tp.authorHandle }, deps);
  assert.deepEqual(j.verdict, { kind: 'ok' });
  await detachDraft(sql, draftId);
  await attachDraft(sql, theirs.id, draftId);   // 그사이 원고가 @other 작업으로
  await assert.rejects(linkTrackedPostGuarded(sql, tp.id, { draftId }, j.seen), TaskChangedError);
  assert.equal(await taskIdOf(tp.id), null);

  // 판정 때 작업 없는 원고였는데 그사이 작업에 붙었다 — 판정을 다시 받아야 한다
  await detachDraft(sql, draftId);
  const j2 = await judgeDraftLink(sql, draftId, { tweetId: tp.tweetId, authorHandle: 'Qni6F' }, deps);
  assert.deepEqual(j2, { verdict: { kind: 'ok' }, seen: null });
  await attachDraft(sql, theirs.id, draftId);
  await assert.rejects(linkTrackedPostGuarded(sql, tp.id, { draftId }, j2.seen), TaskChangedError);
  assert.equal(await taskIdOf(tp.id), null);

  // 바뀐 게 없으면 원고 연결은 작업까지 붙인다
  const j3 = await judgeDraftLink(sql, draftId, { tweetId: tp.tweetId, authorHandle: other }, deps);
  assert.deepEqual(j3.verdict, { kind: 'ok' });
  assert.equal(await linkTrackedPostGuarded(sql, tp.id, { draftId }, j3.seen), true);
  assert.equal(await taskIdOf(tp.id), theirs.id);
});

// ── §9-2 원고 붙이기가 게시물 붙은 미배정 작업의 인플을 채울 때 ──

async function unassignedWithPost(authorHandle: string | null) {
  const s = await setup('post', null);
  const tp = await trackedPost(authorHandle);
  await sql`update tracked_post set task_id = ${s.task.id} where id = ${tp.id}`;   // 옛 데이터 — 입구로는 못 만든다
  return { ...s, tp };
}
async function draftWith(handle: string | null, s: { clientId: string; clientName: string }) {
  const id = await insertDraft(sql, {
    clientId: s.clientId, clientName: s.clientName, procedureNames: [], direction: P + '방향f', format: 'single',
    referenceMode: 'off', refs: [], content, model: null, memberId: null,
  });
  if (handle) await sql`update draft set influencer_handle = ${handle} where id = ${id}`;
  return id;
}

test('§9-2 attachDraft — 원고의 인플이 붙은 게시물 작성자와 다르면 거절, 아무것도 안 바뀐다', async () => {
  const author = P + 'f1'; const other = P + 'f2';
  await roster(author, null); await roster(other, null);
  const s = await unassignedWithPost(author);
  const draftId = await draftWith(other, s);
  await assert.rejects(attachDraft(sql, s.task.id, draftId), (e: unknown) => {
    assert.ok(e instanceof DraftAttachAuthorError);
    assert.equal(e.code, 'author-mismatch');
    assert.equal(e.message, firstAssignMismatchMessage(author));
    return true;
  });
  const t = await getTask(sql, s.task.id);
  assert.equal(t?.draftId, null);
  assert.equal(t?.influencerHandle, null);
});

test('§9-2 attachDraft — 같은 인플이면 붙이고 인플을 채운다, 게시물 없으면 판정 없이 채운다', async () => {
  const author = P + 'f3';
  await roster(author, null);
  const s = await unassignedWithPost(author.toUpperCase());
  const draftId = await draftWith(author, s);
  await attachDraft(sql, s.task.id, draftId);
  const t = await getTask(sql, s.task.id);
  assert.equal(t?.draftId, draftId);
  assert.equal(t?.influencerHandle, author);

  const bare = await setup('post', null);
  const d2 = await draftWith(author, bare);
  await attachDraft(sql, bare.task.id, d2);
  assert.equal((await getTask(sql, bare.task.id))?.influencerHandle, author);
});

test('§9-2 attachDraft — 이미 배정된 작업은 채우지 않으니 판정도 없다(기존 그대로)', async () => {
  const me = P + 'f4';
  await roster(me, null);
  const s = await setup('post', me);
  const tp = await trackedPost('Qni6F');
  await sql`update tracked_post set task_id = ${s.task.id} where id = ${tp.id}`;
  const draftId = await draftWith(P + 'f5', s);
  await attachDraft(sql, s.task.id, draftId);
  const t = await getTask(sql, s.task.id);
  assert.equal(t?.draftId, draftId);
  assert.equal(t?.influencerHandle, me);
});

test('§9-2 attachDraft — 저장된 옛 핸들·명부 고유번호는 미리 조회한 실제 작성자로 판정(트랜잭션 밖에서 조회)', async () => {
  // 저장된 핸들이 옛 핸들 — 미리 조회 없으면 저장값으로 판정(불일치), 조회하면 실제 작성자가 같아 통과
  const me = P + 'f6';
  await roster(me, null);
  const s = await unassignedWithPost('old_handle');
  const draftId = await draftWith(me, s);
  await assert.rejects(attachDraft(sql, s.task.id, draftId), DraftAttachAuthorError);
  const { deps, calls } = fakeFetch({ [s.tp.tweetId]: { handle: me, userId: null } });
  const live = await prefetchAttachAuthors(sql, s.task.id, draftId, deps);
  assert.deepEqual(calls, [s.tp.tweetId]);
  await attachDraft(sql, s.task.id, draftId, { liveAuthors: live });
  assert.equal((await getTask(sql, s.task.id))?.influencerHandle, me);

  // 명부에 고유번호가 있으면 번호로 — 미리 조회가 없거나 실패면 unverified, 번호가 다르면 mismatch
  const you = P + 'f7';
  await roster(you, '9001');
  const s2 = await unassignedWithPost(you);
  const d2 = await draftWith(you, s2);
  await assert.rejects(attachDraft(sql, s2.task.id, d2), (e: unknown) => e instanceof DraftAttachAuthorError && e.code === 'author-unverified');
  const bad = fakeFetch({ [s2.tp.tweetId]: { handle: you, userId: '9002' } });
  await assert.rejects(
    attachDraft(sql, s2.task.id, d2, { liveAuthors: await prefetchAttachAuthors(sql, s2.task.id, d2, bad.deps) }),
    (e: unknown) => e instanceof DraftAttachAuthorError && e.code === 'author-mismatch',
  );
  const good = fakeFetch({ [s2.tp.tweetId]: { handle: 'renamed', userId: '9001' } });
  await attachDraft(sql, s2.task.id, d2, { liveAuthors: await prefetchAttachAuthors(sql, s2.task.id, d2, good.deps) });
  assert.equal((await getTask(sql, s2.task.id))?.influencerHandle, you);
});
