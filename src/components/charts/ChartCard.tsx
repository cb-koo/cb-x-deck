'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { C, S, T, NUM } from './tokens';
import type { Verdict } from './normal';

// 차트 카드 — 고정 순서: [아이콘 제목] → [큰 숫자 · 증감] → [결론 문장] → [주의(있으면, 늘 보임)] → [차트] → [범례] → [다음 행동].
// 사용자 관점 검토(10-09) 반영: 소제목은 지표 이름이 아니라 결론 문장, 판단을 바꾸는 주의는 툴팁이 아니라 화면에,
// 증감은 절대 차이 + 비교 기준을 글로, 색은 좋고 나쁨이 분명할 때만.

export function useWidth<E extends HTMLElement>(): [React.RefObject<E | null>, number] {
  const ref = useRef<E>(null);
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

// 증감 — 절대 차이 먼저("+23명"), 비교 기준은 글로("지난주 21명"). 화살표 필수.
// good: 늘어나는 게 분명히 좋으면 'up', 줄어드는 게 좋으면 'down', 판단이 갈리면 생략(중립색).
export function Delta({ diff, unit = '', base, good, size = 15 }: {
  diff: number | null; unit?: string; base?: string; good?: 'up' | 'down'; size?: number;
}) {
  if (diff === null || !Number.isFinite(diff)) return <span style={{ fontSize: size, color: C.muted }}>—</span>;
  const flat = diff === 0;
  const up = diff > 0;
  const color = flat || !good ? C.secondary : (up === (good === 'up') ? C.up : C.down);
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.3 }}>
      <span style={{ fontSize: size, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {flat ? '→ 같음' : `${up ? '↑ +' : '↓ −'}${NUM.format(Math.abs(Math.round(diff)))}${unit}`}
      </span>
      {base && <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>{base}</span>}
    </span>
  );
}

// 평소 대비 판정 글자 — 색만으로 읽히지 않게 글자가 본체.
const VERDICT_STYLE: Record<Verdict, { bg: string; fg: string }> = {
  above: { bg: '#e8f5fd', fg: C.primaryDeep },
  normal: { bg: '#eef1f3', fg: C.secondary },
  below: { bg: '#fff3e6', fg: '#a14d00' },
};
export function VerdictChip({ verdict, text }: { verdict: Verdict; text: string }) {
  const s = VERDICT_STYLE[verdict];
  return <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{text}</span>;
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
            {it.kind === 'band' && <rect x="0" y="1" width="16" height="8" fill={it.color} stroke="#d5dde2" />}
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ icon, title, value, valueSub, delta, headline, definition, caution, legend, children, footnote, action }: {
  icon?: ReactNode; title: string; value?: ReactNode; valueSub?: ReactNode; delta?: ReactNode;
  headline?: ReactNode; definition?: string; caution?: ReactNode; legend?: ReactNode; children: ReactNode; footnote?: ReactNode; action?: ReactNode;
}) {
  return (
    <section style={{ background: C.card, borderRadius: S.cardRadius, padding: `${S.cardPadY}px ${S.cardPadX}px`, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.secondary }}>
        {icon && <span style={{ display: 'inline-flex' }} aria-hidden="true">{icon}</span>}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {definition && (
          <span title={definition} aria-label={`뜻: ${definition}`} style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: 999, border: `1px solid ${C.axis}`, fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', color: C.muted }}>?</span>
        )}
      </header>
      {(value !== undefined || delta) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: T.value, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</span>
            {valueSub && <span style={{ fontSize: 13, color: C.muted }}>{valueSub}</span>}
          </div>
          {delta}
        </div>
      )}
      {headline && <div style={{ fontSize: 15, fontWeight: 600, color: C.text, lineHeight: 1.45 }}>{headline}</div>}
      {caution && <div style={{ fontSize: 13, color: '#8a4b08', background: '#fff7ed', borderRadius: 8, padding: '6px 10px', lineHeight: 1.45 }}>{caution}</div>}
      <div style={{ minWidth: 0 }}>{children}</div>
      {legend}
      {footnote && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{footnote}</div>}
      {action && <div style={{ fontSize: 13, color: C.text, borderTop: '1px solid #e6ebee', paddingTop: 10, lineHeight: 1.5 }}><span style={{ color: C.primaryDeep, fontWeight: 700 }}>다음 행동 · </span>{action}</div>}
    </section>
  );
}

// 마우스 올림 상세 — 카드 안 절대 위치.
export function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - 100, 0), Math.max(width - 200, 0));
  return (
    <div role="status" style={{ position: 'absolute', left, top: Math.max(y - 8, 0), transform: 'translateY(-100%)', width: 200, pointerEvents: 'none',
      background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(15,20,25,.12)', padding: '8px 10px', fontSize: 12, color: C.text, lineHeight: 1.5, zIndex: 2 }}>
      {children}
    </div>
  );
}
