// 방문 예약의 순수 판정 — 방문 단계·허용 행동·요청 횟수·업로드 기한·저장 검증·종료 검증.
// 웹 화면, 웹 API, 익스텐션 API(/api/extension/v1)가 모두 이 함수로 판정한다(API 계획 §2·§3).
// 서버 command는 트랜잭션 안에서 최신 행으로 이 판정을 다시 돌린다 — 화면의 allowedActions는 안내용일 뿐이다.
//
// 규칙의 출처: 승인된 목업(src/app/mockup/x-extension/policy.ts). 목업의 DemoTask·문자열 금액·샘플 공휴일은
// 옮기지 않고, 운영 행(campaign_task + visit_reservation + reservation_end + 정산 요청)에서 뽑은 사실만 받는다.
// DB 접근 없음. '오늘'은 서울 날짜(kstToday())를 인자로 받아 자정 경계를 테스트가 결정적으로 검증한다.
import { isDateOnlyString, type FlowSettlementInput } from './campaignJudgment.ts';
import {
  readClientSheet,
  readClientSheetInputs,
  sheetDifferences,
  updateClientSheetInput,
  type SheetDifference,
} from './reservationSheet.ts';

export const CHANGE_REQUEST_LIMIT = 3;
export const UPLOAD_DEADLINE_DAYS = 14;

export type ReservationEndKind = 'cancelled' | 'visit_no_show' | 'upload_no_show';
export const RESERVATION_END_KINDS: readonly ReservationEndKind[] = ['cancelled', 'visit_no_show', 'upload_no_show'];
// 저장된 종료 종류(reservation_end.kind). change_limit = 3회 초과 후 명시적 중단 — 단계로는 취소다.
export type StoredEndKind = ReservationEndKind | 'change_limit';
export type ChangeReason = 'waiting_edit' | 'customer_request' | 'correction';
export type DeadlineMode = 'default' | 'manual';

// 방문 단계는 공통 6단계(flowStage)와 별개다. 원고 상태는 조건에 쓰지 않는다.
export type VisitPhase =
  | 'unregistered'
  | 'waiting'
  | 'confirmed'
  | 'visited'
  | 'uploaded'
  | 'settling'
  | 'completed'
  | ReservationEndKind;
export const VISIT_PHASE_LABEL: Record<VisitPhase, string> = {
  unregistered: '예약 전',
  waiting: '대기',
  confirmed: '확정',
  visited: '방문',
  uploaded: '업로드',
  settling: '정산',
  completed: '완료',
  cancelled: '취소',
  visit_no_show: '방문 노쇼',
  upload_no_show: '업로드 노쇼',
};

export type VisitAction =
  | 'add_reservation'
  | 'edit_reservation'      // 확정 전: 사유 없이 / 확정 후: customer_request·correction
  | 'correct_reservation'   // 게시 이후: correction만
  | 'confirm'
  | 'cancel'
  | 'complete_visit'
  | 'confirm_post'
  | 'visit_no_show'
  | 'upload_no_show'
  | 'manage_consent'
  | 'stop_for_change_limit';

// 판정에 필요한 사실만. 모두 저장된 값에서 뽑는다 — 클라이언트가 보낸 phase·count·paid는 받지 않는다(API 계획 §6).
export interface VisitTaskFacts {
  endKind: StoredEndKind | null;                // 활성 reservation_end
  cancelledAt: string | null;                   // 기존 작업 취소(055). 예약 종료가 없어도 취소면 종료로 본다
  postedAt: string | null;
  noCost: boolean;
  settlement: FlowSettlementInput | null;       // flowStage와 같은 입력
  visitCompletedAt: string | null;              // 수동 방문 완료
  visitOn: string | null;                       // 예약 없는 기존 방문 기록(레거시)
  reservation: { confirmed: boolean; visitAt: string } | null;   // visitAt = 시트의 희망 일시(서울 'YYYY-MM-DDTHH:mm', 없으면 '')
}

const isPaid = (s: FlowSettlementInput | null) => s?.status === 'requested' && s.externalStatus === 'paid';
export const hasActiveSettlement = (s: FlowSettlementInput | null) =>
  s?.status === 'requested' && s.externalStatus !== 'cancelled' && s.externalStatus !== 'paid';

const visitDateOf = (visitAt: string) => visitAt.slice(0, 10);

// 우선순위(API 계획 §2): 종료 > 완료 > 정산 > 업로드 > (예약 없음) > 방문 > 확정 > 대기.
// 확정 방문일 다음 날 00:00(서울)부터 방문으로 본다 — 조회·command 때 서버 날짜로 파생하므로 브라우저가 닫혀 있어도 맞다.
export function visitPhase(f: VisitTaskFacts, today: string): VisitPhase {
  if (f.endKind) return f.endKind === 'change_limit' ? 'cancelled' : f.endKind;
  if (f.cancelledAt) return 'cancelled';
  if (isPaid(f.settlement) || (f.postedAt && f.noCost)) return 'completed';
  if (hasActiveSettlement(f.settlement)) return 'settling';
  if (f.postedAt) return 'uploaded';
  const r = f.reservation;
  if (!r) return 'unregistered';
  if (f.visitCompletedAt) return 'visited';
  if (r.confirmed && r.visitAt && visitDateOf(r.visitAt) < today) return 'visited';
  return r.confirmed ? 'confirmed' : 'waiting';
}

// 예약 없는 기존 방문 작업의 방문 여부 — 기존 taskStage('visited')와 같은 기준에 수동 완료를 더한다.
const legacyVisited = (f: VisitTaskFacts, today: string) =>
  !!f.visitCompletedAt || (f.visitOn !== null && f.visitOn < today);

export const ENDED_PHASES: readonly VisitPhase[] = ['completed', 'cancelled', 'visit_no_show', 'upload_no_show'];

export function allowedVisitActions(f: VisitTaskFacts, requestCount: number, today: string): VisitAction[] {
  const phase = visitPhase(f, today);
  const limitReached = requestCount >= CHANGE_REQUEST_LIMIT;
  const withStop = (actions: VisitAction[]): VisitAction[] =>
    limitReached ? [...actions, 'stop_for_change_limit'] : actions;
  switch (phase) {
    case 'unregistered':
      return legacyVisited(f, today) ? ['add_reservation', 'upload_no_show'] : ['add_reservation', 'cancel'];
    case 'waiting':
      return withStop(['edit_reservation', 'confirm', 'cancel']);
    case 'confirmed': {
      const visitDay = !!f.reservation && visitDateOf(f.reservation.visitAt) === today;
      return withStop([
        'edit_reservation',
        'cancel',
        ...(visitDay ? (['complete_visit', 'visit_no_show'] as const) : []),
        'manage_consent',
      ]);
    }
    // 방문일 당일에 노쇼를 체크하지 못할 수 있어, 방문 이후(수동 방문 완료 포함)에도 방문 노쇼로 바꿀 수 있다.
    case 'visited':
      return withStop(['edit_reservation', 'confirm_post', 'visit_no_show', 'upload_no_show', 'manage_consent']);
    case 'uploaded':
    case 'settling':
      return ['correct_reservation', 'manage_consent'];
    default:
      return [];
  }
}

// ─────────────────────────── 요청 횟수 ───────────────────────────
// 확정 후 customer_request의 실제 변경 저장 1건 = 1회. 확정 전 수정·첫 확정·정정·무변경은 제외.
// 명시적 4번째 중단 기록(stopped)은 요청 기록이지만 변경이 적용되지 않았으므로 회차 계산에서 뺀다.
// 저장 행에서는 stopped = (reservation_change.event === 'stop').
export function countCustomerRequests(changes: readonly { reason: ChangeReason; stopped: boolean }[]): number {
  return changes.filter((c) => c.reason === 'customer_request' && !c.stopped).length;
}

// ─────────────────────────── 업로드 기한 ───────────────────────────
// 방문 다음 날이 1일차, 14일차까지. 영업일 계산 아님(주말·공휴일 포함). 2026-12-28 → 2027-01-11.
export function uploadWindow(visitAtOrDate: string): { start: string; end: string } | null {
  const day = visitAtOrDate.slice(0, 10);
  if (!isDateOnlyString(day)) return null;
  const shift = (n: number) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return { start: shift(1), end: shift(UPLOAD_DEADLINE_DAYS) };
}
export const defaultUploadDeadline = (visitAt: string) => uploadWindow(visitAt)?.end ?? '';

// ─────────────────────────── 저장 검증 ───────────────────────────
export type ReservationPolicyCode =
  | 'STATE_CHANGED'           // 409: 지금 단계에서 허용되지 않는 저장(종료·완료·게시 후 일반 수정 등)
  | 'REASON_REQUIRED'         // 400: 확정 후 저장에 사유가 없음
  | 'DATE_INVALID'            // 422: 기한이 달력에 없는 날
  | 'DEADLINE_BEFORE_VISIT'   // 422: 기한이 방문일보다 이름 — 조용히 옮기지 않고 다시 확인
  | 'CONFIRM_FIELDS_MISSING'  // 422: 확정·확정 후 저장에는 올바른 희망 일시와 이름이 필요
  | 'CHANGE_LIMIT_REACHED'    // 409: 3회 이후의 고객 요청 변경 — 명시적 중단으로 안내
  | 'REASON_REQUIRED_FOR_END';// 400: 종료 사유 없음
export const RESERVATION_POLICY_MESSAGE: Record<ReservationPolicyCode, string> = {
  STATE_CHANGED: '예약 상태가 바뀌었어요. 최신 내용을 확인한 뒤 현재 단계에 맞는 처리를 선택해 주세요.',
  REASON_REQUIRED: '예약이 확정됐어요. 수정 사유(고객 요청·정정)를 선택한 뒤 다시 저장해 주세요.',
  DATE_INVALID: '업로드 기한을 올바른 날짜로 입력해 주세요.',
  DEADLINE_BEFORE_VISIT: '업로드 기한이 방문일보다 빨라요. 기한을 다시 확인하거나 기본 기한(방문 후 14일)으로 되돌려 주세요.',
  CONFIRM_FIELDS_MISSING: '확정하려면 올바른 희망 날짜·시간과 이름을 입력해 주세요.',
  CHANGE_LIMIT_REACHED: '고객 요청 변경은 3회까지예요. 추가 요청은 협찬 중단으로 기록해 주세요.',
  REASON_REQUIRED_FOR_END: '종료 사유를 입력해 주세요.',
};
export type PolicyResult<T> = { ok: true; value: T } | { ok: false; code: ReservationPolicyCode; message: string };
const fail = (code: ReservationPolicyCode): { ok: false; code: ReservationPolicyCode; message: string } => ({
  ok: false,
  code,
  message: RESERVATION_POLICY_MESSAGE[code],
});

export interface ReservationSaveInput {
  phase: VisitPhase;            // 잠근 최신 행으로 계산한 현재 단계
  requestCount: number;         // 잠근 최신 이력으로 센 회차
  beforeSheet: string;          // 저장돼 있던 최종 시트
  afterSheet: string;           // 제안된 최종 시트(전체 저장이든 fieldEdits 적용 결과든)
  deadlineMode: DeadlineMode;   // 저장 후의 기한 방식
  reason: ChangeReason | null;  // 클라이언트가 고른 사유. 확정 전에는 무시하고 서버가 waiting_edit로 정한다
  confirm: boolean;             // confirm command
}
export interface ReservationSavePlan {
  sheet: string;                 // 저장할 최종 시트(기본 기한이면 기한 줄이 방문일을 따라 갱신됨)
  differences: SheetDifference[]; // 빈 배열 = 무변경(이력·횟수·version 증가 없음)
  reason: ChangeReason;
  countsAsRequest: boolean;
  confirmed: boolean;            // 저장 후 확정 여부
  visitAt: string;               // 시트에서 검증한 희망 일시('' 가능 — 대기만)
  visitOn: string | undefined;   // campaign_task.visit_on projection. undefined = 바꾸지 않음(대기는 기존 기록 유지)
  scheduledOn: string | null;    // campaign_task.scheduled_on = 업로드 기한
}

// 시트의 기한 줄을 기한 방식에 맞춘다. default = 방문일+14일로 갱신, manual = 담당자가 정한 날짜 유지(검증만).
export function applyDeadlineMode(sheet: string, mode: DeadlineMode): PolicyResult<string> {
  const visitAt = readClientSheet(sheet).preferred;
  if (mode === 'default') return { ok: true, value: updateClientSheetInput(sheet, 'uploadDeadline', defaultUploadDeadline(visitAt)) };
  const deadline = readClientSheetInputs(sheet).uploadDeadline;
  if (!isDateOnlyString(deadline)) return fail('DATE_INVALID');
  if (visitAt && deadline < visitAt.slice(0, 10)) return fail('DEADLINE_BEFORE_VISIT');
  return { ok: true, value: sheet };
}

const EDITABLE_PHASES: readonly VisitPhase[] = ['waiting', 'confirmed', 'visited'];
const CORRECTION_ONLY_PHASES: readonly VisitPhase[] = ['uploaded', 'settling'];

export function planReservationSave(input: ReservationSaveInput): PolicyResult<ReservationSavePlan> {
  const wasConfirmed = input.phase !== 'waiting';
  if (input.confirm) {
    if (input.phase !== 'waiting') return fail('STATE_CHANGED');
  } else if (CORRECTION_ONLY_PHASES.includes(input.phase)) {
    if (input.reason !== 'correction') return fail('STATE_CHANGED');
  } else if (!EDITABLE_PHASES.includes(input.phase)) {
    return fail('STATE_CHANGED');
  }

  // 확정 전 수정·첫 확정은 사유 없이 waiting_edit — 횟수 제외(최신 웹 규칙, 결정 목록 '확정 전 횟수').
  let reason: ChangeReason = 'waiting_edit';
  if (wasConfirmed) {
    if (input.reason !== 'customer_request' && input.reason !== 'correction') return fail('REASON_REQUIRED');
    reason = input.reason;
  }

  const scheduled = applyDeadlineMode(input.afterSheet, input.deadlineMode);
  if (!scheduled.ok) return scheduled;
  const sheet = scheduled.value;

  const differences = sheetDifferences(input.beforeSheet, sheet);
  const countsAsRequest = reason === 'customer_request' && differences.length > 0;
  if (countsAsRequest && input.requestCount >= CHANGE_REQUEST_LIMIT) return fail('CHANGE_LIMIT_REACHED');

  const fields = readClientSheet(sheet);
  const confirmed = input.confirm || wasConfirmed;
  if (confirmed && (!fields.preferred || !fields.name)) return fail('CONFIRM_FIELDS_MISSING');

  const deadline = readClientSheetInputs(sheet).uploadDeadline;
  return {
    ok: true,
    value: {
      sheet,
      differences,
      reason,
      countsAsRequest,
      confirmed,
      visitAt: fields.preferred,
      visitOn: confirmed ? fields.preferred.slice(0, 10) : undefined,
      scheduledOn: isDateOnlyString(deadline) ? deadline : null,
    },
  };
}

// ─────────────────────────── 종료 ───────────────────────────
// 오래 열린 종료창의 자정 경합: command 시각의 서울 날짜로 허용 행동을 다시 계산해 거부한다.
const END_ACTION: Record<ReservationEndKind, VisitAction> = {
  cancelled: 'cancel',
  visit_no_show: 'visit_no_show',
  upload_no_show: 'upload_no_show',
};
export function checkEnd(
  f: VisitTaskFacts,
  requestCount: number,
  kind: ReservationEndKind,
  reason: string,
  today: string,
): PolicyResult<{ kind: ReservationEndKind; reason: string }> {
  if (!allowedVisitActions(f, requestCount, today).includes(END_ACTION[kind])) return fail('STATE_CHANGED');
  if (!reason.trim()) return fail('REASON_REQUIRED_FOR_END');
  return { ok: true, value: { kind, reason: reason.trim() } };
}

export const STOP_FOR_LIMIT_REASON = '예약 변경 횟수 초과로 협찬 중단';
export function checkStopForChangeLimit(f: VisitTaskFacts, requestCount: number, today: string): PolicyResult<null> {
  return allowedVisitActions(f, requestCount, today).includes('stop_for_change_limit')
    ? { ok: true, value: null }
    : fail('STATE_CHANGED');
}

export function checkCompleteVisit(f: VisitTaskFacts, requestCount: number, today: string): PolicyResult<null> {
  return allowedVisitActions(f, requestCount, today).includes('complete_visit')
    ? { ok: true, value: null }
    : fail('STATE_CHANGED');
}
