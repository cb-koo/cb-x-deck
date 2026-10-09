'use client';
import { C, HEAT } from './tokens';

// 코호트 표 — 행 = 시작 주, 열 = 경과, 칸 = 비율(명도 단계 + 값 글자). 맨 위 '평균'(인원 가중) 행.
// 아직 시간이 안 지난 칸은 비워 계단 모양. 인원이 minN 미만인 행은 흐리게 + '표본 적음' — 작은 표본이 진한 색으로 시선을 뺏지 않게.
export type CohortRow = { label: string; n: number; cells: Array<number | null> };

export function CohortGrid({ columns, rows, max, minN = 20 }: { columns: string[]; rows: CohortRow[]; max?: number; minN?: number }) {
  const all = rows.flatMap((r) => r.cells).filter((v): v is number => v !== null);
  const top = max ?? Math.max(1, ...all);
  const avg = columns.map((_, c) => {
    const v = rows.filter((r) => r.n >= minN).map((r) => ({ v: r.cells[c], n: r.n })).filter((x) => x.v !== null) as Array<{ v: number; n: number }>;
    const n = v.reduce((s, x) => s + x.n, 0);
    return v.length >= 2 && n ? v.reduce((s, x) => s + x.v * x.n, 0) / n : null; // 한 주뿐이면 평균이라 부르지 않는다
  });
  const color = (v: number) => HEAT[Math.min(HEAT.length - 1, Math.floor((v / top) * (HEAT.length - 0.001)))];
  const grid = `110px 52px repeat(${columns.length}, minmax(52px, 1fr))`;
  const cell = (v: number | null, key: string, faint: boolean) => (
    <div key={key} style={{ height: 30, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
      fontVariantNumeric: 'tabular-nums', background: v === null ? 'transparent' : faint ? '#eef1f3' : color(v),
      color: faint ? C.muted : v !== null && v / top > 0.55 ? '#fff' : C.text }}>{v === null ? '' : `${Math.round(v)}%`}</div>
  );
  return (
    <div role="table" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, gap: 3, fontSize: 12, color: C.muted }}>
        <div>첫 문의 주</div><div style={{ textAlign: 'right' }}>인원</div>
        {columns.map((c) => <div key={c} style={{ textAlign: 'center' }}>{c}</div>)}
      </div>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, gap: 3, alignItems: 'center', fontSize: 13, borderBottom: `1px solid #e6ebee`, paddingBottom: 4, marginBottom: 2 }}>
        <div style={{ fontWeight: 600 }}>평균</div><div />
        {avg.map((v, i) => <div key={i} style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{v === null ? '' : `${Math.round(v)}%`}</div>)}
      </div>
      {rows.map((r) => {
        const faint = r.n < minN;
        return (
          <div role="row" key={r.label} style={{ display: 'grid', gridTemplateColumns: grid, gap: 3, alignItems: 'center', fontSize: 13 }}>
            <div style={{ color: faint ? C.muted : C.text }}>{r.label}{faint && <span style={{ fontSize: 11, marginLeft: 4 }}>표본 적음</span>}</div>
            <div style={{ textAlign: 'right', fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{r.n}명</div>
            {r.cells.map((v, i) => cell(v, r.label + i, faint))}
          </div>
        );
      })}
    </div>
  );
}
