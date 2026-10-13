'use client';
import { C, NUM } from './tokens';

// 막대 목록 — 순위·비중 가로 막대(전수 검토 #7: 지점별 매출·기능별 비용·주간 추이·주제 비중). 한 줄 = 항목 하나.
// 길이 = 값 / 최댓값. prev가 있으면 아래 얇은 회색 막대로 지난 기간(퍼널의 지난 기간 막대 대체). 값은 오른쪽 글자.
export type BarItem = { label: string; value: number; prev?: number; sub?: string };

export function BarList({ items, format = (v) => NUM.format(v), unit = '', max }: { items: BarItem[]; format?: (v: number) => string; unit?: string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => Math.max(i.value, i.prev ?? 0)));
  return (
    <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it, i) => (
        <div role="listitem" key={it.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 132px) minmax(0,1fr) 72px', alignItems: 'center', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</div>
            {it.sub && <div style={{ fontSize: 11, color: C.muted }}>{it.sub}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ height: 10, background: '#e6ebee', borderRadius: 999 }}>
              <div style={{ width: `${Math.max(1, (it.value / top) * 100)}%`, height: 10, borderRadius: 999, background: i === 0 ? C.primary : C.primaryDeep, opacity: i === 0 ? 1 : 0.55 }} />
            </div>
            {it.prev !== undefined && (
              <div title={`지난 기간 ${format(it.prev)}${unit}`} style={{ height: 3, width: `${Math.max(1, (it.prev / top) * 100)}%`, background: C.neutralBar, borderRadius: 999 }} />
            )}
          </div>
          <div style={{ textAlign: 'right', fontSize: 13, fontWeight: i === 0 ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{format(it.value)}{unit}</div>
        </div>
      ))}
    </div>
  );
}
