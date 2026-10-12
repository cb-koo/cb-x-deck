import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedVisitActions,
  applyDeadlineMode,
  checkCompleteVisit,
  checkEnd,
  checkStopForChangeLimit,
  countCustomerRequests,
  planReservationSave,
  uploadWindow,
  visitPhase,
  type ReservationSaveInput,
  type VisitTaskFacts,
} from './reservationPolicy.ts';
import { createClientSheet, readClientSheetInputs, updateClientSheetInput } from './reservationSheet.ts';
import { kstToday } from './datetime.ts';

const SHEET = `${createClientSheet('hana_mozu', {
  preferred: '2026-10-28T16:00',
  visitType: '초진',
  name: '하나(Hana)',
  treatment: '울쎄라',
})}\n업로드 기한: 2026-11-11\n\n전달 메모: 동반자 1명은 상담만 진행합니다.`;

const facts = (over: Partial<VisitTaskFacts> = {}): VisitTaskFacts => ({
  endKind: null,
  cancelledAt: null,
  postedAt: null,
  noCost: false,
  settlement: null,
  visitCompletedAt: null,
  visitOn: null,
  reservation: { confirmed: false, visitAt: '2026-10-28T16:00' },
  ...over,
});
const confirmed = (over: Partial<VisitTaskFacts> = {}) =>
  facts({ reservation: { confirmed: true, visitAt: '2026-10-28T16:00' }, ...over });
const save = (over: Partial<ReservationSaveInput>): ReservationSaveInput => ({
  phase: 'waiting',
  requestCount: 0,
  beforeSheet: SHEET,
  afterSheet: SHEET,
  deadlineMode: 'default',
  reason: null,
  confirm: false,
  ...over,
});
const ok = <T>(r: { ok: true; value: T } | { ok: false; code: string }) => {
  if (!r.ok) assert.fail(`expected ok, got ${r.code}`);
  return r.value;
};
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code);

test('방문 단계: 종료 > 완료 > 정산 > 업로드 > 방문 > 확정 > 대기, 예약 없으면 예약 전', () => {
  const day = '2026-10-20';
  assert.equal(visitPhase(facts(), day), 'waiting');
  assert.equal(visitPhase(confirmed(), day), 'confirmed');
  assert.equal(visitPhase(facts({ reservation: null }), day), 'unregistered');
  assert.equal(visitPhase(confirmed({ postedAt: '2026-10-30' }), day), 'uploaded');
  assert.equal(visitPhase(confirmed({ postedAt: 'x', settlement: { status: 'requested', externalStatus: null } }), day), 'settling');
  assert.equal(visitPhase(confirmed({ postedAt: 'x', settlement: { status: 'requested', externalStatus: 'paid' } }), day), 'completed');
  // 그쪽이 취소한 정산 요청은 활성 아님 — 다시 업로드 단계
  assert.equal(visitPhase(confirmed({ postedAt: 'x', settlement: { status: 'requested', externalStatus: 'cancelled' } }), day), 'uploaded');
  assert.equal(visitPhase(confirmed({ postedAt: 'x', noCost: true }), day), 'completed');
  assert.equal(visitPhase(confirmed({ endKind: 'visit_no_show' }), day), 'visit_no_show');
  assert.equal(visitPhase(confirmed({ cancelledAt: '2026-10-01' }), day), 'cancelled');
  assert.equal(visitPhase(confirmed({ endKind: 'change_limit' }), day), 'cancelled');
});

test('금액 0·미등록은 무상이 아니다 — 비용 없음을 명시해야 게시 확인으로 완료된다', () => {
  assert.equal(visitPhase(confirmed({ postedAt: 'x', noCost: false }), '2026-10-30'), 'uploaded');
  assert.equal(visitPhase(confirmed({ postedAt: 'x', noCost: true }), '2026-10-30'), 'completed');
});

test('확정 방문일 다음 날 00:00(서울)에 방문으로 바뀌고, 대기는 날짜가 지나도 방문이 아니다', () => {
  const before = kstToday(() => Date.parse('2026-10-28T14:59:59.999Z'));   // 서울 10-28 23:59:59
  const after = kstToday(() => Date.parse('2026-10-28T15:00:00Z'));        // 서울 10-29 00:00
  assert.equal(visitPhase(confirmed(), before), 'confirmed');
  assert.equal(visitPhase(confirmed(), after), 'visited');
  assert.equal(visitPhase(facts(), after), 'waiting');
  // 수동 완료는 날짜와 무관하게 방문 — 이후 방문일을 미래로 고쳐도 수동 실적은 되돌리지 않는다
  assert.equal(visitPhase(confirmed({ visitCompletedAt: 'x', reservation: { confirmed: true, visitAt: '2026-12-01T10:00' } }), before), 'visited');
});

test('허용 행동: 대기·확정 전·방문 당일·방문 후·게시 후·종료를 구분한다', () => {
  assert.deepEqual(allowedVisitActions(facts(), 0, '2026-10-20'), ['edit_reservation', 'confirm', 'cancel', 'manage_consent']);
  assert.deepEqual(allowedVisitActions(confirmed(), 0, '2026-10-20'), ['edit_reservation', 'cancel', 'manage_consent']);
  assert.deepEqual(allowedVisitActions(confirmed(), 0, '2026-10-28'), [
    'edit_reservation', 'cancel', 'complete_visit', 'visit_no_show', 'manage_consent',
  ]);
  // 방문 후(날짜 경과·수동 완료)에는 게시 확인(confirm_post)이 열린다 — reservationCommands.confirmVisitPost가 이 값을 본다
  assert.deepEqual(allowedVisitActions(confirmed(), 0, '2026-10-29'), ['edit_reservation', 'confirm_post', 'visit_no_show', 'upload_no_show', 'manage_consent']);
  assert.deepEqual(allowedVisitActions(confirmed({ visitCompletedAt: 'x' }), 0, '2026-10-28'), ['edit_reservation', 'confirm_post', 'visit_no_show', 'upload_no_show', 'manage_consent']);
  assert.deepEqual(allowedVisitActions(confirmed({ postedAt: 'x' }), 0, '2026-10-29'), ['correct_reservation', 'manage_consent']);
  assert.deepEqual(allowedVisitActions(confirmed({ endKind: 'cancelled' }), 0, '2026-10-20'), []);
  assert.deepEqual(allowedVisitActions(confirmed({ postedAt: 'x', noCost: true }), 0, '2026-10-29'), ['manage_consent']);
});

test('예약 없는 기존 방문 작업: 예약 추가 + 방문 전이면 취소, 방문 기록이 지났으면 업로드 노쇼', () => {
  assert.deepEqual(allowedVisitActions(facts({ reservation: null, visitOn: '2026-10-25' }), 0, '2026-10-20'), ['add_reservation', 'cancel']);
  assert.deepEqual(allowedVisitActions(facts({ reservation: null, visitOn: '2026-10-25' }), 0, '2026-10-26'), ['add_reservation', 'upload_no_show']);
  assert.deepEqual(allowedVisitActions(facts({ reservation: null }), 0, '2026-10-26'), ['add_reservation', 'cancel']);
});

test('요청 횟수: customer_request 실제 변경만 세고 명시적 중단 기록은 회차에서 뺀다', () => {
  assert.equal(countCustomerRequests([
    { reason: 'waiting_edit', stopped: false },
    { reason: 'customer_request', stopped: false },
    { reason: 'correction', stopped: false },
    { reason: 'customer_request', stopped: false },
    { reason: 'customer_request', stopped: true },
  ]), 2);
});

test('업로드 기한: 방문 다음 날 1일차~14일차, 월·연·윤일 경계, 주말 포함', () => {
  assert.deepEqual(uploadWindow('2026-10-08T16:00'), { start: '2026-10-09', end: '2026-10-22' });
  assert.deepEqual(uploadWindow('2026-12-28T15:00'), { start: '2026-12-29', end: '2027-01-11' });
  assert.deepEqual(uploadWindow('2028-02-28T15:00'), { start: '2028-02-29', end: '2028-03-13' });
  assert.equal(uploadWindow('2026-02-30'), null);
  assert.equal(uploadWindow(''), null);
});

test('기본 기한은 방문일을 따라 연말을 넘어 갱신되고, 시트의 다른 줄은 그대로다', () => {
  const moved = updateClientSheetInput(SHEET, 'preferred', '2026-12-31T17:30');
  const next = ok(applyDeadlineMode(moved, 'default'));
  assert.equal(readClientSheetInputs(next).uploadDeadline, '2027-01-14');
  assert.equal(next, moved.replace('업로드 기한: 2026-11-11', '업로드 기한: 2027-01-14'));
});

test('직접 지정 기한은 유지하되 방문일보다 이르면 거부하고, 달력에 없는 날도 거부한다', () => {
  const later = updateClientSheetInput(SHEET, 'preferred', '2026-12-31T17:30');
  assert.equal(code(applyDeadlineMode(later, 'manual')), 'DEADLINE_BEFORE_VISIT');   // 2026-11-11 < 12-31 — 조용히 옮기지 않는다
  const kept = updateClientSheetInput(SHEET, 'uploadDeadline', '2026-11-20');
  assert.equal(ok(applyDeadlineMode(kept, 'manual')), kept);
  assert.equal(code(applyDeadlineMode(updateClientSheetInput(SHEET, 'uploadDeadline', '2026-02-30'), 'manual')), 'DATE_INVALID');
});

test('확정 전 수정·첫 확정은 사유 없이 waiting_edit이고 횟수에서 제외된다', () => {
  const edited = updateClientSheetInput(SHEET, 'treatment', '포텐자');
  const waitingSave = ok(planReservationSave(save({ afterSheet: edited, reason: 'customer_request' })));
  assert.equal(waitingSave.reason, 'waiting_edit');
  assert.equal(waitingSave.countsAsRequest, false);
  assert.equal(waitingSave.confirmed, false);
  assert.equal(waitingSave.visitOn, undefined);   // 대기는 기존 방문 기록을 건드리지 않는다
  const first = ok(planReservationSave(save({ afterSheet: edited, confirm: true })));
  assert.equal(first.reason, 'waiting_edit');
  assert.equal(first.countsAsRequest, false);
  assert.equal(first.confirmed, true);
  assert.equal(first.visitOn, '2026-10-28');
  assert.equal(first.differences[0].before, '울쎄라');
});

test('확정 후 저장은 사유가 필수이고, 여러 항목을 바꾼 한 번의 저장은 1회다', () => {
  assert.equal(code(planReservationSave(save({ phase: 'confirmed', reason: null }))), 'REASON_REQUIRED');
  assert.equal(code(planReservationSave(save({ phase: 'confirmed', reason: 'waiting_edit' }))), 'REASON_REQUIRED');
  const text = updateClientSheetInput(updateClientSheetInput(SHEET, 'preferred', '2026-10-31T17:00'), 'treatment', '리쥬란');
  const plan = ok(planReservationSave(save({ phase: 'confirmed', afterSheet: text, reason: 'customer_request' })));
  assert.equal(plan.countsAsRequest, true);
  assert.deepEqual(plan.differences.map((d) => d.field), ['preferred', 'uploadDeadline', 'treatment']);
  assert.equal(plan.scheduledOn, '2026-11-14');
  assert.equal(plan.visitOn, '2026-10-31');
  assert.match(plan.sheet, /전달 메모: 동반자 1명/);
});

test('형식만 다른 저장·무변경은 요청이 아니다', () => {
  const text = SHEET.split('\n').map((s) => `  ${s}  `).join('\r\n\r\n').replace('2026-10-28 16:00', '2026-10-28T16:00');
  const plan = ok(planReservationSave(save({ phase: 'confirmed', afterSheet: text, reason: 'customer_request' })));
  assert.deepEqual(plan.differences, []);
  assert.equal(plan.countsAsRequest, false);
});

test('3회 이후 고객 요청 변경은 거부하고 정정은 허용, 중단은 명시적 command로만', () => {
  const text = updateClientSheetInput(SHEET, 'treatment', '다른 시술');
  assert.equal(code(planReservationSave(save({ phase: 'confirmed', requestCount: 3, afterSheet: text, reason: 'customer_request' }))), 'CHANGE_LIMIT_REACHED');
  assert.equal(code(planReservationSave(save({ phase: 'confirmed', requestCount: 3, afterSheet: text, reason: 'correction' }))), 'ok');
  // 무변경 customer_request는 한도에 걸리지 않는다(새 요청이 아님)
  assert.equal(code(planReservationSave(save({ phase: 'confirmed', requestCount: 3, reason: 'customer_request' }))), 'ok');
  assert.equal(code(checkStopForChangeLimit(confirmed(), 2, '2026-10-20')), 'STATE_CHANGED');
  assert.equal(code(checkStopForChangeLimit(confirmed(), 3, '2026-10-20')), 'ok');
  assert.equal(code(checkStopForChangeLimit(confirmed({ endKind: 'cancelled' }), 3, '2026-10-20')), 'STATE_CHANGED');
});

test('게시 후에는 정정만, 완료·종료는 저장 불가, 확정은 대기에서만', () => {
  const text = updateClientSheetInput(SHEET, 'treatment', '다른 시술');
  assert.equal(code(planReservationSave(save({ phase: 'uploaded', afterSheet: text, reason: 'customer_request' }))), 'STATE_CHANGED');
  assert.equal(code(planReservationSave(save({ phase: 'settling', afterSheet: text, reason: 'correction' }))), 'ok');
  assert.equal(code(planReservationSave(save({ phase: 'completed', afterSheet: text, reason: 'correction' }))), 'STATE_CHANGED');
  assert.equal(code(planReservationSave(save({ phase: 'visit_no_show', afterSheet: text, reason: 'correction' }))), 'STATE_CHANGED');
  assert.equal(code(planReservationSave(save({ phase: 'confirmed', confirm: true }))), 'STATE_CHANGED');
});

test('올바르지 않은 일시·이름으로는 확정할 수 없고, 대기는 수동 저장할 수 있다', () => {
  const bad = updateClientSheetInput(SHEET, 'preferred', '2026-02-30T16:00');
  assert.equal(code(planReservationSave(save({ afterSheet: bad, confirm: true }))), 'CONFIRM_FIELDS_MISSING');
  const waiting = ok(planReservationSave(save({ afterSheet: bad })));
  assert.equal(waiting.confirmed, false);
  const noName = updateClientSheetInput(SHEET, 'name', '');
  assert.equal(code(planReservationSave(save({ afterSheet: noName, confirm: true }))), 'CONFIRM_FIELDS_MISSING');
});

test('종료: 방문일 기준으로 행동을 제한하고, 당일 체크를 놓쳐도 방문 이후에 방문 노쇼로 바꿀 수 있다', () => {
  assert.equal(code(checkEnd(confirmed(), 0, 'visit_no_show', '안 옴', '2026-10-28')), 'ok');
  assert.equal(code(checkEnd(confirmed(), 0, 'visit_no_show', '안 옴', '2026-10-29')), 'ok');
  assert.equal(code(checkEnd(confirmed({ visitCompletedAt: 'x' }), 0, 'visit_no_show', '안 옴', '2026-10-28')), 'ok');
  assert.equal(code(checkEnd(confirmed({ postedAt: 'x' }), 0, 'visit_no_show', '안 옴', '2026-10-29')), 'STATE_CHANGED');
  assert.equal(code(checkEnd(confirmed(), 0, 'cancelled', '사정', '2026-10-29')), 'STATE_CHANGED');
  assert.equal(code(checkEnd(confirmed(), 0, 'upload_no_show', '미게시', '2026-10-29')), 'ok');
  assert.equal(code(checkEnd(confirmed(), 0, 'cancelled', '   ', '2026-10-20')), 'REASON_REQUIRED_FOR_END');
  assert.equal(code(checkEnd(confirmed({ postedAt: 'x' }), 0, 'upload_no_show', '사유', '2026-11-30')), 'STATE_CHANGED');
  const end = checkEnd(facts(), 0, 'cancelled', '  일정 불가  ', '2026-10-20');
  assert.deepEqual(end, { ok: true, value: { kind: 'cancelled', reason: '일정 불가' } });
});

test('수동 방문 완료는 확정 방문일 당일(서울)에만', () => {
  assert.equal(code(checkCompleteVisit(confirmed(), 0, '2026-10-27')), 'STATE_CHANGED');
  assert.equal(code(checkCompleteVisit(confirmed(), 0, '2026-10-28')), 'ok');
  assert.equal(code(checkCompleteVisit(confirmed(), 0, '2026-10-29')), 'STATE_CHANGED');
  assert.equal(code(checkCompleteVisit(facts(), 0, '2026-10-28')), 'STATE_CHANGED');
});
