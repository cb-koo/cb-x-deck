'use client';
import { scaleBand, scaleLinear } from 'd3-scale';
import { C, T, NUM } from './tokens';
import { useWidth } from './ChartCard';
import { barPath } from './DayBarsChart';

// 범주(주) 막대 — 값은 막대 위에 직접. 마지막(이번 기간)만 주색. band = 평소 범위 띠.
// 보조 줄(sub): 막대 아래 두 번째 지표(예: 북마크당 비용). subLabel로 이름과 "낮을수록 좋음" 같은 방향을 밝히고,
// subWarn이 true인 값만 경고색 — 회색 속에 이상치가 묻히지 않게.
export function CategoryBars({ labels, values, band, bandLabel, height = 180, format = (v: number) => NUM.format(v), sub, subLabel, subWarn }: {
  labels: string[]; values: number[]; band?: [number, number]; bandLabel?: string; height?: number; format?: (v: number) => string;
  sub?: string[]; subLabel?: string; subWarn?: boolean[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const padT = 22, padB = 24, subH = sub ? 30 : 0;
  const plotBottom = height - padB - subH;
  const x = scaleBand<string>().domain(labels).range([0, width]).paddingInner(0.35).paddingOuter(0.1);
  const y = scaleLinear().domain([0, Math.max(1, ...values, band?.[1] ?? 0)]).range([plotBottom, padT]);
  const last = labels.length - 1;
  const mid = (l: string) => (x(l) ?? 0) + x.bandwidth() / 2;
  return (
    <div ref={ref} style={{ minHeight: height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={labels.map((l, i) => `${l} ${format(values[i])}`).join(', ')}>
          {band && <rect x={0} y={y(band[1])} width={width} height={Math.max(1, y(band[0]) - y(band[1]))} fill={C.band} />}
          {values.map((v, i) => (
            <g key={labels[i]}>
              <path d={barPath(x(labels[i]) ?? 0, y(v), x.bandwidth(), plotBottom - y(v), 3)} fill={i === last ? C.primary : C.neutralBar} />
              <text x={mid(labels[i])} y={y(v) - 6} textAnchor="middle" fontSize={T.label} fontWeight={i === last ? 700 : 400} fill={i === last ? C.text : C.secondary}>{format(v)}</text>
              <text x={mid(labels[i])} y={plotBottom + 16} textAnchor="middle" fontSize={T.axis} fill={i === last ? C.text : C.muted} fontWeight={i === last ? 600 : 400}>{labels[i]}</text>
              {sub && (
                <text x={mid(labels[i])} y={height - 6} textAnchor="middle" fontSize={12} fontWeight={subWarn?.[i] ? 700 : 400}
                      fill={subWarn?.[i] ? C.down : C.secondary}>{subWarn?.[i] ? '⚠ ' : ''}{sub[i]}</text>
              )}
            </g>
          ))}
          <line x1={0} x2={width} y1={plotBottom} y2={plotBottom} stroke={C.axis} />
          {band && bandLabel && <text x={4} y={y(band[1]) + 13} fontSize={11} fill={C.secondary} stroke="#f7f9f9" strokeWidth={3} paintOrder="stroke">{bandLabel}</text>}
          {sub && subLabel && <line x1={0} x2={width} y1={height - padB - 2} y2={height - padB - 2} stroke="#e6ebee" />}
        </svg>
      )}
      {sub && subLabel && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{subLabel}</div>}
    </div>
  );
}
