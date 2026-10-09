'use client';
import { C, NUM } from './tokens';

// 작은 막대 추이 — 표 한 줄 안의 최근 며칠(전수 검토 #13: 링크별 7일 클릭). 마지막 날만 주색. 0은 바닥선만.
// 세로 최댓값은 최소 1 — 전부 0인 줄이 꽉 찬 막대로 보이지 않게.
export function BarSparkline({ values, labels, width = 72, height = 24, unit = '' }: { values: number[]; labels?: string[]; width?: number; height?: number; unit?: string }) {
  const max = Math.max(1, ...values);
  const gap = 2, w = (width - gap * (values.length - 1)) / values.length;
  return (
    <svg width={width} height={height} role="img" aria-label={values.map((v, i) => `${labels?.[i] ?? i + 1} ${v}${unit}`).join(', ')}>
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={C.axis} />
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * (height - 2)) : 0;
        return (
          <rect key={i} x={i * (w + gap)} y={height - h} width={w} height={h} rx={1.5} fill={i === values.length - 1 ? C.primary : C.neutralBar}>
            <title>{`${labels?.[i] ?? ''} ${NUM.format(v)}${unit}`.trim()}</title>
          </rect>
        );
      })}
    </svg>
  );
}
