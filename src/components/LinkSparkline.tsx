'use client';
import { Bar, BarChart, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyClickPoint } from '@/lib/linkStore';

// 부모 행의 클릭 열에 들어가는 최근 7일 스파크라인 — 축 라벨 없이 모양만, 하단 기준선으로 막대 위치(날짜 순서)를
// 읽게 한다(koo QA 08-25). 데이터는 마지막 새로고침 때 저장한 추이(030) — 클릭 숫자와 같은 시점.
// recharts는 리포트 기능(api-integration 워크트리)과 같은 ^3.10.1 — 머지 시 자동 합류.
// 막대색 #1573ad = 리포 x-blue-text(흰 배경 대비 5.14:1 — 밝은 x-blue는 3:1 미달이라 마크 색으로 부적합).
const BAR = '#1573ad';

function TipBox({ active, payload }: { active?: boolean; payload?: Array<{ payload: DailyClickPoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-x-border bg-white px-2 py-1 text-caption shadow-sm">
      {p.date} · 클릭 {p.clicks}
    </div>
  );
}

// 저장 추이(생성일~오늘)에서 최근 7일만 — 7일이 안 된 링크는 앞을 0으로 채워 막대 폭·자리를 모든 행에서 같게 한다
// (그 날 링크가 없었으니 클릭 0은 사실이다).
export function lastDays(points: DailyClickPoint[], n: number): DailyClickPoint[] {
  const tail = points.slice(-n);
  if (tail.length === 0) return tail;
  const first = new Date(`${tail[0].date}T00:00:00Z`).getTime();
  const pad: DailyClickPoint[] = [];
  for (let i = n - tail.length; i > 0; i--) {
    pad.push({ date: new Date(first - i * 86400000).toISOString().slice(0, 10), clicks: 0 });
  }
  return [...pad, ...tail];
}

// 고정 크기(ResponsiveContainer 없음): 행마다 하나씩 수십 개가 그려지므로 측정 오버헤드를 피한다.
export function LinkSparkline({ points }: { points: DailyClickPoint[] }) {
  return (
    <BarChart width={64} height={22} data={lastDays(points, 7)} margin={{ top: 1, right: 0, bottom: 1, left: 0 }} barCategoryGap="20%">
      <XAxis dataKey="date" hide />
      {/* 전부 0인 날들만 있어도 축이 무너지지 않게 상한 최소 1 — 0을 가득 찬 막대처럼 그리면 거짓말이 된다 */}
      <YAxis hide allowDecimals={false} domain={[0, (dataMax: number) => Math.max(dataMax, 1)]} />
      {/* 하단 기준선 — 날짜 눈금 대신 '어디부터 어디까지가 7일인지'와 빈 날의 자리를 보여준다 */}
      <ReferenceLine y={0} stroke="var(--color-x-border-strong)" strokeWidth={1} />
      <Tooltip cursor={false} content={<TipBox />} wrapperStyle={{ zIndex: 20 }} />
      <Bar dataKey="clicks" fill={BAR} radius={[1, 1, 0, 0]} isAnimationActive={false} />
    </BarChart>
  );
}
