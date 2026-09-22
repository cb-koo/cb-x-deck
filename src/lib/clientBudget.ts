// 클라이언트 예산 기간의 순수 로직 — 환율 상수, 원화 환산, 기간 찾기, 초과 배지, 표 행, 입력 검증.
// 서버(스토어·라우트)와 화면(BudgetPanel·SummaryCards·FlowCards)이 같은 함수를 쓴다(스펙 2026-09-22 §4).
// 037의 월 단위 모델(기본 예산+예외 달)을 완전히 대체한다 — 이 파일에 '기본값' 개념은 없다.
import { parseAmount, formatAmount, type MoneyByCurrency, type Parsed } from './campaignCost.ts';
import { isDateOnlyString } from './campaignJudgment.ts';

// 환율 — 참고 환산(koo 결정 08-27: 1엔 = 10원 고정, 09-22 유지). 바꿀 자리는 여기 한 곳.
export const JPY_TO_KRW = 10;

export const BUDGET_AMOUNT_MESSAGE = '예산은 0 이상 숫자로 입력해 주세요';
export const PERIOD_DATE_MESSAGE = '기간은 YYYY-MM-DD 날짜로 입력해 주세요';
export const PERIOD_ORDER_MESSAGE = '종료일이 시작일보다 앞이에요';

export interface BudgetPeriod { id: string; startsOn: string; endsOn: string; amountKrw: number }
export type BudgetSource = 'period' | 'none';

export interface PeriodSpend { total: MoneyByCurrency; campaignCount: number; feeKrw: number; feeUnknown: number }
// 기간에 귀속된 캠페인 중 이 기간 종료일 뒤까지 이어지는 것들 — 초과 원인 배지용(스펙 §4, §7)
export interface SpanningCampaign { id: string; endsOn: string }

export function toKrw(total: MoneyByCurrency): { krw: number; jpyIncluded: number } {
  const jpy = total.JPY ?? 0;
  return { krw: (total.KRW ?? 0) + jpy * JPY_TO_KRW, jpyIncluded: jpy };
}

export function remainingOf(amountKrw: number, spentKrw: number): number {
  return amountKrw - spentKrw;
}

// 캠페인이 속한 기간 찾기 — 겹침이 없으므로(DB exclusion constraint) 항상 최대 1개
export function periodFor(periods: BudgetPeriod[], dateOnly: string): BudgetPeriod | null {
  return periods.find((p) => p.startsOn <= dateOnly && dateOnly <= p.endsOn) ?? null;
}

export interface OverageBadge { latestEndsOn: string; count: number }
// 배지는 '존재하면 원인일 수 있다'는 근사치다 — 얼마나 설명하는지(정확한 인과 비율)는 계산하지 않는다(스펙 §7).
export function overageBadge(remaining: number, spanning: SpanningCampaign[]): OverageBadge | null {
  if (remaining >= 0 || spanning.length === 0) return null;
  const latestEndsOn = spanning.reduce((max, c) => (c.endsOn > max ? c.endsOn : max), spanning[0].endsOn);
  return { latestEndsOn, count: spanning.length };
}

export interface PeriodRow {
  period: BudgetPeriod;
  spentKrw: number; jpyIncluded: number; campaignCount: number;
  remaining: number;                     // amountKrw - spentKrw(단가 기준)
  // 지출 기준 토글 — 단가(spentKrw)는 그대로 두고, 수수료 포함 값은 화면이 remainingOf(amountKrw, spentWithFeeKrw)로 다시 낸다
  spentWithFeeKrw: number; feeKrw: number; feeUnknown: number;
  badge: OverageBadge | null;            // 단가 기준 remaining으로 계산 — 토글해도 안 바뀐다
}
export function periodRow(period: BudgetPeriod, spend: PeriodSpend, spanning: SpanningCampaign[]): PeriodRow {
  const { krw, jpyIncluded } = toKrw(spend.total);
  const remaining = remainingOf(period.amountKrw, krw);
  return {
    period, spentKrw: krw, jpyIncluded, campaignCount: spend.campaignCount,
    remaining, spentWithFeeKrw: krw + spend.feeKrw, feeKrw: spend.feeKrw, feeUnknown: spend.feeUnknown,
    badge: overageBadge(remaining, spanning),
  };
}

// 캠페인 상세 카드용 — othersKrw는 이 기간 합계 − 이 캠페인 몫(같은 totalsFor). period가 null이면 '미설정'(source: none).
export interface CampaignPeriodBudget {
  period: BudgetPeriod | null; source: BudgetSource;
  othersKrw: number; campaignCount: number; badge: OverageBadge | null;   // badge는 이 기간 전체 상태(이 캠페인만의 것이 아니다)
}
export function campaignPeriodBudget(
  period: BudgetPeriod | null, spend: PeriodSpend | undefined, spanning: SpanningCampaign[], thisCampaignKrw: number,
): CampaignPeriodBudget {
  if (period === null) return { period: null, source: 'none', othersKrw: 0, campaignCount: 0, badge: null };
  const { krw } = toKrw(spend?.total ?? {});
  const remaining = remainingOf(period.amountKrw, krw);
  return {
    period, source: 'period', othersKrw: Math.max(0, krw - thisCampaignKrw),
    campaignCount: spend?.campaignCount ?? 0, badge: overageBadge(remaining, spanning),
  };
}

// 'M/D' — 시간대 시프트 없음('YYYY-MM-DD' 문자열 슬라이스만, datetime.ts date-only 계열과 같은 태도)
function shortDate(d: string): string { return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; }
export function periodLabel(p: BudgetPeriod): string { return `${shortDate(p.startsOn)} ~ ${shortDate(p.endsOn)}`; }

export function badgeText(badge: OverageBadge): string {
  return badge.count === 1
    ? `${shortDate(badge.latestEndsOn)}까지 이어지는 캠페인 때문에 초과됐어요`
    : `${badge.count}개 캠페인이 기간을 넘어가요 · 가장 늦게는 ${shortDate(badge.latestEndsOn)}까지`;
}

// 표·카드 ⓘ 공용 — 귀속 규칙·집계 범위·환율·배지 규칙을 한 문장씩(스펙 §6)
export function budgetTipText(): string {
  return `캠페인은 시작일이 속한 기간에 전액 잡혀요 · 캠페인에 넣은 콘텐츠 비용만 집계해요 · `
    + `엔화는 1엔 = ${JPY_TO_KRW}원으로 환산해요 · 수수료 포함은 인플루언서별 송금 수수료를 얹은 예상 금액이에요 · `
    + `기간을 넘어가는 캠페인 때문에 초과되면 그 이유를 표시해요(잔액 계산에는 반영하지 않아요)`;
}

export function budgetJudgment(remaining: number): string {
  return remaining < 0 ? `${formatAmount(-remaining, 'KRW')} 초과` : `${formatAmount(remaining, 'KRW')} 남음`;
}

// 예산 입력 검증 — 0 이상 정수만(콤마 허용, 단가 검증과 동일 규칙). 기간은 항상 금액이 있어야 하므로
// null·빈 문자열도 거부한다(037의 '미설정 허용'과 다른 점 — 스펙 §2).
export function parseBudgetAmount(v: unknown): Parsed<number> {
  const n = parseAmount(v);
  return n === null ? { ok: false, message: BUDGET_AMOUNT_MESSAGE } : { ok: true, value: n };
}

export interface BudgetPeriodInput { startsOn: string; endsOn: string; amountKrw: number }
function parseDateOnly(v: unknown): Parsed<string> {
  return isDateOnlyString(v) ? { ok: true, value: v } : { ok: false, message: PERIOD_DATE_MESSAGE };
}
export function parseBudgetPeriodInput(body: unknown): Parsed<BudgetPeriodInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const startsOn = parseDateOnly(b.startsOn); if (!startsOn.ok) return startsOn;
  const endsOn = parseDateOnly(b.endsOn);     if (!endsOn.ok) return endsOn;
  if (endsOn.value < startsOn.value) return { ok: false, message: PERIOD_ORDER_MESSAGE };
  const amount = parseBudgetAmount(b.amountKrw); if (!amount.ok) return amount;
  return { ok: true, value: { startsOn: startsOn.value, endsOn: endsOn.value, amountKrw: amount.value } };
}
