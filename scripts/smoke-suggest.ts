// 실 Anthropic API 스모크 (2콜, Haiku): 연관 제안(ja/ko) + 한국어→일본어 맥락 번역
import { suggestKeywords, translateKeyword } from '../src/lib/suggest.ts';

(async () => {
  const out = await suggestKeywords('레티날');
  console.log('[suggest]', JSON.stringify(out, null, 2));
  if (out.variants.length === 0 && out.adjacent.length === 0) {
    console.error('빈 결과 — 프롬프트/모델 확인 필요');
    process.exit(1);
  }
  if (!out.variants[0]?.ja || out.variants[0].ko === undefined) {
    console.error('ja/ko 쌍 형식 아님 — 프롬프트 확인 필요');
    process.exit(1);
  }

  const tr = await translateKeyword('모공 시술');
  console.log('[translate] 모공 시술 →', JSON.stringify(tr));
  if (!tr?.ja) {
    console.error('번역 실패');
    process.exit(1);
  }
})();
