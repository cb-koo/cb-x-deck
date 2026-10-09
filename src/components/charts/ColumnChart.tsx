'use client';
import { useState } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { C, S, T, NUM } from './tokens';
import { useWidth, Tip, TipBody } from './ChartCard';
import { barPath } from './DayBarsChart';
import { niceMax } from './TimeCompareChart';

// 세로 막대(전수 검토 #3·4) — 한 계열이면 음수 허용(0 기준선, 늘면 주색·줄면 중립), 여러 계열이면 누적.
// null = 기록 없음(막대 대신 옅은 칸 + '기록 없음'), partialLast = 마지막 구간이 아직 진행 중(흐리게 + '집계 중').
// 단일 계열은 막대 위에 값을 직접 적는다(축 대신).
export type ColumnSeries = { name: string; values: Array<number | null>; color: string };
type Props = { labels: string[]; series: ColumnSeries[]; height?: number; partialLast?: boolean; format?: (v: number) => string; unit?: string };

export function ColumnChart({ labels, series, height = 200, partialLast, unit = '' }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const axisW = 40, padB = 24, padT = 20;
  const plotW = Math.max(width - axisW, 0);
  const x = scaleBand<string>().domain(labels).range([0, plotW]).paddingInner(0.35).paddingOuter(0.1);
  const single = series.length === 1;
  const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  const allNull = (i: number) => series.every((se) => se.values[i] === null);
  const lo = single ? Math.min(0, ...series[0].values.filter((v): v is number => v !== null)) : 0;
  const hi = Math.max(1, ...(single ? series[0].values.filter((v): v is number => v !== null) : totals));
  const yMax = niceMax(hi), yMin = lo < 0 ? -niceMax(-lo) : 0;
  const y = scaleLinear().domain([yMin, yMax]).range([height - padB, padT]);
  const fmt = (v: number) => `${NUM.format(Math.round(v))}${unit}`;
  const mid = (l: string) => (x(l) ?? 0) + x.bandwidth() / 2;
  const isPartial = (i: number) => partialLast && i === labels.length - 1;
  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(', ')} onMouseLeave={() => setHover(null)}>
          {[yMin, 0, yMax].filter((t, k, a) => a.indexOf(t) === k).map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.axis : C.grid} strokeDasharray={t === 0 ? undefined : S.gridDash} />
              <text x={width} y={y(t) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{t > 0 && single && lo < 0 ? '+' : ''}{fmt(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const xx = x(l) ?? 0, w = x.bandwidth();
            if (allNull(i)) return (
              <g key={l} onMouseEnter={() => setHover(i)}>
                <rect x={xx} y={padT} width={w} height={height - padB - padT} fill="#f0f3f5" rx={3} />
                <text x={xx + w / 2} y={y(0) - 6} textAnchor="middle" fontSize={10} fill={C.muted}>없음</text>
              </g>
            );
            let acc = 0;
            return (
              <g key={l} opacity={isPartial(i) ? 0.45 : hover === null || hover === i ? 1 : 0.6} onMouseEnter={() => setHover(i)}>
                {series.map((se, k) => {
                  const v = se.values[i] ?? 0;
                  if (single) {
                    const top = v >= 0 ? y(v) : y(0), h = Math.abs(y(v) - y(0));
                    return <path key={se.name} d={v >= 0 ? barPath(xx, top, w, h, S.barRadius) : `M${xx},${top}H${xx + w}V${top + h}H${xx}Z`}
                                 fill={v >= 0 ? se.color : C.neutralBar} />;
                  }
                  const y0 = y(acc), y1 = y(acc + v); acc += v;
                  const isTop = k === series.length - 1 || series.slice(k + 1).every((s2) => !(s2.values[i] ?? 0));
                  return v > 0 ? <path key={se.name} d={isTop ? barPath(xx, y1, w, y0 - y1, S.barRadius) : `M${xx},${y1}H${xx + w}V${y0}H${xx}Z`} fill={se.color} /> : null;
                })}
                {single && series[0].values[i] !== null && (
                  <text x={mid(l)} y={(series[0].values[i] as number) >= 0 ? y(series[0].values[i] as number) - 5 : y(series[0].values[i] as number) + 13} textAnchor="middle"
                        fontSize={11} fill={C.secondary}>{(series[0].values[i] as number) > 0 && lo < 0 ? '+' : ''}{NUM.format(series[0].values[i] as number)}</text>
                )}
              </g>
            );
          })}
          {labels.map((l, i) => (i % Math.ceil(labels.length / 8) === 0 || i === labels.length - 1) && (
            <text key={l} x={mid(l)} y={height - 6} textAnchor="middle" fontSize={T.axis} fill={i === labels.length - 1 ? C.text : C.muted}>{isPartial(i) ? `${l} 집계 중` : l}</text>
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tip x={mid(labels[hover])} y={padT + 10} yBelow={padT + 30} width={width}>
          <TipBody title={labels[hover]} sub={allNull(hover) ? '기록 없음 — 0이 아니라 모름이에요' : isPartial(hover) ? '아직 집계 중' : undefined}
            rows={allNull(hover) ? [] : [
              ...series.map((se, k) => ({ label: se.name, value: se.values[hover] === null ? '—' : fmt(se.values[hover] as number), strong: single || k === 0 })),
              ...(single ? [] : [{ label: '합계', value: fmt(totals[hover]), strong: true }]),
            ]} />
        </Tip>
      )}
    </div>
  );
}
