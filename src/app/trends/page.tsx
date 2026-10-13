// 검색 트렌드 — 시술마다 일본에서 얼마나 찾는지(수요)와 늘고 있는지(트렌드). 스펙 2026-10-13
// 시안: 데이터는 10-13에 받은 실측 스냅샷(snapshot.json). 수집·저장(073)이 붙으면 API로 바꾼다.
'use client';
import { useMemo, useState } from 'react';
import snapshot from './snapshot.json';
import { summarize, changeRank, type TrendState, type TrendSummary } from '@/lib/searchTrend';
import { classify, categoryOrder } from '@/lib/procedureTaxonomy';
import { TrendTable, MajorTable, type TrendRow, type MajorRow } from './TrendTable';
import { TrendDetail } from './TrendDetail';

type Proc = { id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string; volumes: number[] | null };
const DATA = snapshot as { market: string; fetchedAt: string; months: string[]; procedures: Proc[] };

type StateFilter = 'all' | 'rising' | 'falling' | 'flat' | 'quiet';
const STATE_FILTERS: Array<{ key: StateFilter; label: string; match: (s: TrendState) => boolean }> = [
  { key: 'all', label: '전체', match: () => true },
  { key: 'rising', label: '늘어나는 시술', match: (s) => s === 'surge' || s === 'up' },
  { key: 'falling', label: '줄어드는 시술', match: (s) => s === 'down' || s === 'peaked' },
  { key: 'flat', label: '유지', match: (s) => s === 'flat' },
  { key: 'quiet', label: '수요 적음 · 데이터 없음', match: (s) => s === 'low' || s === 'nodata' },
];
type SortKey = 'change' | 'volume' | 'name';
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'change', label: '변화 큰 순' }, { key: 'volume', label: '검색량 많은 순' }, { key: 'name', label: '이름 순' },
];

const lastMonth = DATA.months[DATA.months.length - 1];
const LAST_LABEL = `${lastMonth.slice(0, 4)}년 ${Number(lastMonth.slice(5, 7))}월`;
const FETCHED = `${Number(DATA.fetchedAt.slice(5, 7))}/${Number(DATA.fetchedAt.slice(8, 10))}`;

export default function TrendsPage() {
  // 분류는 일반적인 피부과 시술 분류로 다시 붙인다(시트 대분류·중분류는 용어 참고용). 같은 일본어 검색어는 한 줄만.
  const rows: TrendRow[] = useMemo(() => {
    const seen = new Set<string>();
    return DATA.procedures.flatMap((p) => {
      const key = p.jp.replace(/\s/g, '').toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      const c = classify(p);
      return [{ ...p, major: c.category, majorOrder: categoryOrder(c.category), middle: c.sub, summary: summarize(p.volumes, DATA.months) }];
    });
  }, []);
  const majors = useMemo(() => [...new Map(rows.map((r) => [r.major, r.majorOrder])).entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m), [rows]);

  const [view, setView] = useState<'procedure' | 'major'>('procedure');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [major, setMajor] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('change');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const inMajor = useMemo(() => rows.filter((r) => !major || r.major === major), [rows, major]);
  const counts = useMemo(() => Object.fromEntries(STATE_FILTERS.map((f) => [f.key, inMajor.filter((r) => f.match(r.summary.state)).length])) as Record<StateFilter, number>, [inMajor]);
  const shown = useMemo(() => {
    const f = STATE_FILTERS.find((x) => x.key === stateFilter)!;
    const needle = q.trim().toLowerCase();
    const list = inMajor.filter((r) => f.match(r.summary.state)
      && (!needle || [r.name, r.kr, r.jp, r.en, r.middle].some((t) => t.toLowerCase().includes(needle))));
    const by: Record<SortKey, (a: TrendRow, b: TrendRow) => number> = {
      change: (a, b) => changeRank(b.summary) - changeRank(a.summary) || (b.summary.now ?? -1) - (a.summary.now ?? -1),
      volume: (a, b) => (b.summary.now ?? -1) - (a.summary.now ?? -1),
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    };
    return [...list].sort(by[sort]);
  }, [inMajor, stateFilter, q, sort]);

  const majorRows: MajorRow[] = useMemo(() => majors.map((m) => {
    const list = rows.filter((r) => r.major === m);
    const live = list.filter((r) => r.summary.now !== null && r.summary.state !== 'low');
    const sum = (k: 'now' | 'yearAgo') => live.reduce((s, r) => s + (r.summary[k] ?? 0), 0);
    const top = [...live].sort((a, b) => (b.summary.now ?? 0) - (a.summary.now ?? 0))[0] ?? null;
    return {
      major: m, total: list.length,
      rising: list.filter((r) => r.summary.state === 'surge' || r.summary.state === 'up').length,
      falling: list.filter((r) => r.summary.state === 'down' || r.summary.state === 'peaked').length,
      top: top ? { name: top.name, now: top.summary.now ?? 0 } : null,
      change: sum('yearAgo') > 0 ? sum('now') / sum('yearAgo') - 1 : null,
    };
  }), [majors, rows]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const siblings = useMemo(() => {
    if (!selected) return [];
    const same = rows.filter((r) => r.major === selected.major && r.middle === selected.middle);
    return (same.length >= 3 ? same : rows.filter((r) => r.major === selected.major));
  }, [rows, selected]);

  const openMajor = (m: string) => { setMajor(m); setView('procedure'); setStateFilter('all'); };

  return (
    <div className="flex h-full min-h-0">
      <main className="flex min-w-0 flex-1 flex-col px-6 py-8">
        <h1 className="mb-1 shrink-0 text-[20px] font-bold">검색 트렌드 <span className="text-ui font-normal text-x-secondary">일본 · 피부과 시술 {rows.length}</span></h1>
        <p className="mb-4 shrink-0 text-[15px] text-x-secondary">
          일본 사람들이 구글에서 이 시술을 한 달에 몇 번 찾는지예요. {LAST_LABEL}까지 · {FETCHED}에 받음 · 매달 초 지난달 숫자가 더해져요.
        </p>

        <div className="mb-3 shrink-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" className="flex rounded-full border border-x-border-strong p-0.5 text-ui">
              {(['procedure', 'major'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                        className={`rounded-full px-3 py-1 ${view === v ? 'bg-x-text text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
                  {v === 'procedure' ? '시술별' : '분류별'}
                </button>
              ))}
            </div>
            {view === 'procedure' && (<>
              <select value={major} onChange={(e) => setMajor(e.target.value)} aria-label="분류"
                      className="h-8 rounded-full border border-x-border-strong bg-white px-3 text-ui">
                <option value="">분류 전체</option>
                {majors.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="시술명·일본어로 찾기"
                     className="h-8 w-52 rounded-full border border-x-border-strong px-3 text-ui" />
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬"
                      className="ml-auto h-8 rounded-full border border-x-border-strong bg-white px-3 text-ui">
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </>)}
          </div>
          {view === 'procedure' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {STATE_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setStateFilter(f.key)}
                        className={`rounded-full border px-3 py-1 text-ui ${stateFilter === f.key ? 'border-x-text bg-x-text text-white' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                  {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
                </button>
              ))}
              <span className="ml-1 text-ui text-x-muted" title="최근 3개월 평균을 1년 전 같은 3개월과 비교해요. 검색량은 구간으로 반올림된 값이라 ±30% 안쪽은 '유지'로 봐요.">ⓘ 판정 기준</span>
            </div>
          )}
          {view === 'major' && (
            <p className="text-ui text-x-muted">분류 합계는 한 사람이 여러 검색어로 찾으면 겹쳐 세져서 실제보다 커요. 방향과 늘어난·줄어든 시술 수로 보세요.</p>
          )}
        </div>

        {view === 'procedure'
          ? (shown.length === 0
              ? <div className="rounded-xl border border-x-border py-12 text-center text-ui text-x-secondary">조건에 맞는 시술이 없어요</div>
              : <TrendTable rows={shown} selectedId={selectedId} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} />)
          : <MajorTable rows={majorRows} onOpen={openMajor} />}
      </main>

      {selected && (
        <TrendDetail row={selected} summary={selected.summary as TrendSummary} months={DATA.months}
                     siblings={siblings} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
