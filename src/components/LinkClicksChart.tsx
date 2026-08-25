'use client';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface DailyClickPoint { date: string; clicks: number } // date = YYYY-MM-DD

// 최근 30일 일별 클릭 미니 막대 차트 — 단일 시리즈라 범례 없음(제목이 시리즈명을 겸한다).
// recharts는 리포트 기능(api-integration 워크트리)과 같은 ^3.10.1 — 머지 시 자동 합류.
// 막대색 #1573ad = 리포 x-blue-text(흰 배경 대비 5.14:1 — 밝은 x-blue는 3:1 미달이라 마크 색으로 부적합).
export function LinkClicksChart({ points }: { points: DailyClickPoint[] }) {
  const data = points.map((p) => ({
    ...p,
    label: `${parseInt(p.date.slice(5, 7), 10)}/${parseInt(p.date.slice(8, 10), 10)}`,
  }));
  return (
    <div className="h-[110px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="25%">
          <XAxis dataKey="label" tickLine={false} interval={6}
                 axisLine={{ stroke: 'var(--color-x-border)' }}
                 tick={{ fontSize: 11, fill: 'var(--color-x-muted)' }} />
          {/* 전부 0인 날들만 있어도 축이 무너지지 않게 상한 최소 1 — 0을 가득 찬 막대처럼 그리면 거짓말이 된다 */}
          <YAxis hide allowDecimals={false} domain={[0, (dataMax: number) => Math.max(dataMax, 1)]} />
          <Tooltip cursor={{ fill: 'var(--color-x-hover)' }} content={({ active, payload }) => (
            active && payload?.length ? (
              <div className="rounded-md border border-x-border bg-white px-2 py-1 text-caption shadow-sm">
                {(payload[0].payload as DailyClickPoint).date} · 클릭 {(payload[0].payload as DailyClickPoint).clicks}
              </div>
            ) : null
          )} />
          <Bar dataKey="clicks" fill="#1573ad" radius={[3, 3, 0, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
