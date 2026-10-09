'use client';
import { useState } from 'react';
import { scaleLog } from 'd3-scale';
import { C, T, NUM } from './tokens';
import { useWidth, Tip, TipBody, type TipData } from './ChartCard';

// 분포 두 가지.
// 1) DotStrip — 한 줄 = 한 묶음(예: 클라이언트), 점 하나 = 항목 하나(예: 게시물). 세로 막대 = 그 줄의 가운데값.
//    값 차이가 수백 배면 log(눈금마다 10배). "보통은 여기, 이 점은 바깥"을 보여 준다. 점에 마우스 → 상세.
// 2) Histogram — 구간별 개수. 막대 위에 비율, 가운데값이 든 구간은 주색.
export type Dot = { id: string; v: number; tip: TipData };
export type StripRow = { label: string; dots: Dot[] };

const median = (vs: number[]) => { const s = [...vs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function DotStrip({ rows, unit = '', ticks }: { rows: StripRow[]; unit?: string; ticks: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ r: number; d: Dot } | null>(null);
  const labelW = 104, rowH = 52, padT = 6, padB = 26;
  const plotW = Math.max(width - labelW - 8, 0);
  const all = rows.flatMap((r) => r.dots.map((d) => d.v)).filter((v) => v > 0);
  const x = scaleLog().domain([Math.min(ticks[0], ...all), Math.max(ticks[ticks.length - 1], ...all)]).range([0, plotW]).clamp(true);
  const height = padT + rows.length * rowH + padB;
  const jitter = (id: string) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997; return (h / 997 - 0.5) * 16; };
  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="분포">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={labelW + x(t)} x2={labelW + x(t)} y1={padT} y2={height - padB} stroke={C.grid} strokeDasharray="4 4" />
              <text x={labelW + x(t)} y={height - 8} textAnchor="middle" fontSize={T.axis} fill={C.muted}>{NUM.format(t)}{unit}</text>
            </g>
          ))}
          {rows.map((r, ri) => {
            const cy = padT + ri * rowH + rowH / 2;
            const m = r.dots.length ? median(r.dots.map((d) => d.v)) : null;
            return (
              <g key={r.label}>
                <text x={0} y={cy - 2} fontSize={13} fill={C.text}>{r.label}</text>
                <text x={0} y={cy + 13} fontSize={11} fill={C.muted}>{r.dots.length}개{m !== null ? ` · 가운데 ${NUM.format(Math.round(m * 10) / 10)}${unit}` : ''}</text>
                <line x1={labelW} x2={labelW + plotW} y1={cy} y2={cy} stroke="#eceff1" />
                {r.dots.map((d) => (
                  <circle key={d.id} cx={labelW + x(d.v)} cy={cy + jitter(d.id)} r={hover?.d.id === d.id ? 6 : 4.5}
                          fill={C.primaryDeep} fillOpacity={hover && hover.d.id !== d.id ? 0.2 : 0.5} stroke="#fff" strokeWidth={1}
                          onMouseEnter={() => setHover({ r: ri, d })} onMouseLeave={() => setHover(null)} />
                ))}
                {m !== null && <line x1={labelW + x(m)} x2={labelW + x(m)} y1={cy - 13} y2={cy + 13} stroke={C.text} strokeWidth={2.5} strokeLinecap="round" />}
              </g>
            );
          })}
        </svg>
      )}
      {hover && width > 0 && (
        <Tip x={labelW + x(hover.d.v)} y={padT + hover.r * rowH} yBelow={padT + hover.r * rowH + rowH} width={width}>
          <TipBody {...hover.d.tip} />
        </Tip>
      )}
    </div>
  );
}

export function Histogram({ buckets, height = 170, medianIndex, unit = '' }: { buckets: Array<{ label: string; count: number }>; height?: number; medianIndex?: number; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const padT = 20, padB = 24, gap = 3;
  const bw = width > 0 ? (width - gap * (buckets.length - 1)) / buckets.length : 0;
  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={buckets.map((b) => `${b.label} ${b.count}`).join(', ')}>
          {buckets.map((b, i) => {
            const h = (b.count / max) * (height - padT - padB);
            const xx = i * (bw + gap);
            const hot = i === medianIndex;
            return (
              <g key={b.label}>
                <rect x={xx} y={height - padB - h} width={bw} height={h} rx={3} fill={hot ? C.primary : C.neutralBar}>
                  <title>{`${b.label}: ${b.count}${unit} (${total ? Math.round((b.count / total) * 100) : 0}%)`}</title>
                </rect>
                <text x={xx + bw / 2} y={height - padB - h - 6} textAnchor="middle" fontSize={11} fontWeight={hot ? 700 : 400} fill={hot ? C.text : C.secondary}>{total ? Math.round((b.count / total) * 100) : 0}%</text>
                <text x={xx + bw / 2} y={height - 6} textAnchor="middle" fontSize={11} fill={hot ? C.text : C.muted}>{b.label}</text>
              </g>
            );
          })}
          <line x1={0} x2={width} y1={height - padB} y2={height - padB} stroke={C.axis} />
        </svg>
      )}
    </div>
  );
}
