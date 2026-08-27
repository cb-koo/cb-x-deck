// 클라이언트 월 마케팅 예산의 순수 로직 — 환율 상수, 원화 환산, 귀속 달, 표 행, 문구, 입력 검증.
// 서버(라우트·스토어)와 화면(BudgetPanel·SummaryCards)이 같은 함수를 쓴다(스펙 2026-08-27 §4).
import { parseAmount, formatAmount, type MoneyByCurrency } from './campaignCost.ts';

export interface BudgetClient { monthlyBudget: number | null; budgetOverrides: Record<string, number> }

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && MONTH_RE.test(v);
}

// jsonb 모양은 보증되지 않는다 — 키 형식·정수 검증을 통과한 항목만 남긴다(draftStore.costOf와 같은 태도)
export function budgetOverridesOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!isMonthKey(k)) continue;
    const n = parseAmount(raw);
    if (n !== null) out[k] = n;
  }
  return out;
}

// 환율 — 참고 환산(koo 결정 08-27: 1엔 = 10원 고정). 바꿀 자리는 여기 한 곳.
// 집행은 저장하지 않고 계산하므로 이 값을 바꾸면 지난 달 숫자도 새 환율로 다시 계산된다(스펙 §2).
// 그게 문제가 되면 월별 환율 스냅샷을 그때 넣는다.
export const JPY_TO_KRW = 10;

export const BUDGET_AMOUNT_MESSAGE = '예산은 0 이상 숫자로 입력해 주세요';
export const MONTH_MESSAGE = '달 형식이 올바르지 않아요 (예: 2026-09)';
const MAX_ROWS = 12;

export type BudgetSource = 'override' | 'default' | 'none';
export interface MonthSpend { total: MoneyByCurrency; campaignCount: number }
export interface MonthRow {
  month: string; budget: number | null; source: BudgetSource;
  spentKrw: number; jpyIncluded: number; campaignCount: number;
  remaining: number | null;   // budget - spentKrw. budget이 null이면 null
}
// 캠페인 상세 카드용 — othersKrw는 같은 달 '다른' 캠페인의 환산 합. 이 캠페인 몫은 화면이 자기 합계(campaignTotal)를
// 더한다 — 비용 셀을 고치면 비용 합계 칸과 잔액 칸이 같은 순간에 같은 숫자로 움직여야 한다(UX 원칙 4).
export interface CampaignMonthBudget {
  month: string; amount: number | null; source: BudgetSource; othersKrw: number; campaignCount: number;
}

export function toKrw(total: MoneyByCurrency): { krw: number; jpyIncluded: number } {
  const jpy = total.JPY ?? 0;
  return { krw: (total.KRW ?? 0) + jpy * JPY_TO_KRW, jpyIncluded: jpy };
}

// 'YYYY-MM-DD'(서울 날짜 문자열) → 'YYYY-MM'. Date로 바꾸지 않는다 — 바꾸면 UTC 자정 시프트로 달이 갈린다.
export function monthOf(dateOnly: string): string {
  return dateOnly.slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12 + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

export function budgetForMonth(client: BudgetClient, month: string): { amount: number | null; source: BudgetSource } {
  const o = client.budgetOverrides[month];
  if (o !== undefined) return { amount: o, source: 'override' };
  if (client.monthlyBudget !== null) return { amount: client.monthlyBudget, source: 'default' };
  return { amount: null, source: 'none' };
}

export function remainingOf(amount: number | null, spentKrw: number): number | null {
  return amount === null ? null : amount - spentKrw;
}

// 범위: min(첫 캠페인 달, 이번 달) ~ 다음 달. 최신 위, 최대 12행(스펙 §4).
// 위 끝은 항상 다음 달로 고정 — 아주 먼 미래 캠페인이 있어도 이번 달·다음 달이 12행 상한에 밀려 표에서
// 사라지면 안 된다(그 캠페인들은 "이번 달 예산" 관심사가 아니다). 캠페인이 없으면 이번 달·다음 달 2행.
// 빈 달도 행을 만든다 — 표에서 그 달 예산을 고칠 자리가 필요하다.
export function budgetRows(client: BudgetClient, spend: Map<string, MonthSpend>, today: string): MonthRow[] {
  const thisMonth = monthOf(today);
  const months = [...spend.keys()].sort();
  const first = months.length && months[0] < thisMonth ? months[0] : thisMonth;
  const nextMonth = addMonths(thisMonth, 1);
  const last = nextMonth;
  const rows: MonthRow[] = [];
  for (let m = last; m >= first && rows.length < MAX_ROWS; m = addMonths(m, -1)) {
    const s = spend.get(m);
    const { amount, source } = budgetForMonth(client, m);
    const { krw, jpyIncluded } = toKrw(s?.total ?? {});
    rows.push({ month: m, budget: amount, source, spentKrw: krw, jpyIncluded, campaignCount: s?.campaignCount ?? 0,
                remaining: remainingOf(amount, krw) });
  }
  return rows;
}

export function campaignMonthBudget(
  client: BudgetClient, month: string, spend: MonthSpend | undefined, thisCampaignKrw: number,
): CampaignMonthBudget {
  const { amount, source } = budgetForMonth(client, month);
  const { krw } = toKrw(spend?.total ?? {});
  return { month, amount, source, othersKrw: Math.max(0, krw - thisCampaignKrw), campaignCount: spend?.campaignCount ?? 0 };
}

export function budgetJudgment(budget: number | null, remaining: number | null): string {
  if (budget === null || remaining === null) return '예산을 설정하면 잔액이 보여요';
  if (remaining < 0) return `${formatAmount(-remaining, 'KRW')} 초과`;
  return `${formatAmount(remaining, 'KRW')} 남음`;
}

export function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
}
export function monthShort(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

// 표·카드 ⓘ 공용 — 귀속 규칙·집계 범위·환율을 한 문장씩(스펙 §6-1, §7)
export function budgetTipText(): string {
  return `캠페인은 시작한 달에 잡혀요 · 캠페인에 넣은 콘텐츠 비용만 집계해요 · 엔화는 1엔 = ${JPY_TO_KRW}원으로 환산해요`;
}

// 예산 입력 검증 — null·빈 문자열은 '미설정'으로 허용, 그 외는 parseAmount(0 이상 안전 정수, 콤마 허용)
export function parseBudgetAmount(v: unknown): { ok: true; value: number | null } | { ok: false; message: string } {
  if (v === null || v === '' || v === undefined) return { ok: true, value: null };
  const n = parseAmount(v);
  return n === null ? { ok: false, message: BUDGET_AMOUNT_MESSAGE } : { ok: true, value: n };
}
