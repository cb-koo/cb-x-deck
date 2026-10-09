// '평소' 규칙 — 키트 전체가 이 하나만 쓴다(차트마다 다른 계산 금지).
// 평소 범위 = 최근 8주(그 차트가 보여 주는 기간) 값의 가운데 절반(하위 25% ~ 상위 25% 사이).
// 크게 튄 값 = 평소 범위 위쪽 끝의 2배를 넘는 값. 평소 하루(한 주) = 가운데값.

export const NORMAL_RULE = '평소 = 최근 8주 값의 가운데 절반';

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function normalRange(values: Array<number | null>): [number, number] {
  const s = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return [Math.round(quantile(s, 0.25)), Math.round(quantile(s, 0.75))];
}

export function typical(values: Array<number | null>): number {
  const s = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return quantile(s, 0.5);
}

export function spikeThreshold(range: [number, number]): number {
  return range[1] * 2;
}

export type Verdict = 'above' | 'normal' | 'below';
export function verdictOf(v: number, range: [number, number]): Verdict {
  return v > range[1] ? 'above' : v < range[0] ? 'below' : 'normal';
}
export const VERDICT_TEXT: Record<Verdict, string> = { above: '평소보다 많아요', normal: '평소 수준이에요', below: '평소보다 적어요' };
export const VERDICT_SHORT: Record<Verdict, string> = { above: '평소보다 많음', normal: '평소 수준', below: '평소보다 적음' };
