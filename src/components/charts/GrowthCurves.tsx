'use client';
import { useState } from 'react';
import { scaleLog } from 'd3-scale';
import { line, curveLinear } from 'd3-shape';
import { C, T, compact } from './tokens';
import { useWidth, Tip, TipBody } from './ChartCard';

// 경과 시간별 누적 곡선 — 가로 = 게시 후 시간, 세로 = 누적 조회. 다른 글은 옅은 선, 띠 = 같은 시간대 다른 글들의 가운데 절반, 강조 글 하나는 주색.
// 조회는 글마다 수백 배 차이라 두 축 모두 로그(눈금 = 1·2·4·8시간…, 1천·1만·10만…). ? 설명에 반드시 '칸마다 10배'를 적는다.
// 측정 시점은 자동 측정 일정(게시 후 15분~7일)에 맞춰 들어온다. 1시간 전 측정은 너무 작아 그리지 않는다.
export type Curve = { id: string; label: string; points: Array<[number, number]> };
const TICKS_H = [1, 2, 4, 8, 12, 24, 48, 72, 168];
const TICKS_NARROW = [1, 4, 24, 72, 168]; // 좁은 자리(글 상세 패널 등)에선 이름표가 겹쳐 줄인다
const NARROW_W = 420;
const BAND_MIN_POINTS = 4; // 띠는 측정이 촘촘한 글로만
const BAND_MIN_CURVES = 3;
const hLabel = (h: number) => (h < 24 ? `${h}시간` : h === 168 ? '7일' : `${h / 24}일`);

function interp(points: Array<[number, number]>, h: number): number | null {
  const p = points.filter(([x]) => x >= 1);
  if (!p.length || h < p[0][0] || h > p[p.length - 1][0]) return null;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i];
    if (h >= x0 && h <= x1) {
      if (x1 === x0 || y0 <= 0 || y1 <= 0) return y1;
      const t = (Math.log(h) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
      return Math.exp(Math.log(y0) + t * (Math.log(y1) - Math.log(y0)));
    }
  }
  return p[0][0] === h ? p[0][1] : null;
}
const q = (s: number[], p: number) => { const i = (s.length - 1) * p, a = Math.floor(i); return s[a] + (s[Math.ceil(i)] - s[a]) * (i - a); };

// showLabel: 강조 선 끝 이름표·띠 이름표 — 좁은 자리에서 겹치면 끄고 차트 위 범례로 대신한다.
export function GrowthCurves({ curves, highlightId, height = 280, onSelect, showLabel = true }: { curves: Curve[]; highlightId: string; height?: number; onSelect?: (id: string) => void; showLabel?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const axisW = 44, padB = 26, padT = 14, labelW = 70;
  const plotW = Math.max(width - axisW - labelW, 0), plotH = height - padB - padT;
  const all = curves.flatMap((c) => c.points.filter(([h, v]) => h >= 1 && v > 0).map(([, v]) => v));
  const yLo = Math.pow(10, Math.floor(Math.log10(Math.max(1, Math.min(...all))))), yHi = Math.max(10, ...all) * 1.6; // 위는 최댓값 조금 위까지만
  const x = scaleLog().domain([1, 168]).range([0, plotW]).clamp(true);
  const y = scaleLog().domain([yLo, yHi]).range([padT + plotH, padT]);
  const yTicks: number[] = []; for (let v = yLo; v <= yHi; v *= 10) yTicks.push(v);
  const mk = line<[number, number]>().x(([h]) => x(h)).y(([, v]) => y(Math.max(v, yLo))).curve(curveLinear);
  // 띠: 각 눈금 시각에서 다른 글들의 가운데 절반(3개 이상 있을 때만)
  const ticks = plotW < NARROW_W ? TICKS_NARROW : TICKS_H;
  const dense = curves.filter((c) => c.id !== highlightId && c.points.filter(([h]) => h >= 1).length >= BAND_MIN_POINTS);
  // 띠는 같은 글 묶음으로만 그린다 — 시각마다 재어진 글이 달라지면(들락날락) 띠가 톱니가 된다. 그래서 촘촘히 잰 글이 모두 값이 있는 시각만 쓴다.
  const bandPts = dense.length < BAND_MIN_CURVES ? [] : TICKS_H.map((h) => { const vs = dense.map((c) => interp(c.points, h)); if (vs.some((v) => v === null)) return null; const sv = (vs as number[]).sort((a, b) => a - b); return { h, lo: q(sv, 0.25), hi: q(sv, 0.75), n: sv.length }; }).filter((b): b is { h: number; lo: number; hi: number; n: number } => b !== null);
  const bandPath = bandPts.length > 1 ? `M${bandPts.map((b) => `${x(b.h)},${y(b.hi)}`).join('L')}L${[...bandPts].reverse().map((b) => `${x(b.h)},${y(b.lo)}`).join('L')}Z` : '';
  const hl = curves.find((c) => c.id === highlightId);
  const hlPts = hl ? hl.points.filter(([h]) => h >= 1) : [];
  const hlLast = hlPts[hlPts.length - 1];
  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="게시 후 시간별 누적 조회"
             onMouseLeave={() => setHover(null)}
             onMouseMove={(e) => {
               const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
               const h = x.invert(Math.max(0, Math.min(plotW, e.clientX - r.left)));
               setHover(TICKS_H.reduce((a, b) => (Math.abs(Math.log(b) - Math.log(h)) < Math.abs(Math.log(a) - Math.log(h)) ? b : a)));
             }}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke={C.grid} strokeDasharray="4 4" />
              <text x={width} y={y(v) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{compact(v)}</text>
            </g>
          ))}
          {ticks.map((h) => (
            <g key={h}>
              <line x1={x(h)} x2={x(h)} y1={padT + plotH} y2={padT + plotH + 4} stroke={C.axis} />
              <text x={x(h)} y={height - 6} textAnchor={h === 1 ? 'start' : 'middle'} fontSize={T.axis} fill={h === 24 || h === 168 ? C.text : C.muted}>{hLabel(h)}</text>
            </g>
          ))}
          <line x1={0} x2={plotW} y1={padT + plotH} y2={padT + plotH} stroke={C.axis} />
          {bandPath && <path d={bandPath} fill={C.band} />}
          {showLabel && bandPts.length > 0 && <text x={x(bandPts[bandPts.length - 1].h) + 6} y={y(bandPts[bandPts.length - 1].lo) + 4} fontSize={11} fill={C.secondary}>다른 글 가운데 절반</text>}
          {curves.filter((c) => c.id !== highlightId).map((c) => (
            <path key={c.id} d={mk(c.points.filter(([h, v]) => h >= 1 && v > 0)) ?? ''} fill="none" stroke={C.neutralBar} strokeWidth={1} opacity={0.8} />
          ))}
          {hl && <path d={mk(hlPts) ?? ''} fill="none" stroke={C.primary} strokeWidth={2.5} strokeLinejoin="round" />}
          {hl && hlPts.map(([h, v], i) => <circle key={i} cx={x(h)} cy={y(v)} r={2.5} fill={C.primary} />)}
          {showLabel && hlLast && <text x={x(hlLast[0]) + 8} y={y(hlLast[1]) + 4} fontSize={12} fontWeight={700} fill={C.primaryDeep}>{hl?.label}</text>}
          {onSelect && curves.map((c) => ( // 선이 가늘어 누르기 어렵다 — 투명한 굵은 선을 위에 깐다
            <path key={'hit' + c.id} d={mk(c.points.filter(([h, v]) => h >= 1 && v > 0)) ?? ''} fill="none" stroke="transparent" strokeWidth={12}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }} onClick={() => onSelect(c.id)} />
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke={C.axis} />}
        </svg>
      )}
      {hover !== null && width > 0 && (() => {
        const hv = hl ? interp(hl.points, hover) : null;
        const b = bandPts.find((p) => p.h === hover);
        return (
          <Tip x={x(hover)} y={padT + 10} yBelow={padT + 24} width={width}>
            <TipBody title={`게시 후 ${hLabel(hover)}`}
              rows={[
                ...(hl ? [{ label: hl.label, value: hv === null ? '측정 없음' : `조회 ${compact(Math.round(hv))}`, strong: true, tone: 'up' as const }] : []),
                ...(b ? [{ label: `다른 글 ${b.n}개 가운데 절반`, value: `${compact(Math.round(b.lo))}~${compact(Math.round(b.hi))}` }] : [{ label: '다른 글', value: '비교할 글이 3개 미만', tone: 'muted' as const }]),
              ]}
              note={hv !== null && b ? (hv > b.hi ? '다른 글보다 빠르게 컸어요' : hv < b.lo ? '다른 글보다 느려요' : '다른 글과 비슷해요') : undefined} />
          </Tip>
        );
      })()}
    </div>
  );
}
