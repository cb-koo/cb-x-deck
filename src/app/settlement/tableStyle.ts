// 정산 표(검토 대기·요청 내역) 공용 모양(koo 09-28) — 행 하나 = 작업·요청 하나, 칸마다 값 하나.
// 숫자 칸은 오른쪽 정렬·고정폭 숫자(tabular-nums)라 자릿수가 위아래로 맞는다. 유형 칩은 캠페인 표와 같은 색(flowChips).
import { TYPE_CHIP as FLOW_TYPE_CHIP } from '@/lib/flowChips';
import { formatMoney } from '@/lib/influencerPricing';
import type { TaskType } from '@/lib/campaignJudgment';

export const CELL = 'h-12 whitespace-nowrap border-b border-x-border/60 px-3 align-middle';
export const HEAD = 'whitespace-nowrap border-b border-x-border bg-x-surface px-3 py-2.5 text-left text-ui font-semibold text-x-secondary';
// 표 열 수 — 인플루언서 | 유형 | 작업 금액 | 송금액 | 정산팀 지급 | 차이 | 결제 수단 | 상태 · 처리 | ▸ (스펙 2026-10-07 §8-3)
export const COLS = 9;
export const NUM = 'text-right tabular-nums';
export const GROUP = 'border-b border-x-border bg-x-surface px-3 py-2 text-ui';
export const TYPE_CHIP: Record<TaskType, string> = Object.fromEntries(
  Object.entries(FLOW_TYPE_CHIP).map(([k, v]) => [k, `inline-block rounded-full px-2 py-0.5 text-ui ${v}`]),
) as Record<TaskType, string>;
export const METHOD_CHIP = 'inline-block rounded-md border border-x-border px-2 py-0.5 text-ui text-x-secondary';

// '+500엔' / '−7,007원' — 부호를 앞에(차액 칸은 숫자 하나). 0은 부호 없이('−0원'이 되지 않게)
export function signedMoney(n: number, currency: 'KRW' | 'JPY'): string {
  if (n === 0) return formatMoney(0, currency);
  return `${n > 0 ? '+' : '−'}${formatMoney(Math.abs(n), currency)}`;
}

// 캠페인별 묶음 — 원래 순서를 지키며 첫 등장 순으로(목록이 이미 최신순이라 묶음도 최신 캠페인이 위)
export function groupByCampaign<T extends { campaignId: string | null; campaignName: string; clientName: string }>(rows: T[]): Array<{ key: string; campaignName: string; clientName: string; rows: T[] }> {
  const out: Array<{ key: string; campaignName: string; clientName: string; rows: T[] }> = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    const key = r.campaignId ?? `name:${r.campaignName}`;
    let i = idx.get(key);
    if (i === undefined) { i = out.length; idx.set(key, i); out.push({ key, campaignName: r.campaignName, clientName: r.clientName, rows: [] }); }
    out[i].rows.push(r);
  }
  return out;
}
