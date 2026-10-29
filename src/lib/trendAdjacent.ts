// 검색어 구성 — 시술 관련 검색어(시술명 단독 검색 제외)를 시술 관련 / 화장품·홈케어 관련(시술 밖 관심)으로 나눈 최근 1년 사실값.
// 해석·평가 없이 비율과 월 검색량만(10-29 koo). 화장품·홈케어 관련이 10% 미만이면 보여 주지 않는다.
export const ADJACENT_MIN_SHARE = 0.1;

const avg12 = (xs: number[] | undefined) => (xs ?? []).slice(-12).reduce((a, b) => a + b, 0) / 12;

export interface AdjacentSplit {
  treatment: number;   // 시술 관련 월평균(이름만 검색 제외)
  adjacent: number;    // 화장품·홈케어 관련 월평균
  nameOnly: number;    // 시술명 단독 검색 월평균(비율에서 뺀 것)
  adjacentShare: number;
}

// noName = 이름만 검색을 뺀 시술 검색, total = 이름만 검색을 포함한 시술 검색(둘 다 다른 뜻·제외·시술 밖 관심 제외)
export function adjacentSplit(it: { total: number[]; noName: number[]; adjacent?: number[] } | null): AdjacentSplit | null {
  if (!it?.adjacent) return null;
  const treatment = avg12(it.noName), adjacent = avg12(it.adjacent);
  if (treatment + adjacent <= 0) return null;
  const adjacentShare = adjacent / (treatment + adjacent);
  if (adjacentShare < ADJACENT_MIN_SHARE) return null;
  return { treatment, adjacent, nameOnly: Math.max(0, avg12(it.total) - treatment), adjacentShare };
}
