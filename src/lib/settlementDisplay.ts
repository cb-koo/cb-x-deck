// 정산 상태 표시는 한 자리, 파생값 하나(UX 원칙 4) — 요청 내역 배지·필터·캠페인 표 배지·펼침 문구가 전부 여기서 나온다.
// 우리 상태(requested/cancelled) × 그쪽 상태(external_status) → 라벨. 내부어(on_hold 등)는 밖으로 나가지 않는다.
import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';
import { kstMonthDay, kstDate } from './datetime.ts';
import { formatMoney, type Currency } from './influencerPricing.ts';
import { sameTaskCost, type TaskCost } from './campaignCost.ts';
import type { PaymentFee } from './influencerPayment.ts';
import { computeMoney } from './settlementCalc.ts';   // 순수 모듈 — 요청을 만들 때와 같은 계산으로 기대 송금액을 낸다

export type DisplayKey = 'requested' | 'received' | 'scheduled' | 'on_hold' | 'paid' | 'paid_diff' | 'cancelled';
export type DisplayTone = 'blue' | 'warn' | 'done' | 'gray';
export interface StatusSource extends MismatchSource {
  externalNote: string | null; externalUpdatedAt: string | null;
  createdAt: string; cancelledAt: string | null;
  // 송금액·옛 확인 시각 — 표시용(판정은 MismatchSource의 지금 작업 금액으로 taskPaidMismatch가 한다)
  paidAmountKrw: number | null; grossKrw: number; diffAckAt: string | null;
  payoutCurrency: Currency; amountGross: number; paidAmountJpy: number | null;
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

export function keyOf(s: StatusSource): DisplayKey {
  if (s.status === 'cancelled') return 'cancelled';
  switch (s.externalStatus) {
    case 'received': return 'received';
    case 'scheduled': return 'scheduled';
    case 'on_hold': return 'on_hold';
    case 'paid': return taskPaidMismatch(s) ? 'paid_diff' : 'paid';   // 작업 금액 vs 정산팀 지급(스펙 2026-10-07 §4)
    default: return 'requested';   // null, 또는 그쪽 cancelled인데 우리가 아직 requested(적용 직후엔 생기지 않는다)
  }
}

// 그쪽 처리 상태의 평이한 라벨(날짜 없음) — 요청 펼침의 '정산 프로덕트가 보낸 결과' 블록 전용.
// displayStatus()의 배지 라벨(날짜·차액 문구 포함)과는 쓰임이 달라 따로 둔다. 내부어(on_hold 등)를 밖으로 내보내지 않는 것은 여기도 동일.
export const EXTERNAL_STATUS_LABEL: Record<ExternalStatus, string> = {
  received: '정산 접수', scheduled: '지급 예정', paid: '지급 완료', on_hold: '보류', cancelled: '정산팀이 취소',
};

export function displayStatus(s: StatusSource, where: 'list' | 'campaign'): StatusDisplay {
  const key = keyOf(s);
  const extDay = kstMonthDay(s.externalUpdatedAt);
  const campaign = where === 'campaign';
  switch (key) {
    case 'requested': {
      // 고친 요청(revision>0)은 요청 내역에서 "요청됨 · 2판 M/D"로 — 만든 날짜만 보이면 고친 뒤에도 아무 일 없어 보인다(스펙 2026-09-07 §6).
      if (!campaign && (s.revision ?? 0) > 0 && s.revisedAt) {
        return { key, tone: 'blue', label: `요청됨 · ${(s.revision ?? 0) + 1}판 ${kstMonthDay(s.revisedAt)}`, title: '고쳐서 다시 보낸 요청이에요 — 정산팀이 다시 검토 중' };
      }
      return { key, tone: 'blue', label: `${campaign ? '정산 ' : ''}요청됨 ${kstMonthDay(s.createdAt)}`, title: campaign ? '정산 요청됨 — 클릭하면 요청 내역으로' : '정산팀이 아직 확인 전' };
    }
    case 'received': return { key, tone: 'blue', label: `정산 접수 ${extDay}`, title: '정산팀이 요청을 접수했어요' };
    case 'scheduled': return { key, tone: 'blue', label: '지급 예정', title: '정산팀이 지급을 예정해 두었어요' };
    case 'on_hold': {
      const p = preview(s.externalNote);
      return { key, tone: 'warn', label: campaign ? '정산 보류 — 확인 필요' : (p ? `보류 · ${p}` : '보류'), title: s.externalNote ?? '정산팀이 보류했어요' };
    }
    case 'paid': {
      // 처리한 건은 요청 내역에서 어떻게 처리했는지 말한다(§9 '표 상태(처리 후)'). 캠페인 배지는 짧게 날짜.
      if (!campaign && s.diffAckKind === 'matched') return { key, tone: 'done', label: '지급 완료 · 맞춤', title: '지급이 끝났어요' };
      if (!campaign && s.diffAckKind === 'kept') return { key, tone: 'done', label: '지급 완료 · 그대로 둠', title: '지급이 끝났어요' };
      return { key, tone: 'done', label: `지급 완료 ${extDay}`, title: '지급이 끝났어요' };
    }
    // 요청 내역 표에서는 이 배지 대신 [그대로 두기][지급 금액에 맞추기] 버튼이 보인다(§8-2) — 라벨은 캠페인 배지·필터와 같은 말
    case 'paid_diff': return { key, tone: 'warn', label: '지급 금액 다름', title: '지급 금액 다름' };
    case 'cancelled': return { key, tone: 'gray', label: campaign ? '취소됨' : `취소됨 ${kstMonthDay(s.cancelledAt)}`, title: '요청이 취소됐어요' };
  }
}

export type StatusGroup = '' | 'active' | 'on_hold' | 'paid' | 'paid_diff' | 'cancelled';
export const STATUS_GROUP_OPTIONS: ReadonlyArray<{ value: StatusGroup; label: string }> = [
  { value: '', label: '상태 전체' }, { value: 'active', label: '진행 중' }, { value: 'on_hold', label: '보류' },
  { value: 'paid_diff', label: '지급 금액 다름' }, { value: 'paid', label: '지급 완료' }, { value: 'cancelled', label: '취소됨' },
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

// PayPal 달러 실지급액 표기(그쪽 09-09 paid_amount_usd). formatMoney는 KRW·JPY만 알아서 여기서 따로.
export const usdText = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── 정산팀 지급 금액 ≠ 작업 금액(스펙 2026-10-07 §4) ──
// 이 함수 하나가 표 버튼·상단 안내·캠페인 배지·서버 가드(settlementStore.lockForReconcile)를 모두 정한다 — 판정이 두 곳이면 한쪽만 바뀐다.
// 비교 대상은 '요청 금액'이 아니라 '지금 작업 금액'이다: 작업 금액을 고치면 표시가 저절로 풀린다(§3-1).
export type DiffAckKind = 'matched' | 'kept';

// 달러 지급·엔화 값 없는 지급은 정확히 비교할 수 없어 '환율로 설명되는가'로 본다 — 지급 원화 ÷ (기대 송금액 × 요청 환율).
// 근거(§4-3): 정상 엔화 지급 84건 0.847~0.900(중앙 0.872), 오류 2건 1.27·2.65. 정산팀은 적용 환율을 보내지 않는다(koo 10-07).
// 범위를 바꿀 자리는 여기 하나.
export const FX_RATIO_BAND = { min: 0.8, max: 1.0 } as const;
// 같은 날·같은 지급 방식의 다른 건들 비율 중앙값과 ±3% 넘게 벗어나면 다름(koo 10-07). 다른 건이 3건 미만이면 위 고정 범위로.
// 근거: 같은 지급일 안에서는 비율이 거의 같고(09-14 0.885 / 09-21 0.899~0.900 / 09-28 0.872 / 10-06 0.862~0.863) 날짜를 넘으면 4% 넘게 움직여,
// 고정 범위로는 +13%·−9% 이내 오지급을 놓친다.
export const PEER_RATIO_TOLERANCE = 0.03;
export const PEER_MIN_COUNT = 3;

export interface MismatchSource {
  status: SettlementBadgeStatus; externalStatus: ExternalStatus | null;
  taskId: string | null; taskCost: TaskCost | null;              // 지금 작업 금액(작업이 지워졌거나 비면 null) — 스냅샷이 아니다
  payoutCurrency: Currency; fee: PaymentFee | null; rateKrwPerJpy: number;   // 요청 스냅샷(보낸 통화·수수료·환율)
  paidAmountKrw: number | null; paidAmountJpy: number | null;    // 정산팀 결과
  paidAmountUsd: number | null; paidAt: string | null;           // 같은 날·같은 방식 비교용(지급 방식 = 달러 값 유무, 날짜 = paidAt의 서울 날짜)
  peerRatio?: number | null;                                     // 같은 날 다른 건들의 비율 중앙값 — withPeerRatios/저장소가 채운다(생략 = null = 고정 범위)
  diffAckKind: DiffAckKind | null; diffAckTaskCost: TaskCost | null;   // 처리 기록(065)
}
export type PaidMismatch =
  | { kind: 'exact'; expectedGross: number; paid: number; diff: number; currency: Currency }   // 보낸 통화로 정확히 비교
  | { kind: 'band'; expectedGross: number; ratio: number; diff: number; currency: 'KRW' };     // 비율로 본 것 — diff는 원화 차이

// 비율 = 지급 원화 ÷ (기대 송금액 × 요청 환율) — 식은 여기 한 곳(band 판정과 peer 비율이 같이 쓴다)
function ratioOf(paidKrw: number, expectedGross: number, rate: number): number {
  const expectedKrw = Math.round(expectedGross * rate);
  return expectedKrw === 0 ? (paidKrw === 0 ? 1 : Number.POSITIVE_INFINITY) : paidKrw / expectedKrw;
}
const isBandTarget = (s: MismatchSource): boolean =>
  s.status !== 'cancelled' && s.externalStatus === 'paid' && !!s.taskId && !!s.taskCost && s.paidAmountKrw !== null
  && s.payoutCurrency === 'JPY' && s.paidAmountJpy === null;
// band 분기로 가는 행이면 그 비율, 아니면 null
export function bandRatio(s: MismatchSource): number | null {
  if (!isBandTarget(s)) return null;
  const expectedGross = computeMoney(s.taskCost as TaskCost, s.payoutCurrency, s.fee ?? undefined, s.rateKrwPerJpy).amountGross;
  return ratioOf(s.paidAmountKrw as number, expectedGross, s.rateKrwPerJpy);
}
export type PayRoute = 'usd' | 'jpy-no-amount';
export const payRoute = (s: Pick<MismatchSource, 'paidAmountUsd'>): PayRoute => (s.paidAmountUsd !== null ? 'usd' : 'jpy-no-amount');

const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b); const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
// 행마다 같은 날(서울)·같은 방식의 다른 band 대상 행들 비율의 중앙값. 3건 미만이면 null. 비율이 무한대인 행(기대 원화 0)은 비교 대상에서 뺀다.
export function peerRatios<T extends MismatchSource & { id: string }>(rows: readonly T[]): Map<string, number | null> {
  const groups = new Map<string, Array<{ id: string; ratio: number }>>();
  const keyOf = (r: T): string | null => (r.paidAt ? `${kstDate(r.paidAt)}|${payRoute(r)}` : null);
  for (const r of rows) {
    const k = keyOf(r); const ratio = bandRatio(r);
    if (k === null || ratio === null || !Number.isFinite(ratio)) continue;
    const g = groups.get(k) ?? []; g.push({ id: r.id, ratio }); groups.set(k, g);
  }
  const out = new Map<string, number | null>();
  for (const r of rows) {
    const k = keyOf(r);
    const others = k !== null && bandRatio(r) !== null ? (groups.get(k) ?? []).filter((g) => g.id !== r.id) : [];
    out.set(r.id, others.length >= PEER_MIN_COUNT ? median(others.map((g) => g.ratio)) : null);
  }
  return out;
}
export function withPeerRatios<T extends MismatchSource & { id: string }>(rows: readonly T[]): T[] {
  const m = peerRatios(rows);
  return rows.map((r) => ({ ...r, peerRatio: m.get(r.id) ?? null }));
}

// 처리 기록을 보지 않은 판정 — "차이가 있는가" 자체. 화면·서버는 아래 taskPaidMismatch를 쓴다.
export function paidMismatch(s: MismatchSource): PaidMismatch | null {
  if (s.status === 'cancelled' || s.externalStatus !== 'paid' || !s.taskId || !s.taskCost || s.paidAmountKrw === null) return null;
  // 요청을 만들 때와 같은 계산을 지금 작업 금액으로 다시 한다(§4-2)
  const expectedGross = computeMoney(s.taskCost, s.payoutCurrency, s.fee ?? undefined, s.rateKrwPerJpy).amountGross;
  if (s.payoutCurrency === 'KRW') {
    const diff = s.paidAmountKrw - expectedGross;
    return diff === 0 ? null : { kind: 'exact', expectedGross, paid: s.paidAmountKrw, diff, currency: 'KRW' };
  }
  if (s.paidAmountJpy !== null) {
    const diff = s.paidAmountJpy - expectedGross;
    return diff === 0 ? null : { kind: 'exact', expectedGross, paid: s.paidAmountJpy, diff, currency: 'JPY' };
  }
  const ratio = ratioOf(s.paidAmountKrw, expectedGross, s.rateKrwPerJpy);
  const peer = s.peerRatio ?? null;
  const same = peer !== null ? Math.abs(ratio / peer - 1) <= PEER_RATIO_TOLERANCE : ratio >= FX_RATIO_BAND.min && ratio <= FX_RATIO_BAND.max;
  if (same) return null;
  return { kind: 'band', expectedGross, ratio, diff: s.paidAmountKrw - Math.round(expectedGross * s.rateKrwPerJpy), currency: 'KRW' };
}

// 처리 기록이 있으면 숨긴다 — 단 처리 때의 작업 금액이 지금과 같을 때만(§4-4). 지급 금액 쪽은 정산팀이 금액을 정정하면
// applyExternalStatus가 처리 기록을 통째로 비우므로 여기서 다시 볼 필요가 없다. 옛 확인(종류 null)은 숨기지 않는다.
export function taskPaidMismatch(s: MismatchSource): PaidMismatch | null {
  const m = paidMismatch(s);
  if (!m) return null;
  if (s.diffAckKind !== null && sameTaskCost(s.diffAckTaskCost, s.taskCost)) return null;
  return m;
}

// 그대로 두기 사유(§5-2) — 저장값은 "선택지 — 메모" 한 문자열(처리 기록 문장 `사유: {선택지}{ — 메모}`가 그대로 쓴다).
export const KEEP_REASONS = ['환율·송금 수수료 차이', '추가 지급(별도 합의)', '기타'] as const;
export type KeepReason = typeof KEEP_REASONS[number];
export const RECONCILE_REASON_MAX = 200;
export function composeKeepReason(kind: unknown, memo: unknown): string | null {
  if (typeof kind !== 'string' || !(KEEP_REASONS as readonly string[]).includes(kind)) return null;
  const m = typeof memo === 'string' ? memo.trim() : '';
  if (kind === '기타' && !m) return null;
  const s = m ? `${kind} — ${m}` : kind;
  return s.length > RECONCILE_REASON_MAX ? null : s;
}

// §9 경합 오류 — 서버(409)와 창이 같은 문장을 쓴다
export const RECONCILE_STALE_MESSAGE = '그 사이 작업 금액이나 정산팀 지급 금액이 바뀌었어요 — 새로 고친 내용을 확인해 주세요';

// 요청에 담긴 작업 금액(요청 시점). amount_krw = 작업 금액(원화) 또는 작업 금액(엔화) × 요청 환율(computeMoney)
export function requestCostOf(r: { costCurrency: Currency; amountKrw: number; rateKrwPerJpy: number }): TaskCost {
  return r.costCurrency === 'KRW'
    ? { amount: r.amountKrw, currency: 'KRW' }
    : { amount: Math.round(r.amountKrw / r.rateKrwPerJpy), currency: 'JPY' };
}

// 정산팀이 엔화로 보낸 건의 실제 환율 — 표에서 뺀 회색 환율 차이 대신 펼침에서만 보인다(§8-4).
// 엔화 금액이 와야만 만든다 — 달러로 보낸 건의 원화는 정산팀 환산값이라 엔 환율이 없다
export function paidFxRateText(s: { paidAmountKrw: number | null; paidAmountJpy: number | null }): string | null {
  if (s.paidAmountKrw === null || !s.paidAmountJpy) return null;
  return `환율 1엔 = ${(s.paidAmountKrw / s.paidAmountJpy).toFixed(2)}원`;
}

// 정산팀 취소가 남긴 처리자 이름은 저장값이 '정산 프로덕트'다(정산팀 API로도 나가는 값이라 바꾸지 않는다) — 화면에서만 정산팀으로
export const partnerNameLabel = (name: string | null): string | null => (name === '정산 프로덕트' ? '정산팀' : name);

// 캠페인 배지(settlementByTaskIds) 기준 — 지급이 끝난 요청이 붙은 작업인가(작업 금액 수정에 사유 필수, §6)
export function isPaidBadge(b: { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null } | null): boolean {
  return !!b && b.status === 'requested' && b.externalStatus === 'paid';
}
// 지급 전 살아 있는 요청의 금액이 지금 작업 금액과 다르면 그 요청 금액 — 작업 패널 안내 "정산 요청은 아직 {이전 금액}이에요"(§6)
export function pendingRequestCost(t: { cost: TaskCost | null; settlement: { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; costCurrency: Currency; amountKrw: number; rateKrwPerJpy: number } | null }): TaskCost | null {
  const b = t.settlement;
  if (!b || b.status !== 'requested' || b.externalStatus === 'paid' || b.externalStatus === 'cancelled') return null;
  const req = requestCostOf(b);
  return sameTaskCost(req, t.cost) ? null : req;
}
