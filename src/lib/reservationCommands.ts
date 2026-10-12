import type postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import type { Member } from './types.ts';
import { isUuidLike } from './uuid.ts';
import { kstToday } from './datetime.ts';
import { readClientSheetInputs, updateClientSheetInput, validDateTime, formatReservationName, splitReservationName, type ClientSheetEditFields } from './reservationSheet.ts';
import { allowedVisitActions, applyDeadlineMode, checkCompleteVisit, checkEnd, checkStopForChangeLimit, planReservationSave,
  RESERVATION_END_KINDS, STOP_FOR_LIMIT_REASON, visitPhase, type ChangeReason, type DeadlineMode, type ReservationEndKind } from './reservationPolicy.ts';
import { expectVersion, jsonValue, objectBody, ProductError, productMissing, productOperation, textValue, versionHeader } from './productCommand.ts';
import { readReservation, reservationDetail, taskFact } from './reservationStore.ts';
import { logTaskDeclined, markTaskCancelled, updateTask } from './campaignTaskStore.ts';   // 한 방향 의존 — campaignTaskStore는 이 파일을 모른다
import { normalizeTargetTweetUrl, parseCancelBody, POST_URL_MESSAGE, type CancelReason } from './campaignTaskInput.ts';
import type { TaskType } from './campaignJudgment.ts';
import { attachFetchedPostToTask, AuthorRejected } from './postAttach.ts';
import { authorVerdictMessage } from './postAuthor.ts';
import { fetchPost } from './postMetrics.ts';
import { parseTweetLink } from './tweetLink.ts';
import { postedOnFromTweetLink } from './tweetPostedOn.ts';

const uuid = (v: unknown) => { if (typeof v !== 'string' || !isUuidLike(v)) throw productMissing(); return v; };
const policy = <T>(r: { ok: true; value: T } | { ok: false; code: string; message: string }): T => {
  if (!r.ok) throw new ProductError(r.code, r.message, r.code === 'STATE_CHANGED' || r.code === 'CHANGE_LIMIT_REACHED' ? 409 : 422);
  return r.value;
};
export async function lockReservationTask(sql: postgres.Sql, taskId: string) {
  const [task] = await sql<Array<{ id: string; type: string; version: number; campaign_id: string; influencer_handle: string | null }>>`
    select id, type, version, campaign_id, influencer_handle from campaign_task where id = ${taskId} for update`;
  if (!task || task.type !== 'visit') throw productMissing();
  return task;
}
function deadlineMode(body: Record<string, unknown>, previous: DeadlineMode): DeadlineMode {
  const mode = body.deadlineMode ?? previous;
  if (mode !== 'default' && mode !== 'manual') throw new ProductError('INVALID_INPUT', '업로드 기한의 적용 방식을 확인해 주세요.');
  return mode;
}
function checkedHandle(sheet: string, handle: string) {
  const entered = readClientSheetInputs(sheet).handle.replace(/^@+/, '');
  if (entered && entered.toLowerCase() !== handle.toLowerCase()) throw new ProductError('IDENTITY_MISMATCH', '기재 시트의 계정이 이 작업의 인플루언서와 달라요.', 422);
}
const EDIT_FIELDS: Record<string, keyof ClientSheetEditFields> = { visitAt: 'preferred', preferred: 'preferred', preferred2: 'preferred2',
  visitType: 'visitType', name: 'name', gender: 'gender', birthDate: 'birthDate', koreanAbility: 'koreanAbility', treatment: 'treatment', uploadDeadline: 'uploadDeadline' };
function editedSheet(body: Record<string, unknown>, previous: string): string {
  if (body.sheetText !== undefined && body.fieldEdits !== undefined) throw new ProductError('INVALID_INPUT', '기재 시트와 개별 항목 수정 중 한 가지로 저장해 주세요.');
  if (body.sheetText !== undefined) return textValue(body.sheetText, '기재 시트');
  if (body.fieldEdits === undefined) return previous;
  let sheet = previous;
  const edits = objectBody(body.fieldEdits);
  if ('romanizedName' in edits) {
    const names = splitReservationName(readClientSheetInputs(sheet).name);
    sheet = updateClientSheetInput(sheet, 'name', formatReservationName({ korean: 'name' in edits ? textValue(edits.name ?? '', '한글 이름') : names.korean,
      roman: textValue(edits.romanizedName ?? '', '로마자 이름') }));
  }
  for (const [key, raw] of Object.entries(edits)) {
    if (key === 'romanizedName' || key === 'name' && 'romanizedName' in edits) continue;
    const field = EDIT_FIELDS[key];
    if (!field) throw new ProductError('INVALID_INPUT', '수정할 예약 항목을 확인해 주세요.');
    let value = textValue(raw ?? '', '예약 항목', 10000);
    if (key === 'visitAt' && value && !validDateTime(value)) {
      if (!/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
        throw new ProductError('DATE_INVALID', '방문 날짜와 시간을 확인해 주세요.', 422);
      value = new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
    }
    if (/[\r\n]/.test(value)) throw new ProductError('INVALID_INPUT', '각 예약 항목은 한 줄로 입력해 주세요.');
    sheet = updateClientSheetInput(sheet, field, value);
  }
  return sheet;
}

export async function createReservation(sql: postgres.Sql, req: Request, actor: Member, raw: unknown) {
  const body = objectBody(raw), target = objectBody(body.target);
  const locationId = uuid(body.locationId), source = textValue(body.sourceText ?? '', '고객 응답'), finalSheet = textValue(body.sheetText, '기재 시트');
  return productOperation(sql, actor, req, body, async (tx, operationId) => {
    let taskId: string;
    if (target.kind === 'existingTask') taskId = uuid(target.taskId);
    else if (target.kind === 'createTask') {
      const campaignId = uuid(target.campaignId), personId = uuid(target.personId);
      const [person] = await tx<Array<{ handle: string }>>`select handle from influencer where id = ${personId}`;
      if (!person || !(await tx`select id from campaign where id = ${campaignId}`).length) throw productMissing();
      const [created] = await tx<Array<{ id: string }>>`insert into campaign_task (campaign_id, influencer_handle, type, created_by)
        values (${campaignId}, ${person.handle}, 'visit', ${actor.id}) returning id`;
      taskId = created.id;
    } else throw new ProductError('INVALID_INPUT', '예약을 연결할 작업을 선택해 주세요.');
    const task = await lockReservationTask(tx, taskId);
    if (target.kind === 'existingTask') {
      const expected = target.expectedTaskVersion ?? versionHeader(req);
      if (!Number.isInteger(expected)) throw new ProductError('VERSION_REQUIRED', '작업의 최신 내용을 불러와 주세요.', 428);
      expectVersion(task.version, expected as number);
    }
    // 중복 검사를 단계 판정보다 먼저 한다 — 예약이 붙은 작업은 단계가 대기·확정이라 add_reservation이 빠지는데, 그러면 원인이
    // 'STATE_CHANGED'로 뭉개져 handoff 문서·익스텐션 코드 목록의 RESERVATION_ALREADY_EXISTS가 영영 안 난다(통합 테스트 1이 확인한다).
    if ((await tx`select id from visit_reservation where task_id = ${taskId}`).length) throw new ProductError('RESERVATION_ALREADY_EXISTS', '이미 예약이 연결된 작업이에요.', 409);
    const { fact, personId } = await taskFact(tx, taskId);
    if (!personId || !task.influencer_handle) throw new ProductError('PERSON_REQUIRED', '등록된 인플루언서를 작업에 배정한 뒤 예약을 추가해 주세요.', 422);
    if (!allowedVisitActions(fact, fact.requestCount, kstToday()).includes('add_reservation')) throw new ProductError('STATE_CHANGED', '이 작업에는 예약을 추가할 수 없어요.', 409);
    const location = await tx`select l.id from clinic_location l join campaign c on c.client_id = l.client_id
      where l.id = ${locationId} and c.id = ${task.campaign_id}`;
    if (!location.length) throw new ProductError('LOCATION_MISMATCH', '이 캠페인의 클리닉 본점을 선택해 주세요.', 422);
    const mode = deadlineMode(body, 'default'), sheet = policy(applyDeadlineMode(finalSheet, mode));
    checkedHandle(sheet, task.influencer_handle);
    let revisionId: string | null = null;
    if (body.templateRevisionId != null) {
      revisionId = uuid(body.templateRevisionId);
      if (!(await tx`select id from clinic_template_revision where id = ${revisionId} and location_id = ${locationId} and kind = 'sheet'`).length)
        throw new ProductError('TEMPLATE_MISMATCH', '이 클리닉의 기재 시트 양식을 선택해 주세요.', 422);
    }
    const fields = readClientSheetInputs(sheet);
    const [saved] = await tx<Array<{ id: string }>>`insert into visit_reservation
      (task_id, location_id, source_text, sheet_text, fields, deadline_mode, create_operation_id, created_by, updated_by, template_revision_id)
      values (${taskId}, ${locationId}, ${source}, ${sheet}, ${tx.json(jsonValue(fields))}, ${mode}, ${operationId}, ${actor.id}, ${actor.id}, ${revisionId}) returning id`;
    // 업로드 기한은 날짜만 받는다 — 기한이 비면 063의 게시 시간도 함께 비운다(날짜 없는 시간은 표에 뜨지 않는다).
    await tx`update campaign_task set scheduled_on = ${fields.uploadDeadline || null}::date,
      scheduled_time = case when ${fields.uploadDeadline || null}::date is null then null else scheduled_time end,
      updated_at = now() where id = ${taskId}`;
    await tx`insert into reservation_change (reservation_id, event, reason, sheet_after, actor_id, actor_name, operation_id)
      values (${saved.id}, 'create', 'waiting_edit', ${sheet}, ${actor.id}, ${actor.name}, ${operationId})`;
    return reservationDetail(tx, saved.id, new URL(req.url).origin);
  });
}

export async function saveReservation(sql: postgres.Sql, req: Request, actor: Member, id: string, raw: unknown, confirm = false) {
  uuid(id); const body = objectBody(raw), expected = versionHeader(req);
  return productOperation(sql, actor, req, body, async (tx, operationId) => {
    const reference = await readReservation(tx, id);
    if (!reference) throw productMissing();
    const task = await lockReservationTask(tx, reference.taskId);
    const reservation = await readReservation(tx, id, true);
    if (!reservation) throw productMissing();
    expectVersion(reservation.version, expected);
    const { fact } = await taskFact(tx, task.id), today = kstToday();
    const mode = deadlineMode(body, reservation.deadlineMode);
    const plan = policy(planReservationSave({ phase: visitPhase(fact, today), requestCount: fact.requestCount,
      beforeSheet: reservation.sheetText, afterSheet: editedSheet(body, reservation.sheetText), deadlineMode: mode,
      reason: (body.reason ?? null) as ChangeReason | null, confirm }));
    // 개명 전 저장한 시트의 계정 표기는 기록으로 보존한다. 새 계정으로 임의 변경한 입력은 거부한다.
    if (readClientSheetInputs(plan.sheet).handle !== readClientSheetInputs(reservation.sheetText).handle)
      checkedHandle(plan.sheet, task.influencer_handle ?? '');
    if (!plan.differences.length && !confirm && mode === reservation.deadlineMode) return reservationDetail(tx, id, new URL(req.url).origin);
    await tx`update visit_reservation set sheet_text = ${plan.sheet}, fields = ${tx.json(jsonValue(readClientSheetInputs(plan.sheet)))},
      deadline_mode = ${mode}, confirmed_at = case when ${confirm} then now() else confirmed_at end,
      confirmed_by = case when ${confirm} then ${actor.id}::uuid else confirmed_by end,
      version = version + 1, updated_by = ${actor.id}, updated_at = now() where id = ${id}`;
    // 확정된 희망 일시를 작업의 방문일·방문 시간(063)에 함께 반영한다 — 표·작업 상세·익스텐션이 같은 값을 읽는다.
    const visitTime = plan.visitOn ? readClientSheetInputs(plan.sheet).preferred.slice(11, 16) || null : null;
    await tx`update campaign_task set scheduled_on = ${plan.scheduledOn}::date,
      scheduled_time = case when ${plan.scheduledOn}::date is null then null else scheduled_time end,
      visit_on = case when ${plan.visitOn !== undefined} then ${plan.visitOn ?? null}::date else visit_on end,
      visit_time = case when ${plan.visitOn !== undefined} then ${visitTime}::time else visit_time end,
      updated_at = now() where id = ${task.id}`;
    if (plan.differences.length || confirm) await tx`insert into reservation_change
      (reservation_id, event, reason, request_no, differences, sheet_before, sheet_after, actor_id, actor_name, operation_id)
      values (${id}, ${confirm ? 'confirm' : 'edit'}, ${plan.reason}, ${plan.countsAsRequest ? fact.requestCount + 1 : null},
      ${tx.json(jsonValue(plan.differences))}, ${reservation.sheetText}, ${plan.sheet}, ${actor.id}, ${actor.name}, ${operationId})`;
    return reservationDetail(tx, id, new URL(req.url).origin);
  });
}

// ─────────────────────────── 종료(취소·노쇼) ───────────────────────────
// 입력은 웹 작업 취소 창('진행 안 됨')과 같은 모양: 사유 칩(거절·무응답·기타, 선택) + 한 줄 메모(선택). 종료 종류는 서버가 단계로 정한다 —
// 취소 가능하면 '취소', 아니면 '업로드 노쇼'(방문했는데 진행이 안 됨), 그다음 방문일 당일만 가능한 '방문 노쇼'(parity 문서 D-3, 2026-10-07).
// kind는 선택 — 익스텐션이 '방문 노쇼'를 명시해야 할 때만 보낸다(결정 대기). 보내면 그 종류를 단계 규칙(checkEnd)으로 검증한다.
export interface EndTaskInput { reason: CancelReason | null; note: string; kind?: ReservationEndKind }
const CANCEL_REASON_TEXT: Record<CancelReason, string> = { declined: '거절', no_response: '무응답', other: '기타' };
export function parseEndBody(raw: unknown): EndTaskInput {
  const body = objectBody(raw), parsed = parseCancelBody(body);
  if (!parsed.ok) throw new ProductError('INVALID_INPUT', '취소 사유는 거절·무응답·기타 중에서 골라 주세요.');
  if (body.kind !== undefined && !RESERVATION_END_KINDS.includes(body.kind as ReservationEndKind)) throw new ProductError('INVALID_INPUT', '종료 종류를 확인해 주세요.');
  if (parsed.value.note.length > 3000) throw new ProductError('INVALID_INPUT', '메모는 3000자 안으로 적어 주세요.');
  return { ...parsed.value, kind: body.kind as ReservationEndKind | undefined };
}

// 작업 패널 [진행 안 됨](작업 취소 창, 웹)이 예약이 연결된 방문 작업을 취소할 때 — 일반 취소(cancelTask)는 reservationWriteGuard가 거절하므로
// 같은 창의 입력으로 /end와 같은 종료 명령을 돌린다. 예약 기록이 없는 작업이면 false — 호출한 쪽이 예전 취소를 그대로 한다.
// 버전·요청 번호는 여기서 만든다(화면은 작업 취소 창이라 모른다). 종류 판정은 명령 안(잠근 최신 행)에서 한다.
export async function endReservedTaskByCancel(sql: postgres.Sql, req: Request, actor: Member, taskId: string,
  input: { reason: CancelReason | null; note: string }): Promise<boolean> {
  const [schema] = await sql<Array<{ ready: boolean }>>`select to_regclass('visit_reservation') is not null as ready`;
  if (!schema.ready) return false;
  const [state] = await sql<Array<{ reserved: boolean; version: number | null }>>`select
    exists(select 1 from visit_reservation where task_id = ${taskId}) as reserved, (select version from campaign_task where id = ${taskId}) as version`;
  if (!state?.reserved || state.version === null) return false;
  const synthetic = new Request(req.url, { method: 'POST', headers: { 'if-match': `"${state.version}"`, 'idempotency-key': `cancel-${randomUUID()}` } });
  await visitTaskCommand(sql, synthetic, actor, taskId, { reason: input.reason, note: input.note }, 'end');
  return true;
}

export async function confirmVisitPost(sql: postgres.Sql, req: Request, actor: Member, taskId: string, raw: unknown) {
  uuid(taskId);
  const body = objectBody(raw), expected = versionHeader(req);
  const postUrl = normalizeTargetTweetUrl(textValue(body.postUrl, '게시물 링크', 2048).trim());
  const parsed = postUrl ? parseTweetLink(postUrl) : null;
  const postedAt = postUrl ? postedOnFromTweetLink(postUrl) : null;
  if (!postUrl || !parsed?.ok || !postedAt) throw new ProductError('INVALID_INPUT', POST_URL_MESSAGE, 422);
  // X 조회는 트랜잭션 밖에서 하고, 저장 직전 잠근 작업으로 단계·버전·작성자를 다시 판단한다.
  const fetched = await fetchPost(parsed.tweetId);
  if (fetched.kind === 'ok' && fetched.post.tweetId !== parsed.tweetId)
    throw new ProductError('INVALID_INPUT', '리포스트 링크예요. 인플루언서 본인의 게시물 링크를 입력해 주세요.', 422);
  try {
    return await productOperation(sql, actor, req, body, async (tx) => {
      const task = await lockReservationTask(tx, taskId);
      expectVersion(task.version, expected);
      const [reservation] = await tx<Array<{ id: string }>>`select id from visit_reservation where task_id = ${taskId} for update`;
      const { fact } = await taskFact(tx, taskId);
      if (!reservation || !allowedVisitActions(fact, fact.requestCount, kstToday()).includes('confirm_post'))
        throw new ProductError('STATE_CHANGED', '방문이 완료된 예약에서 게시를 확인할 수 있어요. 최신 상태를 확인해 주세요.', 409);
      if (!await updateTask(tx, taskId, { postUrl, postedAt, postedSource: 'manual' })) throw productMissing();
      await attachFetchedPostToTask(tx, taskId, fetched, actor.id);
      await tx`update visit_reservation set version = version + 1, updated_by = ${actor.id}, updated_at = now() where id = ${reservation.id}`;
      return reservationDetail(tx, reservation.id, new URL(req.url).origin);
    });
  } catch (e) {
    if (e instanceof AuthorRejected) throw new ProductError('INVALID_INPUT', authorVerdictMessage(e.verdict).error, 422);
    throw e;
  }
}

export async function visitTaskCommand(sql: postgres.Sql, req: Request, actor: Member, taskId: string, raw: unknown,
  command: 'end' | 'complete-visit' | 'stop-for-change-limit', reservationId?: string) {
  uuid(taskId); const body = objectBody(raw), expected = versionHeader(req);
  const endInput = command === 'end' ? parseEndBody(body) : null;   // 입력 모양은 트랜잭션 전에 거른다
  return productOperation(sql, actor, req, body, async (tx, operationId) => {
    const task = await lockReservationTask(tx, taskId);
    const rows = await tx<Array<{ id: string; version: number; sheet_text: string }>>`select id, version, sheet_text from visit_reservation where task_id = ${taskId} for update`;
    const reservation = rows[0];
    if (reservationId && reservation?.id !== reservationId) throw productMissing();
    expectVersion(command === 'stop-for-change-limit' ? reservation?.version ?? 0 : task.version, expected);
    const { fact } = await taskFact(tx, taskId), today = kstToday();
    const snapshot = () => tx.json(jsonValue({ visitOn: fact.visitOn, scheduledOn: fact.scheduledOn, cost: fact.cost, visitPhase: visitPhase(fact, today), visitCompletedAt: fact.visitCompletedAt }));
    if (command === 'complete-visit') {
      policy(checkCompleteVisit(fact, fact.requestCount, today));
      await tx`update campaign_task set visit_completed_at = now(), visit_completed_by = ${actor.id}, updated_at = now() where id = ${taskId}`;
    } else if (command === 'stop-for-change-limit') {
      policy(checkStopForChangeLimit(fact, fact.requestCount, today));
      if (!reservation) throw productMissing();
      await tx`insert into reservation_change (reservation_id, event, reason, request_no, sheet_before, sheet_after, actor_id, actor_name, operation_id)
        values (${reservation.id}, 'stop', 'customer_request', 4, ${reservation.sheet_text}, ${reservation.sheet_text}, ${actor.id}, ${actor.name}, ${operationId})`;
      await tx`insert into reservation_end (task_id, reservation_id, kind, reason, snapshot, ended_by, ended_by_name)
        values (${taskId}, ${reservation.id}, 'change_limit', ${STOP_FOR_LIMIT_REASON}, ${snapshot()}, ${actor.id}, ${actor.name})`;
      await tx`update campaign_task set cancelled_at = ${today}::date, cancel_reason = 'other', cancel_note = ${STOP_FOR_LIMIT_REASON}, updated_at = now() where id = ${taskId}`;
    } else {
      // 종료 = 웹 작업 취소와 같은 효과: 취소 컬럼(사유 칩·메모)·원고 떼기·거절/무응답 타임라인. 예약이 있으면 종료 기록(reservation_end)을 더해
      // 되돌릴 수 없게 하고, 예약 없는 방문 작업은 일반 취소와 똑같이 두어 되돌리기(restore)가 된다(reservationWriteGuard는 종료 기록만 본다).
      const input = endInput!, allowed = allowedVisitActions(fact, fact.requestCount, today);
      const reason = input.note || (input.reason ? CANCEL_REASON_TEXT[input.reason] : '') || '진행 안 됨';
      if (reservation) {
        const kind = input.kind ?? (allowed.includes('cancel') ? 'cancelled' : allowed.includes('upload_no_show') ? 'upload_no_show' : allowed.includes('visit_no_show') ? 'visit_no_show' : null);
        if (!kind) throw new ProductError('STATE_CHANGED', '지금 단계에서는 취소할 수 없어요. 예약 상세를 확인해 주세요.', 409);
        const end = policy(checkEnd(fact, fact.requestCount, kind, reason, today));
        await tx`insert into reservation_end (task_id, reservation_id, kind, reason, snapshot, ended_by, ended_by_name)
          values (${taskId}, ${reservation.id}, ${end.kind}, ${end.reason}, ${snapshot()}, ${actor.id}, ${actor.name})`;
      } else if (!allowed.includes('cancel') && !allowed.includes('upload_no_show')) {
        throw new ProductError('STATE_CHANGED', '지금 단계에서는 취소할 수 없어요. 작업 상태를 확인해 주세요.', 409);
      }
      if (!(await markTaskCancelled(tx, taskId, { reason: input.reason, note: input.note, today })))
        throw new ProductError('STATE_CHANGED', '이미 게시됐거나 취소된 작업이에요. 최신 내용을 확인해 주세요.', 409);
      if ((input.reason === 'declined' || input.reason === 'no_response') && task.influencer_handle) {
        await logTaskDeclined(tx, { handle: task.influencer_handle, taskId, campaignId: task.campaign_id, taskType: task.type as TaskType, reason: input.reason, action: 'cancel', actorId: actor.id });
      }
    }
    if (reservation) {
      await tx`update visit_reservation set version = version + 1, updated_by = ${actor.id}, updated_at = now() where id = ${reservation.id}`;
      return reservationDetail(tx, reservation.id, new URL(req.url).origin);
    }
    return { taskId, ...(await taskFact(tx, taskId)).fact };
  });
}
