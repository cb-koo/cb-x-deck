// 클라이언트 월 마케팅 예산의 순수 로직 — 환율 상수, 원화 환산, 귀속 달, 표 행, 문구, 입력 검증.
// 서버(라우트·스토어)와 화면(BudgetPanel·SummaryCards)이 같은 함수를 쓴다(스펙 2026-08-27 §4).
import { parseAmount } from './campaignCost.ts';

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
