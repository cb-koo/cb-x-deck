'use client';
import { useState } from 'react';
import { scaleLinear, scaleLog, scaleSqrt } from 'd3-scale';
import { C, S, T, compact } from './tokens';
import { useWidth, Tip, TipBody, type TipData } from './ChartCard';

// 게시물 산점도 — 상관을 보는 차트(Material: correlation = scatter/bubble). 점 하나 = 게시물 하나.
// 가로 = 조회(로그, 차이가 수백 배라), 세로 = 반응 지표, 원 크기 = 세 번째 값(면적 비례). 0 기준선은 점선 + 직접 라벨.
// 이름표는 직접 붙인다(범례 대신). 마우스를 올리면 그 점만 또렷하게, 나머지는 흐리게 + 정리된 상세(TipBody).
export type Bubble = { id: string; x: number; y: number; size: number; label?: string; strong?: boolean; tip: TipData };
type Props = { points: Bubble[]; xName: string; yName: string; height?: number; zeroLabel?: string };

export function BubbleScatter({ points, xName, yName, height = 300, zeroLabel = '평소와 같음', onSelect, selectedId }: Props & { onSelect?: (id: string) => void; selectedId?: string | null }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const axisW = 36, padB = 44, padT = 28;
  const plotW = Math.max(width - axisW, 0), plotH = height - padB - padT;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = scaleLog().domain([Math.min(...xs) * 0.7, Math.max(...xs) * 1.4]).range([12, plotW - 12]);
  const yMin = Math.min(0, ...ys), yMax = Math.max(...ys);
  const y = scaleLinear().domain([yMin - 2, yMax + 3]).nice().range([padT + plotH, padT]);
  const r = scaleSqrt().domain([0, Math.max(...points.map((p) => p.size))]).range([3, 24]);
  const yTicks = y.ticks(3);
  const xTicks = [1e3, 1e4, 1e5, 1e6, 1e7].filter((t) => t >= x.domain()[0] && t <= x.domain()[1]);
  const h = points.find((p) => p.id === hover) ?? null;
  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${xName}와 ${yName}`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.axis : C.grid} strokeDasharray={t === 0 ? '5 4' : S.gridDash} />
              <text x={width} y={y(t) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{t > 0 ? `+${t}` : t}</text>
            </g>
          ))}
          <text x={4} y={y(0) + 16} fontSize={T.label} fill={C.muted}>{zeroLabel}</text>
          <line x1={0} x2={plotW} y1={padT + plotH} y2={padT + plotH} stroke={C.axis} />
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={padT + plotH + 18} textAnchor="middle" fontSize={T.axis} fill={C.muted}>{compact(t)}</text>
          ))}
          <text x={plotW} y={height - 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{xName} →</text>
          <text x={4} y={12} fontSize={T.axis} fill={C.muted}>↑ {yName}</text>
          {[...points].sort((a, b) => b.size - a.size).map((p) => (
            <circle key={p.id} cx={x(p.x)} cy={y(p.y)} r={r(p.size)}
                    fill={p.strong ? C.primary : C.primaryDeep} fillOpacity={(p.strong ? 0.75 : 0.32) * (hover && hover !== p.id ? 0.35 : 1)}
                    stroke={hover === p.id || selectedId === p.id ? C.text : '#fff'} strokeWidth={selectedId === p.id ? 2 : hover === p.id ? 1.5 : 1}
                    onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
                    onClick={onSelect ? () => onSelect(p.id) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }} />
          ))}
          {points.filter((p) => p.label).map((p) => {
            const right = x(p.x) < plotW * 0.6;
            return <text key={p.id} x={x(p.x) + (right ? r(p.size) + 6 : -(r(p.size) + 6))} y={y(p.y) + 4}
                         textAnchor={right ? 'start' : 'end'} fontSize={T.label} fontWeight={p.strong ? 700 : 400} fill={C.text} opacity={hover && hover !== p.id ? 0.35 : 1}>{p.label}</text>;
          })}
        </svg>
      )}
      {h && width > 0 && (
        <Tip x={x(h.x)} y={y(h.y) - r(h.size)} yBelow={y(h.y) + r(h.size)} width={width}>
          <TipBody {...h.tip} />
        </Tip>
      )}
    </div>
  );
}
