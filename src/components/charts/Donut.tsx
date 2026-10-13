'use client';
import { useState } from 'react';
import { C, NUM } from './tokens';

// 도넛 — 구성비(전수 검토 #14: 글 유형). 큰 조각부터 12시 방향 시계방향, 조각 사이 작은 틈.
// 가운데 = 전체 수, 옆 목록 = 색·이름·건수·%(색만으로 읽히지 않게 글자 필수). 조각이 6개 넘으면 나머지는 '기타'로.
export const DONUT_COLORS = ['#1d9bf0', '#0b4f7c', '#7cc4f4', '#9aa6ae', '#c9d3d9', '#e2e9ed'] as const;
export type DonutItem = { label: string; value: number; color?: string };

export function Donut({ items, centerLabel, size = 140 }: { items: DonutItem[]; centerLabel: string; size?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 5);
  const restSum = sorted.slice(5).reduce((s, x) => s + x.value, 0);
  const list = restSum > 0 ? [...head, { label: '기타', value: restSum, color: C.neutralBar }] : head;
  const total = list.reduce((s, x) => s + x.value, 0);
  const R = 50, CIRC = 2 * Math.PI * R, GAP = list.length > 1 ? 1.5 : 0;
  const lens = list.map((x) => (total ? (x.value / total) * CIRC : 0));
  const offsets = lens.map((_, i) => lens.slice(0, i).reduce((s, l) => s + l, 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
        <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={list.map((x) => `${x.label} ${x.value}`).join(', ')}>
          <circle cx={60} cy={60} r={R} fill="none" stroke="#eef1f3" strokeWidth={16} />
          {list.map((x, i) => (
            <circle key={x.label} cx={60} cy={60} r={R} fill="none" stroke={x.color ?? DONUT_COLORS[i]} strokeWidth={hover === x.label ? 19 : 16}
                    strokeDasharray={`${Math.max(0, lens[i] - GAP)} ${CIRC}`} strokeDashoffset={-offsets[i]} transform="rotate(-90 60 60)"
                    opacity={hover && hover !== x.label ? 0.4 : 1} onMouseEnter={() => setHover(x.label)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{NUM.format(total)}</div>
          <div style={{ fontSize: 11, color: C.muted }}>{centerLabel}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 140 }}>
        {list.map((x, i) => (
          <div key={x.label} onMouseEnter={() => setHover(x.label)} onMouseLeave={() => setHover(null)}
               style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: hover && hover !== x.label ? 0.5 : 1 }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, background: x.color ?? DONUT_COLORS[i], flex: 'none' }} />
            <span style={{ flex: 1, color: C.text }}>{x.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{NUM.format(x.value)}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: C.muted, width: 36, textAlign: 'right' }}>{total ? Math.round((x.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
