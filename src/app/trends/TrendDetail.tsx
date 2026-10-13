// 검색 트렌드 상세 — 판정 문장 → 월별 그래프(작년 같은 달 겹침) → 핵심 숫자 → 같은 분류 안 비교. 스펙 2026-10-13 §5-2
'use client';
import { useState } from 'react';
import { LineChart } from '@/components/charts/LineChart';
import { describe, fmtVolume, type TrendSummary } from '@/lib/searchTrend';
import { StateChip } from './StateChip';
import type { TrendRow } from './TrendTable';

const PERIODS = [{ m: 12, label: '1년' }, { m: 24, label: '2년' }, { m: 48, label: '4년' }] as const;

export function TrendDetail({ row, summary, months, siblings, onSelect, onClose }: {
  row: TrendRow; summary: TrendSummary; months: string[]; siblings: TrendRow[];
  onSelect: (id: string) => void; onClose: () => void;
}) {
  const [period, setPeriod] = useState<12 | 24 | 48>(24);
  const vols = row.volumes;
  const n = months.length;
  const from = Math.max(0, n - period);
  const labels = months.slice(from).map((m) => `${m.slice(2, 4)}.${m.slice(5, 7)}`);
  const series = vols ? [
    { name: '검색량', values: vols.slice(from) },
    { name: '1년 전', dashed: true, color: '#8ecdf8', values: months.slice(from).map((_, i) => vols[from + i - 12] ?? null) },
  ] : [];
  const ranked = [...siblings].sort((a, b) => (b.summary.now ?? -1) - (a.summary.now ?? -1));

  return (
    <aside className="flex w-[480px] shrink-0 flex-col overflow-y-auto border-l border-x-border bg-white">
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-x-border bg-white px-6 py-4">
        <div className="min-w-0">
          <p className="text-[18px] font-bold">{row.name}</p>
          <p className="truncate text-ui text-x-muted">{row.jp}{row.en && ` · ${row.en}`} · {row.major} › {row.middle}</p>
        </div>
        <button onClick={onClose} aria-label="닫기" className="ml-auto shrink-0 rounded-full px-2 py-1 text-x-secondary hover:bg-x-hover">✕</button>
      </div>

      <div className="space-y-6 px-6 py-5">
        <div>
          <StateChip state={summary.state} />
          <p className="mt-2 text-[15px] leading-relaxed">{describe(summary)}</p>
        </div>

        {vols && (
          <div>
            <div className="mb-2 flex items-center">
              <p className="text-ui font-semibold text-x-secondary">월별 검색량</p>
              <div className="ml-auto flex gap-1">
                {PERIODS.map((p) => (
                  <button key={p.m} onClick={() => setPeriod(p.m)}
                          className={`rounded-full px-2.5 py-0.5 text-ui ${period === p.m ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>{p.label}</button>
                ))}
              </div>
            </div>
            <LineChart labels={labels} series={series} height={220} />
            <p className="mt-2 text-ui text-x-muted">검색량은 구간으로 반올림된 값이라 달마다 계단처럼 튈 수 있어요. 판정은 3개월 평균으로 해요.</p>
          </div>
        )}

        {vols && (
          <dl className="grid grid-cols-3 gap-3">
            {[['최근 3개월 평균', summary.now], ['1년 전 같은 3개월', summary.yearAgo], ['최근 1년 최고', summary.peak12]].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-x-surface px-3 py-2.5">
                <dt className="text-ui text-x-muted">{k}</dt>
                <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{fmtVolume(v as number | null)}</dd>
              </div>
            ))}
          </dl>
        )}

        <div>
          <p className="mb-2 text-ui font-semibold text-x-secondary">
            {siblings.every((s) => s.middle === row.middle) ? `같은 중분류(${row.middle})` : `같은 대분류(${row.major})`}에서 — 많이 찾는 순
          </p>
          <ul className="divide-y divide-x-border/60 rounded-lg border border-x-border">
            {ranked.map((s) => (
              <li key={s.id}>
                <button onClick={() => onSelect(s.id)}
                        className={`flex h-11 w-full items-center gap-2 px-3 text-left text-[15px] ${s.id === row.id ? 'bg-x-blue/10 font-semibold' : 'hover:bg-x-hover'}`}>
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="tabular-nums text-x-secondary">{s.summary.state === 'nodata' ? '—' : fmtVolume(s.summary.now)}</span>
                  <span className="w-[88px] text-right"><StateChip state={s.summary.state} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
