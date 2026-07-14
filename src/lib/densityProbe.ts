// 밀도 프로브: 최근 7일 표본의 좋아요 분포로 min_faves 컷라인을 제안한다.
// 실측 근거: 니치 밀도가 극단적으로 다름(브로드 1만+/주 vs 좁은 시술 300+가 11건).
const PAGE = 20;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const k = (sorted.length - 1) * p;
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f);
}

export function suggestMinFaves(likes: number[], sampleSize: number): { suggested: number; density: 'high' | 'low' } {
  if (sampleSize < PAGE) return { suggested: 100, density: 'low' };
  const sorted = [...likes].sort((a, b) => a - b);
  const p25 = percentile(sorted, 0.25);
  return { suggested: Math.max(100, Math.round(p25)), density: 'high' };
}
