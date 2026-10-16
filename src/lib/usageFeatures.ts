const FEATURE: Record<string, string> = {
  'reservation.extract': '예약 응답 정리',
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
  'anthropic.influencerClassify': '계정 분석',
  'anthropic.influencerClassifyRt': '계정 분석',
  'anthropic.influencerNormalize': '계정 분석',
  'anthropic.influencerSynth': '계정 분석',
  'anthropic.trendTranslate': '검색 트렌드 번역',
  'anthropic.trendDiscover': '검색 트렌드 새 후보 분류',
  'anthropic.trendMeaning': '검색 트렌드 뜻 확인',
  'anthropic.trendAltSpell': '검색 트렌드 다른 표기 찾기',
  'googleads.historical': '검색 트렌드 수집',
  'googleads.ideas': '검색 트렌드 수집',
};

// 알려진 operation은 사용자 언어 라벨로, 그 외에는 제공사별 '기타'로 — 내부 원문(anthropic.translate·probe 등)을 화면에 노출하지 않는다.
export function featureLabel(operation: string): string {
  if (FEATURE[operation]) return FEATURE[operation];
  if (operation.startsWith('getxapi.')) return 'X 데이터 (기타)';
  if (operation.startsWith('exa.')) return '웹 검색 (기타)';
  if (operation.startsWith('anthropic.')) return 'AI (기타)';
  if (operation.startsWith('googleads.')) return '검색 트렌드 수집';
  return '기타';
}

const API: Record<string, string> = {
  getxapi: 'getxapi (X 데이터)',
  exa: 'Exa (웹 검색)',
  anthropic: 'Anthropic (AI)',
  googleads: 'Google Ads (검색량, 무료)',
};

export function apiLabel(api: string): string {
  return API[api] ?? api;
}
