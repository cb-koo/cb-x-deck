// 캠페인 상세 카드 2×2 공용 모양(koo 10-08 시안 B 값 그대로 — mock-values-cards.md). FlowCards·BudgetCard가 같이 쓴다.
export const CARD = 'flex min-w-0 flex-col rounded-[12px] border border-x-border bg-white px-[20px] py-[16px]';
export const LABEL_ROW = 'flex h-[28px] items-center justify-between gap-[8px]';
export const LABEL_WRAP = 'inline-flex min-w-0 items-center gap-[4px]';
export const LABEL = 'whitespace-nowrap text-[13px] font-semibold text-x-secondary';
export const BIG = 'text-[28px] font-extrabold leading-[34px] tabular-nums whitespace-nowrap';
export const COMP = 'ml-[4px] text-[14px] font-normal text-x-muted';
export const BAR = 'flex h-[8px] overflow-hidden rounded-[4px] bg-[#eef2f4]';
// 작은 표(비용 통화별·예산 범례) — 라벨 칸 + 금액 두 칸(130px 고정)
export const TBL = 'grid grid-cols-[1fr_130px_130px] gap-x-[12px] tabular-nums';
export const TBL_HEAD = 'flex h-[18px] items-center justify-end whitespace-nowrap text-[13px] text-x-muted';
export const TBL_KEY = 'flex h-[22px] items-center whitespace-nowrap text-[14px] text-x-secondary';
export const TBL_VAL = 'flex h-[22px] items-center justify-end gap-[6px] whitespace-nowrap text-[14px] text-x-text';
export const SWATCH = 'inline-block h-[10px] w-[10px] flex-none rounded-[2px]';
// 막대 색 — 진한 = 집행, 옅은 = 예정 / 파랑 = 이 캠페인, 회색 = 다른 캠페인
export const C_THIS_SPENT = 'bg-x-blue';
export const C_THIS_PENDING = 'bg-[#cfe6f7]';
export const C_OTHERS_SPENT = 'bg-x-muted';
export const C_OTHERS_PENDING = 'bg-[#d5dbe0]';
export const C_REST = 'bg-[#eef2f4] shadow-[inset_0_0_0_1px_#cfd9de]';
