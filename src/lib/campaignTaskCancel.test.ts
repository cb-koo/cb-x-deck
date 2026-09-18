import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { insertDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import { createTasks, getTask, markPosted, listTargetCandidates, listTargetingHandles, cancelTask, restoreTask, attachDraft, replaceInfluencer, updateTask, TaskAttachError } from './campaignTaskStore.ts';
import { linkTrackedPost, addTrackedPost, TrackingLinkError } from './trackingStore.ts';
import { CANCEL_REASONS } from './campaignTaskInput.ts';
import { ensureInfluencer } from './influencerStore.ts';
import { getDraft, updateDraft } from './draftStore.ts';

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

test('4) 취소 — 원고를 떼고 스냅샷을 남기며, 게시된 작업은 거절, 거절 사유는 타임라인에 남는다', async () => {
  const { c, camp } = await mkCampaign('d');
  const handle = P + '_d';
  const infId = await ensureInfluencer(sql, handle, null);
  const draftId = await mkDraft(c.id, c.name, '치아미백 후기');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId, items: [{ handle, cost: { amount: 10000, currency: 'KRW' } }] });
  assert.equal(await cancelTask(sql, t.id, { reason: 'declined', note: '일정 안 맞음', actorId: null, today: '2026-09-16' }), 'ok');
  const r = await getTask(sql, t.id);
  assert.equal(r?.cancelledAt, '2026-09-16');
  assert.equal(r?.cancelReason, 'declined');
  assert.equal(r?.cancelNote, '일정 안 맞음');
  assert.equal(r?.draftId, null);                                  // 떼어졌다
  assert.equal(r?.cancelledDraftId, draftId);
  assert.equal(r?.cancelledDraftTitle, '치아미백 후기');
  const logs = await sql<Array<{ event_type: string; payload: { action: string; reason: string } }>>`
    select event_type, payload from influencer_log where influencer_id = ${infId} and event_type = 'task_declined'`;
  assert.equal(logs.length, 1);
  assert.equal(logs[0].payload.action, 'cancel');
  assert.equal(logs[0].payload.reason, 'declined');
  assert.equal(await cancelTask(sql, t.id, { reason: null, note: '', actorId: null, today: '2026-09-16' }), 'already');
  const [posted] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle, cost: null }] });
  await sql`update campaign_task set posted_at = '2026-09-15' where id = ${posted.id}`;
  assert.equal(await cancelTask(sql, posted.id, { reason: 'other', note: '', actorId: null, today: '2026-09-16' }), 'posted');
  // 사유 없음·미배정 → 로그 없음
  const [noone] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [] });
  assert.equal(await cancelTask(sql, noone.id, { reason: 'no_response', note: '', actorId: null, today: '2026-09-16' }), 'ok');
  assert.equal((await sql`select count(*)::int as n from influencer_log where event_type = 'task_declined' and influencer_id = ${infId}`)[0].n, 1);
});

test('5) 되돌리기 — 재부착 / 다른 작업이 가져갔으면 작업만 복원 / 원고가 지워졌으면 작업만 복원, 취소 컬럼은 전부 비운다', async () => {
  const { c, camp } = await mkCampaign('e');
  const handle = P + '_e';
  // 재부착
  const d1 = await mkDraft(c.id, c.name, 'd1');
  const [t1] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId: d1, items: [{ handle, cost: null }] });
  await cancelTask(sql, t1.id, { reason: null, note: '', actorId: null, today: '2026-09-16' });
  const r1 = await restoreTask(sql, t1.id);
  assert.deepEqual(r1, { result: 'ok', draft: 'reattached' });
  const g1 = await getTask(sql, t1.id);
  assert.equal(g1?.draftId, d1);
  assert.equal(g1?.cancelledAt, null); assert.equal(g1?.cancelReason, null); assert.equal(g1?.cancelNote, '');
  assert.equal(g1?.cancelledDraftId, null); assert.equal(g1?.cancelledDraftTitle, null);
  // 다른 작업이 가져감 → 작업만 복원(세이브포인트: unique 충돌이 복원을 깨지 않는다)
  const d2 = await mkDraft(c.id, c.name, 'd2');
  const [t2] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId: d2, items: [{ handle, cost: null }] });
  await cancelTask(sql, t2.id, { reason: null, note: '', actorId: null, today: '2026-09-16' });
  const [other] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_e2', cost: null }] });
  await attachDraft(sql, other.id, d2);
  assert.deepEqual(await restoreTask(sql, t2.id), { result: 'ok', draft: 'taken' });
  assert.equal((await getTask(sql, t2.id))?.draftId, null);
  assert.equal((await getTask(sql, t2.id))?.cancelledAt, null);
  // 원고 삭제됨
  const d3 = await mkDraft(c.id, c.name, 'd3');
  const [t3] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId: d3, items: [{ handle, cost: null }] });
  await cancelTask(sql, t3.id, { reason: null, note: '', actorId: null, today: '2026-09-16' });
  await sql`delete from draft where id = ${d3}`;
  assert.deepEqual(await restoreTask(sql, t3.id), { result: 'ok', draft: 'gone' });
  // 취소 아님
  assert.equal((await restoreTask(sql, t3.id)).result, 'not-cancelled');
});

test('6) 교체 — 같은 행에서 인플만 바뀌고, 전달됨 원고는 사용 확정으로, RT 증빙은 지워지고, 사유가 무응답이면 옛 인플 타임라인에 남는다', async () => {
  const { c, camp } = await mkCampaign('f');
  const oldH = P + '_f1', newH = P + '_f2';
  const oldId = await ensureInfluencer(sql, oldH, null);
  const draftId = await mkDraft(c.id, c.name, '전달된 원고');
  await updateDraft(sql, draftId, { status: 'delivered' });
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId, scheduledOn: '2026-09-18', items: [{ handle: oldH, cost: { amount: 30000, currency: 'KRW' } }] });
  const r = await replaceInfluencer(sql, t.id, { handle: newH, cost: { amount: 35000, currency: 'KRW' }, reason: 'no_response', note: '', actorId: null, today: '2026-09-16' });
  assert.equal(r, 'ok');
  const g = await getTask(sql, t.id);
  assert.equal(g?.influencerHandle, newH);
  assert.deepEqual(g?.cost, { amount: 35000, currency: 'KRW' });
  assert.equal(g?.scheduledOn, '2026-09-18');                                  // 그대로
  assert.equal(g?.draftId, draftId);                                           // 원고는 따라간다
  assert.equal((await getDraft(sql, draftId))?.status, 'approved');            // 전달됨 → 사용 확정
  assert.equal((await getDraft(sql, draftId))?.influencerHandle, newH);
  const logs = await sql<Array<{ payload: { action: string } }>>`select payload from influencer_log where influencer_id = ${oldId} and event_type = 'task_declined'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.action, 'replace');
  // RT 증빙 제거
  const [rt] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle: oldH, cost: null }] });
  await sql`update campaign_task set proof = ${sql.json({ url: `task/${rt.id}/00000000-0000-4000-8000-000000000000.png`, by: null, byName: '', at: new Date().toISOString() } as never)} where id = ${rt.id}`;
  assert.equal(await replaceInfluencer(sql, rt.id, { handle: newH, cost: null, reason: null, note: '', actorId: null, today: '2026-09-16' }), 'ok');
  assert.equal((await getTask(sql, rt.id))?.proof, null);
  // 게시된 작업은 거절(문구)
  await sql`update campaign_task set posted_at = '2026-09-16' where id = ${rt.id}`;
  assert.equal(typeof await replaceInfluencer(sql, rt.id, { handle: oldH, cost: null, reason: null, note: '', actorId: null, today: '2026-09-17' }), 'string');
});

test('7) updateTask R17 가드 — 취소 작업의 게시 확인은 false(경합 신호)로 거절되고, 메모 편집은 취소 중에도 허용된다(R18)', async () => {
  const { camp } = await mkCampaign('g');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_g', cost: null }] });
  assert.equal(await cancelTask(sql, t.id, { reason: null, note: '', actorId: null, today: '2026-09-16' }), 'ok');
  // 게시 확인(postedAt)은 취소 작업에 막힌다 — updateTask가 false를 돌려주고 posted_at은 null 그대로
  assert.equal(await updateTask(sql, t.id, { postedAt: '2026-09-18', postedSource: 'manual' }), false);
  assert.equal((await getTask(sql, t.id))?.postedAt, null);
  // 메모는 취소 중에도 허용(R18) — true를 돌려주고 값이 반영된다
  assert.equal(await updateTask(sql, t.id, { note: 'x' }), true);
  assert.equal((await getTask(sql, t.id))?.note, 'x');
});

test('8) 취소 작업에 원고 붙이기 금지 (R18) — attachDraft가 TaskAttachError(\'task-cancelled\')를 던진다', async () => {
  const { c, camp } = await mkCampaign('h');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_h', cost: null }] });
  assert.equal(await cancelTask(sql, t.id, { reason: null, note: '', actorId: null, today: '2026-09-16' }), 'ok');
  const draftId = await mkDraft(c.id, c.name, '붙일 원고');
  await assert.rejects(
    () => attachDraft(sql, t.id, draftId),
    (e: unknown) => e instanceof TaskAttachError && e.code === 'task-cancelled',
  );
});

test('9) 교체 — 같은 핸들(대소문자만 다름)은 no-op: 원고 강등·비용 변경·RT 증빙 제거·로그 전부 건너뛴다 (ADR 0005 "같은 인플 재선택")', async () => {
  const { c, camp } = await mkCampaign('i');
  const handle = P + '_i1';
  const infId = await ensureInfluencer(sql, handle, null);
  const draftId = await mkDraft(c.id, c.name, '전달된 원고2');
  await updateDraft(sql, draftId, { status: 'delivered' });
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', draftId, items: [{ handle, cost: { amount: 10000, currency: 'KRW' } }] });
  assert.equal(await replaceInfluencer(sql, t.id, { handle: handle.toUpperCase(), cost: { amount: 99999, currency: 'KRW' }, reason: 'declined', note: '', actorId: null, today: '2026-09-16' }), 'ok');
  const g = await getTask(sql, t.id);
  assert.equal(g?.influencerHandle, handle);                                  // 표기 보존 — 대문자로 덮이지 않는다
  assert.deepEqual(g?.cost, { amount: 10000, currency: 'KRW' });              // 비용도 그대로
  assert.equal((await getDraft(sql, draftId))?.status, 'delivered');         // 강등 안 됨

  const [rt] = await createTasks(sql, camp.id, { ...baseInput, type: 'rt', items: [{ handle, cost: null }] });
  const proof = { url: `task/${rt.id}/00000000-0000-4000-8000-000000000009.png`, by: null, byName: '', at: new Date().toISOString() };
  await sql`update campaign_task set proof = ${sql.json(proof as never)} where id = ${rt.id}`;
  assert.equal(await replaceInfluencer(sql, rt.id, { handle: handle.toUpperCase(), cost: null, reason: 'no_response', note: '', actorId: null, today: '2026-09-16' }), 'ok');
  assert.equal((await getTask(sql, rt.id))?.proof?.url, proof.url);          // 증빙 유지

  assert.equal((await sql`select count(*)::int as n from influencer_log where influencer_id = ${infId} and event_type = 'task_declined'`)[0].n, 0);
});

test('10) 트래킹↔취소 동시 실행 — linkTrackedPost의 for update 직렬화로 23514 대신 문구 있는 오류를 받는다 (I2, §8)', async () => {
  const { camp } = await mkCampaign('j');
  const [t] = await createTasks(sql, camp.id, { ...baseInput, type: 'post', items: [{ handle: P + '_j', cost: null }] });
  const { row } = await addTrackedPost(sql, {
    tweetId: P + 'J1', authorHandle: P + '_j', text: '', postedAt: null, createdBy: null,
    metrics: { views: null, likes: null, retweets: null, replies: null, bookmarks: null, quotes: null }, raw: null,
  });
  // cancelTask를 흉내낸 트랜잭션 — select ... for update로 행을 잠근 채 신호를 받을 때까지 대기하다가
  // cancelled_at을 찍고 커밋한다. 실제 cancelTask도 같은 모양(for update → 갱신 → 커밋)이라 대표성이 있다.
  // lockAcquired는 "이 select가 실제로 서버에 도달해 락을 쥐었다"는 신호 — 원격 DB의 왕복 지연에 좌우되지
  // 않게, 임의의 대기시간 대신 이 select 자체를 기다려 순서를 보장한다.
  let lockAcquired: () => void = () => {};
  const lockAcquiredPromise = new Promise<void>((res) => { lockAcquired = res; });
  let releaseCancel: () => void = () => {};
  const cancelHeld = new Promise<void>((res) => { releaseCancel = res; });
  const cancelTx = sql.begin(async (tx0) => {
    const tx = tx0 as unknown as typeof sql;
    await tx`select id from campaign_task where id = ${t.id} for update`;
    lockAcquired();
    await cancelHeld;   // linkTrackedPost가 이 자리에서 직렬화(대기)되는지가 이 테스트의 핵심
    await tx`update campaign_task set cancelled_at = '2026-09-16' where id = ${t.id}`;
  });
  await lockAcquiredPromise;   // cancelTx가 확실히 락을 쥔 뒤에만 linkTx를 시작한다

  const linkTx = sql.begin((tx0) => linkTrackedPost(tx0 as unknown as typeof sql, row.id, { taskId: t.id }));
  // linkTx가 새 커넥션을 맺고(원격 DB라 이 자체가 수백 ms) 자기 select를 서버로 보내고 블록될 시간을
  // 넉넉히 준다 — 짧으면(직접 확인함: 800ms는 부족) cancelTx가 먼저 커밋해버려 linkTx의 select가 이미
  // 갱신된 값을 읽어 이 테스트가 고치기 전 코드에서도 우연히 통과해버린다(경합이 재현되지 않는다).
  await new Promise((r) => setTimeout(r, 2500));
  releaseCancel();
  await cancelTx;

  // for update 직렬화 덕에 linkTrackedPost는 cancelTx 커밋 후의 cancelled_at을 보고 깨끗하게
  // TrackingLinkError를 던진다 — 23514(raw PostgresError)로 터지지 않는다.
  await assert.rejects(
    linkTx,
    (e: unknown) => e instanceof TrackingLinkError && e.code === 'cancelled-task',
  );
  assert.equal((await getTask(sql, t.id))?.postedAt, null);      // 반쪽 연결로 채워지지 않았다
});
