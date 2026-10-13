'use client';
import { useState } from 'react';
import { scaleLinear, scalePoint } from 'd3-scale';
import { line, curveLinear } from 'd3-shape';
import { C, S, T, NUM } from './tokens';
import { useWidth, Tip, TipBody } from './ChartCard';
import { niceMax } from './TimeCompareChart';

// 다계열 선(전수 검토 #1·2) — 계열 이름은 선 끝에 직접(범례 대신). 빈 값(null)은 선을 끊는다(0이 아니라 '모름').
// band = 기준 띠(예: 업계 통상 5~8%) + 띠 안 라벨. dashed = 보조 계열(이동평균 등). 직선으로만 잇는다.
// 색: 계열이 늘어도 주색 하나 + 명도 차이(SERIES). 첫 계열이 주인공.
export const SERIES = ['#1d9bf0', '#0b4f7c', '#9aa6ae', '#7cc4f4'] as const;
export type LineSeries = { name: string; values: Array<number | null>; color?: string; dashed?: boolean };
type Props = { labels: string[]; series: LineSeries[]; height?: number; band?: { range: [number, number]; label: string }; unit?: string; yMax?: number };

export function LineChart({ labels, series, height = 220, band, unit = '', yMax }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const labelW = 64, padB = 24, padT = 12;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const max = yMax ?? niceMax(Math.max(1, ...all, band?.range[1] ?? 0));
  // 세로축 칸 = 가장 긴 눈금 글자 폭(12px 숫자 ≈ 7px/자) — 다섯 자리 이상(60,000)이 끝 라벨을 덮지 않게
  const axisW = Math.max(36, `${NUM.format(Math.round(max))}${unit}`.length * 7 + 8);
  const plotW = Math.max(width - axisW - labelW, 0), plotH = height - padB - padT;
  // 가로축 날짜 = 폭에 맞춰 솎는다(날짜 하나에 ≈ 48px) — 좁은 패널에서 날짜끼리 겹치지 않게
  const step = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 48))));
  const x = scalePoint<string>().domain(labels).range([6, plotW - 6]);
  const y = scaleLinear().domain([0, max]).range([padT + plotH, padT]);
  const ticks = [0, max / 2, max];
  const color = (s: LineSeries, i: number) => s.color ?? SERIES[i % SERIES.length];
  const mk = line<number | null>().defined((v) => v !== null).x((_, i) => x(labels[i]) ?? 0).y((v) => y(v ?? 0)).curve(curveLinear);
  const lastIdx = (vals: Array<number | null>) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) return i; return -1; };
  // 끝 라벨이 겹치지 않게 세로로 밀어낸다
  const ends = series.map((s, i) => ({ i, li: lastIdx(s.values), yy: lastIdx(s.values) >= 0 ? y(s.values[lastIdx(s.values)] as number) : 0 })).sort((a, b) => a.yy - b.yy);
  for (let k = 1; k < ends.length; k++) if (ends[k].yy - ends[k - 1].yy < 14) ends[k].yy = ends[k - 1].yy + 14;
  const fmt = (v: number | null) => (v === null ? '—' : `${NUM.format(Math.round(v * 10) / 10)}${unit}`);
  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.name).join(', ')}
             onMouseLeave={() => setHover(null)}
             onMouseMove={(e) => {
               const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
               const i = Math.round(((e.clientX - r.left - 6) / Math.max(1, plotW - 12)) * (labels.length - 1));
               setHover(i >= 0 && i < labels.length ? i : null);
             }}>
          {band && (
            <g>
              <rect x={0} y={y(band.range[1])} width={plotW} height={Math.max(1, y(band.range[0]) - y(band.range[1]))} fill={C.band} />
              <text x={4} y={y(band.range[1]) + 12} fontSize={11} fill={C.secondary} stroke="#f7f9f9" strokeWidth={3} paintOrder="stroke">{band.label}</text>
            </g>
          )}
          {ticks.map((t, k) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={k === 0 ? C.axis : C.grid} strokeDasharray={k === 0 ? undefined : S.gridDash} />
              <text x={width} y={y(t) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{NUM.format(Math.round(t))}{unit}</text>
            </g>
          ))}
          {labels.map((l, i) => ((i % step === 0 && labels.length - 1 - i >= step / 2) || i === labels.length - 1) && (
            <text key={l} x={x(l)} y={height - 6} textAnchor={i === 0 ? 'start' : 'middle'} fontSize={T.axis} fill={i === labels.length - 1 ? C.text : C.muted}>{l}</text>
          ))}
          {hover !== null && <line x1={x(labels[hover])} x2={x(labels[hover])} y1={padT} y2={padT + plotH} stroke={C.axis} />}
          {series.map((s, i) => (
            <path key={s.name} d={mk(s.values) ?? ''} fill="none" stroke={color(s, i)} strokeWidth={s.dashed ? S.compareWidth : S.lineWidth}
                  strokeDasharray={s.dashed ? S.compareDash : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s, i) => s.values.map((v, j) => v !== null && !s.dashed && (s.values[j - 1] ?? null) === null && (s.values[j + 1] ?? null) === null && (
            <circle key={`${s.name}${j}`} cx={x(labels[j])} cy={y(v)} r={2.5} fill={color(s, i)} />
          )))}
          {ends.map((e) => e.li >= 0 && (
            <g key={series[e.i].name}>
              <circle cx={x(labels[e.li])} cy={y(series[e.i].values[e.li] as number)} r={3} fill={color(series[e.i], e.i)} />
              <text x={plotW + 6} y={e.yy + 4} fontSize={12} fontWeight={e.i === 0 ? 700 : 500} fill={series[e.i].dashed ? C.muted : color(series[e.i], e.i)}>{series[e.i].name}</text>
            </g>
          ))}
          {hover !== null && series.map((s, i) => s.values[hover] !== null && (
            <circle key={s.name} cx={x(labels[hover])} cy={y(s.values[hover] as number)} r={4} fill="#fff" stroke={color(s, i)} strokeWidth={2} />
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tip x={x(labels[hover]) ?? 0} y={padT + 20} yBelow={padT + 40} width={width}>
          <TipBody title={labels[hover]} rows={series.map((s, i) => ({ label: s.name, value: fmt(s.values[hover]), strong: i === 0 }))} />
        </Tip>
      )}
    </div>
  );
}
