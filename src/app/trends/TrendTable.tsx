// 검색 트렌드 표 — 시술 하나 = 한 줄, 정보 6개(시술·월 검색량·1년 변화·한국 검색·성격·4년 추이). 표 모양은 정산 표 공용(HEAD·CELL·NUM).
'use client';
import { Sparkline } from '@/components/charts/Sparkline';
import { HEAD, CELL, NUM } from '@/app/settlement/tableStyle';
import { fmtVolume, fmtChange, type TrendSummary } from '@/lib/searchTrend';
import type { Stage, ProfileIntent } from '@/lib/searchIntent';
import { StateChip, StageChip } from './StateChip';

export type IntentInfo = {
  total: number[]; korea: number[];
  profile: Record<ProfileIntent, number> | null; prev: Record<ProfileIntent, number> | null;
  stage: Stage | null; prevStage: Stage | null; ambiguous: boolean; keywords: number;
  top: Partial<Record<ProfileIntent, Array<[string, number]>>>;
};

export type TrendRow = {
  id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string;
  volumes: number[] | null; series: number[] | null; summary: TrendSummary;
  intent: IntentInfo | null; korea: { now: number; yearAgo: number } | null;
};

// 한국 검색 — 월 50 미만은 '적음'(키워드 플래너가 작은 값을 0으로 합치는 일이 잦다)
export function KoreaCell({ k }: { k: TrendRow['korea'] }) {
  if (!k || k.now < 50) return <span className="text-ui text-x-muted">적음</span>;
  const c = k.yearAgo >= 50 ? k.now / k.yearAgo - 1 : null;
  return (
    <span className="tabular-nums">
      {fmtVolume(k.now)}
      {c !== null && Math.abs(c) >= 0.3 && <span className={`ml-1.5 text-ui ${c > 0 ? 'text-green-700' : 'text-red-600'}`}>{c > 0 ? '▲' : '▼'}{fmtChange(c).replace(/^[+−]/, '')}</span>}
      {c === null && k.yearAgo < 50 && <span className="ml-1.5 text-ui text-green-700">새로</span>}
    </span>
  );
}

export function TrendTable({ rows, selectedId, onSelect }: { rows: TrendRow[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="shrink-0 overflow-x-auto rounded-xl border border-x-border bg-white">
      <table className="w-full border-separate border-spacing-0 text-[15px]">
        <thead>
          <tr>
            <th className={HEAD}>시술</th>
            <th className={`${HEAD} text-right`} title="이 시술 관련 검색어 전체의 최근 3개월 평균(화장품·다른 뜻 제외)">월 검색량</th>
            <th className={HEAD}>1년 변화</th>
            <th className={`${HEAD} text-right`} title="韓国·ソウル·江南이 붙은 검색, 최근 3개월 평균">한국 검색</th>
            <th className={HEAD} title="함께 찾는 말로 본 단계 — 알아보는 중(뭔지·차이) · 고민하는 중(효과·부작용) · 고르는 중(값·장소)">성격</th>
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
                <td className={`${CELL} max-w-[340px] truncate`}>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-ui text-x-muted">{r.jp}</span>
                  <span className="ml-2 text-ui text-x-muted">· {r.major}</span>
                </td>
                <td className={`${CELL} ${NUM}`}>{s.state === 'nodata' ? <span className="text-x-muted">—</span> : fmtVolume(s.now)}</td>
                <td className={CELL}>
                  <StateChip state={s.state} />
                  {s.change !== null && s.state !== 'low' && <span className="ml-2 text-ui tabular-nums text-x-secondary">{fmtChange(s.change)}</span>}
                  {s.seasonMonth && <span className="ml-2 text-ui text-x-muted">{s.seasonMonth}월↑</span>}
                </td>
                <td className={`${CELL} ${NUM}`}><KoreaCell k={r.korea} /></td>
                <td className={CELL}>
                  {r.intent?.ambiguous
                    ? <span className="text-ui text-amber-700" title="이름이 게임·상품 등 다른 뜻과 겹쳐 숫자를 그대로 믿기 어려워요">⚠ 다른 뜻 섞임</span>
                    : <StageChip stage={r.intent?.stage ?? null} />}
                </td>
                <td className={`${CELL} w-[136px]`}>
                  {r.series ? <Sparkline values={r.series} width={120} height={28} /> : <span className="text-ui text-x-muted">—</span>}
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
  top: { name: string; now: number } | null; change: number | null; korea: number;
};

export function MajorTable({ rows, onOpen }: { rows: MajorRow[]; onOpen: (major: string) => void }) {
  return (
    <div className="shrink-0 overflow-x-auto rounded-xl border border-x-border bg-white">
      <table className="w-full border-separate border-spacing-0 text-[15px]">
        <thead>
          <tr>
            <th className={HEAD}>분류</th>
            <th className={`${HEAD} text-right`}>시술</th>
            <th className={`${HEAD} text-right`}>늘어남</th>
            <th className={`${HEAD} text-right`}>줄어듦</th>
            <th className={HEAD} title="분류 안 시술들의 1년 변화 가운데값">가운데 변화</th>
            <th className={HEAD}>가장 많이 찾는 시술</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.major} onClick={() => onOpen(r.major)} className="cursor-pointer hover:bg-x-hover">
              <td className={`${CELL} font-medium`}>{r.major}</td>
              <td className={`${CELL} ${NUM} text-x-secondary`}>{r.total}</td>
              <td className={`${CELL} ${NUM}`}>{r.rising ? <span className="text-green-700">{r.rising}</span> : <span className="text-x-muted">0</span>}</td>
              <td className={`${CELL} ${NUM}`}>{r.falling ? <span className="text-red-600">{r.falling}</span> : <span className="text-x-muted">0</span>}</td>
              <td className={`${CELL} tabular-nums`}>
                {r.change === null ? <span className="text-x-muted">—</span>
                  : r.change >= 0.3 ? <span className="text-green-700">▲ 늘어남 {fmtChange(r.change)}</span>
                  : r.change <= -0.3 ? <span className="text-red-600">▼ 줄어듦 {fmtChange(r.change)}</span>
                  : <span className="text-x-secondary">― 비슷 {fmtChange(r.change)}</span>}
              </td>
              <td className={CELL}>{r.top ? <>{r.top.name} <span className="ml-1 text-ui tabular-nums text-x-muted">{fmtVolume(r.top.now)}</span></> : <span className="text-x-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
