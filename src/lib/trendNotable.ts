// 주목 시술 — 한국 클리닉의 일본 마케팅에서 볼 만한 변화(koo 10-15). 태그(지금 방향)와 따로, 지도 이름·굵은 점·'주목' 필터가 이 기준 하나를 쓴다.
// ① 성장: 1년 새 월 검색이 1,000건 이상 늘었고(+30% 이상 또는 신규) 지금 꺾이지 않음 — 늘어난 검색 수가 곧 잡을 수 있는 수요.
//    1,000건 = 중간 규모(중앙값 월 4천) 시술에서 반올림 한 칸(약 20%)보다 큰 증가 · +30% = 큰 시술의 출렁임(이소트레티노인 +16%) 거르기.
//    500~1,000건 사이에선 결과가 같다(12개, 10-15 확인).
// ② 한국 수요: 한국에서 받으려는 검색(韓国·ソウル·江南·明洞·弘大 조합)이 1년 새 월 100건 이상 늘었고 지금 월 100 이상 — 숫자가 작아 %는 쓰지 않는다.
import type { TrendSummary } from './searchTrend';

export const NOTABLE = { growthAbs: 1000, growthPct: 0.3, koreaAbs: 100, koreaNow: 100 } as const;

export interface Notable {
  growth: { abs: number; pct: number | null } | null;  // pct null = 신규(1년 전 소량)
  korea: { now: number; abs: number } | null;
}

const avg3 = (v: number[], end: number) => v.slice(end - 3, end).reduce((s, x) => s + x, 0) / 3;
const FALLING: ReadonlySet<TrendSummary['state']> = new Set(['down', 'peaked', 'spiked', 'low', 'nodata']);

export function notableOf(s: TrendSummary, series: number[] | null, korea: number[] | null): Notable | null {
  let growth: Notable['growth'] = null, k: Notable['korea'] = null;
  if (series && series.length >= 15 && !FALLING.has(s.state)) {
    const n = series.length, abs = avg3(series, n) - avg3(series, n - 12);
    if (abs >= NOTABLE.growthAbs && (s.change === null || s.change >= NOTABLE.growthPct)) growth = { abs, pct: s.change };
  }
  if (korea && korea.length >= 15) {
    const n = korea.length, now = avg3(korea, n), abs = now - avg3(korea, n - 12);
    if (now >= NOTABLE.koreaNow && abs >= NOTABLE.koreaAbs) k = { now, abs };
  }
  return growth || k ? { growth, korea: k } : null;
}

const NUM = new Intl.NumberFormat('ko-KR');
// 주목 이유 문장 — 표 ★ 툴팁·상세 요약이 같이 쓴다
export function notableText(n: Notable): string[] {
  const out: string[] = [];
  if (n.growth) out.push(`1년 새 월 +${NUM.format(Math.round(n.growth.abs))}건${n.growth.pct === null ? '(신규)' : `(+${Math.round(n.growth.pct * 100)}%)`}, 지금도 유지`);
  if (n.korea) out.push(`한국에서 받으려는 검색 1년 새 +${NUM.format(Math.round(n.korea.abs))}건(지금 월 ${NUM.format(Math.round(n.korea.now))})`);
  return out;
}
