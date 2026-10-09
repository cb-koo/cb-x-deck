'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { C, S, T } from './tokens';

// 차트 카드 — 레퍼런스의 고정 순서: [아이콘 제목] → [큰 숫자 · 증감] → [차트 소제목] → [차트] → [범례(아래)].
// 큰 숫자가 결론, 차트는 근거. 모든 카드가 같은 순서라 처음 보는 카드도 읽는 법이 같다.

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// 증감 — 색만으로 의미를 전하지 않는다(화살표 필수). good: 늘어나는 게 좋은 지표면 'up'(비용류는 'down').
export function Delta({ value, good = 'up', suffix = '%' }: { value: number | null; good?: 'up' | 'down'; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return <span style={{ fontSize: T.delta, color: C.muted }}>—</span>;
  const up = value > 0;
  const flat = value === 0;
  const color = flat ? C.muted : (up === (good === 'up') ? C.up : C.down);
  return (
    <span style={{ fontSize: T.delta, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {flat ? '→' : up ? '↑' : '↓'} {Math.abs(Math.round(value * 10) / 10)}{suffix}
    </span>
  );
}

export type LegendItem = { label: string; kind: 'line' | 'dash' | 'bar' | 'dot' | 'band'; color: string };
export function Legend({ items, align = 'end' }: { items: LegendItem[]; align?: 'start' | 'end' | 'center' }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', justifyContent: align === 'end' ? 'flex-end' : align, fontSize: T.axis, color: C.secondary }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="10" aria-hidden="true">
            {it.kind === 'line' && <line x1="0" y1="5" x2="16" y2="5" stroke={it.color} strokeWidth={S.lineWidth} />}
            {it.kind === 'dash' && <line x1="0" y1="5" x2="16" y2="5" stroke={it.color} strokeWidth={S.compareWidth} strokeDasharray={S.compareDash} />}
            {it.kind === 'bar' && <rect x="3" y="0" width="10" height="10" rx="2" fill={it.color} />}
            {it.kind === 'dot' && <circle cx="8" cy="5" r="4" fill={it.color} />}
            {it.kind === 'band' && <rect x="0" y="1" width="16" height="8" fill={it.color} />}
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ icon, title, value, valueSub, delta, subtitle, definition, legend, children, footnote }: {
  icon?: ReactNode; title: string; value?: ReactNode; valueSub?: ReactNode; delta?: ReactNode;
  subtitle?: string; definition?: string; legend?: ReactNode; children: ReactNode; footnote?: ReactNode;
}) {
  return (
    <section style={{ background: C.card, borderRadius: S.cardRadius, padding: `${S.cardPadY}px ${S.cardPadX}px`, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text }}>
        {icon && <span style={{ color: C.secondary, display: 'inline-flex' }} aria-hidden="true">{icon}</span>}
        <h3 style={{ margin: 0, fontSize: T.cardTitle, fontWeight: 600 }}>{title}</h3>
      </header>
      {(value !== undefined || delta) && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: T.value, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</span>
            {valueSub && <span style={{ fontSize: 13, color: C.muted }}>{valueSub}</span>}
          </div>
          {delta}
        </div>
      )}
      {subtitle && (
        <div style={{ fontSize: T.subtitle, fontWeight: 600, color: C.text }}>
          <span title={definition} style={definition ? { textDecoration: 'underline dotted', textUnderlineOffset: 4, cursor: 'help' } : undefined}>{subtitle}</span>
        </div>
      )}
      <div style={{ minWidth: 0 }}>{children}</div>
      {legend}
      {footnote && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{footnote}</div>}
    </section>
  );
}

// 마우스 올림 상세 — 카드 안 절대 위치. 차트가 x·y와 내용을 넘긴다.
export function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - 90, 0), Math.max(width - 180, 0));
  return (
    <div role="status" style={{ position: 'absolute', left, top: Math.max(y - 8, 0), transform: 'translateY(-100%)', width: 180, pointerEvents: 'none',
      background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(15,20,25,.12)', padding: '8px 10px', fontSize: 12, color: C.text, lineHeight: 1.5, zIndex: 2 }}>
      {children}
    </div>
  );
}
