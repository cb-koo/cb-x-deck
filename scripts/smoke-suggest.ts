// 실 Anthropic API 스모크 (1콜, Haiku)
import { suggestKeywords } from '../src/lib/suggest.ts';

(async () => {
  const out = await suggestKeywords('レチナール');
  console.log(JSON.stringify(out, null, 2));
  if (out.variants.length === 0 && out.adjacent.length === 0) {
    console.error('빈 결과 — 프롬프트/모델 확인 필요');
    process.exit(1);
  }
})();
