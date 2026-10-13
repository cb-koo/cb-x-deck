'use client';
import { useState } from 'react';
import { C, HEAT, NUM } from './tokens';
import { useWidth, Tip, TipBody } from './ChartCard';

// 달력 히트맵(전수 검토 #15: 일별 게시) — 열 = 주(월요일 시작), 행 = 요일. 칸 색 = 값 단계(HEAT, 0은 가장 연한 칸).
// 단계 경계는 0을 뺀 값들의 4분위 — 데이터마다 고르게 나뉜다. 아래 '적음 ▢▢▢ 많음' + 마우스 올림 상세.
type Props = { days: string[]; values: Array<number | null>; unit?: string; valueName: string };

function quart(sorted: number[], p: number) { if (!sorted.length) return 0; const i = (sorted.length - 1) * p; const a = Math.floor(i); return sorted[a] + (sorted[Math.ceil(i)] - sorted[a]) * (i - a); }

export function CalendarHeatmap({ days, values, unit = '', valueName }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pos = values.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  const cuts = [0.25, 0.5, 0.75].map((p) => quart(pos, p));
  const step = (v: number | null) => (v === null ? -1 : v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 5);
  const dow = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // 월=0
  const startPad = dow(days[0]);
  const cols = Math.ceil((startPad + days.length) / 7);
  const labelW = 22, gap = 3;
  const cell = Math.max(12, Math.min(28, Math.floor((Math.max(width, 200) - labelW - gap * cols) / cols)));
  const colOf = (i: number) => Math.floor((startPad + i) / 7);
  const monthLabel = (i: number) => { const d = days[i]; return d.slice(8) <= '07' || i === 0 ? `${Number(d.slice(5, 7))}월` : ''; };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `${labelW}px repeat(${cols}, ${cell}px)`, gap }}>
        <div />
        {Array.from({ length: cols }, (_, c) => { const i = c * 7 - startPad; const ok = i >= 0 && i < days.length && dow(days[i]) === 0; return <div key={c} style={{ fontSize: 11, color: C.muted, height: 14 }}>{ok ? monthLabel(i) : ''}</div>; })}
        {Array.from({ length: 7 }, (_, r) => (
          <div key={`r${r}`} style={{ display: 'contents' }}>
            <div style={{ fontSize: 11, color: C.muted, height: cell, display: 'flex', alignItems: 'center' }}>{r % 2 === 0 ? '월화수목금토일'[r] : ''}</div>
            {Array.from({ length: cols }, (_, c) => {
              const i = c * 7 + r - startPad;
              if (i < 0 || i >= days.length) return <div key={c} />;
              const s = step(values[i]);
              return (
                <div key={c} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                     style={{ width: cell, height: cell, borderRadius: 4, background: s < 0 ? '#f7f9f9' : HEAT[s as 0 | 1 | 2 | 3 | 5], outline: hover === i ? `2px solid ${C.text}` : 'none', outlineOffset: -1 }} />
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, fontSize: 11, color: C.muted }}>
        적음 {[0, 1, 2, 3, 5].map((s) => <span key={s} style={{ width: 12, height: 12, borderRadius: 3, background: HEAT[s], display: 'inline-block' }} />)} 많음
      </div>
      {hover !== null && width > 0 && (
        <Tip x={labelW + colOf(hover) * (cell + gap) + cell / 2} y={14 + dow(days[hover]) * (cell + gap)} width={width}>
          <TipBody title={`${Number(days[hover].slice(5, 7))}월 ${Number(days[hover].slice(8))}일 (${'월화수목금토일'[dow(days[hover])]})`}
            rows={[{ label: valueName, value: values[hover] === null ? '기록 없음' : `${NUM.format(values[hover] as number)}${unit}`, strong: true }]} />
        </Tip>
      )}
    </div>
  );
}
