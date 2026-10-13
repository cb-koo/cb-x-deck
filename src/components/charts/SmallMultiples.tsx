'use client';
import { C } from './tokens';
import { VerdictChip } from './ChartCard';
import { normalRange, verdictOf, VERDICT_SHORT } from './normal';

// 작은 차트 나란히(스몰 멀티플) — 같은 지표를 묶음(클라이언트)마다 같은 모양·같은 세로 눈금으로 나란히.
// 세로 눈금을 공유해야 크기 비교가 정직하다(shared, 기본). 각 칸 = 주별 막대 + 그 묶음의 평소 띠 + 마지막 막대 강조 + 판정 글자.
export type Multiple = { name: string; values: Array<number | null> };

export function SmallMultiples({ items, labels, unit = '', shared = true, height = 96 }: { items: Multiple[]; labels: string[]; unit?: string; shared?: boolean; height?: number }) {
  const globalMax = Math.max(1, ...items.flatMap((it) => it.values.filter((v): v is number => v !== null)));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      {items.map((it) => {
        const vals = it.values.filter((v): v is number => v !== null);
        const band = normalRange(it.values.slice(-8)); // 키트 규칙: 평소 = 최근 8주
        const last = it.values[it.values.length - 1];
        const v = last === null ? null : verdictOf(last, band);
        const max = shared ? globalMax : Math.max(1, ...vals);
        const n = it.values.length, W = 200, gap = 3, bw = (W - gap * (n - 1)) / n;
        const yy = (val: number) => height - (val / max) * (height - 6);
        return (
          <div key={it.name} style={{ background: '#fff', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 14 }}>{it.name} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{last ?? '—'}{unit}</b></div>
              {v && <VerdictChip verdict={v} text={VERDICT_SHORT[v]} />}
            </div>
            <svg viewBox={`0 0 ${W} ${height + 16}`} width="100%" height={height + 16} preserveAspectRatio="none" role="img" aria-label={`${it.name} ${labels.map((l, i) => `${l} ${it.values[i] ?? '없음'}`).join(', ')}`}>
              <rect x={0} y={yy(band[1])} width={W} height={Math.max(1, yy(band[0]) - yy(band[1]))} fill={C.band} />
              {it.values.map((val, i) => val !== null && val > 0 && (
                <rect key={i} x={i * (bw + gap)} y={yy(val)} width={bw} height={height - yy(val)} rx={1.5} fill={i === n - 1 ? C.primary : C.neutralBar}>
                  <title>{`${labels[i]} ${val}${unit}`}</title>
                </rect>
              ))}
              <line x1={0} x2={W} y1={height} y2={height} stroke={C.axis} vectorEffect="non-scaling-stroke" />
              <text x={0} y={height + 13} fontSize={10} fill={C.muted}>{labels[0]}</text>
              <text x={W} y={height + 13} fontSize={10} fill={C.text} textAnchor="end">{labels[n - 1]}</text>
            </svg>
            <div style={{ fontSize: 11, color: C.muted }}>평소(최근 8주) {band[0]}~{band[1]}{unit}</div>
          </div>
        );
      })}
    </div>
  );
}
