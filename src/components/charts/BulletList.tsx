'use client';
import { C, NUM } from './tokens';
import { VerdictChip } from './ChartCard';

// 불릿 차트(목표 대비) — 한 줄 = 하나의 예산. 트랙 = 전체 예산, 진한 막대 = 집행, 연한 막대 = 예정(집행 + 예정까지),
// 세로 표시 = 오늘 기준 적정선(기간이 지난 비율 × 예산). 오른쪽 판정 = 집행이 적정선보다 10%p 넘게 낮으면 '느림', 높으면 '빠름'.
export type BulletRow = { label: string; total: number; spent: number; planned: number; pace: number; sub?: string };

const PACE_TOL = 0.1;

export function BulletList({ rows, paceLabel = '오늘 기준 적정' }: { rows: BulletRow[]; paceLabel?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => {
        const pct = (v: number) => (r.total > 0 ? Math.min(100, (v / r.total) * 100) : 0);
        const gap = r.total > 0 ? r.spent / r.total - r.pace : 0;
        // 끝난 기간(pace 1)은 속도가 아니라 결과 — '덜 씀/더 씀'
        const done = r.pace >= 1;
        const verdict = gap < -PACE_TOL ? { v: 'below' as const, t: done ? '덜 씀' : '집행 느림' } : gap > PACE_TOL ? { v: 'above' as const, t: done ? '더 씀' : '집행 빠름' } : { v: 'normal' as const, t: '적정' };
        return (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 120px) minmax(0,1fr) auto', alignItems: 'center', gap: 14, minHeight: 64, borderTop: i ? '1px solid #eceff1' : 'none' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
              <div style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>예산 {NUM.format(Math.round(r.total / 10000))}만</div>
            </div>
            <div title={`집행 ${NUM.format(r.spent)}원 · 예정 포함 ${NUM.format(r.planned)}원 · ${paceLabel} ${NUM.format(Math.round(r.total * r.pace))}원`} style={{ position: 'relative', height: 26 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, top: 9, height: 10, background: '#e6ebee', borderRadius: 999 }} />
              <div style={{ position: 'absolute', left: 0, top: 9, height: 10, width: `${pct(r.planned)}%`, background: '#cfe6f7', borderRadius: 999 }} />
              <div style={{ position: 'absolute', left: 0, top: 9, height: 10, width: `${pct(r.spent)}%`, background: C.primary, borderRadius: 999 }} />
              <div aria-hidden="true" style={{ position: 'absolute', left: `calc(${r.pace * 100}% - 1px)`, top: 3, height: 22, width: 2, background: C.text, borderRadius: 1 }} />
              <div style={{ position: 'absolute', left: `clamp(0px, calc(${r.pace * 100}% - 40px), calc(100% - 80px))`, top: -12, width: 80, textAlign: 'center', fontSize: 11, color: C.secondary }}>{i === 0 ? paceLabel : ''}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <VerdictChip verdict={verdict.v} text={verdict.t} />
              <span style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>집행 {Math.round(pct(r.spent))}% · 적정 {Math.round(r.pace * 100)}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
