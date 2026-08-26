// 성과 화면의 파생값 — 서버 요약과 클라 표시가 같은 함수를 쓴다(라벨-값 일치, influencerJudgment 선례).
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §읽기 모델
export const SAMPLE_EARLY = 20; // 도착이 이보다 적으면 탭률을 판단에 쓰지 말 것(흐리게 + 배지)
export const SAMPLE_REF = 50;   // 이보다 적으면 참고용
export type SampleState = 'early' | 'ref' | 'ok';
export function sampleState(arrivals: number): SampleState {
  return arrivals < SAMPLE_EARLY ? 'early' : arrivals < SAMPLE_REF ? 'ref' : 'ok';
}
export const SAMPLE_LABEL: Record<SampleState, string | null> = { early: '아직 판단 이르어요', ref: '참고용', ok: null };

// Wilson score 95% 신뢰구간 하한 — 단순 비율로 정렬하면 "2건 중 2건(100%)"이 "80건 중 8건" 위로 올라간다(Evan Miller).
// 화면에 보이는 값은 단순 비율 그대로 두고, 정렬 키로만 쓴다.
export function wilsonLower(successes: number, n: number, z = 1.96): number {
  if (n <= 0) return -1;
  const p = successes / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - spread) / denom;
}

export function rate(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den <= 0) return null;
  return num / den;
}
export function formatPct(r: number | null, digits = 0): string {
  return r === null ? '—' : `${(r * 100).toFixed(digits)}%`;
}

export interface PerfRow {
  key: string; title: string; influencerHandle: string; contentCount: number;
  views: number | null; clicks: number | null; arrivals: number; taps: number;
  postedAt: string | null;
}

// 같은 사람의 콘텐츠를 합친다 — 핸들은 소문자로 묶고(대소문자 표기 차이는 같은 사람), 표시는 첫 행의 표기.
// 조회는 콘텐츠당 1값(main)씩이라 그대로 더하면 된다; 값 없는 콘텐츠는 빼고 더하되 전부 없으면 null.
export function groupByInfluencer<T extends PerfRow>(rows: T[]): PerfRow[] {
  const map = new Map<string, PerfRow>();
  for (const r of rows) {
    const k = r.influencerHandle.toLowerCase();
    const g = map.get(k);
    if (!g) {
      map.set(k, { key: k, title: `@${r.influencerHandle}`, influencerHandle: r.influencerHandle, contentCount: 1,
                   views: r.views, clicks: r.clicks, arrivals: r.arrivals, taps: r.taps, postedAt: r.postedAt });
      continue;
    }
    g.contentCount += 1;
    g.views = r.views === null ? g.views : (g.views ?? 0) + r.views;
    g.clicks = r.clicks === null ? g.clicks : (g.clicks ?? 0) + r.clicks;
    g.arrivals += r.arrivals; g.taps += r.taps;
    if (r.postedAt && (!g.postedAt || r.postedAt < g.postedAt)) g.postedAt = r.postedAt;
  }
  return [...map.values()];
}

// 결정 카드: 탭 상위 n개가 전체 탭의 몇 %인가. 탭이 0이면 아직 말할 게 없다(share null).
export function topShare(rows: ReadonlyArray<{ title: string; taps: number }>, n = 3): { share: number | null; titles: string[] } {
  const total = rows.reduce((s, r) => s + r.taps, 0);
  if (total === 0) return { share: null, titles: [] };
  const top = [...rows].sort((a, b) => b.taps - a.taps).slice(0, n).filter((r) => r.taps > 0);
  return { share: top.reduce((s, r) => s + r.taps, 0) / total, titles: top.map((r) => r.title) };
}

export type PerfSortKey = 'taps' | 'arrivals' | 'clicks' | 'views' | 'clickRate' | 'tapRate' | 'contribution' | 'postedAt';

// 값이 없는 행(null)은 방향과 무관하게 맨 뒤 — '모름'이 0이나 최댓값처럼 끼면 순서가 거짓말이 된다(tracking 관례).
export function sortRows<T extends PerfRow>(rows: T[], key: PerfSortKey, dir: 'asc' | 'desc'): T[] {
  const val = (r: T): number | null => {
    switch (key) {
      case 'taps': case 'contribution': return r.taps;   // 기여 = 탭/Σ탭 — 순서는 탭과 같다
      case 'arrivals': return r.arrivals;
      case 'clicks': return r.clicks;
      case 'views': return r.views;
      case 'clickRate': return rate(r.clicks, r.views);
      case 'tapRate': return r.arrivals > 0 ? wilsonLower(r.taps, r.arrivals) : null;
      case 'postedAt': return r.postedAt ? Date.parse(r.postedAt) : null;
    }
  };
  // 탭률만 표본 부족 행을 뒤로 보낸다 — Wilson 하한은 "2/2가 8/80보다 높다"고 (통계적으로 옳게) 말하지만,
  // 화면의 약속은 "방문이 적은 건 뒤로"다. 방향과 무관하게 뒤, 그 안에서는 하한 순.
  const group = (r: T): number => (key === 'tapRate' && r.arrivals > 0 && sampleState(r.arrivals) === 'early' ? 1 : 0);
  return [...rows].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const g = group(a) - group(b);
    if (g !== 0) return g;
    const cmp = va - vb;
    return dir === 'desc' ? -cmp : cmp;
  });
}
