// 검색 트렌드 — 시술마다 일본에서 얼마나 찾는지(크기)·늘고 있는지(방향)·왜 찾는지(성격)·한국에서 받으려는 검색(한국). 스펙 2026-10-13
// 시안: 데이터는 10-13 실측 스냅샷 — snapshot.json(시술 목록·이름 검색), intent.json(검색어 묶음을 태그해 모은 시술 단위 값).
// 수집·저장(073)이 붙으면 API로 바꾼다.
'use client';
import { useMemo, useState } from 'react';
import snapshot from './snapshot.json';
import intentData from './intent.json';
import { summarize, changeRank, type TrendState } from '@/lib/searchTrend';
import { classify, categoryOrder } from '@/lib/procedureTaxonomy';
import { TrendTable, MajorTable, type TrendRow, type MajorRow, type IntentInfo } from './TrendTable';
import { TrendDetail } from './TrendDetail';
import { TrendMap } from './TrendMap';

type Proc = { id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string; volumes: number[] | null };
const DATA = snapshot as { market: string; fetchedAt: string; months: string[]; procedures: Proc[] };
const INTENT = intentData as unknown as Record<string, IntentInfo>;

type StateFilter = 'all' | 'rising' | 'falling' | 'flat' | 'quiet';
const STATE_FILTERS: Array<{ key: StateFilter; label: string; match: (s: TrendState) => boolean }> = [
  { key: 'all', label: '전체', match: () => true },
  { key: 'rising', label: '상승', match: (s) => s === 'surge' || s === 'up' },
  { key: 'falling', label: '하락', match: (s) => s === 'down' || s === 'peaked' || s === 'spiked' },
  { key: 'flat', label: '보합', match: (s) => s === 'flat' },
  { key: 'quiet', label: '소량 · 데이터 없음', match: (s) => s === 'low' || s === 'nodata' },
];
type SortKey = 'change' | 'volume' | 'korea' | 'name';
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'change', label: '변화율순' }, { key: 'volume', label: '검색량순' }, { key: 'korea', label: '한국 검색량순' }, { key: 'name', label: '이름순' },
];

const lastMonth = DATA.months[DATA.months.length - 1];
const LAST_LABEL = `${lastMonth.slice(0, 4)}년 ${Number(lastMonth.slice(5, 7))}월`;
const FETCHED = `${Number(DATA.fetchedAt.slice(5, 7))}/${Number(DATA.fetchedAt.slice(8, 10))}`;
const avg3 = (v: number[], end: number) => v.slice(end - 3, end).reduce((s, x) => s + x, 0) / 3;

export default function TrendsPage() {
  // 분류는 일반적인 피부과 시술 분류로 다시 붙인다(시트 대분류·중분류는 용어 참고용). 같은 일본어 검색어는 한 줄만.
  // 크기·방향은 검색어 묶음 전체(이름 + 수식어 + 한국 조합, 제외·다른 뜻 뺌)로 본다 — 묶음이 없으면 이름 검색으로.
  // 같은 분류·같은 시술명(시트의 제품·표기 변형 행: 울쎄라/울쎄라프라임/울쎄라리프트)은 한 줄로 묶는다 — intent.json이 묶음 단위(첫 행 id)다.
  const rows: TrendRow[] = useMemo(() => {
    const seen = new Set<string>();
    const n = DATA.months.length;
    const fams = new Map<string, Proc[]>();
    for (const p of DATA.procedures) {
      const key = p.jp.replace(/\s/g, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const fk = `${classify(p).category}|${p.name}`;
      fams.set(fk, [...(fams.get(fk) ?? []), p]);
    }
    // 이름만 같고 다른 시술(포토나 레이저 / 포토나 4D, 인모드 / 바디 인모드)은 한국어 표기로 구분해 보여 준다
    const nameCount = new Map<string, number>();
    for (const ms of fams.values()) nameCount.set(ms[0].name, (nameCount.get(ms[0].name) ?? 0) + 1);
    return [...fams.values()].map((ms) => {
      const p = ms[0];
      const c = classify(p);
      const it = INTENT[p.id] ?? null;
      // 묶음이 있으면 묶음만 — 이름 검색으로 되돌아가면 동음이의 시술(フォトナ=게임)이 다시 커진다
      const series = it && (it.ambiguous || it.total.some((x) => x > 0)) ? it.total : p.volumes;
      const korea = it ? { now: avg3(it.korea, n), yearAgo: avg3(it.korea, n - 12) } : null;
      return {
        ...p, name: (nameCount.get(p.name) ?? 0) > 1 ? p.kr.replace(/\s*\(.*\)$/, '') : p.name, major: c.category, majorOrder: categoryOrder(c.category), middle: c.sub,
        jp: ms.length > 1 ? `${p.jp} 외 ${ms.length - 1}` : p.jp,
        searchText: ms.flatMap((m) => [m.name, m.kr, m.jp, m.en]).join(' ').toLowerCase(),
        series, summary: summarize(series, DATA.months), intent: it, korea,
      };
    });
  }, []);
  const majors = useMemo(() => [...new Map(rows.map((r) => [r.major, r.majorOrder])).entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m), [rows]);

  const [view, setView] = useState<'procedure' | 'major'>('procedure');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [major, setMajor] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('change');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(true);

  const inMajor = useMemo(() => rows.filter((r) => !major || r.major === major), [rows, major]);
  const counts = useMemo(() => Object.fromEntries(STATE_FILTERS.map((f) => [f.key, inMajor.filter((r) => f.match(r.summary.state)).length])) as Record<StateFilter, number>, [inMajor]);
  const shown = useMemo(() => {
    const f = STATE_FILTERS.find((x) => x.key === stateFilter)!;
    const needle = q.trim().toLowerCase();
    const list = inMajor.filter((r) => f.match(r.summary.state)
      && (!needle || r.searchText.includes(needle) || r.middle.toLowerCase().includes(needle)));
    const by: Record<SortKey, (a: TrendRow, b: TrendRow) => number> = {
      change: (a, b) => changeRank(b.summary) - changeRank(a.summary) || (b.summary.now ?? -1) - (a.summary.now ?? -1),
      volume: (a, b) => (b.summary.now ?? -1) - (a.summary.now ?? -1),
      korea: (a, b) => (b.korea?.now ?? -1) - (a.korea?.now ?? -1),
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    };
    return [...list].sort(by[sort]);
  }, [inMajor, stateFilter, q, sort]);

  const majorRows: MajorRow[] = useMemo(() => majors.map((m) => {
    const list = rows.filter((r) => r.major === m);
    const live = list.filter((r) => r.summary.now !== null && r.summary.state !== 'low');
    const changes = live.map((r) => r.summary.change).filter((c): c is number => c !== null).sort((a, b) => a - b);
    const top = [...live].sort((a, b) => (b.summary.now ?? 0) - (a.summary.now ?? 0))[0] ?? null;
    return {
      major: m, total: list.length,
      rising: list.filter((r) => r.summary.state === 'surge' || r.summary.state === 'up').length,
      falling: list.filter((r) => r.summary.state === 'down' || r.summary.state === 'peaked' || r.summary.state === 'spiked').length,
      top: top ? { name: top.name, now: top.summary.now ?? 0 } : null,
      change: changes.length ? changes[Math.floor(changes.length / 2)] : null,
      korea: list.reduce((s, r) => s + (r.korea?.now ?? 0), 0),
    };
  }), [majors, rows]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const siblings = useMemo(() => {
    if (!selected) return [];
    const same = rows.filter((r) => r.major === selected.major && r.middle === selected.middle);
    return (same.length >= 3 ? same : rows.filter((r) => r.major === selected.major));
  }, [rows, selected]);

  const openMajor = (m: string) => { setMajor(m); setView('procedure'); setStateFilter('all'); };
  const toggle = (id: string) => setSelectedId(id === selectedId ? null : id);

  return (
    <div className="flex h-full min-h-0">
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-8">
        <h1 className="mb-1 shrink-0 text-[20px] font-bold">검색 트렌드 <span className="text-ui font-normal text-x-secondary">일본 · 피부과 시술 {rows.length}</span></h1>
        <p className="mb-4 shrink-0 text-[15px] text-x-secondary">
          일본 구글 검색 기준 시술별 수요·추세·검색 의도. 기준월 {LAST_LABEL} · 수집 {FETCHED} · 매월 초 갱신
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
              <span className="ml-1 text-ui text-x-muted" title="상승·하락: 최근 3개월 평균 vs 전년 같은 3개월(±30% 이내는 보합 — 검색량이 구간 반올림값이라). 급상승: 최근 6개월 증가 속도가 전년 같은 시기보다 1.5배 이상 빠르고 월 300 이상, 또는 1년 전엔 거의 없던 신규 수요">ⓘ 판정 기준</span>
            </div>
          )}
          {view === 'major' && (
            <p className="text-ui text-x-muted">분류별 전년 대비 변화율은 소속 시술의 중앙값. 검색량 합계는 중복 집계 우려로 미사용</p>
          )}
        </div>

        {view === 'procedure' && shown.length > 0 && (
          <TrendMap rows={shown} open={mapOpen} onToggle={() => setMapOpen(!mapOpen)} selectedId={selectedId} onSelect={toggle} />
        )}

        {view === 'procedure'
          ? (shown.length === 0
              ? <div className="rounded-xl border border-x-border py-12 text-center text-ui text-x-secondary">조건에 맞는 시술이 없어요</div>
              : <TrendTable rows={shown} selectedId={selectedId} onSelect={toggle} />)
          : <MajorTable rows={majorRows} onOpen={openMajor} />}
      </main>

      {selected && (
        <TrendDetail row={selected} months={DATA.months} siblings={siblings} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
