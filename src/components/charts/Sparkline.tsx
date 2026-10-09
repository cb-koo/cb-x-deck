'use client';
import { scaleLinear } from 'd3-scale';
import { line, curveLinear } from 'd3-shape';
import { C } from './tokens';

// 작은 추이선 — 표 한 줄 안에서 8주 흐름. 평소 범위 띠 + 마지막 점만 주색 강조(Tufte 스파크라인).
export function Sparkline({ values, band, width = 96, height = 30 }: { values: number[]; band?: [number, number]; width?: number; height?: number }) {
  const max = Math.max(1, ...values, band?.[1] ?? 0);
  const x = scaleLinear().domain([0, values.length - 1]).range([2, width - 5]);
  const y = scaleLinear().domain([0, max]).range([height - 3, 3]);
  const d = line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveLinear)(values) ?? '';
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden="true">
      {band && <rect x={0} y={y(band[1])} width={width} height={y(band[0]) - y(band[1])} fill={C.band} />}
      <path d={d} fill="none" stroke={C.neutralBar} strokeWidth={1.5} />
      <path d={line<number>().x((_, i) => x(i + last - 1)).y((v) => y(v))([values[last - 1], values[last]]) ?? ''} fill="none" stroke={C.primary} strokeWidth={2} />
      <circle cx={x(last)} cy={y(values[last])} r={3} fill={C.primary} />
    </svg>
  );
}
