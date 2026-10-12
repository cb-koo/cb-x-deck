import type { Branch, Campaign, DemoTask, Difference, Reason, ReservationEndKind, Stage } from './model';
import { TYPE_LABEL } from './model';
import { FLOW_STAGE_LABEL } from '@/lib/campaignJudgment';
import {
  readClientSheet,
  readClientSheetInputs,
  updateClientSheetInput,
  type ClientSheetEditFields,
} from './sheet';
export const LIMIT = 3;
export const normalize = (s: string) =>
  s
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/(\d{4}-\d{2}-\d{2})T(?=\d{2}:\d{2})/g, '$1 ');
export const requestCount = (t: DemoTask) =>
  t.reservation?.history.filter((h) => h.reason === 'customer_request').length ?? 0;
export const completed = (t: DemoTask) => !t.end && t.posted && (t.noCost || t.paid);
export const bucket = (t: DemoTask) => (t.end ? 'ended' : completed(t) ? 'done' : 'active');
export const settlementCandidate = (t: DemoTask) =>
  !t.end && t.posted && !t.noCost && !t.paid && !t.settlementActive;
export function stage(t: DemoTask): Stage {
  if (t.end) return t.end.kind;
  if (completed(t)) return '완료';
  if (t.settlementActive) return '정산';
  if (t.posted) return '업로드';
  if (t.visited) return '방문';
  return t.reservation?.phase === 'confirmed' ? '확정' : '대기';
}
export function commonFlow(t: DemoTask) {
  if (t.end) return 'canc';
  if (completed(t)) return 'done';
  if (t.settlementActive) return 'settle';
  if (t.posted) return 'posted';
  return t.flow;
}
export const taskStatus = (t: DemoTask) => (t.type === 'visit' ? stage(t) : FLOW_STAGE_LABEL[commonFlow(t)]);
// 캠페인 기간 상태와 작업 진행 상태는 별도로 표시한다. 종료 작업은 기록에 남기고 비용에서 제외한다.
export function participatingCampaigns(campaigns: Campaign[], tasks: DemoTask[], personId: string) {
  return campaigns
    .flatMap((campaign) => {
      const own = tasks.filter((t) => t.personId === personId && t.campaignId === campaign.id);
      if (!own.length) return [];
      const assigned = own.filter((t) => !t.end);
      const totals = new Map<DemoTask['currency'], number>();
      let missing = 0;
      for (const task of assigned) {
        if (task.noCost) continue;
        if (!task.amount.trim()) missing += 1;
        else totals.set(task.currency, (totals.get(task.currency) ?? 0) + Number(task.amount));
      }
      const amounts = [...totals].map(([currency, amount]) => money(String(amount), currency));
      if (missing) amounts.push(`금액 미등록 ${missing}건`);
      return [
        {
          campaign,
          tasks: own,
          taskCount: assigned.length,
          endedCount: own.length - assigned.length,
          typeSummary: (Object.keys(TYPE_LABEL) as DemoTask['type'][])
            .flatMap((type) => {
              const count = assigned.filter((t) => t.type === type).length;
              return count ? [`${TYPE_LABEL[type]} ${count}`] : [];
            })
            .join(' · '),
          subtotal: amounts.join(' · ') || (assigned.length ? '비용 없음' : '—'),
        },
      ];
    })
    .sort((a, b) => b.campaign.startsOn.localeCompare(a.campaign.startsOn));
}
// The saved sheet is the only source of the reservation datetime.
export const preferredAt = (t: DemoTask) =>
  t.reservation ? readClientSheet(t.reservation.sheet).preferred : '';
export const visitSchedule = (t: DemoTask) => {
  const preferred = preferredAt(t);
  if (preferred) return dateTime(preferred);
  return t.visitOn ? `${t.visitOn} · 시간 미정` : '희망 일시 미입력';
};
const DAY_MS = 24 * 60 * 60 * 1000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
export const koreanDay = (now: number) => new Date(now + KOREA_OFFSET_MS).toISOString().slice(0, 10);
export const nextKoreanMidnight = (now: number) => Date.parse(`${koreanDay(now)}T00:00:00+09:00`) + DAY_MS;
const awaitingVisit = (t: DemoTask) =>
  t.type === 'visit' && t.reservation?.phase === 'confirmed' && !t.end && !t.visited && !t.posted;
export const canCompleteVisit = (t: DemoTask, now: number) =>
  awaitingVisit(t) && preferredAt(t).slice(0, 10) === koreanDay(now);
export function applyAutomaticVisit(t: DemoTask, now: number): DemoTask {
  const preferred = preferredAt(t);
  if (!awaitingVisit(t) || !preferred || preferred.slice(0, 10) >= koreanDay(now)) return t;
  return { ...t, visited: true };
}
type ReservationActions = {
  confirm: boolean;
  cancel: boolean;
  completeVisit: boolean;
  noShow: Exclude<ReservationEndKind, '취소'> | null;
};
export function reservationActions(task: DemoTask, now: number | null): ReservationActions {
  const t = now === null ? task : applyAutomaticVisit(task, now);
  const actions: ReservationActions = { confirm: false, cancel: false, completeVisit: false, noShow: null };
  if (t.type !== 'visit' || t.end || t.posted || t.settlementActive) return actions;
  if (t.visited) return { ...actions, noShow: '업로드 노쇼' };
  if (!t.reservation) return { ...actions, cancel: true };
  if (t.reservation.phase === 'waiting') return { ...actions, confirm: true, cancel: true };
  const today = now !== null && canCompleteVisit(t, now);
  return { ...actions, cancel: true, completeVisit: today, noShow: today ? '노쇼' : null };
}
export function canEndReservation(task: DemoTask, kind: ReservationEndKind, now: number | null) {
  const actions = reservationActions(task, now);
  return kind === '취소' ? actions.cancel : actions.noShow === kind;
}
export function endReservation(
  task: DemoTask,
  kind: ReservationEndKind,
  reason: string,
  now: number,
): DemoTask {
  if (!canEndReservation(task, kind, now))
    throw new Error('예약 상태가 바뀌었어요. 돌아가서 현재 상태에 맞는 처리를 선택해 주세요.');
  if (!reason.trim()) throw new Error('종료 사유를 입력해 주세요.');
  return {
    ...applyAutomaticVisit(task, now),
    end: { kind, reason: reason.trim(), at: new Date(now).toISOString() },
  };
}
export function uploadWindow(value: string) {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  const shift = (n: number) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return { start: shift(1), end: shift(14) };
}
const fields: [keyof ClientSheetEditFields, string][] = [
  ['preferred', '희망 일시'],
  ['uploadDeadline', '업로드 기한'],
  ['preferred2', '제2희망 일시'],
  ['treatment', '시술'],
  ['name', '이름'],
  ['visitType', '초진/재진'],
  ['gender', '성별'],
  ['birthDate', '생년월일'],
  ['koreanAbility', '한국어 가능 여부'],
  ['handle', 'X 계정'],
  ['profileUrl', '프로필 링크'],
];
export function differences(before: string, after: string): Difference[] {
  if (normalize(before) === normalize(after)) return [];
  const a = readClientSheetInputs(before),
    b = readClientSheetInputs(after);
  let explained = before;
  const result: Difference[] = [];
  for (const [field, label] of fields) {
    if (a[field] === b[field]) continue;
    result.push({ field, label, before: a[field], after: b[field] });
    explained = updateClientSheetInput(explained, field, b[field]);
  }
  if (normalize(explained) !== normalize(after))
    result.push({ field: 'sheet', label: '기재 시트 추가 문구', before, after });
  return result;
}
// Calendar, reservation form and client sheet share the same saved dates.
// A manually chosen deadline survives a visit change; the default follows the visit by 14 days.
export function reservationScheduleSheet(sheet: string, previousSheet?: string) {
  const next = readClientSheetInputs(sheet);
  const previous = previousSheet === undefined ? null : readClientSheetInputs(previousSheet);
  const defaultDeadline = uploadWindow(next.preferred)?.end ?? '';
  const followsVisit =
    previous &&
    next.preferred !== previous.preferred &&
    next.uploadDeadline === previous.uploadDeadline &&
    previous.uploadDeadline === uploadWindow(previous.preferred)?.end;
  return !next.uploadDeadline || followsVisit
    ? updateClientSheetInput(sheet, 'uploadDeadline', defaultDeadline)
    : sheet;
}
export function updateReservationInput(sheet: string, key: keyof ClientSheetEditFields, value: string) {
  const next = updateClientSheetInput(sheet, key, value);
  return key === 'preferred' ? reservationScheduleSheet(next, sheet) : next;
}
export function saveReservation(task: DemoTask, sheet: string, reason: Reason, confirm = false): DemoTask {
  const r = task.reservation;
  if (!r || task.end || completed(task)) throw new Error('종료된 기록은 수정할 수 없어요.');
  const editReason = r.phase === 'waiting' ? 'waiting_edit' : reason;
  if (r.phase === 'confirmed' && editReason === 'waiting_edit')
    throw new Error('예약이 확정됐어요. 수정 사유를 선택한 뒤 다시 저장해 주세요.');
  sheet = reservationScheduleSheet(sheet, r.sheet);
  const deadline = readClientSheetInputs(sheet).uploadDeadline;
  const preferred = readClientSheet(sheet).preferred;
  if (
    deadline &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
      !uploadWindow(deadline) ||
      (preferred && deadline < preferred.slice(0, 10)))
  )
    throw new Error('업로드 기한은 방문일 이후의 올바른 날짜로 선택해 주세요.');
  const diff = differences(r.sheet, sheet);
  if (diff.length && editReason === 'customer_request' && requestCount(task) >= LIMIT)
    throw new Error('3회를 초과한 요청은 협찬 중단으로 기록해 주세요.');
  const fields = readClientSheet(sheet);
  if ((confirm || r.phase === 'confirmed') && (!fields.preferred || !fields.name))
    throw new Error('확정하려면 올바른 희망 날짜·시간과 이름을 입력해 주세요.');
  const confirmed = confirm || r.phase === 'confirmed';
  return {
    ...task,
    visitOn: confirmed ? fields.preferred.slice(0, 10) : task.visitOn,
    scheduledOn: deadline,
    reservation: {
      ...r,
      sheet,
      phase: confirmed ? 'confirmed' : 'waiting',
      history: diff.length
        ? [
            ...r.history,
            { id: crypto.randomUUID(), reason: editReason, at: new Date().toISOString(), differences: diff },
          ]
        : r.history,
    },
  };
}
export function stopForLimit(task: DemoTask): DemoTask {
  if (!task.reservation || task.end || completed(task) || requestCount(task) < LIMIT) return task;
  const at = new Date().toISOString();
  return {
    ...task,
    end: { kind: '취소', reason: '예약 변경 횟수 초과로 협찬 중단', at },
    reservation: {
      ...task.reservation,
      history: [
        ...task.reservation.history,
        { id: crypto.randomUUID(), reason: 'customer_request', at, stopped: true },
      ],
    },
  };
}
export const money = (amount: string, currency: string, noCost = false) =>
  noCost
    ? '비용 없음'
    : amount === ''
      ? '미등록'
      : `${Number(amount).toLocaleString('ko-KR')} ${currency === 'JPY' ? '엔' : '원'}`;
export const validAmount = (s: string) => s === '' || (/^\d+$/.test(s) && Number.isSafeInteger(Number(s)));
export const dateTime = (s: string) => (s ? s.replace('T', ' ') : '미입력');
export const changedAt = (s: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(s));
export const HOLIDAYS: Record<string, string> = {
  '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일',
  '2026-10-09': '한글날',
};
export function operating(
  branch: Branch,
  day: string,
  holidayLoaded = true,
): { state: '운영' | '휴무' | '확인 필요'; hours: string; reason: string } {
  const ex = branch.exceptions.find((e) => e.date === day);
  if (ex)
    return {
      state: ex.closed ? '휴무' : ex.intervals ? '운영' : '확인 필요',
      hours: ex.closed ? '' : ex.intervals,
      reason: ex.note || '특정일 예외',
    };
  if (!holidayLoaded || !day.startsWith('2026-10'))
    return { state: '확인 필요', hours: '', reason: '공휴일 정보 미등록 · 2026년 10월만 샘플 제공' };
  if (HOLIDAYS[day]) {
    if (branch.holiday === 'closed') return { state: '휴무', hours: '', reason: HOLIDAYS[day] };
    if (branch.holiday === 'unknown')
      return { state: '확인 필요', hours: '', reason: `${HOLIDAYS[day]} · 공휴일 정책 미설정` };
    if (branch.holiday === 'special')
      return {
        state: branch.holidayHours ? '운영' : '확인 필요',
        hours: branch.holidayHours,
        reason: `${HOLIDAYS[day]} · 별도 운영`,
      };
  }
  const w = branch.week[new Date(`${day}T00:00:00Z`).getUTCDay()];
  return {
    state: w.closed ? '휴무' : w.intervals ? '운영' : '확인 필요',
    hours: w.closed ? '' : w.intervals,
    reason: w.closed ? '정기 휴무' : '요일별 운영시간',
  };
}
export function timeGuidance(branch: Branch, preferred: string, holidayLoaded = true) {
  if (!readClientSheet(`1. 희망 일시: ${preferred}`).preferred) return '';
  const o = operating(branch, preferred.slice(0, 10), holidayLoaded);
  if (o.state !== '운영') return `${o.state} · ${o.reason}`;
  const time = preferred.slice(11, 16);
  const intervals = o.hours.split(',').map((s) => s.trim().split('-'));
  return intervals.some(([from, to]) => from <= time && time < to)
    ? `운영시간 내 · ${o.hours}`
    : `점심 또는 운영시간 밖 · ${o.hours}. 운영 여부 안내이며 예약 가능 수량은 확인하지 않아요.`;
}
export function validIntervals(raw: string) {
  const ranges = raw.split(',').map((s) => s.trim());
  let end = '';
  return (
    !!raw &&
    ranges.every((s) => {
      const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(s);
      if (!match) return false;
      const [, a, b] = match;
      const valid = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
      if (!valid(a) || !valid(b) || a >= b || a < end) return false;
      end = b;
      return true;
    })
  );
}
export function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (full, key) => (key in values ? values[key] || '-' : full));
}
export function safeMapUrl(value: string) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}
