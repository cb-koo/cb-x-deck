const FEATURE: Record<string, string> = {
  'getxapi.search': '트윗 검색',
  'getxapi.userTweets': '인플루언서 갱신',
  'getxapi.userInfo': '계정 조회',
  'getxapi.tweetDetail': '인용 트윗 조회',
  'getxapi.replies': '트윗 확장 탐색',
  'getxapi.thread': '트윗 확장 탐색',
  'getxapi.retweeters': '트윗 확장 탐색',
  'exa.search': '웹 기사 검색',
  'anthropic.suggest': '키워드 추천',
  'anthropic.translate': '번역',
  'anthropic.translateKeyword': '번역',
  'anthropic.translateTags': '번역',
  'anthropic.briefing': '브리핑 생성',
  'anthropic.pillar': '주제별로 묶기',
  'anthropic.research': '리서치 요약',
  'anthropic.draft': '원고 생성',
  'anthropic.draftRegen': '원고 부분 재생성',
  'anthropic.draftRewrite': '원고 다시 쓰기',
  'anthropic.draftTranslate': '원고 번역',
};

// 알려진 operation은 사용자 언어 라벨로, 그 외에는 제공사별 '기타'로 — 내부 원문(anthropic.translate·probe 등)을 화면에 노출하지 않는다.
export function featureLabel(operation: string): string {
  if (FEATURE[operation]) return FEATURE[operation];
  if (operation.startsWith('getxapi.')) return 'X 데이터 (기타)';
  if (operation.startsWith('exa.')) return '웹 검색 (기타)';
  if (operation.startsWith('anthropic.')) return 'AI (기타)';
  return '기타';
}

const API: Record<string, string> = {
  getxapi: 'getxapi (X 데이터)',
  exa: 'Exa (웹 검색)',
  anthropic: 'Anthropic (AI)',
};

export function apiLabel(api: string): string {
  return API[api] ?? api;
}
