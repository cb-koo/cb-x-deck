// 캠페인 상세 카드 2×2(작업 현황·성과·캠페인 비용·클라이언트 예산, koo 10-08 시안)의 판정 — 컴포넌트는 그리기만 한다.
import type { FlowStage } from './campaignJudgment.ts';
import { CURRENCIES, formatAmount, type Currency, type MoneyByCurrency } from './campaignCost.ts';
import { budgetBreakdown, type BudgetBreakdown } from './clientBudget.ts';

// ── 작업 현황 알약 버튼 — 누르면 아래 목록 필터의 '단계' 묶음을 그 조건으로 바꾼다 ──
export type StagePill = 'waiting' | 'cancelled';
// 게시 대기 = 아직 게시 전(준비·전달), 취소 = 취소. 표의 단계(flowStage)와 같은 이름표를 쓴다.
export const PILL_STAGES: Record<StagePill, readonly FlowStage[]> = { waiting: ['prep', 'handed'], cancelled: ['canc'] };

// 켜짐 = 단계 묶음이 정확히 그 조건일 때만. 필터 바에서 '준비'만 골라 둔 상태는 '게시 대기'가 켜진 게 아니다.
export function isPillActive(stages: ReadonlySet<FlowStage>, pill: StagePill): boolean {
  const want = PILL_STAGES[pill];
  return stages.size === want.length && want.every((s) => stages.has(s));
}
// 누르면: 꺼져 있으면 단계 묶음을 그 조건으로 바꾸고(다른 단계 선택은 덮어씀), 켜져 있으면 단계 묶음을 비운다.
// 유형·기타·검색 묶음은 건드리지 않는다(호출부가 stages만 바꾼다).
export function nextStagesForPill(stages: ReadonlySet<FlowStage>, pill: StagePill): Set<FlowStage> {
  return isPillActive(stages, pill) ? new Set() : new Set(PILL_STAGES[pill]);
}
export function pillCount(stageCounts: Record<FlowStage, number>, pill: StagePill): number {
  return PILL_STAGES[pill].reduce((n, s) => n + (stageCounts[s] ?? 0), 0);
}

// ── 캠페인 비용 표 — 실제로 있는 통화만 한 줄씩(집행·계획) ──
export interface CostTableRow { currency: Currency; label: string; spent: string; planned: string }
const CUR_LABEL: Record<Currency, string> = { KRW: '원화', JPY: '엔화' };
// 계획에만 있고 아직 집행이 없는 통화는 집행 칸을 '—'로(0원으로 위장하지 않는다 — 값 없음 관례)
export function costTableRows(spent: MoneyByCurrency, planned: MoneyByCurrency): CostTableRow[] {
  const cell = (m: MoneyByCurrency, c: Currency) => (m[c] ? formatAmount(m[c] as number, c) : '—');
  return CURRENCIES
    .filter((c) => (spent[c] ?? 0) !== 0 || (planned[c] ?? 0) !== 0)
    .map((c) => ({ currency: c, label: CUR_LABEL[c], spent: cell(spent, c), planned: cell(planned, c) }));
}

// 막대 위 'NN%' 위치 — 집행 끝에 붙여 같이 움직이되, 양 끝에서는 글자가 막대 밖으로 나가지 않게 가둔다.
export function pctLabelLeft(pct: number): string {
  return `clamp(18px, ${pct}%, calc(100% - 18px))`;
}

// ── 클라이언트 예산 카드 ──
// 잔액 표시 — 넘치면 빨강 + '초과'(BudgetStrip·budgetJudgment와 같은 말)
export function remainText(v: number): { text: string; over: boolean } {
  return v < 0 ? { text: `${formatAmount(-v, 'KRW')} 초과`, over: true } : { text: formatAmount(v, 'KRW'), over: false };
}

export type BudgetSegKey = 'othersSpent' | 'othersPending' | 'thisSpent' | 'thisPending';
export interface BudgetSeg { key: BudgetSegKey; value: number; width: number }
export interface BudgetCardView {
  b: BudgetBreakdown;
  segs: BudgetSeg[];          // 막대 순서: 다른 캠페인 집행 → 다른 캠페인 예정 → 이 캠페인 집행 → 이 캠페인 예정 → (나머지 = 남음)
  pendingTotal: number;       // 아직 게시 전 금액(이 캠페인 + 다른 캠페인) — '전체 작업 완료 후 남은 예산' 설명에 쓴다
}
export function budgetCardView(amountKrw: number, o: {
  othersPlannedKrw: number; othersSpentKrw: number; thisPlannedKrw: number; thisSpentKrw: number;
}): BudgetCardView {
  const b = budgetBreakdown(amountKrw, o);
  // 막대는 예산이 전체 길이 — 넘치면 100%에서 자른다(숫자는 실제 값 그대로)
  let used = 0;
  const w = (v: number) => {
    const pct = amountKrw > 0 ? Math.max(0, Math.min(100 - used, (v / amountKrw) * 100)) : 0;
    used += pct;
    return pct;
  };
  const segs = (['othersSpent', 'othersPending', 'thisSpent', 'thisPending'] as const)
    .map((key) => ({ key, value: b[key], width: w(b[key]) }));
  return { b, segs, pendingTotal: b.thisPending + b.othersPending };
}
