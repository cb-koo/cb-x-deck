// 투어 스텝 정의 — 순수 데이터. 문구는 AGENTS.md UX 원칙(이득을 사용자 언어로,
// 비용 액션은 '팀 공용·누를 때만·아주 소액')을 따른다.
export interface TourStep {
  id: string;
  element?: string; // CSS 셀렉터. 없으면 화면 중앙 표시. 요소가 없으면 자동 건너뜀(skipMissingElement).
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
}

// 덱 투어 — 항상 '컬럼 생성부터' 시작하는 하나의 시나리오.
// 컬럼이 이미 있는 사용자가 생성 단계를 넘겨도(모달을 열지 않으면) 해당 스텝은 요소가 없어 자동 건너뛰어진다.
const DECK_STEPS: TourStep[] = [
  {
    id: 'deck-intro',
    title: '덱에 오신 걸 환영해요',
    description: '여기 <b>덱</b>은 관심 주제·계정의 X 글을 컬럼으로 모아 한눈에 보는 곳이에요. 컬럼을 만들며 하나씩 익혀볼게요.',
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
    description: '주제나 계정을 넣고 만들면 돼요. 각 입력창의 라벨과 도움말이 어떤 값을 넣을지 알려줘요.',
    side: 'left',
    align: 'start',
  },
  {
    id: 'col-refresh',
    element: '[data-tour="col-refresh"]',
    title: '새로고침으로 최신 글 가져오기',
    description: '컬럼은 <b>새로고침을 눌러야</b> 최신 글을 가져와요. 팀 공용이고 누를 때만, 아주 소액이라 부담 없이 눌러도 돼요. 새로 올라온 글엔 파란 <b>NEW</b> 배지가 붙어요.',
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'col-sort',
    element: '[data-tour="col-sort"]',
    title: '정렬 바꾸기',
    description: '<b>날짜·조회수·북마크·RT</b> 기준으로 글 순서를 바꿔요. 같은 기준을 한 번 더 누르면 오름/내림이 뒤집혀요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'col-view',
    element: '[data-tour="col-view"]',
    title: '다른 목록 보기',
    description: "<b>'보기'</b>에서 벤치마크와 무관해 <b>버림(숨긴 트윗)</b> 같은 다른 목록도 볼 수 있어요.",
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'col-translate',
    element: '[data-tour="col-translate"]',
    title: '외국어 글 한국어로 보기',
    description: '영어·일본어 등 외국어 글은 <b>🌐 번역</b>을 누르면 <b>AI가</b> 한국어로 바꿔줘요. 자동 번역이라 어색하거나 뜻이 안 맞을 수 있으니, 중요한 내용은 원문도 함께 확인하세요. 팀 공용이고 누를 때만, 아주 소액이에요.',
    side: 'top',
    align: 'start',
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
    id: 'deck-sidebar',
    element: '[data-tour="sidebar"]',
    title: '영역·워크스페이스 오가기',
    description: '왼쪽에서 <b>리서치·덱·브리핑·보관함</b>을 오가고, 맨 위에서 <b>워크스페이스</b>(클라이언트별 작업 공간)를 바꿔요.',
    side: 'right',
    align: 'start',
  },
  {
    id: 'deck-outro',
    element: '[data-tour="help-button"]',
    title: '준비 끝!',
    description: '바로 여기 <b>?</b> 를 누르면 언제든 이 안내를 다시 볼 수 있어요. 글이 며칠 쌓이면 <b>브리핑</b>에서 흐름을 보고서로 받아보세요.',
    side: 'bottom',
    align: 'end',
  },
];

export function deckSteps(): TourStep[] {
  return DECK_STEPS;
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
    description: '<b>몇 주간</b>을 볼지 정해요. 중간에 글이 없는 주가 있으면 <b>빈 주 채우기</b> 안내가 떠서 과거 글을 더 모아 정확도를 높일 수 있어요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-generate',
    element: '[data-tour="bf-generate"]',
    title: '보고서 생성',
    description: '<b>브리핑 생성</b>을 누르면 보고서가 만들어져요. 누를 때만, 아주 소액(약 $0.1 이하)이고 팀 공용이라 부담 없이 눌러도 돼요. 표본이 적으면 <b>참고용</b> 표시가 함께 떠요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'bf-result',
    element: '[data-tour="bf-result"]',
    title: '보고서 읽기',
    description: '완성된 보고서는 여기 열려요. 문단 사이에 <b>근거가 된 실제 트윗</b>이 함께 실려 있어 바로 확인할 수 있어요.',
    side: 'top',
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
  {
    id: 'bf-outro',
    element: '[data-tour="help-button"]',
    title: '브리핑 끝!',
    description: '바로 여기 <b>?</b> 를 누르면 언제든 다시 볼 수 있어요. 먼저 덱에서 컬럼에 글을 며칠 쌓은 뒤 브리핑을 만들면 가장 잘 나와요.',
    side: 'bottom',
    align: 'end',
  },
];
