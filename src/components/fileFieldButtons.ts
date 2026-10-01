// 첨부 칸(RT 증빙 TaskProofField·협찬 동의서 AgreementField)이 함께 쓰는 버튼 모양 — 한 칸 안의 버튼은 역할로 무게를 나눈다
// (동의서 파일 카드 8d225ed가 처음 정한 체계, koo 10-01 두 칸을 맞춤): 주 동작(보기·크게 보기) = 테두리, 보조(바꾸기·받기) = 옅은 버튼,
// 지우기 = 휴지통 아이콘(되돌릴 수 없는 쪽이라 가장 작게). 높이 h-8·둥근 모양으로 맞춘다. 파란 글자 링크 나열은 쓰지 않는다.
export const FILE_BTN_PRIMARY =
  'h-8 shrink-0 rounded-full border border-x-border-strong bg-white px-3 text-ui font-semibold text-x-text hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-50';
export const FILE_BTN_LIGHT =
  'h-8 shrink-0 rounded-full px-3 text-ui text-x-secondary hover:bg-x-hover disabled:cursor-not-allowed disabled:opacity-50';
export const FILE_BTN_TRASH =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-x-muted hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50';
// 휴지통 아이콘 path(24×24, stroke) — 두 칸이 같은 그림을 쓴다
export const TRASH_ICON_PATH = 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3';
// 아이콘만 있는 보조 버튼(받기 등) — 휴지통과 같은 크기, 위험하지 않은 동작이라 빨간 hover 대신 옅은 회색
export const FILE_BTN_ICON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-x-secondary hover:bg-x-hover hover:text-x-text disabled:cursor-not-allowed disabled:opacity-50';
// 받기(⤓) 아이콘 path(24×24, stroke) — 휴지통과 같은 선 굵기·끝 모양으로 그린다
export const DOWNLOAD_ICON_PATH = 'M12 4v11M7 10l5 5 5-5M5 20h14';
