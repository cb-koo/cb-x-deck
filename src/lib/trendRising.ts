// 늘어난 검색 판정(새로 뜨는 검색 찾기·시술별 연관 검색어의 '목록 밖' 모으기가 같이 쓴다) — 서로 부르는 두 모듈 사이에 둔다.
export interface RawCandidate { text: string; now: number; yearAgo: number; increase: number; series: number[] }

// 문턱 — 주목 시술(trendNotable)보다 낮게: 아직 작은 새 말을 일찍 잡는 게 목적
export const DISCOVER = { minVolume: 300, minIncrease: 300, minRatio: 1.3, newBelow: 100 } as const;

const avg3 = (v: number[], end: number) => v.slice(end - 3, end).reduce((s, x) => s + x, 0) / 3;

// 늘어난 검색만 — 월 300 이상, 1년 새 +300건 이상, +30% 이상(1년 전 거의 없으면 신규로 통과)
export function risingOnly(rows: Array<{ text: string; series: number[] }>): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const r of rows) {
    const n = r.series.length;
    if (n < 15) continue;
    const now = avg3(r.series, n), yearAgo = avg3(r.series, n - 12), increase = now - yearAgo;
    if (now < DISCOVER.minVolume || increase < DISCOVER.minIncrease) continue;
    if (yearAgo >= DISCOVER.newBelow && now / yearAgo < DISCOVER.minRatio) continue;
    out.push({ text: r.text, now: Math.round(now), yearAgo: Math.round(yearAgo), increase: Math.round(increase), series: r.series });
  }
  return out;
}

