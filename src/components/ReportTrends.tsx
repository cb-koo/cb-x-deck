'use client';
import type { ReactNode } from 'react';
import type { ReportUnit } from '@/lib/reportApi';
import { movingAverage, type SeriesPoint } from '@/lib/reportSeries';

const W = 560, H = 120, PAD = 4;

type LinePoint = { x: number; y: number; i: number };

// null 구간에서 선을 끊는 세그먼트들 — "모름"을 보간해 이으면 거짓말이 된다.
// 세그먼트 길이 1(양옆이 null인 고립된 실측점)도 버리지 않고 그대로 반환한다 — 렌더에서 원으로 그린다.
function lineSegments(values: (number | null)[], max: number): LinePoint[][] {
  const segs: LinePoint[][] = []; let seg: LinePoint[] = [];
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  values.forEach((v, i) => {
    if (v === null) { if (seg.length) segs.push(seg); seg = []; return; }
    seg.push({ x: PAD + i * step, y: H - PAD - (max ? (v / max) * (H - PAD * 2) : 0), i });
  });
  if (seg.length) segs.push(seg);
  return segs;
}
const toPts = (pts: LinePoint[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

// 빈 배열일 때만 1로 폴백 — 실제 값이 있으면(0~1 비율이라도) 그 값을 그대로 y축 상한으로 쓴다.
// (Math.max(1, ...)로 강제 고정하면 비율 차트가 항상 바닥에 압축된다.)
const maxOf = (arr: (number | null)[]) => {
  const vals = arr.filter((v): v is number => v !== null);
  return vals.length ? Math.max(...vals) : 1;
};

// 실측 라인 렌더러. 길이 1 세그먼트는 원, 길이 2+는 폴리라인.
// lastInProgress면 마지막 점으로 들어가는 마지막 선분(또는 그 점 자체)만 옅게 — dashed=false면 그 구간만 점선 처리, dashed=true(이미 점선인 이동평균 등)면 opacity만 낮춘다.
function Line({ values, max, color, strokeWidth = 2, dashed = false, lastInProgress = false }: {
  values: (number | null)[]; max: number; color: string; strokeWidth?: number; dashed?: boolean; lastInProgress?: boolean;
}) {
  const segs = lineSegments(values, max);
  const lastIdx = values.length - 1;
  return <>
    {segs.map((seg, si) => {
      if (seg.length === 1) {
        const p = seg[0];
        const inProg = lastInProgress && p.i === lastIdx;
        return <circle key={si} cx={p.x} cy={p.y} r={2.5} fill={color} opacity={inProg ? 0.5 : 1} />;
      }
      const touchesLast = lastInProgress && seg[seg.length - 1].i === lastIdx;
      if (touchesLast) {
        const head = seg.slice(0, -1);
        const tail = seg.slice(-2);
        return <g key={si}>
          {head.length > 1 && <polyline points={toPts(head)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={dashed ? '3 3' : undefined} />}
          <polyline points={toPts(tail)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray="3 3" opacity={0.5} />
        </g>;
      }
      return <polyline key={si} points={toPts(seg)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={dashed ? '3 3' : undefined} />;
    })}
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

function fmt(n: number): string { return n.toLocaleString('ko-KR'); }

function Bars({ points, get, color = '#4a72b8', stackGet }: {
  points: SeriesPoint[]; get: (p: SeriesPoint) => number | null; color?: string;
  stackGet?: (p: SeriesPoint) => number | null; // 스택 위칸(옅은 색)
}) {
  const totals = points.map((p) => { const a = get(p), b = stackGet?.(p) ?? 0; return a === null ? null : a + b; });
  const max = maxOf(totals);
  return <div className="flex h-[110px] items-end gap-[2px]">
    {points.map((p, i) => {
      // 버킷 자체가 미수집인 경우만 "미수집" 플레이스홀더 — 수집됐지만 값이 null인 경우와 구분한다.
      if (p.missing) return <div key={i} className="flex-1 self-stretch rounded-sm bg-x-text/5" title={`${p.start} 미수집`} />;
      const base = get(p), top = stackGet?.(p) ?? null;
      const baseVal = base ?? 0, topVal = top ?? 0;
      const valueLabel = base === null ? '값 없음(0 아님)' : fmt(base) + (top !== null ? ` (+${fmt(top)})` : '');
      return <div key={i} className="flex flex-1 flex-col justify-end gap-[1px]" title={`${p.start}${p.inProgress ? ' (진행 중)' : ''} · ${valueLabel}`}>
        {top !== null && <div style={{ height: `${max ? (topVal / max) * 100 : 0}%`, background: color, opacity: p.inProgress ? 0.25 : 0.45 }} className="rounded-t-sm" />}
        <div style={{ height: `${max ? (baseVal / max) * 100 : 0}%`, background: color, opacity: p.inProgress ? 0.35 : 1 }} className={top === null ? 'rounded-t-sm' : ''} />
      </div>;
    })}
  </div>;
}

export function ReportTrends({ unit, points }: { unit: ReportUnit; points: SeriesPoint[] }) {
  const missing = points.filter((p) => p.missing && !p.inProgress).length;
  const lastInProgress = points.length > 0 && points[points.length - 1].inProgress;
  const convA = points.map((p) => p.convInflowToConsult);
  const convB = points.map((p) => p.convConsultToReserve);
  const convMax = Math.max(0.01, maxOf(convA), maxOf(convB));
  const cancel = points.map((p) => p.cancelNoshowRate);
  const cancelMax = Math.max(0.1, maxOf(cancel));
  const roas = points.map((p) => p.roas);
  const roasAvg = movingAverage(roas, 3);
  const roasMax = maxOf([...roas, ...roasAvg]);
  const unitLabel = unit === 'day' ? '일간' : unit === 'week' ? '주간(월요일 시작)' : '월간';

  return (
    <section className="mt-6">
      <h2 className="text-base font-bold">③ 흐름 <span className="text-caption font-normal text-x-muted">({unitLabel} · 저장된 수집분 기준{missing ? ` · 미수집 ${missing}칸은 공백` : ''})</span></h2>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Chart title="다음 단계로 넘어간 비율" desc="인입→상담, 상담→예약이 각각 몇 %였는지 — 선이 내려가면 전환이 약해진 것">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            <Line values={convA} max={convMax} color="#4a72b8" lastInProgress={lastInProgress} />
            <Line values={convB} max={convMax} color="#c2703e" lastInProgress={lastInProgress} />
          </svg>
          <p className="text-caption text-x-muted"><span style={{ color: '#4a72b8' }}>■</span> 인입→상담 <span style={{ color: '#c2703e' }}>■</span> 상담→예약 · 선이 끊긴 곳 = 데이터 없음(0 아님)</p>
        </Chart>
        <Chart title="예약 건수" desc="확정+방문 기준 건수 — 옅은 칸은 아직 진행 중">
          <Bars points={points} get={(p) => p.reservationCount} />
        </Chart>
        <Chart title="매출 (초진/재진)" desc="막대 전체가 그 구간 매출, 아래 진한 부분이 초진">
          <Bars points={points} get={(p) => p.revenueFirst} stackGet={(p) => p.revenueRepeat} />
        </Chart>
        <Chart title="취소·노쇼는 관리되고 있나" desc="취소+노쇼가 전체 예약의 몇 %인지 — 회색 띠가 업계 통상 범위(5~8%)">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
            <rect x={0} y={H - PAD - (0.08 / cancelMax) * (H - PAD * 2)} width={W}
                  height={(0.03 / cancelMax) * (H - PAD * 2)} fill="currentColor" opacity="0.08" />
            <Line values={cancel} max={cancelMax} color="#4a72b8" lastInProgress={lastInProgress} />
          </svg>
          <p className="text-caption text-x-muted">선이 끊긴 곳 = 데이터 없음(0 아님)</p>
        </Chart>
        <Chart title="광고비" desc="구간별 광고비 — 0원인 칸은 시트 미입력일 수 있어요 (0과 미입력을 구분 못 함)">
          <Bars points={points} get={(p) => p.marketingCost} />
        </Chart>
        {unit !== 'day' && (
          <Chart title="ROAS (광고비 대비 매출)" desc="점선은 최근 3구간 평균 — 구간별 값은 출렁임이 커요"
                 footer="광고비가 0이거나 미입력인 구간은 계산하지 않아 선이 끊겨요">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
              <Line values={roas} max={roasMax} color="#4a72b8" lastInProgress={lastInProgress} />
              <Line values={roasAvg} max={roasMax} color="#9aa4b2" strokeWidth={1.5} dashed lastInProgress={lastInProgress} />
            </svg>
          </Chart>
        )}
        {unit === 'day' && <div className="rounded-lg border border-dashed border-x-border p-3 text-caption text-x-muted">
          ROAS·CPA는 일간에서는 보여드리지 않아요 — 하루 단위 값은 출렁임이 커서 오독을 부릅니다. 주간·월간으로 보면 나타나요.</div>}
      </div>
      <p className="mt-2 text-caption text-x-muted">
        x축: {points[0]?.start} ~ {points[points.length - 1]?.end} · 마지막 칸(막대는 옅게, 선은 점선)은 아직 진행 중 — 확정 수치가 아니에요
      </p>
    </section>
  );
}
