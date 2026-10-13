// 검색 트렌드 표 — 시술 하나 = 한 줄, 정보 5개(시술·분류·월 검색량·1년 변화·4년 추이). 표 모양은 정산 표 공용(HEAD·CELL·NUM).
'use client';
import { Sparkline } from '@/components/charts/Sparkline';
import { HEAD, CELL, NUM } from '@/app/settlement/tableStyle';
import { fmtVolume, fmtChange, type TrendSummary } from '@/lib/searchTrend';
import { StateChip } from './StateChip';

export type TrendRow = {
  id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string;
  volumes: number[] | null; summary: TrendSummary;
};

export function TrendTable({ rows, selectedId, onSelect }: { rows: TrendRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="min-h-0 overflow-auto rounded-xl border border-x-border bg-white">
      <table className="w-full border-separate border-spacing-0 text-[15px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={HEAD}>시술</th>
            <th className={HEAD}>분류</th>
            <th className={`${HEAD} text-right`} title="최근 3개월 평균">월 검색량</th>
            <th className={HEAD}>1년 변화</th>
            <th className={HEAD}>4년 추이</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = r.summary;
            const on = r.id === selectedId;
            return (
              <tr key={r.id} onClick={() => onSelect(r.id)} aria-selected={on}
                  className={`cursor-pointer ${on ? 'bg-x-blue/10' : 'hover:bg-x-hover'}`}>
                <td className={`${CELL} max-w-[320px]`}>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-ui text-x-muted">{r.jp}</span>
                </td>
                <td className={`${CELL} max-w-[260px] truncate text-ui text-x-secondary`}>{r.major} › {r.middle}</td>
                <td className={`${CELL} ${NUM}`}>{s.state === 'nodata' ? <span className="text-x-muted">—</span> : fmtVolume(s.now)}</td>
                <td className={CELL}>
                  <StateChip state={s.state} />
                  {s.change !== null && s.state !== 'low' && <span className="ml-2 text-ui tabular-nums text-x-secondary">{fmtChange(s.change)}</span>}
                  {s.seasonMonth && <span className="ml-2 text-ui text-x-muted">{s.seasonMonth}월↑</span>}
                </td>
                <td className={`${CELL} w-[136px]`}>
                  {r.volumes ? <Sparkline values={r.volumes} width={120} height={28} /> : <span className="text-ui text-x-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export type MajorRow = {
  major: string; total: number; rising: number; falling: number;
  top: { name: string; now: number } | null; change: number | null;
};

export function MajorTable({ rows, onOpen }: { rows: MajorRow[]; onOpen: (major: string) => void }) {
  return (
    <div className="min-h-0 overflow-auto rounded-xl border border-x-border bg-white">
      <table className="w-full border-separate border-spacing-0 text-[15px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={HEAD}>분류</th>
            <th className={`${HEAD} text-right`}>시술</th>
            <th className={`${HEAD} text-right`}>늘어남</th>
            <th className={`${HEAD} text-right`}>줄어듦</th>
            <th className={HEAD}>가장 많이 찾는 시술</th>
            <th className={HEAD} title="분류 안 검색어 합계의 1년 변화 — 겹쳐 세진 값이라 방향만 보세요">전체 방향</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.major} onClick={() => onOpen(r.major)} className="cursor-pointer hover:bg-x-hover">
              <td className={`${CELL} font-medium`}>{r.major}</td>
              <td className={`${CELL} ${NUM} text-x-secondary`}>{r.total}</td>
              <td className={`${CELL} ${NUM}`}>{r.rising ? <span className="text-green-700">{r.rising}</span> : <span className="text-x-muted">0</span>}</td>
              <td className={`${CELL} ${NUM}`}>{r.falling ? <span className="text-red-600">{r.falling}</span> : <span className="text-x-muted">0</span>}</td>
              <td className={CELL}>{r.top ? <>{r.top.name} <span className="ml-1 text-ui tabular-nums text-x-muted">{fmtVolume(r.top.now)}</span></> : <span className="text-x-muted">—</span>}</td>
              <td className={`${CELL} tabular-nums`}>
                {r.change === null ? <span className="text-x-muted">—</span>
                  : r.change >= 0.3 ? <span className="text-green-700">▲ 늘어남 {fmtChange(r.change)}</span>
                  : r.change <= -0.3 ? <span className="text-red-600">▼ 줄어듦 {fmtChange(r.change)}</span>
                  : <span className="text-x-secondary">― 비슷 {fmtChange(r.change)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
