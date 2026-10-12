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
import { createTasks, getTask, updateTask, deleteTask, restoreTask } from './campaignTaskStore.ts';
import { extensionProductDispatch } from './extensionProductApi.ts';
import { ProductError } from './productCommand.ts';
import { createClientSheet, readClientSheetInputs } from './reservationSheet.ts';
import { kstToday } from './datetime.ts';
import type { Member } from './types.ts';

// 쓰기 경로는 운영 플래그(또는 개발 환경)로 열린다(productFeatures). 테스트 프로세스는 둘 다 아니므로 여기서 켠다 — 값은 호출 시점에 읽는다.
process.env.EXTENSION_PRODUCT_ENABLED = 'true';

const sql = getSql();
const P = 'trsv' + process.pid;   // 핸들은 15자 제한 — 'trsv' + pid(5자리) + 접미어 4자
const ORIGIN = 'http://127.0.0.1:3000';

after(async () => {
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
  return { client, locationId: location.id, campaign, handle, person };
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
