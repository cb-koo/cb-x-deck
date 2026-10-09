'use client';
import { useState } from 'react';
import { scaleBand, scaleLinear, scaleSqrt } from 'd3-scale';
import { C, S, T, NUM, compact } from './tokens';
import { useWidth, Tip } from './ChartCard';
import { niceMax } from './TimeCompareChart';

// 일별 막대 + (선택) 위쪽 사건 줄 — 같은 날짜 축에 위아래로 놓아 "게시 → 반응" 시차를 보여 준다(이중 축 대신 위아래 배치).
// 레퍼런스의 '하루를 묶는 연한 세로 구분선'을 주 단위로: 월요일마다 구분선. 평소 범위는 띠, 범위 위 날만 주색(나머지 중립색).
export type DayEvent = { date: string; size: number; intensity: number; label?: string; tip: string[] };
export type DayNote = { date: string; text: string; tone?: 'up' | 'flat' };
type Props = {
  days: string[]; values: Array<number | null>; band?: [number, number]; highlightAbove?: number;
  events?: DayEvent[]; eventEmpty?: { until: string; text: string };
  notes?: DayNote[]; valueName: string; height?: number;
};

const STRIP = 84;

export function DayBarsChart({ days, values, band, highlightAbove, events, eventEmpty, notes = [], valueName, height = 190 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const stripH = events ? STRIP : 0;
  const axisW = 32, padB = 24, padT = 22;
  const plotW = Math.max(width - axisW, 0);
  const plotH = height - padB - padT;
  const x = scaleBand<string>().domain(days).range([0, plotW]).paddingInner(0.3).paddingOuter(0.15);
  const max = niceMax(Math.max(1, ...values.filter((v): v is number => v !== null)));
  const y = scaleLinear().domain([0, max]).range([stripH + padT + plotH, stripH + padT]);
  const r = scaleSqrt().domain([0, Math.max(1, ...(events ?? []).map((e) => e.size))]).range([0, Math.min(22, stripH / 2 - 6)]);
  const cx = (d: string) => (x(d) ?? 0) + x.bandwidth() / 2;
  const mondays = days.filter((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1);
  const total = stripH + height;
  // 강조는 아껴서(Material) — 평소 범위 위가 아니라 '크게 튄 날'(highlightAbove 초과)만 주색
  const hot = (v: number | null) => v !== null && highlightAbove !== undefined && v > highlightAbove;
  const evByDay = new Map<string, DayEvent[]>();
  (events ?? []).forEach((e) => evByDay.set(e.date, [...(evByDay.get(e.date) ?? []), e]));
  const emptyEnd = eventEmpty ? (x(eventEmpty.until) ?? 0) : 0;

  return (
    <div ref={ref} style={{ position: 'relative', height: total }}>
      {width > 0 && (
        <svg width={width} height={total} role="img" aria-label={`${valueName} 일별`}
             onMouseLeave={() => setHover(null)}
             onMouseMove={(e) => {
               const rr = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
               const i = Math.floor(((e.clientX - rr.left) / plotW) * days.length);
               setHover(i >= 0 && i < days.length ? i : null);
             }}>
          {/* 주 구분선 — 사건 줄과 막대를 관통해 같은 주로 묶어 읽게 */}
          {mondays.map((d) => {
            const xx = (x(d) ?? 0) - (x.step() * x.paddingInner()) / 2;
            return <line key={d} x1={xx} x2={xx} y1={0} y2={stripH + padT + plotH} stroke={C.separator} />;
          })}
          {events && (
            <g>
              {eventEmpty && emptyEnd > 0 && (
                <g>
                  <rect x={0} y={4} width={emptyEnd} height={stripH - 8} rx={6} fill="#fbfcfc" />
                  <text x={emptyEnd / 2} y={stripH / 2 + 4} textAnchor="middle" fontSize={T.label} fill={C.muted}>{eventEmpty.text}</text>
                </g>
              )}
              {[...(events ?? [])].sort((a, b) => b.size - a.size).map((e, i) => (
                <circle key={i} cx={cx(e.date)} cy={stripH / 2 + 6} r={Math.max(3, r(e.size))}
                        fill={C.primaryDeep} fillOpacity={0.18 + 0.72 * Math.min(1, e.intensity)} stroke="#fff" strokeWidth={1} />
              ))}
              {(events ?? []).filter((e) => e.label).map((e, i) => (
                <text key={i} x={cx(e.date)} y={12} textAnchor="middle" fontSize={T.label} fill={C.secondary}>{e.label}</text>
              ))}
              <line x1={0} x2={plotW} y1={stripH} y2={stripH} stroke={C.grid} />
            </g>
          )}
          {band && (
            <rect x={0} y={y(band[1])} width={plotW} height={y(band[0]) - y(band[1])} fill={C.band} />
          )}
          {[max / 2, max].map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray={S.gridDash} />
              <text x={width} y={y(t) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>{NUM.format(t)}</text>
            </g>
          ))}
          {values.map((v, i) => v !== null && v > 0 && (
            <path key={days[i]} d={barPath(x(days[i]) ?? 0, y(v), x.bandwidth(), y(0) - y(v), S.barRadius)}
                  fill={hot(v) ? C.primary : C.neutralBar} opacity={hover === null || hover === i ? 1 : 0.55} />
          ))}
          <line x1={0} x2={plotW} y1={y(0)} y2={y(0)} stroke={C.axis} />
          <text x={width} y={y(0) + 4} textAnchor="end" fontSize={T.axis} fill={C.muted}>0</text>
          {notes.map((n) => {
            const i = days.indexOf(n.date); if (i < 0) return null;
            const v = values[i] ?? 0;
            return <text key={n.date} x={cx(n.date)} y={y(v) - 6} textAnchor="middle" fontSize={T.label} fontWeight={n.tone === 'up' ? 700 : 400}
                         fill={n.tone === 'up' ? C.primaryDeep : C.secondary}>{n.text}</text>;
          })}
          {mondays.map((d) => (
            <text key={d} x={x(d) ?? 0} y={total - 6} fontSize={T.axis} fill={C.muted}>{short(d)}</text>
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <Tip x={cx(days[hover])} y={y(values[hover] ?? 0)} width={width}>
          <div style={{ fontWeight: 600 }}>{short(days[hover])} ({'일월화수목금토'[new Date(days[hover] + 'T00:00:00Z').getUTCDay()]})</div>
          <div>{valueName}: <b>{values[hover] ?? '—'}</b>{values[hover] !== null && (hot(values[hover]) ? ' · 크게 튄 날' : band && (values[hover] as number) > band[1] ? ' · 평소보다 많음' : '')}</div>
          {(evByDay.get(days[hover]) ?? []).map((e, k) => <div key={k} style={{ color: C.secondary }}>{e.tip.join(' · ')}</div>)}
        </Tip>
      )}
    </div>
  );
}

function short(d: string) { const [, m, dd] = d.split('-'); return `${Number(m)}/${Number(dd)}`; }
// 위 모서리만 둥근 막대 — 윗변이 값을 정확히 가리키도록 반경은 작게(Material: imprecise top edge 금지)
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
export { compact };
