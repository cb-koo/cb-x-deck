'use client';
import { scaleBand, scaleLinear } from 'd3-scale';
import { C, T, NUM } from './tokens';
import { useWidth } from './ChartCard';
import { barPath } from './DayBarsChart';

// 범주(주) 막대 — 축 대신 막대 위에 값을 직접 적는다(Material: 축을 줄이고 값은 요소에). 마지막(이번 기간)만 주색.
export function CategoryBars({ labels, values, height = 170, format = (v: number) => NUM.format(v), sub }: {
  labels: string[]; values: number[]; height?: number; format?: (v: number) => string; sub?: string[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const padT = 22, padB = sub ? 40 : 24;
  const x = scaleBand<string>().domain(labels).range([0, width]).paddingInner(0.35).paddingOuter(0.1);
  const y = scaleLinear().domain([0, Math.max(1, ...values)]).range([height - padB, padT]);
  const last = labels.length - 1;
  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={labels.map((l, i) => `${l} ${format(values[i])}`).join(', ')}>
          {values.map((v, i) => (
            <g key={labels[i]}>
              <path d={barPath(x(labels[i]) ?? 0, y(v), x.bandwidth(), y(0) - y(v), 3)} fill={i === last ? C.primary : C.neutralBar} />
              <text x={(x(labels[i]) ?? 0) + x.bandwidth() / 2} y={y(v) - 6} textAnchor="middle" fontSize={T.label}
                    fontWeight={i === last ? 700 : 400} fill={i === last ? C.text : C.secondary}>{format(v)}</text>
              <text x={(x(labels[i]) ?? 0) + x.bandwidth() / 2} y={height - padB + 16} textAnchor="middle" fontSize={T.axis}
                    fill={i === last ? C.text : C.muted} fontWeight={i === last ? 600 : 400}>{labels[i]}</text>
              {sub && <text x={(x(labels[i]) ?? 0) + x.bandwidth() / 2} y={height - 4} textAnchor="middle" fontSize={11} fill={C.muted}>{sub[i]}</text>}
            </g>
          ))}
          <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={C.axis} />
        </svg>
      )}
    </div>
  );
}
