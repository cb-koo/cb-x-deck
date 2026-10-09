'use client';
import { C, HEAT } from './tokens';

// 코호트 표 — 레퍼런스 형식: 행 = 시작 주, 열 = 경과, 칸 = 비율(같은 색의 명도 단계). 맨 위 '평균' 행으로 각 주를 평소와 비교.
// 아직 시간이 안 지난 칸은 비워 계단 모양이 된다(0이 아니라 '아직 모름'). 색만으로 읽히지 않게 칸에 값을 함께 적는다.
export type CohortRow = { label: string; n: number; cells: Array<number | null> };

export function CohortGrid({ columns, rows, max }: { columns: string[]; rows: CohortRow[]; max?: number }) {
  const all = rows.flatMap((r) => r.cells).filter((v): v is number => v !== null);
  const top = max ?? Math.max(1, ...all);
  const avg = columns.map((_, c) => {
    const v = rows.map((r) => ({ v: r.cells[c], n: r.n })).filter((x) => x.v !== null) as Array<{ v: number; n: number }>;
    const n = v.reduce((s, x) => s + x.n, 0);
    return n ? v.reduce((s, x) => s + x.v * x.n, 0) / n : null; // 인원 가중 평균
  });
  const color = (v: number) => HEAT[Math.min(HEAT.length - 1, Math.floor((v / top) * (HEAT.length - 0.001)))];
  const grid = `92px 44px repeat(${columns.length}, minmax(44px, 1fr))`;
  const cell = (v: number | null, key: string) => (
    <div key={key} style={{ height: 30, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
      fontVariantNumeric: 'tabular-nums', background: v === null ? 'transparent' : color(v),
      color: v !== null && v / top > 0.55 ? '#fff' : C.text }}>{v === null ? '' : `${Math.round(v)}%`}</div>
  );
  return (
    <div role="table" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, gap: 3, fontSize: 12, color: C.muted }}>
        <div>첫 문의 주</div><div style={{ textAlign: 'right' }}>인원</div>
        {columns.map((c) => <div key={c} style={{ textAlign: 'center' }}>{c}</div>)}
      </div>
      <div role="row" style={{ display: 'grid', gridTemplateColumns: grid, gap: 3, alignItems: 'center', fontSize: 13, borderBottom: `1px solid #e6ebee`, paddingBottom: 4, marginBottom: 2 }}>
        <div style={{ fontWeight: 600 }}>평균</div><div />
        {avg.map((v, i) => <div key={i} style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v === null ? '' : `${Math.round(v)}%`}</div>)}
      </div>
      {rows.map((r) => (
        <div role="row" key={r.label} style={{ display: 'grid', gridTemplateColumns: grid, gap: 3, alignItems: 'center', fontSize: 13 }}>
          <div style={{ color: C.text }}>{r.label}</div>
          <div style={{ textAlign: 'right', fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{r.n}명</div>
          {r.cells.map((v, i) => cell(v, r.label + i))}
        </div>
      ))}
    </div>
  );
}
