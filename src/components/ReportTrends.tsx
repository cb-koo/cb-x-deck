'use client';
import type { ReactNode } from 'react';
import type { ReportUnit } from '@/lib/reportApi';
import { movingAverage, type SeriesPoint } from '@/lib/reportSeries';

const W = 560, H = 120, PAD = 4;

// null 구간에서 선을 끊는 폴리라인 조각들 — "모름"을 보간해 이으면 거짓말이 된다.
function linePaths(values: (number | null)[], max: number): string[] {
  const paths: string[] = []; let seg: string[] = [];
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  values.forEach((v, i) => {
    if (v === null) { if (seg.length > 1) paths.push(seg.join(' ')); seg = []; return; }
    seg.push(`${PAD + i * step},${H - PAD - (max ? (v / max) * (H - PAD * 2) : 0)}`);
  });
  if (seg.length > 1) paths.push(seg.join(' '));
  return paths;
}
const maxOf = (arr: (number | null)[]) => Math.max(1, ...arr.filter((v): v is number => v !== null));

function Chart({ title, desc, children, footer }: { title: string; desc: string; children: ReactNode; footer?: ReactNode }) {
  return <div className="rounded-lg border border-x-border bg-x-surface p-3">
    <h3 className="text-[13px] font-bold">{title}</h3>
    <p className="mb-2 text-caption text-x-muted">{desc}</p>
    {children}
    {footer && <div className="mt-1 text-caption text-x-muted">{footer}</div>}
  </div>;
}

function Bars({ points, get, color = '#4a72b8', stackGet }: {
  points: SeriesPoint[]; get: (p: SeriesPoint) => number | null; color?: string;
  stackGet?: (p: SeriesPoint) => number | null; // 스택 위칸(옅은 색)
}) {
  const totals = points.map((p) => { const a = get(p), b = stackGet?.(p) ?? 0; return a === null ? null : a + (b ?? 0); });
  const max = maxOf(totals);
  return <div className="flex h-[110px] items-end gap-[2px]">
    {points.map((p, i) => {
      const base = get(p), top = stackGet?.(p) ?? null;
      if (base === null) return <div key={i} className="flex-1 self-stretch rounded-sm bg-x-text/5" title={`${p.start} 미수집`} />;
      return <div key={i} className="flex flex-1 flex-col justify-end gap-[1px]" title={`${p.start}${p.inProgress ? ' (진행 중)' : ''}`}>
        {top !== null && <div style={{ height: `${(top / max) * 100}%`, background: color, opacity: p.inProgress ? 0.25 : 0.45 }} className="rounded-t-sm" />}
        <div style={{ height: `${(base / max) * 100}%`, background: color, opacity: p.inProgress ? 0.35 : 1 }} className={top === null ? 'rounded-t-sm' : ''} />
      </div>;
    })}
  </div>;
}

export function ReportTrends({ unit, points }: { unit: ReportUnit; points: SeriesPoint[] }) {
  const missing = points.filter((p) => p.missing && !p.inProgress).length;
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
            {linePaths(convA, convMax).map((d, i) => <polyline key={`a${i}`} points={d} fill="none" stroke="#4a72b8" strokeWidth="2" />)}
            {linePaths(convB, convMax).map((d, i) => <polyline key={`b${i}`} points={d} fill="none" stroke="#c2703e" strokeWidth="2" />)}
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
            {linePaths(cancel, cancelMax).map((d, i) => <polyline key={i} points={d} fill="none" stroke="#4a72b8" strokeWidth="2" />)}
          </svg>
        </Chart>
        <Chart title="광고비" desc="구간별 광고비 — 0원인 칸은 시트 미입력일 수 있어요 (0과 미입력을 구분 못 함)">
          <Bars points={points} get={(p) => p.marketingCost} />
        </Chart>
        {unit !== 'day' && (
          <Chart title="ROAS (광고비 대비 매출)" desc="점선은 최근 3구간 평균 — 구간별 값은 출렁임이 커요"
                 footer="광고비가 0이거나 미입력인 구간은 계산하지 않아 선이 끊겨요">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
              {linePaths(roas, roasMax).map((d, i) => <polyline key={`r${i}`} points={d} fill="none" stroke="#4a72b8" strokeWidth="2" />)}
              {linePaths(roasAvg, roasMax).map((d, i) => <polyline key={`m${i}`} points={d} fill="none" stroke="#9aa4b2" strokeWidth="1.5" strokeDasharray="3 3" />)}
            </svg>
          </Chart>
        )}
        {unit === 'day' && <div className="rounded-lg border border-dashed border-x-border p-3 text-caption text-x-muted">
          ROAS·CPA는 일간에서는 보여드리지 않아요 — 하루 단위 값은 출렁임이 커서 오독을 부릅니다. 주간·월간으로 보면 나타나요.</div>}
      </div>
      <p className="mt-2 text-caption text-x-muted">
        x축: {points[0]?.start} ~ {points[points.length - 1]?.end} · 마지막 칸이 옅으면 아직 진행 중인 {unitLabel.slice(0, 1)} — 확정 수치가 아니에요
      </p>
    </section>
  );
}
