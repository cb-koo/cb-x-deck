'use client';
import { C, NUM } from './tokens';
import { Delta } from './ChartCard';

// 퍼널 — 단계별 한 줄. 막대 = 첫 단계(신규 인입) 대비 남은 비율 — 맨 위 100%에서 아래로 줄어드는 퍼널 모양(10-09 koo 질문 반영).
// 숫자 열 '앞 단계에서' = 단계 사이 전환율. 열 제목을 달아 두 숫자(전환율 / 지난 기간 대비 증감)가 섞이지 않게.
// 증감은 사람 수 절대 차이. 아직 진행 중인 단계(inProgress)는 흐리게 + '진행 중', 비교하지 않는다.
export type FunnelStep = { name: string; count: number | null; sub?: string; prevCount?: number | null; inProgress?: boolean };

const GRID = 'minmax(0,1fr) 76px 96px';

export function FunnelList({ steps, compareName }: { steps: FunnelStep[]; compareName: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, fontSize: 12, color: C.muted, paddingBottom: 6, borderBottom: '1px solid #e6ebee' }}>
        <div>단계 · 사람 수</div><div style={{ textAlign: 'right' }}>앞 단계에서</div><div style={{ textAlign: 'right' }}>{compareName} 대비</div>
      </div>
      {steps.map((s, i) => {
        const before = i > 0 ? steps[i - 1].count : null;
        const first = steps[0].count;
        const ofFirst = first && s.count !== null ? (s.count / first) * 100 : null;
        const rate = before && s.count !== null ? (s.count / before) * 100 : null;
        const diff = !s.inProgress && s.prevCount != null && s.count !== null ? s.count - s.prevCount : null;
        return (
          <div key={s.name} style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 12, minHeight: 56, borderTop: i ? `1px solid #eceff1` : 'none', padding: '6px 0', opacity: s.inProgress ? 0.6 : 1 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, color: C.text }}>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{s.count === null ? '—' : `${NUM.format(s.count)}명`}</b> {s.name}
                {s.inProgress && <span style={{ marginLeft: 6, fontSize: 12, color: '#8a4b08' }}>진행 중</span>}
              </div>
              {ofFirst !== null && (
                <div title={i === 0 ? '기준 100%' : `신규 인입의 ${Math.round(ofFirst)}%`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <div style={{ flex: 1, height: 8, background: '#e6ebee', borderRadius: 4 }}>
                    <div style={{ width: `${Math.max(1, Math.min(100, ofFirst))}%`, height: 8, background: C.primary, borderRadius: 4 }} />
                  </div>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              {rate !== null ? <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{Math.round(rate)}%</div>
                : <div style={{ fontSize: 12, color: C.muted }}>—</div>}
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
