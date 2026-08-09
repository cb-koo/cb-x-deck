// 투어 스텝 정의 — 순수 데이터. 문구는 AGENTS.md UX 원칙(이득을 사용자 언어로,
// 비용 액션은 '팀 공용·누를 때만·아주 소액')을 따른다.
//
// 여기의 `element` 셀렉터는 컴포넌트의 `data-tour` 속성과 짝이다. 짝이 깨지면 driver.js가
// skipMissingElement로 **조용히** 그 스텝을 건너뛰므로 아무도 눈치채지 못한다 —
// tourAnchors.test.ts가 실제 소스에 앵커가 남아 있는지 검사해 그 회귀를 막는다.
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
    description: "<b>'보기'</b>에서 <b>버림</b> 목록도 볼 수 있어요. 벤치마크와 무관한 글은 카드 아래 <b>✕ 버림</b>으로 치우면 이 목록으로 가고, 거기서 <b>되돌리기</b>도 돼요.",
    side: 'bottom',
    align: 'end',
  },
  {
    id: 'col-analyze',
    element: '[data-tour="col-analyze"]',
    title: '쌓인 글로 결과 만들기',
    description: '이 <b>분석</b> 줄은 컬럼에 쌓인 글을 재료로 새 결과를 만들어요. <b>주간 추이</b>는 추가 비용 없이 흐름을 보여주고, 인플루언서 컬럼에는 <b>주제별로 묶기</b>가 더 있어요. <b>돈이 드는 버튼에는 금액이 적혀 있어요</b>(예: ~$0.05) — 적혀 있지 않으면 공짜예요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'col-translate',
    element: '[data-tour="col-translate"]',
    title: '외국어 글 한국어로 보기',
    description: '<b>전체 번역</b>을 누르면 지금 불러온 글이 위에서부터 한국어로 바뀌어요. 한 건만 보고 싶으면 카드 안의 <b>🌐 번역</b>을 눌러도 돼요. <b>AI 자동 번역</b>이라 어색하거나 뜻이 안 맞을 수 있으니 중요한 내용은 원문도 함께 확인하세요. 한 번 번역하면 저장돼서 다시 볼 땐 비용이 들지 않아요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'col-save',
    element: '[data-tour="col-save"]',
    title: '마음에 드는 글 저장하기',
    description: '마음에 드는 글은 <b>저장</b>하면 보관함에 모여요. 저장하는 순간 <b>메모 한 줄</b>을 적는 칸이 열려요 — 왜 담았는지 남겨두면 나중에 팀원과 이야기하기 좋아요(비워둬도 괜찮아요).',
    side: 'top',
    align: 'start',
  },
  {
    id: 'col-reorder',
    element: '[data-tour="col-reorder"]',
    title: '컬럼 순서 바꾸기',
    description: '컬럼이 <b>2개 이상</b>이면 제목 왼쪽에 <b>손잡이</b>가 생겨요. 끌어서 옮기거나, 손잡이를 클릭한 뒤 <b>← →</b> 키로도 옮길 수 있어요. 자주 보는 컬럼을 왼쪽에 두세요. 순서는 팀 전체에 저장돼요.',
    side: 'bottom',
    align: 'start',
  },
  {
    id: 'deck-sidebar',
    element: '[data-tour="sidebar"]',
    title: '영역·워크스페이스 오가기',
    description: '왼쪽에서 <b>리서치·덱·브리핑·보관함</b>을 오가고, 맨 위에서 <b>워크스페이스</b>(팀 공용 작업 공간)를 바꿔요.',
    side: 'right',
    align: 'start',
  },
  {
    id: 'deck-outro',
    element: '[data-tour="help-button"]',
    title: '준비 끝!',
    description: '<b>덱</b>과 <b>브리핑</b> 화면에는 이렇게 <b>?</b> 가 있어서, 누르면 그 화면의 안내를 언제든 다시 볼 수 있어요. 글이 며칠 쌓이면 <b>브리핑</b>에서 흐름을 보고서로 받아보세요.',
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
