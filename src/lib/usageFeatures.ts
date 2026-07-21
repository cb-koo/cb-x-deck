const FEATURE: Record<string, string> = {
  'getxapi.search': '트윗 검색',
  'getxapi.userTweets': '인플루언서 갱신',
  'getxapi.userInfo': '계정 조회',
  'getxapi.tweetDetail': '인용 트윗 보강',
  'getxapi.replies': '트윗 확장 탐색',
  'getxapi.thread': '트윗 확장 탐색',
  'getxapi.retweeters': '트윗 확장 탐색',
  'exa.search': '웹 기사 검색',
  'anthropic.suggest': '키워드 추천',
  'anthropic.translateKeyword': '번역',
  'anthropic.translateTags': '번역',
  'anthropic.briefing': '브리핑 생성',
  'anthropic.pillar': '기둥 분석',
  'anthropic.research': '리서치 요약',
};

export function featureLabel(operation: string): string {
  return FEATURE[operation] ?? operation;
}

const API: Record<string, string> = {
  getxapi: 'getxapi (X 데이터)',
  exa: 'Exa (웹 검색)',
  anthropic: 'Anthropic (AI)',
};

export function apiLabel(api: string): string {
  return API[api] ?? api;
}
