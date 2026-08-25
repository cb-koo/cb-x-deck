'use client';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyClickPoint } from '@/lib/linkStore';

// 최근 7일 일별 클릭 — 단일 시리즈라 범례 없음(제목이 시리즈명을 겸한다). 데이터는 마지막 새로고침 때
// 저장한 추이(030) — 표의 클릭 열과 같은 시점이라 숫자와 그림이 어긋나지 않는다(koo A안).
// recharts는 리포트 기능(api-integration 워크트리)과 같은 ^3.10.1 — 머지 시 자동 합류.
// 막대색 #1573ad = 리포 x-blue-text(흰 배경 대비 5.14:1 — 밝은 x-blue는 3:1 미달이라 마크 색으로 부적합).
const BAR = '#1573ad';

const label = (p: DailyClickPoint) => `${parseInt(p.date.slice(5, 7), 10)}/${parseInt(p.date.slice(8, 10), 10)}`;

function TipBox({ active, payload }: { active?: boolean; payload?: Array<{ payload: DailyClickPoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-x-border bg-white px-2 py-1 text-caption shadow-sm">
      {p.date} · 클릭 {p.clicks}
    </div>
  );
}

// 펼침용 큰 차트
export function LinkClicksChart({ points }: { points: DailyClickPoint[] }) {
  const data = points.map((p) => ({ ...p, label: label(p) }));
  return (
    <div className="h-[110px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="25%">
          <XAxis dataKey="label" tickLine={false} interval={data.length <= 10 ? 0 : 6}
                 axisLine={{ stroke: 'var(--color-x-border)' }}
                 tick={{ fontSize: 11, fill: 'var(--color-x-muted)' }} />
          {/* 전부 0인 날들만 있어도 축이 무너지지 않게 상한 최소 1 — 0을 가득 찬 막대처럼 그리면 거짓말이 된다 */}
          <YAxis hide allowDecimals={false} domain={[0, (dataMax: number) => Math.max(dataMax, 1)]} />
          <Tooltip cursor={{ fill: 'var(--color-x-hover)' }} content={<TipBox />} />
          <Bar dataKey="clicks" fill={BAR} radius={[3, 3, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// 부모 행의 클릭 열에 들어가는 스파크라인 — 축·라벨 없이 모양만, 상세는 툴팁과 펼침이 맡는다.
// 고정 크기(ResponsiveContainer 없음): 행마다 하나씩 수십 개가 그려지므로 측정 오버헤드를 피한다.
export function LinkSparkline({ points }: { points: DailyClickPoint[] }) {
  return (
    <BarChart width={64} height={20} data={points} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap="20%">
      <YAxis hide allowDecimals={false} domain={[0, (dataMax: number) => Math.max(dataMax, 1)]} />
      <Tooltip cursor={false} content={<TipBox />} wrapperStyle={{ zIndex: 20 }} />
      <Bar dataKey="clicks" fill={BAR} radius={[1, 1, 0, 0]} isAnimationActive={false} />
    </BarChart>
  );
}
