// 정산 상태 표시는 한 자리, 파생값 하나(UX 원칙 4) — 요청 내역 배지·필터·캠페인 표 배지·펼침 문구가 전부 여기서 나온다.
// 우리 상태(requested/cancelled) × 그쪽 상태(external_status) → 라벨. 내부어(on_hold 등)는 밖으로 나가지 않는다.
import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';
import { kstMonthDay, kstDateTime } from './datetime.ts';
import { formatMoney } from './influencerPricing.ts';

export type DisplayKey = 'requested' | 'received' | 'scheduled' | 'on_hold' | 'paid' | 'cancelled';
export type DisplayTone = 'blue' | 'warn' | 'done' | 'gray';
export interface StatusSource {
  status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
  createdAt: string; cancelledAt: string | null;
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

export function keyOf(s: Pick<StatusSource, 'status' | 'externalStatus'>): DisplayKey {
  if (s.status === 'cancelled') return 'cancelled';
  switch (s.externalStatus) {
    case 'received': return 'received';
    case 'scheduled': return 'scheduled';
    case 'on_hold': return 'on_hold';
    case 'paid': return 'paid';
    default: return 'requested';   // null, 또는 그쪽 cancelled인데 우리가 아직 requested(적용 직후엔 생기지 않는다)
  }
}

export function displayStatus(s: StatusSource, where: 'list' | 'campaign'): StatusDisplay {
  const key = keyOf(s);
  const extDay = kstMonthDay(s.externalUpdatedAt);
  const campaign = where === 'campaign';
  switch (key) {
    case 'requested': return { key, tone: 'blue', label: `${campaign ? '정산 ' : ''}요청됨 ${kstMonthDay(s.createdAt)}`, title: campaign ? '정산 요청됨 — 클릭하면 요청 내역으로' : '정산 쪽에서 아직 확인 전' };
    case 'received': return { key, tone: 'blue', label: `정산 접수 ${extDay}`, title: '정산 쪽이 요청을 접수했어요' };
    case 'scheduled': return { key, tone: 'blue', label: '지급 예정', title: '정산 쪽이 지급을 예정해 두었어요' };
    case 'on_hold': {
      const p = preview(s.externalNote);
      return { key, tone: 'warn', label: campaign ? '정산 보류 — 확인 필요' : (p ? `보류 · ${p}` : '보류'), title: s.externalNote ?? '정산 쪽이 보류했어요' };
    }
    case 'paid': return { key, tone: 'done', label: `지급 완료 ${extDay}`, title: '지급이 끝났어요' };
    case 'cancelled': return { key, tone: 'gray', label: campaign ? '취소됨' : `취소됨 ${kstMonthDay(s.cancelledAt)}`, title: '요청이 취소됐어요' };
  }
}

export type StatusGroup = '' | 'active' | 'on_hold' | 'paid' | 'cancelled';
export const STATUS_GROUP_OPTIONS: ReadonlyArray<{ value: StatusGroup; label: string }> = [
  { value: '', label: '상태 전체' }, { value: 'active', label: '진행 중' }, { value: 'on_hold', label: '보류' }, { value: 'paid', label: '지급 완료' }, { value: 'cancelled', label: '취소됨' },
];
export function inGroup(key: DisplayKey, g: StatusGroup): boolean {
  if (g === '') return true;
  if (g === 'active') return key === 'requested' || key === 'received' || key === 'scheduled';
  return key === g;
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('ko-KR')}` : `−${Math.abs(n).toLocaleString('ko-KR')}`);
export function paidText(amountKrw: number, paidAmountKrw: number): string {
  const diff = paidAmountKrw - amountKrw;
  return diff === 0 ? `실지급 ${formatMoney(paidAmountKrw, 'KRW')}` : `실지급 ${formatMoney(paidAmountKrw, 'KRW')} (요청 ${formatMoney(amountKrw, 'KRW')}, ${signed(diff)})`;
}

// 요청 내역 펼침의 '정산' 항목 한 줄
export function settlementDetail(s: StatusSource & { paidAmountKrw: number | null; paidAt: string | null; amountKrw: number }): string {
  if (!s.externalStatus) return '아직 정산 쪽에서 확인 전이에요';
  const when = kstDateTime(s.externalUpdatedAt);
  const memo = s.externalNote ? ` · 메모: ${s.externalNote}` : '';
  switch (s.externalStatus) {
    case 'received': return `정산 접수 · ${when}${memo}`;
    case 'scheduled': return `지급 예정 · ${when}${memo}`;
    case 'on_hold': return `보류 · ${when}${s.externalNote ? ` · ${s.externalNote}` : ''}`;
    case 'paid': return `지급 완료 · ${kstDateTime(s.paidAt ?? s.externalUpdatedAt)} · ${paidText(s.amountKrw, s.paidAmountKrw ?? 0)}${memo}`;
    case 'cancelled': return `정산에서 취소 · ${when}${memo}`;
  }
}
