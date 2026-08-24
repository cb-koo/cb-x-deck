'use client';
import type { ReactNode } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, CartesianGrid, XAxis, YAxis,
  Tooltip, Legend, ReferenceArea, ReferenceLine, Cell,
} from 'recharts';
import type { ReportUnit } from '@/lib/reportApi';
import { movingAverage, type SeriesPoint } from '@/lib/reportSeries';

// 색상 — 전환 2색은 dataviz 팔레트 검증(ΔE 19.6/24.3, 정상시각 24.3) 통과.
const BLUE = '#4a72b8';
const ORANGE = '#c2703e';
const GREEN = '#2f7d4f';
const REVENUE_FIRST = '#2f5590'; // 초진 — 진한 파랑
const REVENUE_REPEAT = '#9db8dd'; // 재진 — 연한 파랑 (같은 색 계열, 스택이라 구분 필요)
const GRAY_LINE = '#9aa4b2';
const GRID = '#eff3f4';
const AXIS_TEXT = '#6c7781';
const MISSING_FILL = '#9aa4b2';
const IN_PROGRESS_FILL = '#4a72b8';

const axisTick = { fontSize: 11, fill: AXIS_TEXT };
const axisLine = { stroke: GRID };

function fmtCount(v: number): string { return v.toLocaleString('ko-KR'); }
function fmtWon(v: number): string { return `${v.toLocaleString('ko-KR')}원`; }
function fmtManwon(v: number): string { return `${Math.round(v / 10000).toLocaleString('ko-KR')}만`; }
function fmtPercent(v: number): string { return `${Math.round(v * 100)}%`; }
function fmtRatio(v: number): string { return v.toFixed(2); }
function fmtSigned(v: number): string { return `${v >= 0 ? '+' : ''}${v.toLocaleString('ko-KR')}`; }

// null("모름")은 절대 0으로 보여주지 않는다 — 값 없음을 명시.
function valueFormatter(fmt: (v: number) => string) {
  return (value: unknown): ReactNode => (typeof value === 'number' ? fmt(value) : '— (데이터 없음)');
}

function xTick(unit: ReportUnit) {
  return (s: string) => {
    const m = +s.slice(5, 7), d = +s.slice(8, 10);
    return unit === 'month' ? `${m}월` : `${m}/${d}`;
  };
}

// 툴팁 라벨 = 그 버킷의 날짜 범위(일간이면 하루, 주간/월간이면 시작~끝) — ISO 그대로라 처음 보는 사람도 바로 읽힘.
function labelFormatter(label: unknown, payload: ReadonlyArray<{ payload?: SeriesPoint }>): ReactNode {
  const p = payload?.[0]?.payload;
  if (!p) return typeof label === 'string' ? label : '';
  return p.start === p.end ? p.start : `${p.start} ~ ${p.end}`;
}

function bucketLabel(p: SeriesPoint): string { return p.start === p.end ? p.start : `${p.start} ~ ${p.end}`; }
const cnt = (v: number | null): string => (v === null ? '—' : fmtCount(v));

// 전환율 툴팁 — 분모를 함께 보여줘 "표본이 작아서 튄 값인지" 바로 판단하게 한다.
function conversionTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: SeriesPoint }> }): ReactNode {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return <div className="rounded border border-x-border bg-x-surface px-2 py-1 text-[12px] shadow-sm">
    <div className="text-x-muted">{bucketLabel(p)}</div>
    {p.convInflowToConsult !== null && <div>인입→상담 {fmtPercent(p.convInflowToConsult)} ({cnt(p.consulted)} / {cnt(p.inflow)})</div>}
    {p.convConsultToReserve !== null && <div>상담→예약 {fmtPercent(p.convConsultToReserve)} ({cnt(p.reserversByLineId)} / {cnt(p.consulted)})</div>}
    {p.convInflowToConsult === null && p.convConsultToReserve === null && <div className="text-x-muted">데이터 없음</div>}
  </div>;
}

// 취소·노쇼율 툴팁 — 마찬가지로 분모(전체 예약 건수) 병기.
function cancelNoshowTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: SeriesPoint }> }): ReactNode {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return <div className="rounded border border-x-border bg-x-surface px-2 py-1 text-[12px] shadow-sm">
    <div className="text-x-muted">{bucketLabel(p)}</div>
    {p.cancelNoshowRate !== null
      ? <div>취소·노쇼율 {fmtPercent(p.cancelNoshowRate)} (취소+노쇼 {cnt(p.cancelNoshowCount)} / 전체 {cnt(p.statusTotal)})</div>
      : <div className="text-x-muted">데이터 없음</div>}
  </div>;
}

// null 구간에서 세그먼트가 끊기는 것과 별개로, "이 버킷 자체가 미수집/진행중"인 연속 구간을 x축 배경 띠로 깐다.
function segmentsWhere(points: SeriesPoint[], pred: (p: SeriesPoint) => boolean): Array<{ x1: string; x2: string }> {
  const segs: Array<{ x1: string; x2: string }> = [];
  let x1: string | null = null, x2: string | null = null;
  for (const p of points) {
    if (pred(p)) { if (x1 === null) x1 = p.start; x2 = p.start; } else if (x1 !== null) { segs.push({ x1, x2: x2! }); x1 = null; }
  }
  if (x1 !== null) segs.push({ x1, x2: x2! });
  return segs;
}

function Bands({ missing, inProgress }: { missing: Array<{ x1: string; x2: string }>; inProgress: Array<{ x1: string; x2: string }> }) {
  return <>
    {missing.map((s, i) => (
      <ReferenceArea key={`m${i}`} x1={s.x1} x2={s.x2} fill={MISSING_FILL} fillOpacity={0.08} strokeOpacity={0} ifOverflow="visible" />
    ))}
    {inProgress.map((s, i) => (
      <ReferenceArea key={`p${i}`} x1={s.x1} x2={s.x2} fill={IN_PROGRESS_FILL} fillOpacity={0.06} strokeOpacity={0} ifOverflow="visible" />
    ))}
  </>;
}

function Chart({ title, desc, children, footer }: { title: string; desc: string; children: ReactNode; footer?: ReactNode }) {
  return <div className="rounded-lg border border-x-border bg-x-surface p-3">
    <h3 className="text-[13px] font-bold text-x-secondary">{title}</h3>
    <p className="mb-2 text-caption text-x-muted">{desc}</p>
    {children}
    {footer && <div className="mt-1 text-caption text-x-muted">{footer}</div>}
  </div>;
}

function GroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 text-[13px] font-bold text-x-secondary">{children}</h3>;
}

export function ReportTrends({ unit, points }: { unit: ReportUnit; points: SeriesPoint[] }) {
  const missingCount = points.filter((p) => p.missing && !p.inProgress).length;
  const missingSegs = segmentsWhere(points, (p) => p.missing && !p.inProgress);
  const inProgressSegs = segmentsWhere(points, (p) => p.inProgress);
  const unitLabel = unit === 'day' ? '일간' : unit === 'week' ? '주간(월요일 시작)' : '월간';
  const tick = xTick(unit);

  const roasAvg = movingAverage(points.map((p) => p.roas), 3);
  const roasData = points.map((p, i) => ({ ...p, roasAvg: roasAvg[i] }));

  const inProgressOpacity = (p: SeriesPoint) => (p.inProgress ? 0.4 : 1);
  const ratesAvailable = unit !== 'day';

  return (
    <section className="mt-6">
      <h2 className="text-base font-bold">③ 흐름 <span className="text-caption font-normal text-x-muted">({unitLabel} · 저장된 수집분 기준{missingCount ? ` · 미수집 ${missingCount}칸은 공백` : ''})</span></h2>

      <GroupTitle>그룹 1 · 얼마나 들어왔나</GroupTitle>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Chart title="LINE 친구 누적" desc="기간 끝 기준 누적 친구 수 — 점이 끊긴 곳은 그날 스냅샷이 없다는 뜻">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <Bands missing={missingSegs} inProgress={inProgressSegs} />
              <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={48} domain={['auto', 'auto']} tickFormatter={fmtCount} />
              <Tooltip labelFormatter={labelFormatter} formatter={valueFormatter(fmtCount)} contentStyle={{ fontSize: 12 }} />
              <Line dataKey="followersTotal" name="누적 친구" stroke={BLUE} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </Chart>

        <Chart title="친구 증감" desc="구간별 증가·감소분 — 막대가 0 아래로 내려가면 그 구간엔 순감소">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <Bands missing={missingSegs} inProgress={inProgressSegs} />
              <ReferenceLine y={0} stroke={AXIS_TEXT} strokeWidth={1} />
              <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={44} domain={['auto', 'auto']} tickFormatter={fmtCount} />
              <Tooltip labelFormatter={labelFormatter} formatter={valueFormatter(fmtSigned)} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="followersChange" name="친구 증감" fill={BLUE} radius={[2, 2, 2, 2]}>
                {points.map((p, i) => <Cell key={i} fillOpacity={inProgressOpacity(p)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart>

        <div className="md:col-span-2">
          <Chart title="인입·상담·예약자 수" desc="깔때기 세 단계를 사람 수로 겹쳐 보기 — 선 사이 간격이 벌어지면 그 단계에서 이탈이 커진 것">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <Bands missing={missingSegs} inProgress={inProgressSegs} />
                <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
                <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={44} domain={[0, 'auto']} tickFormatter={fmtCount} />
                <Tooltip labelFormatter={labelFormatter} formatter={valueFormatter(fmtCount)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="inflow" name="인입" stroke={BLUE} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                <Line dataKey="consulted" name="상담" stroke={ORANGE} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                <Line dataKey="reserversByLineId" name="예약자(LINE ID)" stroke={GREEN} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-caption text-x-muted">선이 끊긴 곳 = 데이터 없음(0 아님) · 예약 &quot;건수&quot;는 그룹 3에서 매출과 함께 봐요</p>
          </Chart>
        </div>
      </div>

      <GroupTitle>그룹 2 · 얼마나 이어졌나</GroupTitle>
      {!ratesAvailable ? (
        <div className="mt-2 rounded-lg border border-dashed border-x-border p-3 text-caption text-x-muted">
          비율 지표는 주간부터 보여드려요 — 하루 표본이 작아 0%↔100%로 널뛰어서 오독을 부릅니다. 단위를 주간으로 바꾸면 나타나요
        </div>
      ) : (
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <Chart title="다음 단계로 넘어간 비율" desc="인입→상담, 상담→예약이 각각 몇 %였는지 — 선이 내려가면 전환이 약해진 것">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <Bands missing={missingSegs} inProgress={inProgressSegs} />
                <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
                <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={40} domain={[0, 'auto']} tickFormatter={fmtPercent} />
                <Tooltip content={conversionTooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="convInflowToConsult" name="인입→상담" stroke={BLUE} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                <Line dataKey="convConsultToReserve" name="상담→예약" stroke={ORANGE} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-caption text-x-muted">선이 끊긴 곳 = 데이터 없음(0 아님)</p>
          </Chart>

          <Chart title="취소·노쇼는 관리되고 있나" desc="취소+노쇼가 전체 예약의 몇 %인지 — 회색 띠가 업계 통상 범위(5~8%)">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <Bands missing={missingSegs} inProgress={inProgressSegs} />
                <ReferenceArea y1={0.05} y2={0.08} fill="#8b98a5" fillOpacity={0.15} strokeOpacity={0} ifOverflow="visible" />
                <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
                <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={40}
                       domain={[0, (max: number) => Math.max(max, 0.09)]} tickFormatter={fmtPercent} />
                <Tooltip content={cancelNoshowTooltip} />
                <Line dataKey="cancelNoshowRate" name="취소·노쇼율" stroke={BLUE} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-caption text-x-muted">선이 끊긴 곳 = 데이터 없음(0 아님)</p>
          </Chart>
        </div>
      )}

      <GroupTitle>그룹 3 · 얼마 벌고 썼나</GroupTitle>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Chart title="매출 (초진/재진)" desc="막대 전체가 그 구간 매출, 진한 부분이 초진 — 범례 참고">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <Bands missing={missingSegs} inProgress={inProgressSegs} />
              <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={48} domain={[0, 'auto']} tickFormatter={fmtManwon} />
              <Tooltip labelFormatter={labelFormatter} formatter={valueFormatter(fmtWon)} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenueFirst" name="초진" stackId="rev" fill={REVENUE_FIRST}>
                {points.map((p, i) => <Cell key={i} fillOpacity={inProgressOpacity(p)} />)}
              </Bar>
              <Bar dataKey="revenueRepeat" name="재진" stackId="rev" fill={REVENUE_REPEAT} radius={[2, 2, 0, 0]}>
                {points.map((p, i) => <Cell key={i} fillOpacity={inProgressOpacity(p)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart>

        <Chart title="예약 건수" desc="확정+방문 기준 건수(사람 수인 예약자와는 다른 지표) — 옅은 칸은 아직 진행 중">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <Bands missing={missingSegs} inProgress={inProgressSegs} />
              <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={44} domain={[0, 'auto']} tickFormatter={fmtCount} />
              <Tooltip labelFormatter={labelFormatter} formatter={valueFormatter(fmtCount)} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="reservationCount" name="예약 건수" fill={BLUE} radius={[2, 2, 0, 0]}>
                {points.map((p, i) => <Cell key={i} fillOpacity={inProgressOpacity(p)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart>

        <Chart title="광고비" desc="구간별 광고비 — 0원인 칸은 시트 미입력일 수 있어요 (0과 미입력을 구분 못 함)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <Bands missing={missingSegs} inProgress={inProgressSegs} />
              <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
              <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={48} domain={[0, 'auto']} tickFormatter={fmtManwon} />
              <Tooltip labelFormatter={labelFormatter} formatter={valueFormatter(fmtWon)} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="marketingCost" name="광고비" fill={BLUE} radius={[2, 2, 0, 0]}>
                {points.map((p, i) => <Cell key={i} fillOpacity={inProgressOpacity(p)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Chart>

        {unit !== 'day' && (
          <Chart title="ROAS (광고비 대비 매출)" desc="회색 점선은 최근 3구간 평균 — 구간별 값은 출렁임이 커요"
                 footer="광고비가 0이거나 미입력인 구간은 계산하지 않아 선이 끊겨요">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={roasData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <Bands missing={missingSegs} inProgress={inProgressSegs} />
                <XAxis dataKey="start" tickFormatter={tick} tick={axisTick} axisLine={axisLine} tickLine={false} />
                <YAxis tick={axisTick} axisLine={axisLine} tickLine={false} width={36} domain={[0, 'auto']} tickFormatter={fmtRatio} />
                <Tooltip labelFormatter={labelFormatter} formatter={valueFormatter(fmtRatio)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="roas" name="ROAS" stroke={BLUE} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                <Line dataKey="roasAvg" name="3구간 평균" stroke={GRAY_LINE} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </Chart>
        )}
      </div>

      <p className="mt-2 text-caption text-x-muted">
        x축: {points[0]?.start} ~ {points[points.length - 1]?.end} · 회색 배경 = 미수집 구간, 옅은 파란 배경(막대는 옅게)은 아직 진행 중 — 확정 수치가 아니에요
        {!ratesAvailable && ' · 전환율·취소노쇼율·ROAS 같은 비율 지표는 단위를 주간 이상으로 바꾸면 나타나요'}
      </p>
    </section>
  );
}
