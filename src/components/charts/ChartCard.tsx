'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { C, S, T, NUM } from './tokens';
import type { Verdict } from './normal';

// 차트 카드 — 고정 순서: [아이콘 제목 · ?] → [큰 숫자 · 증감] → [결론 한 줄] → [주의(판단을 바꿀 때만)] → [차트] → [다음 행동(규칙에 걸릴 때만)].
// 글 줄이기 원칙(10-09 koo): 카드에 남기는 글 = 결론 한 줄 + 숫자. 뜻·계산·보는 법은 전부 ? 설명 창(항목별 짧은 줄, 줄글 금지).
// 판단을 바꾸는 정보(진행 중, 표본 적음)는 보이게, 이해를 돕는 정보는 ? 안으로. 범례는 가능하면 차트 안 직접 라벨로.

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

// 증감 — 절대 차이("+23명")와 화살표. 비교 기준("그 전주 21명")은 마우스를 올리면 보인다.
// good: 늘어나는 게 분명히 좋으면 'up', 줄어드는 게 좋으면 'down', 판단이 갈리면 생략(중립색).
export function Delta({ diff, unit = '', base, good, size = 15 }: {
  diff: number | null; unit?: string; base?: string; good?: 'up' | 'down'; size?: number;
}) {
  if (diff === null || !Number.isFinite(diff)) return <span style={{ fontSize: size, color: C.muted }}>—</span>;
  const flat = diff === 0;
  const up = diff > 0;
  const color = flat || !good ? C.secondary : (up === (good === 'up') ? C.up : C.down);
  return (
    <span title={base} aria-label={base ? `${base} 대비` : undefined} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.3, cursor: base ? 'help' : undefined }}>
      <span style={{ fontSize: size, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {flat ? '→ 같음' : `${up ? '↑ +' : '↓ −'}${NUM.format(Math.abs(Math.round(diff)))}${unit}`}
      </span>
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

// ? 설명 창 — 줄글 대신 정해진 칸: 뜻(한 줄) / 보는 법 / 계산 / 주의(각 항목 짧은 줄 목록). 읽는 순서 = 무엇 → 어떻게 보나 → 어떻게 셌나 → 조심할 점.
export type Info = { what: string; calc?: string[]; read?: string[]; note?: string[] };
function InfoButton({ info }: { info: Info }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const sec = (label: string, items?: string[]) => items && items.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.secondary }}>{label}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map((t) => (
          <li key={t} style={{ display: 'flex', gap: 8, fontSize: 13, color: C.text, lineHeight: 1.45 }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 4, height: 4, borderRadius: 999, background: C.muted, marginTop: 8 }} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div ref={ref} style={{ marginLeft: 'auto', position: 'relative' }}>
      <button type="button" aria-expanded={open} aria-controls={id} aria-label="이 차트 설명" onClick={() => setOpen((v) => !v)}
        style={{ width: 22, height: 22, borderRadius: 999, border: `1px solid ${C.axis}`, background: open ? '#fff' : 'transparent', fontSize: 12, color: C.muted, cursor: 'pointer', padding: 0 }}>?</button>
      {open && (
        <div id={id} role="dialog" style={{ position: 'absolute', right: 0, top: 28, width: 300, zIndex: 5, background: '#fff', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(15,20,25,.14)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.45 }}>{info.what}</div>
          {sec('보는 법', info.read)}
          {sec('계산', info.calc)}
          {sec('주의', info.note)}
        </div>
      )}
    </div>
  );
}

export function ChartCard({ icon, title, value, valueSub, delta, headline, info, caution, legend, children, action }: {
  icon?: ReactNode; title: string; value?: ReactNode; valueSub?: ReactNode; delta?: ReactNode;
  headline?: ReactNode; info?: Info; caution?: ReactNode; legend?: ReactNode; children: ReactNode; action?: ReactNode;
}) {
  return (
    <section style={{ background: C.card, borderRadius: S.cardRadius, padding: `${S.cardPadY}px ${S.cardPadX}px`, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.secondary }}>
        {icon && <span style={{ display: 'inline-flex' }} aria-hidden="true">{icon}</span>}
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {info && <InfoButton info={info} />}
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
      {action && <div style={{ fontSize: 13, color: C.text, borderTop: '1px solid #e6ebee', paddingTop: 10, lineHeight: 1.5 }}><span style={{ color: C.primaryDeep, fontWeight: 700 }}>다음 행동 · </span>{action}</div>}
    </section>
  );
}

// 마우스 올림 상세 — 카드 안 절대 위치. 내용은 TipBody 형식(제목 → 부제 → 이름·값 줄 → 메모)으로 통일.
const TIP_W = 248;
// 위쪽 공간(y)이 상세 창 높이보다 작으면 아래(yBelow)로 뒤집어 카드 밖으로 잘리지 않게.
export function Tip({ x, y, yBelow, width, children }: { x: number; y: number; yBelow?: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - TIP_W / 2, 0), Math.max(width - TIP_W, 0));
  const flip = y < 150 && yBelow !== undefined;
  return (
    <div role="status" style={{ position: 'absolute', left, top: flip ? (yBelow as number) + 10 : Math.max(y - 10, 0), transform: flip ? 'none' : 'translateY(-100%)', width: TIP_W, pointerEvents: 'none',
      background: '#fff', borderRadius: 10, boxShadow: '0 6px 20px rgba(15,20,25,.14)', padding: '10px 12px', color: C.text, zIndex: 3 }}>
      {children}
    </div>
  );
}

// 상세 내용 형식 — 줄글 금지. 제목(무엇) · 부제(언제) · 이름/값 줄(값은 오른쪽 정렬, 핵심 값만 굵게) · 메모(있으면, 맨 아래 흐리게).
export type TipRow = { label: string; value: string; strong?: boolean; tone?: 'up' | 'down' | 'muted'; section?: boolean };
export type TipData = { title: string; sub?: string; rows: TipRow[]; note?: string };
export function TipBody({ title, sub, rows, note }: TipData) {
  const toneColor = { up: C.primaryDeep, down: '#a14d00', muted: C.muted } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid #eef1f3', paddingTop: 6 }}>
        {rows.map((r, i) => r.section
          ? <div key={i} style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginTop: 4 }}>{r.label}</div>
          : (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, lineHeight: 1.45 }}>
              <span style={{ color: C.secondary, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: r.strong ? 700 : 500, color: r.tone ? toneColor[r.tone] : C.text }}>{r.value}</span>
            </div>
          ))}
      </div>
      {note && <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.45, borderTop: '1px solid #eef1f3', paddingTop: 6 }}>{note}</div>}
    </div>
  );
}
