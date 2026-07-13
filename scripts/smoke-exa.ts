// 실 exa API 스모크 (검색 1콜, ~$0.005): 계약(스키마) 검증 + 일본어 기사 수확 확인
import { makeExaClient } from '../src/lib/exa.ts';

(async () => {
  const results = await makeExaClient().search('毛穴ケア 最新 トレンド 記事', { numResults: 3, maxCharacters: 500 });
  console.log('[exa]', results.length, '건');
  for (const r of results) console.log('-', r.publishedDate?.slice(0, 10) ?? '????-??-??', r.title, r.url);
  if (results.length === 0) {
    console.error('빈 결과 — 쿼리/계약 확인 필요');
    process.exit(1);
  }
  if (!results[0].url || typeof results[0].text !== 'string') {
    console.error('결과 스키마 이상 — exa API 계약 변화 의심');
    process.exit(1);
  }
})();
