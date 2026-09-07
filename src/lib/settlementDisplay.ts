// 정산 상태 표시는 한 자리, 파생값 하나(UX 원칙 4) — 요청 내역 배지·필터·캠페인 표 배지·펼침 문구가 전부 여기서 나온다.
// 우리 상태(requested/cancelled) × 그쪽 상태(external_status) → 라벨. 내부어(on_hold 등)는 밖으로 나가지 않는다.
import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';
import { kstMonthDay } from './datetime.ts';
import { formatMoney } from './influencerPricing.ts';

export type DisplayKey = 'requested' | 'received' | 'scheduled' | 'on_hold' | 'paid' | 'paid_diff' | 'cancelled';
export type DisplayTone = 'blue' | 'warn' | 'done' | 'gray';
export interface StatusSource {
  status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
  createdAt: string; cancelledAt: string | null;
  // 차액 판정 입력 — 그쪽 실지급액을 우리가 실제로 보낸 금액과 비교한다
  paidAmountKrw: number | null; grossKrw: number; diffAckAt: string | null;
  // 제자리 수정(2026-09-07): 고친 횟수·마지막 고친 시각. 캠페인 표 배지 소스엔 없을 수 있어 선택
  revision?: number; revisedAt?: string | null;
}
export interface StatusDisplay { key: DisplayKey; label: string; tone: DisplayTone; title: string }

export const TONE_CLASS: Record<DisplayTone, string> = {
  blue: 'bg-x-blue/10 text-x-blue-text',
  warn: 'bg-amber-50 text-amber-700',      // 신호등 🟡 톤(readinessView)
  done: 'bg-emerald-50 text-emerald-700',  // 🟢
  gray: 'bg-x-surface text-x-secondary',
};

const NOTE_PREVIEW = 20;
const preview = (note: string | null) => (note ? (note.length > NOTE_PREVIEW ? `${note.slice(0, NOTE_PREVIEW)}…` : note) : null);

// 차액 = 그쪽 실지급액 − 우리가 실제로 보낸 금액. 아직 지급 전이면 null.
export function paidDiff(s: Pick<StatusSource, 'paidAmountKrw' | 'grossKrw'>): number | null {
  return s.paidAmountKrw === null ? null : s.paidAmountKrw - s.grossKrw;
}

// 차액이 있는 지급인가 — 지급 완료 + 실지급액 있음 + 차액 ≠ 0. 취소된 요청은 대상이 아니다.
// 화면 배지(needsDiffAck)와 서버의 확인 가드(settlementStore.ackDiff)가 이 한 함수를 쓴다 — 판정이 두 곳에
// 따로 있으면 한쪽만 바뀌어 어긋난다(09-02 순액·송금액 결함과 같은 종류). 기준(예: 1원 이내 무시)을 바꿀 자리도 여기 하나.
export function hasPaidDiff(s: Pick<StatusSource, 'status' | 'externalStatus' | 'paidAmountKrw' | 'grossKrw'>): boolean {
  if (s.status === 'cancelled' || s.externalStatus !== 'paid') return false;
  const d = paidDiff(s);
  return d !== null && d !== 0;
}

// 담당자 확인이 필요한가 — 차액 있음 + 아직 확인 안 함.
export function needsDiffAck(s: StatusSource): boolean {
  return hasPaidDiff(s) && !s.diffAckAt;
}

export function keyOf(s: StatusSource): DisplayKey {
  if (s.status === 'cancelled') return 'cancelled';
  switch (s.externalStatus) {
    case 'received': return 'received';
    case 'scheduled': return 'scheduled';
    case 'on_hold': return 'on_hold';
    case 'paid': return needsDiffAck(s) ? 'paid_diff' : 'paid';
    default: return 'requested';   // null, 또는 그쪽 cancelled인데 우리가 아직 requested(적용 직후엔 생기지 않는다)
  }
}

// 그쪽 처리 상태의 평이한 라벨(날짜 없음) — 요청 펼침의 '정산 프로덕트가 보낸 결과' 블록 전용.
// displayStatus()의 배지 라벨(날짜·차액 문구 포함)과는 쓰임이 달라 따로 둔다. 내부어(on_hold 등)를 밖으로 내보내지 않는 것은 여기도 동일.
export const EXTERNAL_STATUS_LABEL: Record<ExternalStatus, string> = {
  received: '정산 접수', scheduled: '지급 예정', paid: '지급 완료', on_hold: '보류', cancelled: '정산에서 취소',
};

export function displayStatus(s: StatusSource, where: 'list' | 'campaign'): StatusDisplay {
  const key = keyOf(s);
  const extDay = kstMonthDay(s.externalUpdatedAt);
  const campaign = where === 'campaign';
  switch (key) {
    case 'requested': {
      // 고친 요청(revision>0)은 요청 내역에서 "요청됨 · 2판 M/D"로 — 만든 날짜만 보이면 고친 뒤에도 아무 일 없어 보인다(스펙 2026-09-07 §6).
      // 캠페인 표 배지는 짧게 유지한다.
      if (!campaign && (s.revision ?? 0) > 0 && s.revisedAt) {
        return { key, tone: 'blue', label: `요청됨 · ${(s.revision ?? 0) + 1}판 ${kstMonthDay(s.revisedAt)}`, title: '고쳐서 다시 보낸 요청이에요 — 정산 쪽이 다시 검토 중' };
      }
      return { key, tone: 'blue', label: `${campaign ? '정산 ' : ''}요청됨 ${kstMonthDay(s.createdAt)}`, title: campaign ? '정산 요청됨 — 클릭하면 요청 내역으로' : '정산 쪽에서 아직 확인 전' };
    }
    case 'received': return { key, tone: 'blue', label: `정산 접수 ${extDay}`, title: '정산 쪽이 요청을 접수했어요' };
    case 'scheduled': return { key, tone: 'blue', label: '지급 예정', title: '정산 쪽이 지급을 예정해 두었어요' };
    case 'on_hold': {
      const p = preview(s.externalNote);
      return { key, tone: 'warn', label: campaign ? '정산 보류 — 확인 필요' : (p ? `보류 · ${p}` : '보류'), title: s.externalNote ?? '정산 쪽이 보류했어요' };
    }
    case 'paid': return { key, tone: 'done', label: `지급 완료 ${extDay}`, title: '지급이 끝났어요' };
    case 'paid_diff': {
      const d = paidDiff(s) ?? 0;
      const 적게많게 = d < 0 ? '적게' : '많게';
      return { key, tone: 'warn', label: campaign ? '정산 차액 확인 필요' : '지급 완료 · 차액 확인 필요',
               title: `요청한 송금액보다 ${Math.abs(d).toLocaleString('ko-KR')}원 ${적게많게} 지급됐어요 — 확인해 주세요` };
    }
    case 'cancelled': return { key, tone: 'gray', label: campaign ? '취소됨' : `취소됨 ${kstMonthDay(s.cancelledAt)}`, title: '요청이 취소됐어요' };
  }
}

export type StatusGroup = '' | 'active' | 'on_hold' | 'paid' | 'paid_diff' | 'cancelled';
export const STATUS_GROUP_OPTIONS: ReadonlyArray<{ value: StatusGroup; label: string }> = [
  { value: '', label: '상태 전체' }, { value: 'active', label: '진행 중' }, { value: 'on_hold', label: '보류' },
  { value: 'paid_diff', label: '차액 확인 필요' }, { value: 'paid', label: '지급 완료' }, { value: 'cancelled', label: '취소됨' },
];
export function inGroup(key: DisplayKey, g: StatusGroup): boolean {
  if (g === '') return true;
  if (g === 'active') return key === 'requested' || key === 'received' || key === 'scheduled';
  if (g === 'paid') return key === 'paid' || key === 'paid_diff';   // 차액 건도 지급 완료다
  return key === g;
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('ko-KR')}` : `−${Math.abs(n).toLocaleString('ko-KR')}`);
// 그쪽 실지급액은 우리가 '실제로 보낸 금액'(gross_krw, 수수료 포함)과 비교한다.
// amount_krw(수수료 제외 순액)와 비교하면 수수료가 차액으로 오해된다 — 2026-09-01 수정.
export function paidText(grossKrw: number, paidAmountKrw: number): string {
  const diff = paidAmountKrw - grossKrw;
  return diff === 0
    ? `실지급 ${formatMoney(paidAmountKrw, 'KRW')}`
    : `실지급 ${formatMoney(paidAmountKrw, 'KRW')} (송금액 ${formatMoney(grossKrw, 'KRW')}, ${signed(diff)})`;
}

// 그쪽이 처리한 건(상태를 보내온 요청)인가 — 이런 건을 고칠 때는 슬랙으로 정산 담당자 확인 후 반영(09-07 합의). 송금 중일 수 있는 틈을 사람 확인으로 막는다.
// 순수 모듈에 두는 이유: 수정 창(클라이언트)과 서버(reviseRequest)가 같은 판정을 쓰되, 클라이언트가 settlementStore(pg)를 끌어오면 빌드가 깨진다.
export const needsPartnerConfirm = (r: { externalStatus: ExternalStatus | null }): boolean => r.externalStatus !== null;
