// 투어 스텝 정의 — 순수 데이터. 문구는 AGENTS.md UX 원칙(이득을 사용자 언어로,
// 비용 액션은 '팀 공용·누를 때만·아주 소액')을 따른다.
export interface TourStep {
  id: string;
  element?: string; // CSS 셀렉터. 없으면 화면 중앙 표시.
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

// 첫 컬럼을 직접 만들게 유도하는 도입부 (컬럼 0개일 때만)
const DECK_INTRO_STEPS: TourStep[] = [
  {
    id: 'deck-intro',
    title: '덱에 오신 걸 환영해요',
    description: '여기 <b>덱</b>은 관심 주제·계정의 X 글을 컬럼으로 모아 한눈에 보는 곳이에요. 첫 컬럼을 직접 만들어볼까요?',
  },
  {
    id: 'add-column',
    element: '[data-tour="add-column"]',
    title: '컬럼 만들기',
    description: '여기를 눌러 <b>키워드</b>(관심 주제)나 <b>인플루언서</b>(특정 계정) 컬럼을 만들어요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'create-modal',
    element: '[data-tour="column-modal"]',
    title: '주제나 계정 넣기',
    description: '주제나 계정을 넣고 만들면 돼요. 입력창 옆 도움말이 어떤 값을 넣을지 알려줘요.',
    side: 'left',
    align: 'start',
  },
];

// 만들어진 컬럼 위에서 핵심 사용법 설명
const DECK_COLUMN_STEPS: TourStep[] = [
  {
    id: 'col-refresh',
    element: '[data-tour="col-refresh"]',
    title: '새로고침으로 최신 글 가져오기',
    description: '컬럼은 <b>새로고침을 눌러야</b> 최신 글을 가져와요. 팀 공용이고 누를 때만, 아주 소액이라 부담 없이 눌러도 돼요. 새로 올라온 글엔 파란 <b>NEW</b> 배지가 붙어요.',
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'col-save',
    element: '[data-tour="col-save"]',
    title: '마음에 드는 글 저장하기',
    description: '마음에 드는 글은 <b>저장</b>하면 보관함에 모여, 팀원과 코멘트를 나눌 수 있어요.',
    side: 'top',
    align: 'start',
  },
  {
    id: 'deck-outro',
    title: '준비 끝!',
    description: '오른쪽 위 <b>?</b> 로 언제든 이 안내를 다시 볼 수 있어요. 글이 며칠 쌓이면 <b>브리핑</b>에서 흐름을 보고서로 받아보세요.',
  },
];

export function deckSteps(hasColumns: boolean): TourStep[] {
  return hasColumns ? DECK_COLUMN_STEPS : [...DECK_INTRO_STEPS, ...DECK_COLUMN_STEPS];
}

export const BRIEFING_STEPS: TourStep[] = [
  {
    id: 'bf-intro',
    title: '브리핑이란',
    description: '<b>브리핑</b>은 컬럼 하나의 최근 몇 주를 AI가 읽고 보고서로 정리해줘요. 컬럼에 글이 며칠~몇 주 쌓인 뒤에 유용해요.',
  },
  {
    id: 'bf-column',
    element: '[data-tour="bf-column"]',
    title: '컬럼 고르기',
    description: '먼저 정리할 <b>컬럼을 하나</b> 고르세요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-period',
    element: '[data-tour="bf-period"]',
    title: '기간 정하기',
    description: '<b>몇 주간</b>을 볼지 정해요. 빈 주가 있으면 채우기 안내가 떠요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-generate',
    element: '[data-tour="bf-generate"]',
    title: '보고서 생성',
    description: '<b>브리핑 생성</b>을 누르면 보고서가 만들어져요. 누를 때만, 아주 소액(약 $0.1 이하)이고 팀 공용이라 부담 없이 눌러도 돼요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-history',
    element: '[data-tour="bf-history"]',
    title: '지난 보고서 다시 보기',
    description: '만든 보고서는 여기 <b>지난 브리핑</b>에 쌓여 언제든 다시 봐요.',
    side: 'top',
    align: 'start',
  },
];
