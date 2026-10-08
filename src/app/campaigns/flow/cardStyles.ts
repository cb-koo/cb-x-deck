// 캠페인 상세 카드 2×2 공용 모양(koo 10-08 시안 B 값 그대로 — mock-values-cards.md). FlowCards·BudgetCard가 같이 쓴다.
// @container — 카드 안쪽 줄바꿈(좁은 카드)은 창이 아니라 카드 자신의 폭으로 판단한다. 좁은 카드 = 안쪽 폭 400px 미만(카드 약 440px 미만),
// 각 파일에 `@max-[400px]:` 글자 그대로 반복한다(Tailwind는 문자열 그대로만 찾으므로 접두어를 상수로 못 뺀다).
export const CARD = '@container flex min-w-0 flex-col rounded-[12px] border border-x-border bg-white px-[20px] py-[16px]';
export const LABEL_ROW = 'flex h-[28px] items-center justify-between gap-[8px]';
export const LABEL_WRAP = 'inline-flex min-w-0 items-center gap-[4px]';
// 좁으면 라벨(기간 포함)이 먼저 말줄임 — 오른쪽 버튼·링크는 그대로
export const LABEL = 'min-w-0 truncate text-[13px] font-semibold text-x-secondary';
// 큰 숫자 + 비교(COMP) — 좁으면 비교 부분이 통째로 다음 줄로 내려간다(숫자 쪽은 BIG_NUM으로 끊기지 않게)
export const BIG = 'text-[28px] font-extrabold leading-[34px] tabular-nums';
export const BIG_NUM = 'whitespace-nowrap';
export const COMP = 'ml-[4px] inline-block whitespace-nowrap text-[14px] font-normal text-x-muted';
export const BAR = 'flex h-[8px] overflow-hidden rounded-[4px] bg-[#eef2f4]';
// 작은 표(비용 통화별·예산 범례) — 라벨 칸(남는 폭, 좁으면 먼저 말줄임) + 금액 두 칸(내용 폭). 금액 칸을 고정 폭으로 두면
// 카드가 그만큼 넓어야 해서 2열 기준이 800px까지 올라갔다(10-08).
// 좁은 카드에선 13px·칸 간격 12px.
export const TBL = 'grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-[16px] tabular-nums @max-[400px]:gap-x-[12px]';
export const TBL_HEAD = 'flex h-[18px] items-center justify-end whitespace-nowrap text-[13px] text-x-muted';
export const TBL_KEY = 'h-[22px] min-w-0 truncate text-[14px] leading-[22px] text-x-secondary @max-[400px]:text-[13px]';
export const TBL_VAL = 'flex h-[22px] items-center justify-end gap-[6px] whitespace-nowrap text-[14px] text-x-text @max-[400px]:text-[13px]';
export const SWATCH = 'inline-block h-[10px] w-[10px] flex-none rounded-[2px]';
// 막대 색 — 진한 = 집행, 옅은 = 예정 / 파랑 = 이 캠페인, 회색 = 다른 캠페인
export const C_THIS_SPENT = 'bg-x-blue';
export const C_THIS_PENDING = 'bg-[#cfe6f7]';
export const C_OTHERS_SPENT = 'bg-x-muted';
export const C_OTHERS_PENDING = 'bg-[#d5dbe0]';
export const C_REST = 'bg-[#eef2f4] shadow-[inset_0_0_0_1px_#cfd9de]';
