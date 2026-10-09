'use client';
import { useState } from 'react';
import { scaleLinear, scalePoint } from 'd3-scale';
import { line, curveLinear } from 'd3-shape';
import { C, S, T, NUM } from './tokens';
import { useWidth, Tip } from './ChartCard';

// 기간 비교 선 — 이번 기간 = 주색 실선, 비교 기간 = 같은 색 연한 점선(레퍼런스·Material: 색을 늘리지 않고 선 모양으로 구분).
// 직선으로 잇는다 — 곡선은 측정하지 않은 사이 값을 지나가는 것처럼 보인다(10-09 검토). 세로축 값은 오른쪽, 격자는 점선 3줄.
type Props = { labels: string[]; current: Array<number | null>; previous?: Array<number | null>; height?: number;
  currentName: string; previousName?: string; unit?: string };

export function TimeCompareChart({ labels, current, previous, height = 180, currentName, previousName, unit = '' }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const axisW = 40, padB = 26, padT = 8;
  const plotW = Math.max(width - axisW, 0), plotH = height - padB - padT;
  const all = [...current, ...(previous ?? [])].filter((v): v is number => v !== null);
  const max = niceMax(Math.max(1, ...all));
  const x = scalePoint<string>().domain(labels).range([8, plotW - 8]);
  const y = scaleLinear().domain([0, max]).range([padT + plotH, padT]);
  const ticks = [0, max / 3, (2 * max) / 3, max];
  const mk = line<number | null>().defined((v) => v !== null).x((_, i) => x(labels[i]) ?? 0).y((v) => y(v ?? 0)).curve(curveLinear);
  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${currentName} ${labels.map((l, i) => `${l} ${current[i] ?? '없음'}`).join(', ')}`}
             onMouseLeave={() => setHover(null)}
             onMouseMove={(e) => {
               const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
               const px = e.clientX - r.left; const step = plotW / labels.length;
               setHover(Math.min(labels.length - 1, Math.max(0, Math.floor(px / step))));
             }}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={i === 0 ? C.axis : C.grid} strokeDasharray={i === 0 ? undefined : S.gridDash} />
              <text x={width} y={y(t) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{NUM.format(Math.round(t))}{unit}</text>
            </g>
          ))}
          {labels.map((l) => (
            <g key={l}>
              <line x1={x(l)} x2={x(l)} y1={padT + plotH} y2={padT + plotH + 4} stroke={C.axis} />
              <text x={x(l)} y={height - 6} textAnchor="middle" fontSize={T.axis} fill={C.muted}>{l}</text>
            </g>
          ))}
          {hover !== null && <line x1={x(labels[hover])} x2={x(labels[hover])} y1={padT} y2={padT + plotH} stroke={C.axis} />}
          {previous && <path d={mk(previous) ?? ''} fill="none" stroke={C.primarySoft} strokeWidth={S.compareWidth} strokeDasharray={S.compareDash} />}
          <path d={mk(current) ?? ''} fill="none" stroke={C.primary} strokeWidth={S.lineWidth} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null && current[hover] !== null && <circle cx={x(labels[hover])} cy={y(current[hover] as number)} r={4} fill="#fff" stroke={C.primary} strokeWidth={2} />}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tip x={x(labels[hover]) ?? 0} y={y(current[hover] ?? 0)} width={width}>
          <div style={{ fontWeight: 600 }}>{labels[hover]}</div>
          <div>{currentName}: <b>{current[hover] ?? '—'}{unit}</b></div>
          {previous && <div style={{ color: C.secondary }}>{previousName}: {previous[hover] ?? '—'}{unit}</div>}
        </Tip>
      )}
    </div>
  );
}

export function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
