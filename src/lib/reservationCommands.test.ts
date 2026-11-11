// 방문 예약 저장 경로 통합 테스트 — 합성 담당자(member)로 extensionProductDispatch를 직접 호출한다.
// 익스텐션(Bearer)과 웹(쿠키)이 같은 디스패치를 지나므로 여기서 통과하면 두 경계의 업무 처리는 같다.
// 데이터는 접두어 P로 만들고 after에서 restrict FK 순서대로 지운다(reservation_change → reservation_end → visit_reservation → task …).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign } from './campaignStore.ts';
import { createInfluencer } from './influencerStore.ts';
import { createMember } from './workspaceStore.ts';
import { createTasks, getTask, updateTask, deleteTask, restoreTask, cancelTask } from './campaignTaskStore.ts';
import { confirmVisitPost } from './reservationCommands.ts';
import type { FetchPostResult } from './postMetrics.ts';
import { reservationDeleteSummary, listTaskDeletions } from './taskDeletionStore.ts';
import { extensionProductDispatch } from './extensionProductApi.ts';
import { ProductError } from './productCommand.ts';
import { createClientSheet, readClientSheetInputs } from './reservationSheet.ts';
import { kstToday } from './datetime.ts';
import type { Member } from './types.ts';

// 쓰기 경로는 기본 켜짐(productFeatures). 바깥 환경이 비상 스위치(=false)를 켜 뒀어도 이 테스트는 돌게 지운다.
delete process.env.EXTENSION_PRODUCT_ENABLED;

const sql = getSql();
const P = 'trsv' + process.pid;   // 핸들은 15자 제한 — 'trsv' + pid(5자리) + 접미어 4자
const ORIGIN = 'http://127.0.0.1:3000';

after(async () => {
  await sql`delete from tracked_post where author_handle like ${P + '%'}`;   // 연결 작업 게시 확인 테스트가 만든 게시물(지표는 cascade)
  await sql`delete from campaign_task where same_visit_of is not null and campaign_id in (select id from campaign where name like ${P + '%'})`;
  const tasks = sql`select id from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  const reservations = sql`select id from visit_reservation where task_id in (${tasks})`;
  await sql`delete from reservation_change where reservation_id in (${reservations})`;
  await sql`delete from reservation_end where task_id in (${tasks})`;
  await sql`delete from visit_reservation where task_id in (${tasks})`;
  await sql`delete from campaign_task where id in (${tasks})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from clinic_location where client_id in (select id from client where name like ${P + '%'})`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from api_idempotency where subject in (select id::text from member where name like ${P + '%'})`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

// ─────────────────────────── 픽스처 ───────────────────────────
let actor: Member;
async function fixture(suffix: string) {
  actor ??= await createMember(sql, P + '담당', '#1d9bf0');
  const client = await createClient(sql, P + '클리닉' + suffix);
  const [location] = await sql<Array<{ id: string }>>`insert into clinic_location (client_id) values (${client.id}) returning id`;
  const campaign = await createCampaign(sql, {
    clientId: client.id, clientName: client.name, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
    startsOn: base, endsOn: plusDays(60), kind: null, note: '', createdBy: actor.id,
  });
  const handle = P + suffix;
  const { row: person } = await createInfluencer(sql, { handle, createdBy: actor.id });
  // 다지점(벤자민 명동·신사) — 본점 행 외에 지점 행 둘
  const [myeongdong] = await sql<Array<{ id: string }>>`insert into clinic_location (client_id, kind, name, position)
    values (${client.id}, 'branch', '명동점', 2) returning id`;
  const [sinsa] = await sql<Array<{ id: string }>>`insert into clinic_location (client_id, kind, name, position)
    values (${client.id}, 'branch', '신사점', 3) returning id`;
  return { client, locationId: location.id, campaign, handle, person, branches: { myeongdong: myeongdong.id, sinsa: sinsa.id } };
}
// 날짜 기준은 테스트마다 한 번만 잡는다 — 서버(kstToday)가 자정을 넘기는 사이 기대값이 어긋나는 경합을 막는다. 각 테스트 첫 줄에서 다시 잡는다.
let base = kstToday();
function plusDays(n: number): string {
  const d = new Date(`${base}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const sheet = (handle: string, visitDate: string, over: Record<string, string> = {}) =>
  createClientSheet(handle, { preferred: `${visitDate}T16:00`, visitType: '초진', name: '하나(Hana)', treatment: '울쎄라', ...over });

// 디스패치 호출 — 익스텐션 client.ts와 같은 헤더 규칙(Idempotency-Key·If-Match)으로 Request를 만든다.
type CallOpts = { body?: unknown; version?: number; key?: string };
async function call<T = Record<string, unknown>>(method: string, path: string, opts: CallOpts = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.version !== undefined) headers['if-match'] = `"${opts.version}"`;
  if (opts.key) headers['idempotency-key'] = opts.key;
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const req = new Request(`${ORIGIN}/api/extension/v1/${path}`, { method, headers, ...(hasBody ? { body: JSON.stringify(opts.body ?? {}) } : {}) });
  const segments = path.split('?')[0].split('/');
  return (await extensionProductDispatch(req, segments, actor)).data as T;
}
async function rejects(run: Promise<unknown>, code: string, status?: number) {
  await assert.rejects(run, (e: unknown) => {
    assert.ok(e instanceof ProductError, `ProductError가 아니라 ${String(e)}`);
    assert.equal(e.code, code);
    if (status !== undefined) assert.equal(e.status, status);
    return true;
  });
}
type Detail = { id: string; taskId: string; version: number; phase: string; confirmed: boolean; sheetText: string; deadlineMode: string;
  customerRequestCount: number; allowedActions: string[]; uploadDeadline: string | null; task: { version: number; visitAt: string | null } };

// ─────────────────────────── 1) 생성 → 확정 → 수정 → 종료 ───────────────────────────
test('1) 예약 생성(작업 새로 만들기) → 확정 → 고객 요청 수정 → 종료가 저장·이력·작업 칸에 반영된다', async () => {
  base = kstToday();
  const f = await fixture('a');
  const visit = plusDays(30);
  const key = randomUUID();
  const body = { locationId: f.locationId, sourceText: '10/28 16시 부탁해요', sheetText: sheet(f.handle, visit),
    target: { kind: 'createTask', campaignId: f.campaign.id, personId: f.person.id } };

  // 생성 — 대기 단계. 기본 기한 방식이면 업로드 기한이 방문+14일로 시트에 붙고 작업의 게시 예정일에도 복사된다.
  const created = await call<Detail>('POST', 'reservations', { body, key });
  assert.equal(created.phase, 'waiting');
  assert.equal(created.confirmed, false);
  assert.equal(created.version, 1);
  assert.equal(created.uploadDeadline, plusDays(44));
  assert.equal(readClientSheetInputs(created.sheetText).uploadDeadline, plusDays(44));
  assert.deepEqual(created.allowedActions, ['edit_reservation', 'confirm', 'cancel', 'manage_consent']);
  const task0 = await getTask(sql, created.taskId);
  assert.equal(task0?.type, 'visit');
  assert.equal(task0?.influencerHandle, f.handle);
  assert.equal(task0?.scheduledOn, plusDays(44));
  assert.equal(task0?.visitOn, null);   // 대기 중엔 방문일을 작업에 쓰지 않는다

  // 같은 키·같은 본문 재시도 = 최초 결과 그대로, 이력도 1건 그대로
  const replay = await call<Detail>('POST', 'reservations', { body, key });
  assert.equal(replay.id, created.id);
  const changes0 = await sql`select event from reservation_change where reservation_id = ${created.id}`;
  assert.deepEqual(changes0.map((c) => c.event), ['create']);
  // 같은 키·다른 본문 = 409
  await rejects(call('POST', 'reservations', { body: { ...body, sourceText: '다른 원문' }, key }), 'IDEMPOTENCY_KEY_REUSED', 409);
  // 같은 작업에 두 번째 예약 = 409 RESERVATION_ALREADY_EXISTS — 중복 검사가 단계 판정(STATE_CHANGED)보다 먼저여야 이 코드가 난다(handoff 문서·익스텐션 코드 목록과 일치)
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: { ...body, target: { kind: 'existingTask', taskId: created.taskId, expectedTaskVersion: (await getTask(sql, created.taskId))!.version } } }), 'RESERVATION_ALREADY_EXISTS', 409);

  // 작업 조회 — 예약 ID·버전이 붙는다
  const taskDto = await call<{ reservationId: string | null; version: number; visitPhase: string }>('GET', `tasks/${created.taskId}`);
  assert.equal(taskDto.reservationId, created.id);
  assert.equal(taskDto.visitPhase, 'waiting');
  const viaTask = await call<Detail | null>('GET', `tasks/${created.taskId}/reservation`);
  assert.equal(viaTask?.id, created.id);

  // 확정 — If-Match 필수(428), 낡은 버전은 409, 맞으면 방문일·방문 시간이 작업에 복사된다
  await rejects(call('POST', `reservations/${created.id}/confirm`, { key: randomUUID() }), 'VERSION_REQUIRED', 428);
  await rejects(call('POST', `reservations/${created.id}/confirm`, { key: randomUUID(), version: 99 }), 'VERSION_CONFLICT', 409);
  const confirmed = await call<Detail>('POST', `reservations/${created.id}/confirm`, { key: randomUUID(), version: created.version });
  assert.equal(confirmed.phase, 'confirmed');
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.version, 2);
  assert.deepEqual(confirmed.allowedActions, ['edit_reservation', 'cancel', 'manage_consent']);
  const task1 = await getTask(sql, created.taskId);
  assert.equal(task1?.visitOn, visit);
  assert.equal(task1?.visitTime, '16:00');
  // 확정은 대기에서만 — 두 번째 확정은 409
  await rejects(call('POST', `reservations/${created.id}/confirm`, { key: randomUUID(), version: confirmed.version }), 'STATE_CHANGED', 409);

  // 확정 후 수정 — 사유 없으면 422, 고객 요청이면 회차 1, 정정은 회차에 안 센다
  await rejects(call('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: confirmed.version, body: { fieldEdits: { treatment: '보톡스' } } }), 'REASON_REQUIRED', 422);
  const edited = await call<Detail>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: confirmed.version,
    body: { reason: 'customer_request', fieldEdits: { treatment: '보톡스', visitAt: `${plusDays(31)}T15:30` } } });
  assert.equal(edited.version, 3);
  assert.equal(edited.customerRequestCount, 1);
  assert.equal(readClientSheetInputs(edited.sheetText).treatment, '보톡스');
  assert.equal(edited.uploadDeadline, plusDays(45));   // 기본 기한은 방문일을 따라간다
  const task2 = await getTask(sql, created.taskId);
  assert.equal(task2?.visitOn, plusDays(31));
  assert.equal(task2?.visitTime, '15:30');
  assert.equal(task2?.scheduledOn, plusDays(45));
  const corrected = await call<Detail>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: edited.version,
    body: { reason: 'correction', fieldEdits: { name: '하나', romanizedName: 'Hana Kim' } } });
  assert.equal(corrected.customerRequestCount, 1);
  assert.equal(readClientSheetInputs(corrected.sheetText).name, '하나(Hana Kim)');
  // 무변경 저장은 버전도 이력도 늘리지 않는다
  const same = await call<Detail>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: corrected.version, body: { reason: 'correction', fieldEdits: {} } });
  assert.equal(same.version, corrected.version);
  const changes = await call<{ items: Array<{ event: string; reason: string; requestNo: number | null }>; total: number }>('GET', `reservations/${created.id}/changes?limit=10`);
  assert.equal(changes.total, 4);
  assert.deepEqual(changes.items.map((c) => [c.event, c.reason, c.requestNo]).reverse(),
    [['create', 'waiting_edit', null], ['confirm', 'waiting_edit', null], ['edit', 'customer_request', 1], ['edit', 'correction', null]]);
  const onlyRequests = await call<{ total: number }>('GET', `reservations/${created.id}/changes?reason=customer_request`);
  assert.equal(onlyRequests.total, 1);

  // 웹의 레거시 경로는 예약이 연결된 작업의 일정·인플을 못 바꾸고 삭제도 못 한다 — 메모는 된다
  await rejects(updateTask(sql, created.taskId, { visitOn: plusDays(40) }), 'RESERVATION_COMMAND_REQUIRED', 409);
  await rejects(deleteTask(sql, created.taskId), 'RESERVATION_COMMAND_REQUIRED', 409);
  assert.equal(await updateTask(sql, created.taskId, { note: '메모만' }), true);
  await rejects(call('DELETE', `tasks/${created.taskId}`, { key: randomUUID(), version: (await getTask(sql, created.taskId))!.version }), 'RESERVATION_COMMAND_REQUIRED', 409);

  // 종료 — 본문은 웹 취소 창과 같다. 확정 단계라 종류는 '취소'. 작업 취소 칸·예약 종료 기록·타임라인이 함께 남는다
  const taskVersion = (await getTask(sql, created.taskId))!.version;
  await rejects(call('POST', `tasks/${created.taskId}/end`, { key: randomUUID(), version: taskVersion, body: { reason: 'maybe', note: '' } }), 'INVALID_INPUT', 400);
  const ended = await call<Detail>('POST', `tasks/${created.taskId}/end`, { key: randomUUID(), version: taskVersion, body: { reason: 'declined', note: '일정이 안 맞아요' } });
  assert.equal(ended.phase, 'cancelled');
  assert.deepEqual(ended.allowedActions, []);
  const task3 = await getTask(sql, created.taskId);
  assert.ok(task3?.cancelledAt);
  assert.equal(task3?.cancelReason, 'declined');
  assert.equal(task3?.cancelNote, '일정이 안 맞아요');
  const [end] = await sql`select kind, reason, revoked_at from reservation_end where task_id = ${created.taskId}`;
  assert.equal(end.kind, 'cancelled');
  assert.equal(end.reason, '일정이 안 맞아요');
  assert.equal(end.revoked_at, null);
  const log = await sql`select event_type, payload from influencer_log where influencer_id = ${f.person.id} and event_type = 'task_declined' and payload->>'taskId' = ${created.taskId}`;
  assert.equal(log.length, 1, '거절 타임라인이 남아야 한다');
  assert.equal(log[0].payload.reason, 'declined');
  // 종료 뒤에는 저장·재종료·웹 복원이 모두 막힌다. 예약 기록은 남는다(삭제가 아니다)
  await rejects(call('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: ended.version, body: { reason: 'correction', fieldEdits: { treatment: '리프팅' } } }), 'STATE_CHANGED', 409);
  await rejects(call('POST', `tasks/${created.taskId}/end`, { key: randomUUID(), version: (await getTask(sql, created.taskId))!.version, body: { reason: 'other', note: '다시' } }), 'STATE_CHANGED', 409);
  await rejects(restoreTask(sql, created.taskId), 'RESERVATION_COMMAND_REQUIRED', 409);
  assert.equal((await call<Detail>('GET', `reservations/${created.id}`)).sheetText, corrected.sheetText);
});

// ─────────────────────────── 2) 기존 작업에 연결·클리닉 불일치·버전 ───────────────────────────
test('2) 기존 방문 작업에 예약 연결 — 작업 버전 검사, 다른 클라이언트 본점은 거부, 시트의 계정은 작업의 인플과 같아야 한다', async () => {
  base = kstToday();
  const f = await fixture('b');
  const other = await fixture('c');
  const [task] = await createTasks(sql, f.campaign.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: actor.id,
    type: 'visit', items: [{ handle: f.handle, cost: { amount: 10000, currency: 'JPY' } }] });
  const visit = plusDays(20);
  const input = { sourceText: '', sheetText: sheet(f.handle, visit) };
  const target = (version: number) => ({ kind: 'existingTask', taskId: task.id, expectedTaskVersion: version });
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: { ...input,locationId: f.locationId, target: { kind: 'existingTask', taskId: task.id } } }), 'VERSION_REQUIRED', 428);
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: { ...input,locationId: f.locationId, target: target(task.version! + 5) } }), 'VERSION_CONFLICT', 409);
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: { ...input,locationId: other.locationId, target: target(task.version!) } }), 'LOCATION_MISMATCH', 422);
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: { ...input,sheetText: sheet(other.handle, visit), locationId: f.locationId, target: target(task.version!) } }), 'IDENTITY_MISMATCH', 422);
  // 직접 지정 기한: 방문일보다 이르면 거부, 날짜 줄이 없으면 거부
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: { ...input,deadlineMode: 'manual', locationId: f.locationId, target: target(task.version!) } }), 'DATE_INVALID', 422);
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: { ...input,deadlineMode: 'manual', sheetText: `${input.sheetText}\n업로드 기한: ${plusDays(10)}`, locationId: f.locationId, target: target(task.version!) } }), 'DEADLINE_BEFORE_VISIT', 422);

  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: { ...input,deadlineMode: 'manual', sheetText: `${input.sheetText}\n업로드 기한: ${plusDays(25)}`, locationId: f.locationId, target: target(task.version!) } });
  assert.equal(created.taskId, task.id);
  assert.equal(created.deadlineMode, 'manual');
  assert.equal(created.uploadDeadline, plusDays(25));
  assert.equal((await getTask(sql, task.id))?.scheduledOn, plusDays(25));
  // 캠페인의 방문 작업 후보 목록에 이 작업과 예약 ID가 보인다
  const candidates = await call<{ items: Array<{ id: string; reservationId: string | null }> }>('GET', `campaigns/${f.campaign.id}/visit-task-candidates?personId=${f.person.id}`);
  assert.deepEqual(candidates.items.map((c) => [c.id, c.reservationId]), [[task.id, created.id]]);
  // 다른 사람 본문이 아닌 '종료'는 예약 없는 방문 작업에도 된다 — 예약 없으면 일반 취소라 되돌릴 수 있다
  const [bare] = await createTasks(sql, f.campaign.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: actor.id,
    type: 'visit', items: [{ handle: f.handle, cost: null }] });
  const endedBare = await call<{ taskId: string; cancelledAt: string | null }>('POST', `tasks/${bare.id}/end`, { key: randomUUID(), version: bare.version!, body: { reason: 'no_response', note: '' } });
  assert.equal(endedBare.taskId, bare.id);
  assert.ok(endedBare.cancelledAt);
  assert.equal((await sql`select 1 from reservation_end where task_id = ${bare.id}`).length, 0);
  assert.equal((await restoreTask(sql, bare.id)).result, 'ok');
});

// ─────────────────────────── 3) 방문 당일 — 방문 완료 → 업로드 노쇼 ───────────────────────────
test('3) 방문 당일 확정 예약: 수동 방문 완료 후 종료하면 종류가 업로드 노쇼가 된다', async () => {
  base = kstToday();
  const f = await fixture('d');
  const today = base;
  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: { locationId: f.locationId, sourceText: '', sheetText: sheet(f.handle, today),
    target: { kind: 'createTask', campaignId: f.campaign.id, personId: f.person.id } } });
  // 대기 단계에서는 방문 완료를 못 한다
  await rejects(call('POST', `tasks/${created.taskId}/complete-visit`, { key: randomUUID(), version: created.task.version }), 'STATE_CHANGED', 409);
  const confirmed = await call<Detail>('POST', `reservations/${created.id}/confirm`, { key: randomUUID(), version: created.version });
  assert.ok(confirmed.allowedActions.includes('complete_visit'));
  assert.ok(confirmed.allowedActions.includes('visit_no_show'));
  const visited = await call<Detail>('POST', `tasks/${created.taskId}/complete-visit`, { key: randomUUID(), version: confirmed.task.version });
  assert.equal(visited.phase, 'visited');
  const [completed] = await sql`select visit_completed_at, visit_completed_by from campaign_task where id = ${created.taskId}`;   // TaskRow(웹)는 이 칸을 아직 안 읽는다
  assert.ok(completed.visit_completed_at);
  assert.equal(completed.visit_completed_by, actor.id);
  assert.deepEqual(visited.allowedActions, ['edit_reservation', 'confirm_post', 'visit_no_show', 'upload_no_show', 'manage_consent']);
  const ended = await call<Detail>('POST', `tasks/${created.taskId}/end`, { key: randomUUID(), version: visited.task.version, body: { reason: 'other', note: '' } });
  assert.equal(ended.phase, 'upload_no_show');
  const [end] = await sql`select kind, reason from reservation_end where task_id = ${created.taskId}`;
  assert.equal(end.kind, 'upload_no_show');
  assert.equal(end.reason, '기타');   // 메모가 비면 사유 칩 문구가 종료 사유가 된다
});

// ─────────────────────────── 4) 예약 기록과 함께 지우기 + 삭제 기록(073) ───────────────────────────
test('4) 예약이 연결된 작업은 확인(withReservation) 없이는 못 지우고, 확인하면 예약 기록까지 지우며 누가·언제·무엇을 남긴다', async () => {
  base = kstToday();
  const f = await fixture('e');
  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: { locationId: f.locationId, sourceText: '', sheetText: sheet(f.handle, plusDays(20)),
    target: { kind: 'createTask', campaignId: f.campaign.id, personId: f.person.id } } });
  const confirmed = await call<Detail>('POST', `reservations/${created.id}/confirm`, { key: randomUUID(), version: created.version });
  const ended = await call<Detail>('POST', `tasks/${created.taskId}/end`, { key: randomUUID(), version: confirmed.task.version, body: { reason: 'other', note: '테스트' } });
  assert.equal(ended.phase, 'cancelled');

  // 요약 — 확정·종료·변경 내역(생성·확정 2건)
  const summary = await reservationDeleteSummary(sql, created.taskId);
  assert.deepEqual({ ...summary, visitTime: undefined }, { confirmed: true, visitOn: plusDays(20), visitTime: undefined, changes: 2, ended: true, uploads: 0 });
  assert.equal(summary?.visitTime, '16:00');

  // 확인 없는 삭제(옛 화면·익스텐션)는 예전처럼 거절 — 아무것도 지워지지 않는다
  await rejects(deleteTask(sql, created.taskId), 'RESERVATION_COMMAND_REQUIRED', 409);
  await rejects(call('DELETE', `tasks/${created.taskId}`, { key: randomUUID(), version: (await getTask(sql, created.taskId))!.version }), 'RESERVATION_COMMAND_REQUIRED', 409);
  assert.ok(await getTask(sql, created.taskId));
  assert.equal((await sql`select 1 from campaign_task_deletion where task_id = ${created.taskId}`).length, 0);

  // 확인하고 지우기 — 작업·예약·변경 내역·종료가 한 번에 사라지고, 삭제 기록에 담당자와 지운 내용이 남는다
  assert.equal(await deleteTask(sql, created.taskId, { actor, withReservation: true }), true);
  assert.equal(await getTask(sql, created.taskId), null);
  assert.equal((await sql`select 1 from visit_reservation where id = ${created.id}`).length, 0);
  assert.equal((await sql`select 1 from reservation_change where reservation_id = ${created.id}`).length, 0);
  assert.equal((await sql`select 1 from reservation_end where task_id = ${created.taskId}`).length, 0);
  const [log] = await sql<Array<{ with_reservation: boolean; deleted_by: string; deleted_by_name: string; influencer_handle: string; task_type: string; snapshot: { task: { id: string }; reservations: unknown[]; reservationChanges: unknown[]; reservationEnds: unknown[] } }>>`
    select with_reservation, deleted_by, deleted_by_name, influencer_handle, task_type, snapshot from campaign_task_deletion where task_id = ${created.taskId}`;
  assert.equal(log.with_reservation, true);
  assert.equal(log.deleted_by, actor.id);
  assert.equal(log.deleted_by_name, actor.name);
  assert.equal(log.influencer_handle, f.handle);
  assert.equal(log.task_type, 'visit');
  assert.equal(log.snapshot.task.id, created.taskId);
  assert.equal(log.snapshot.reservations.length, 1);
  assert.equal(log.snapshot.reservationChanges.length, 2);
  assert.equal(log.snapshot.reservationEnds.length, 1);
  const listed = await listTaskDeletions(sql, f.campaign.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].deletedByName, actor.name);
  assert.equal(listed[0].withReservation, true);

  // 다시 지우기는 멱등(false), 기록도 늘지 않는다
  assert.equal(await deleteTask(sql, created.taskId, { actor, withReservation: true }), false);
  assert.equal((await listTaskDeletions(sql, f.campaign.id)).length, 1);
});

test('5) 예약 없는 작업 삭제도 기록이 남고, 익스텐션 삭제는 담당자를 남긴다', async () => {
  base = kstToday();
  const f = await fixture('f');
  const [plain] = await createTasks(sql, f.campaign.id, { type: 'visit', targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: actor.id, items: [{ handle: f.handle, cost: null }] });
  const [viaExt] = await createTasks(sql, f.campaign.id, { type: 'visit', targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: actor.id, items: [{ handle: f.handle, cost: null }] });
  assert.equal(await deleteTask(sql, plain.id), true);
  await call('DELETE', `tasks/${viaExt.id}`, { key: randomUUID(), version: (await getTask(sql, viaExt.id))!.version });
  const rows = await sql<Array<{ task_id: string; with_reservation: boolean; deleted_by: string | null; deleted_by_name: string }>>`
    select task_id, with_reservation, deleted_by, deleted_by_name from campaign_task_deletion where campaign_id = ${f.campaign.id}`;
  const byTask = new Map(rows.map((r) => [r.task_id, r]));
  assert.equal(byTask.get(plain.id)?.with_reservation, false);
  assert.equal(byTask.get(plain.id)?.deleted_by, null);
  assert.equal(byTask.get(viaExt.id)?.deleted_by, actor.id);
  assert.equal(byTask.get(viaExt.id)?.deleted_by_name, actor.name);
});

test('등급 안내 문구가 값으로 들어오면 저장 시 빈 값으로 정리된다', async () => {
  base = kstToday();
  const f = await fixture('t');
  const visit = plusDays(30);
  const withTier = (extra = '') => `${sheet(f.handle, visit)}\n- 인플루언서 팔로워 : 영역 (나노/마이크로/메가)${extra}`;
  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: { locationId: f.locationId, sourceText: '', sheetText: withTier(),
    target: { kind: 'createTask', campaignId: f.campaign.id, personId: f.person.id } } });
  const tierLine = (text: string) => text.split('\n').find((l) => l.includes('인플루언서 팔로워'));
  assert.equal(tierLine(created.sheetText), '- 인플루언서 팔로워 :');
  assert.equal(readClientSheetInputs(created.sheetText).followerTier, '');
  // 안내 문구를 그대로 다시 보내는 저장은 followerTier 변경으로 세지 않는다
  const same = await call<Detail>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: created.version, body: { sheetText: withTier() } });
  assert.equal(same.version, created.version);
  // 등급을 고르면 값이 들어가고, 안내 문구가 다시 오면 비워진다
  const picked = await call<Detail>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: created.version,
    body: { sheetText: created.sheetText.replace('팔로워 :', '팔로워 : 마이크로') } });
  assert.equal(tierLine(picked.sheetText), '- 인플루언서 팔로워 : 마이크로');
  const reset = await call<Detail>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: picked.version,
    body: { sheetText: picked.sheetText.replace('마이크로', '영역 (나노/마이크로/메가)') } });
  assert.equal(tierLine(reset.sheetText), '- 인플루언서 팔로워 :');
});

// ─────────────────────────── 지점(다지점 클리닉) ───────────────────────────
const createBody = (f: Awaited<ReturnType<typeof fixture>>, over: Record<string, unknown>) => ({ sourceText: '',
  sheetText: sheet(f.handle, plusDays(30)), target: { kind: 'createTask', campaignId: f.campaign.id, personId: f.person.id }, ...over });
const sheetRevision = async (locationId: string) => (await sql<Array<{ id: string }>>`insert into clinic_template_revision (location_id, kind, body, revision)
  values (${locationId}, 'sheet', '양식', 1) returning id`)[0].id;

test('사용 중지 지점으로 등록하면 422 LOCATION_INACTIVE', async () => {
  base = kstToday();
  const f = await fixture('i');
  await sql`update clinic_location set active = false where id = ${f.branches.sinsa}`;
  await assert.rejects(call('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.branches.sinsa }) }), (e: unknown) => {
    assert.ok(e instanceof ProductError);
    assert.equal(e.code, 'LOCATION_INACTIVE');
    assert.equal(e.status, 422);
    assert.equal(e.message, '사용 중지된 지점이에요. 지점을 다시 골라 주세요.');
    return true;
  });
  const created = await call<Detail & { locationId: string }>('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.branches.myeongdong }) });
  assert.equal(created.locationId, f.branches.myeongdong);
});

// 087 클라이언트 비활성화(ISSUE-013, 태정님 11-06) — 목록은 거르지 않고 clientActive만 싣고, 새 예약은 막는다
test('비활성 클라이언트: /clinics·/campaigns에 clientActive=false로 실리고, 새 예약은 422 CLIENT_INACTIVE(작업도 안 생긴다)', async () => {
  base = kstToday();
  const f = await fixture('z');
  await sql`update client set deactivated_at = now() where id = ${f.client.id}`;
  const clinics = await call<{ items: Array<{ clientId: string; clientActive: boolean }> }>('GET', 'clinics');
  assert.ok(clinics.items.filter((c) => c.clientId === f.client.id).every((c) => c.clientActive === false));
  const camps = await call<{ items: Array<{ id: string; clientActive: boolean }> }>('GET', 'campaigns');
  assert.equal(camps.items.find((c) => c.id === f.campaign.id)?.clientActive, false);
  const before = (await sql<Array<{ n: number }>>`select count(*)::int n from campaign_task where campaign_id = ${f.campaign.id}`)[0].n;
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.branches.myeongdong }) }), 'CLIENT_INACTIVE', 422);
  const after = (await sql<Array<{ n: number }>>`select count(*)::int n from campaign_task where campaign_id = ${f.campaign.id}`)[0].n;
  assert.equal(after, before);   // 작업 새로 만들기로 만든 작업도 함께 되돌려진다
  await sql`update client set deactivated_at = null where id = ${f.client.id}`;
  const ok = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.branches.myeongdong }) });
  assert.ok(ok.id);
});

test('같은 클라이언트 다른 장소의 시트 리비전은 통과, 다른 클라이언트 리비전은 TEMPLATE_MISMATCH', async () => {
  base = kstToday();
  const f = await fixture('r');
  const other = await fixture('s');
  // 파싱은 명동 양식으로 하고 등록 직전 신사로 바꾼 경우(D13)
  const created = await call<Detail & { locationId: string; templateRevisionId: string | null }>('POST', 'reservations', { key: randomUUID(),
    body: createBody(f, { locationId: f.branches.sinsa, templateRevisionId: await sheetRevision(f.branches.myeongdong) }) });
  assert.equal(created.locationId, f.branches.sinsa);
  assert.ok(created.templateRevisionId);
  // 다른 클라이언트 장소의 리비전(I3)
  const f2 = await fixture('u');
  await rejects(call('POST', 'reservations', { key: randomUUID(),
    body: createBody(f2, { locationId: f2.branches.sinsa, templateRevisionId: await sheetRevision(other.branches.myeongdong) }) }), 'TEMPLATE_MISMATCH', 422);
});

test('수정에서 locationId를 바꾸면 location_id가 바뀌고 differences는 location 1건', async () => {
  base = kstToday();
  const f = await fixture('l');
  const other = await fixture('m');
  const withBranch = `${sheet(f.handle, plusDays(30))}\n지점: 명동점`;
  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.branches.myeongdong, sheetText: withBranch }) });
  const confirmed = await call<Detail>('POST', `reservations/${created.id}/confirm`, { key: randomUUID(), version: created.version });
  // 다른 클라이언트 지점(I4)
  await rejects(call('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: confirmed.version,
    body: { reason: 'customer_request', locationId: other.branches.sinsa } }), 'LOCATION_MISMATCH', 422);
  // 시트 지점 줄도 같이 바꿔 보내도 차이는 지점 1건(D22·D26), 고객 요청이면 회차가 오른다(D27)
  const moved = await call<Detail & { locationId: string }>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: confirmed.version,
    body: { reason: 'customer_request', locationId: f.branches.sinsa, sheetText: confirmed.sheetText.replace('지점: 명동점', '지점: 신사점') } });
  assert.equal(moved.locationId, f.branches.sinsa);
  assert.equal(moved.version, confirmed.version + 1);
  assert.equal(moved.customerRequestCount, 1);
  assert.ok(moved.sheetText.includes('지점: 신사점'));
  const [row] = await sql<Array<{ location_id: string }>>`select location_id from visit_reservation where id = ${created.id}`;
  assert.equal(row.location_id, f.branches.sinsa);
  const [change] = await sql<Array<{ differences: Array<{ field: string; label: string; before: string; after: string }> }>>`
    select differences from reservation_change where reservation_id = ${created.id} and event = 'edit'`;
  assert.equal(change.differences.length, 1);
  assert.deepEqual(change.differences[0], { field: 'location', label: '지점', before: '명동점', after: '신사점' });
  // 본점으로 옮기면 라벨은 클라이언트명 없이 '본점'
  const toMain = await call<Detail & { locationId: string }>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: moved.version,
    body: { reason: 'correction', locationId: f.locationId } });
  assert.equal(toMain.locationId, f.locationId);
  const [last] = await sql<Array<{ differences: Array<{ before: string; after: string }> }>>`
    select differences from reservation_change where reservation_id = ${created.id} order by created_at desc, id desc limit 1`;
  assert.deepEqual(last.differences.map((d) => [d.before, d.after]), [['신사점', '본점']]);
});

test('수정에서 사용 중지 지점: 저장된 지점은 그대로 저장되고, 새로 고르면 LOCATION_INACTIVE', async () => {
  base = kstToday();
  const f = await fixture('v');
  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.branches.myeongdong }) });
  await sql`update clinic_location set active = false where id in (${f.branches.myeongdong}, ${f.branches.sinsa})`;
  // 기존 예약은 중지된 지점을 유지한다(A4) — locationId를 안 보내도, 같은 값을 보내도 저장된다
  const kept = await call<Detail & { locationId: string }>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: created.version,
    body: { locationId: f.branches.myeongdong, fieldEdits: { treatment: '보톡스' } } });
  assert.equal(kept.locationId, f.branches.myeongdong);
  assert.equal(kept.version, created.version + 1);
  const kept2 = await call<Detail & { locationId: string }>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: kept.version,
    body: { fieldEdits: { treatment: '필러' } } });
  assert.equal(kept2.locationId, f.branches.myeongdong);
  await rejects(call('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: kept2.version,
    body: { locationId: f.branches.sinsa } }), 'LOCATION_INACTIVE', 422);
  // 지점 진실은 location_id — 시트의 지점 줄 글자만 바꾸고 locationId가 그대로면 차이가 없어 저장하지 않는다
  const textOnly = await call<Detail>('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: kept2.version,
    body: { sheetText: `${kept2.sheetText}\n지점: 신사점` } });
  assert.equal(textOnly.version, kept2.version);
});

test('핸들 줄 없는 시트에서 계정 링크 핸들을 바꾸면 IDENTITY_MISMATCH', async () => {
  base = kstToday();
  const f = await fixture('h');
  const body = sheet(f.handle, plusDays(30)).split('\n').slice(3).join('\n');
  const benjamin = (h: string) => `- 인플루언서 계정 링크: https://x.com/${h}?s=20\n${body}`;
  assert.equal(readClientSheetInputs(benjamin(f.handle)).handle, '');
  // 등록에서도 링크의 계정이 작업 인플과 달라면 거부한다
  await rejects(call('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.locationId, sheetText: benjamin('other') }) }), 'IDENTITY_MISMATCH', 422);
  // 핸들 줄이 있는 시트는 URL을 보지 않는다 — 핸들 줄이 인플과 같으면 링크가 다른 계정이어도 등록된다(H2)
  const f2 = await fixture('k');
  const withHandle = sheet(f2.handle, plusDays(30)).replace(`x.com/${f2.handle}?s=20`, 'x.com/other?s=20');
  assert.ok(withHandle.includes('x.com/other?s=20'));
  const viaHandle = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: createBody(f2, { locationId: f2.locationId, sheetText: withHandle }) });
  assert.ok(viaHandle.id);
  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: createBody(f, { locationId: f.locationId, sheetText: benjamin(f.handle.toUpperCase()) }) });
  await rejects(call('PATCH', `reservations/${created.id}`, { key: randomUUID(), version: created.version,
    body: { sheetText: created.sheetText.replace(`x.com/${f.handle.toUpperCase()}?s=20`, 'x.com/other?s=20') } }), 'IDENTITY_MISMATCH', 422);
});

// ─────────────────────────── 같은 방문의 게시물(ISSUE-016) — 확장에서 추가·게시 확인 ───────────────────────────
// 트윗 id에서 게시일을 읽으므로(postedOnFromTweetLink) 지금 시각의 snowflake를 만든다. X 조회는 바꿔 끼운다.
const tweetIdNow = (n: number) => (((BigInt(Date.now()) - BigInt('1288834974657')) << BigInt(22)) + BigInt(n)).toString();
const fakeFetch = (author: string) => async (tweetId: string): Promise<FetchPostResult> => ({ kind: 'ok', post: {
  tweetId, authorHandle: author, authorUserId: null, text: '테스트', postedAt: new Date().toISOString(),
  metrics: { views: 1, likes: 0, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 }, raw: {} as never } });
function postRequest(path: string, version: number) {
  return new Request(`${ORIGIN}/api/extension/v1/${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'if-match': `"${version}"`, 'idempotency-key': randomUUID() } });
}
type TaskInfo = { id: string; version: number; allowedActions: string[]; posts: Array<{ taskId: string; version: number; postedAt: string | null }>; sameVisitOf: string | null };

test('같은 방문: POST tasks/{id}/posts는 웹과 같은 판정으로 연결 작업을 만들고, 원래 작업에 posts로 싣는다', async () => {
  base = kstToday();
  const f = await fixture('s');
  const [o] = await createTasks(sql, f.campaign.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: actor.id,
    type: 'visit', items: [{ handle: f.handle, cost: { amount: 15000, currency: 'JPY' } }] });
  const before = await call<TaskInfo>('GET', `tasks/${o.id}`);
  assert.ok(before.allowedActions.includes('add_post'));
  assert.deepEqual(before.posts, []);
  // If-Match 없음·낡은 version
  await rejects(call('POST', `tasks/${o.id}/posts`, { key: randomUUID() }), 'VERSION_REQUIRED', 428);
  await rejects(call('POST', `tasks/${o.id}/posts`, { key: randomUUID(), version: before.version + 5 }), 'VERSION_CONFLICT', 409);
  // 같은 멱등 키 두 번 → 같은 응답, 줄은 하나
  const key = randomUUID();
  const added = await call<TaskInfo>('POST', `tasks/${o.id}/posts`, { key, version: before.version });
  const again = await call<TaskInfo>('POST', `tasks/${o.id}/posts`, { key, version: before.version });
  assert.equal(added.id, o.id);
  assert.equal(added.posts.length, 1);
  assert.deepEqual(again, added);
  assert.equal(added.version, before.version);   // 원래 작업 version은 그대로(웹과 같음)
  // 다른 키 — 빈 연결 작업이 있으면 그것을 다시 쓴다(웹 [게시물 하나 더]와 같은 규칙)
  const reused = await call<TaskInfo>('POST', `tasks/${o.id}/posts`, { key: randomUUID(), version: before.version });
  assert.deepEqual(reused.posts.map((p) => p.taskId), added.posts.map((p) => p.taskId));
  // 연결 작업: 목록엔 그대로(sameVisitOf), 행동 없음, 거기에 게시물을 더하면 409
  const linkedId = added.posts[0].taskId;
  const linked = await call<TaskInfo>('GET', `tasks/${linkedId}`);
  assert.deepEqual([linked.sameVisitOf, linked.allowedActions, linked.posts], [o.id, [], []]);
  const list = await call<{ items: Array<{ id: string }> }>('GET', `people/${f.person.id}/tasks?status=active`).catch(() => null);
  if (list) assert.ok(list.items.some((t) => t.id === linkedId));
  await rejects(call('POST', `tasks/${linkedId}/posts`, { key: randomUUID(), version: linked.version }), 'STATE_CHANGED', 409);
  // 취소된 원래 작업 — 409, 행동에도 없다
  assert.equal(await cancelTask(sql, o.id, { reason: 'other', note: '테스트', actorId: actor.id, today: base }), 'ok');
  const cancelled = await call<TaskInfo>('GET', `tasks/${o.id}`);
  assert.ok(!cancelled.allowedActions.includes('add_post'));
  await rejects(call('POST', `tasks/${o.id}/posts`, { key: randomUUID(), version: cancelled.version }), 'STATE_CHANGED', 409);
});

test('같은 방문: 연결 작업의 confirm-post는 원래 작업의 예약으로 확인하고 예약 상세(task.posts 갱신)를 돌려준다', async () => {
  base = kstToday();
  const f = await fixture('t');
  const created = await call<Detail>('POST', 'reservations', { key: randomUUID(), body: { locationId: f.locationId, sourceText: '', sheetText: sheet(f.handle, base),
    target: { kind: 'createTask', campaignId: f.campaign.id, personId: f.person.id } } });
  const originalId = created.taskId;
  // 방문 전에 게시물을 더해 둔다(웹 규칙: 게시 여부와 상관없이 더할 수 있다)
  const added = await call<TaskInfo>('POST', `tasks/${originalId}/posts`, { key: randomUUID(), version: created.task.version });
  const linkedId = added.posts[0].taskId;
  const linkedVersion = () => getTask(sql, linkedId).then((t) => t!.version!);
  // 방문 전 → 409
  await rejects(confirmVisitPost(sql, postRequest(`tasks/${linkedId}/confirm-post`, await linkedVersion()), actor, linkedId,
    { postUrl: `https://x.com/${f.handle}/status/${tweetIdNow(1)}` }, fakeFetch(f.handle)), 'STATE_CHANGED', 409);
  const confirmed = await call<Detail>('POST', `reservations/${created.id}/confirm`, { key: randomUUID(), version: created.version });
  const visited = await call<Detail>('POST', `tasks/${originalId}/complete-visit`, { key: randomUUID(), version: confirmed.task.version });
  assert.equal(visited.phase, 'visited');
  // 다른 사람 글 → 422(작성자 문구)
  await rejects(confirmVisitPost(sql, postRequest(`tasks/${linkedId}/confirm-post`, await linkedVersion()), actor, linkedId,
    { postUrl: `https://x.com/someone/status/${tweetIdNow(2)}` }, fakeFetch('someone_else')), 'INVALID_INPUT', 422);
  // 성공 — 응답은 원래 작업의 예약, task.posts[0]이 게시됨. 원래 작업은 그대로 '방문' 단계
  const result = await confirmVisitPost(sql, postRequest(`tasks/${linkedId}/confirm-post`, await linkedVersion()), actor, linkedId,
    { postUrl: `https://x.com/${f.handle}/status/${tweetIdNow(3)}` }, fakeFetch(f.handle)) as unknown as Detail & { task: TaskInfo };
  assert.equal(result.id, created.id);
  assert.equal(result.taskId, originalId);
  assert.equal(result.version, visited.version + 1);
  assert.equal(result.phase, 'visited');
  assert.equal(result.task.posts[0].taskId, linkedId);
  assert.ok(result.task.posts[0].postedAt);
  // 이미 게시된 연결 작업에 다시 → 409
  await rejects(confirmVisitPost(sql, postRequest(`tasks/${linkedId}/confirm-post`, await linkedVersion()), actor, linkedId,
    { postUrl: `https://x.com/${f.handle}/status/${tweetIdNow(4)}` }, fakeFetch(f.handle)), 'STATE_CHANGED', 409);
});

test('같은 방문: 원래 작업에 예약이 없으면 연결 작업 confirm-post는 409 RESERVATION_COMMAND_REQUIRED', async () => {
  base = kstToday();
  const f = await fixture('u');
  const [o] = await createTasks(sql, f.campaign.id, { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: actor.id,
    type: 'visit', items: [{ handle: f.handle, cost: null }] });
  const added = await call<TaskInfo>('POST', `tasks/${o.id}/posts`, { key: randomUUID(), version: o.version! });
  const linkedId = added.posts[0].taskId;
  await rejects(confirmVisitPost(sql, postRequest(`tasks/${linkedId}/confirm-post`, (await getTask(sql, linkedId))!.version!), actor, linkedId,
    { postUrl: `https://x.com/${f.handle}/status/${tweetIdNow(5)}` }, fakeFetch(f.handle)), 'RESERVATION_COMMAND_REQUIRED', 409);
});
