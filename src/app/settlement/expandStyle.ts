// 정산 요청 펼침의 흰 카드 모양(10-07 koo QA 시안 A) — 요약 카드·두 카드·개정 이력이 같은 클래스를 쓴다.
// 카드 20~22px 안쪽 여백·16px 간격 / 본문 15px·라벨 14px·묶음 제목 13px 굵게 흐림 / 라벨 열 92px.
export const CARD_BOX = 'flex min-w-0 flex-col rounded-xl border border-x-border bg-white px-[22px] py-5';
export const CARD = `${CARD_BOX} gap-4`;
export const CARD_HEAD = 'flex items-baseline justify-between gap-3';
export const CARD_META = 'text-[14px] text-x-muted';
export const ROW = 'grid grid-cols-[92px_1fr] gap-x-4 text-content leading-normal';
export const ROW_KEY = 'text-x-secondary';
export const GROUP = 'flex flex-col gap-2.5';
export const GROUP_TITLE = 'text-ui font-semibold tracking-[.02em] text-x-muted';
export const DIVIDER = 'h-px bg-x-border';
export const SUB = 'text-[14px] text-x-muted';
