'use client';
import { C, NUM } from './tokens';
import { Delta } from './ChartCard';

// 퍼널 — 레퍼런스처럼 차트 대신 단계별 한 줄 목록. 단계 이름·사람 수 / 앞 단계 대비 비율 / 지난 기간 대비 증감.
// 얇은 진행 막대는 '앞 단계 대비 비율'만 보여 준다(길이 = 비율, 색 하나).
export type FunnelStep = { name: string; count: number | null; sub?: string; prevCount?: number | null };

export function FunnelList({ steps, compareName }: { steps: FunnelStep[]; compareName: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((s, i) => {
        const before = i > 0 ? steps[i - 1].count : null;
        const rate = before && s.count !== null ? (s.count / before) * 100 : null;
        const chg = s.prevCount && s.count !== null ? ((s.count - s.prevCount) / s.prevCount) * 100 : null;
        return (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 72px 92px', alignItems: 'center', gap: 12, minHeight: 52, borderTop: i ? `1px solid #eceff1` : 'none', padding: '6px 0' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text }}>{s.name}</div>
              <div style={{ fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{s.count === null ? '—' : `${NUM.format(s.count)}명`}{s.sub ? ` · ${s.sub}` : ''}</div>
              {rate !== null && (
                <div style={{ height: 4, background: '#e6ebee', borderRadius: 2, marginTop: 6 }}>
                  <div style={{ width: `${Math.min(100, rate)}%`, height: 4, background: C.primary, borderRadius: 2 }} />
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
              {rate === null ? '' : `${Math.round(rate)}%`}
            </div>
            <div style={{ textAlign: 'right' }} title={`${compareName} 대비`}>
              {chg !== null ? <span style={{ fontSize: 13 }}><Delta value={chg} /></span> : null}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>비율 = 앞 단계 대비 · 증감 = {compareName} 대비 사람 수</div>
    </div>
  );
}
