'use client';
// 주별 예약 매출 두 기준 — 막대 = 접수일 기준(그 주에 받은 예약의 금액, 대표), 선 = 방문일 기준(그 주에 실제 방문한 금액).
// 두 기준은 시간이 지나며 반대로 움직인다: 접수일 기준 최근 주는 '예정 포함'(확정 예약이 취소·불발로 바뀌면 줄어듦),
// 방문일 기준 최근 주는 '방문 진행 중'(앞으로 늘어남). 그래서 최근 RECENT주는 둘 다 점선으로 구분한다.
import { scaleBand, scaleLinear } from 'd3-scale';
import { useWidth } from '@/components/charts/ChartCard';
import { C, NUM } from '@/components/charts/tokens';

const VISIT = '#536471';
export const man = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${NUM.format(Math.round(n / 1e4))}만`);

// recent: 끝에서 몇 칸을 '바뀔 수 있음'(점선)으로 — 주차는 2(예약→방문 약 2주), 월은 1. recentLabel은 범례 글자.
export function RevenueWeeks({ labels, created, visit, days, height = 190, recent: RECENT = 2, recentLabel = '최근 2주' }: { labels: string[]; created: Array<number | null>; visit: Array<number | null>; days?: number[]; height?: number; recent?: number; recentLabel?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const short = !!days?.some((d) => d < 7);
  const padT = 18, padB = short ? 34 : 22, axisW = 40;
  const plotW = Math.max(width - axisW, 10), plotH = height - padT - padB;
  const max = Math.max(1, ...created.map((v) => v ?? 0), ...visit.map((v) => v ?? 0));
  const x = scaleBand<string>().domain(labels).range([0, plotW]).paddingInner(0.3).paddingOuter(0.15);
  const y = scaleLinear().domain([0, max * 1.12]).range([padT + plotH, padT]);
  const recent = (i: number) => i >= labels.length - RECENT;
  const cx = (i: number) => (x(labels[i]) ?? 0) + x.bandwidth() / 2;
  const vpts = visit.map((v, i) => (v === null ? null : ([cx(i), y(v)] as const)));
  return (
    <div>
      <div ref={ref} style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="주별 예약 매출">
            {[max / 2, max].map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray="4 4" />
                <text x={width} y={y(t) + 4} textAnchor="end" fontSize={11} fill={C.muted}>{man(t)}</text>
              </g>
            ))}
            {created.map((v, i) => {
              if (v === null) return null;
              const bx = x(labels[i]) ?? 0, h = Math.max(0, padT + plotH - y(v));
              return (
                <g key={labels[i]}>
                  {recent(i)
                    ? <rect x={bx + 0.5} y={y(v)} width={x.bandwidth() - 1} height={h} rx={3} fill="#e8f5fe" stroke={C.primary} strokeDasharray="3 2" />
                    : <rect x={bx} y={y(v)} width={x.bandwidth()} height={h} rx={3} fill={C.primary} />}
                  {v > 0 && <text x={cx(i)} y={y(v) - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={recent(i) ? C.primaryDeep : C.text}>{man(v)}</text>}
                </g>
              );
            })}
            {vpts.map((p, i) => {
              const q = vpts[i + 1];
              if (!p || !q) return null;
              return <line key={'l' + i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={VISIT} strokeWidth={2} strokeDasharray={recent(i + 1) ? '4 3' : undefined} />;
            })}
            {vpts.map((p, i) => p && <circle key={'c' + i} cx={p[0]} cy={p[1]} r={3} fill={recent(i) ? '#fff' : VISIT} stroke={VISIT} strokeWidth={1.5} />)}
            <line x1={0} x2={plotW} y1={padT + plotH} y2={padT + plotH} stroke={C.axis} />
            {labels.map((l, i) => <text key={l} x={cx(i)} y={height - (short ? 18 : 6)} textAnchor="middle" fontSize={11} fill={i === labels.length - 1 ? C.text : C.muted}>{l}</text>)}
            {short && days?.map((d, i) => d < 7 && <text key={'d' + i} x={cx(i)} y={height - 5} textAnchor="middle" fontSize={10} fill={C.muted}>{d}일</text>)}
          </svg>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-x-muted">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-3 rounded-sm" style={{ background: C.primary }} />접수일 기준</span>
        <span className="flex items-center gap-1.5"><i className="inline-block w-4 border-t-2" style={{ borderColor: VISIT }} />방문일 기준</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-3 rounded-sm border border-dashed" style={{ borderColor: C.primary, background: '#e8f5fe' }} />{recentLabel} · 바뀔 수 있음</span>
      </div>
    </div>
  );
}

// 작업 비용 대비 매출 — 두 막대를 같은 눈금에(비용 막대가 얼마나 작은지가 곧 배수). 비율은 4주 합으로만(주별은 게시→예약 시차로 흔들림).
export function RoasBars({ revenue, cost }: { revenue: number; cost: number }) {
  const max = Math.max(1, revenue, cost);
  const row = (label: string, v: number, color: string) => (
    <div className="grid items-center gap-2 text-[13px]" style={{ gridTemplateColumns: '64px 1fr 64px' }}>
      <span className="text-x-secondary">{label}</span>
      <span className="h-3 rounded-full bg-[#eef1f3]"><span className="block h-3 rounded-full" style={{ width: `${Math.max(v > 0 ? 1 : 0, (v / max) * 100)}%`, background: color }} /></span>
      <span className="text-right font-semibold tabular-nums">{man(v)}</span>
    </div>
  );
  return <div className="flex flex-col gap-2">{row('예약 매출', revenue, C.primary)}{row('작업 비용', cost, C.neutralBar)}</div>;
}
