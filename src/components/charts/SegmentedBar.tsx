'use client';
import { C, NUM } from './tokens';

// 구간 막대 — 진행 막대·구간 진행 막대·예산 누적 막대·미니 막대·100% 누적 막대를 이 하나로(전수 검토 #8~12).
// 구간은 왼쪽부터 쌓이고 나머지는 빈 트랙. 색은 호출자가 tokens 안에서 고른다(주색 = 이번 것, 연한 주색 = 예정, 중립 = 다른 것).
// pct: 막대 끝 % 라벨 — 지정한 구간까지의 누적 끝을 따라 움직인다(캠페인 비용 카드 관례). inBar: 구간 안 % 글자(12% 이상일 때만).
export type Segment = { value: number; color: string; label: string };
type Props = { segments: Segment[]; total: number; size?: 'md' | 'sm' | 'mini'; pct?: { upTo: number; text?: string }; inBar?: boolean; ariaLabel?: string };

const H = { md: 10, sm: 6, mini: 4 } as const;

export function SegmentedBar({ segments, total, size = 'md', pct, inBar, ariaLabel }: Props) {
  const h = inBar ? 20 : H[size];
  const share = (v: number) => (total > 0 ? Math.max(0, (v / total) * 100) : 0);
  const cum = pct ? segments.slice(0, pct.upTo + 1).reduce((s, x) => s + share(x.value), 0) : 0;
  const label = ariaLabel ?? segments.map((s) => `${s.label} ${NUM.format(s.value)}`).join(', ') + ` / 전체 ${NUM.format(total)}`;
  return (
    <div role="img" aria-label={label} style={{ position: 'relative', paddingTop: pct ? 20 : 0, width: size === 'mini' ? 48 : '100%' }}>
      {pct && (
        <span style={{ position: 'absolute', top: 0, left: `clamp(0px, calc(${Math.min(cum, 100)}% - 16px), calc(100% - 36px))`, fontSize: 12, fontWeight: 700, color: C.primaryDeep, fontVariantNumeric: 'tabular-nums' }}>
          {pct.text ?? `${Math.round(cum)}%`}
        </span>
      )}
      <div style={{ display: 'flex', height: h, borderRadius: inBar ? 4 : 999, overflow: 'hidden', background: '#e6ebee' }}>
        {segments.map((s) => (
          <div key={s.label} title={`${s.label} ${NUM.format(s.value)}`} style={{ width: `${share(s.value)}%`, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums', minWidth: 0, overflow: 'hidden' }}>
            {inBar && share(s.value) >= 12 ? `${Math.round(share(s.value))}%` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// 구간 범례 — 칸 색 + 이름 + 값을 한 줄씩(막대 아래). 값은 오른쪽 정렬.
export function SegmentLegend({ items, unit = '' }: { items: Array<{ label: string; value: number; color: string }>; unit?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, background: it.color, border: it.color === '#e6ebee' ? '1px solid #cfd9de' : 'none', flex: 'none' }} />
          <span style={{ color: C.secondary, flex: 1 }}>{it.label}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{NUM.format(it.value)}{unit}</span>
        </div>
      ))}
    </div>
  );
}
