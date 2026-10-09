'use client';
import { C, NUM } from './tokens';
import { Delta } from './ChartCard';

// 퍼널 — 단계별 한 줄. 열 제목을 달아 두 숫자(다음 단계 비율 / 지난 기간 대비 증감)가 섞이지 않게.
// 증감은 사람 수 절대 차이. 아직 진행 중인 단계(inProgress)는 흐리게 + '진행 중', 비교하지 않는다.
export type FunnelStep = { name: string; count: number | null; sub?: string; prevCount?: number | null; inProgress?: boolean };

const GRID = 'minmax(0,1fr) 84px 96px';

export function FunnelList({ steps, compareName }: { steps: FunnelStep[]; compareName: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, fontSize: 12, color: C.muted, paddingBottom: 6, borderBottom: '1px solid #e6ebee' }}>
        <div>단계 · 사람 수</div><div style={{ textAlign: 'right' }}>앞 단계에서</div><div style={{ textAlign: 'right' }}>{compareName} 대비</div>
      </div>
      {steps.map((s, i) => {
        const before = i > 0 ? steps[i - 1].count : null;
        const rate = before && s.count !== null ? (s.count / before) * 100 : null;
        const diff = !s.inProgress && s.prevCount != null && s.count !== null ? s.count - s.prevCount : null;
        return (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 12, minHeight: 56, borderTop: i ? `1px solid #eceff1` : 'none', padding: '6px 0', opacity: s.inProgress ? 0.6 : 1 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text }}>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{s.count === null ? '—' : `${NUM.format(s.count)}명`}</b> {s.name}
                {s.inProgress && <span style={{ marginLeft: 6, fontSize: 12, color: '#8a4b08' }}>진행 중</span>}
              </div>
              {s.sub && <div style={{ fontSize: 12, color: C.muted }}>{s.sub}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              {rate !== null && (
                <>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{Math.round(rate)}%</div>
                  <div style={{ height: 4, background: '#e6ebee', borderRadius: 2, marginTop: 4 }}>
                    <div style={{ width: `${Math.min(100, rate)}%`, height: 4, background: C.primary, borderRadius: 2 }} />
                  </div>
                </>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              {s.inProgress ? <span style={{ fontSize: 12, color: C.muted }}>비교 안 함</span>
                : diff !== null ? <Delta diff={diff} unit="명" good="up" size={14} base={`${compareName} ${NUM.format(s.prevCount as number)}명`} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
