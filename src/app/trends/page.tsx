// 검색 트렌드 — 시술마다 일본에서 얼마나 찾는지(크기)·늘고 있는지(방향)·왜 찾는지(성격)·한국에서 받으려는 검색(한국). 스펙 2026-10-13
// 데이터: 수집·수정 때 만들어 둔 완성본(trend_view, 074)을 /api/trends로 읽는다 — 시술 목록·이름 검색 + 묶음 단위 값(검색어 묶음을 태그해 모은 것).
'use client';
import { useEffect, useMemo, useState } from 'react';
import { summarize, changeRank } from '@/lib/searchTrend';
import { notableOf } from '@/lib/trendNotable';
import { interestShares, interestBaseline, interestOf } from '@/lib/trendInterest';
import { classify, categoryOrder } from '@/lib/procedureTaxonomy';
import { TrendTable, MajorTable, MED_MIX, SORT_FIRST_DIR, type TrendRow, type MajorRow, type IntentInfo, type SortKey, type TableSort } from './TrendTable';
import { TrendDetail } from './TrendDetail';
import { TrendMap } from './TrendMap';
import { ProcedureForm } from './TrendManage';
import { Button } from '@/components/ui';

type Proc = { id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string; volumes: number[] | null };
type TrendData = { market: string; fetchedAt: string; months: string[]; procedures: Proc[]; intent: Record<string, IntentInfo> };

type StateFilter = 'all' | 'notable' | 'rising' | 'falling' | 'flat' | 'quiet';
const STATE_FILTERS: Array<{ key: StateFilter; label: string; match: (r: TrendRow) => boolean }> = [
  { key: 'all', label: '전체', match: () => true },
  { key: 'notable', label: '★ 주목', match: (r) => !!r.notable },
  { key: 'rising', label: '상승', match: (r) => r.summary.state === 'surge' || r.summary.state === 'up' },
  { key: 'falling', label: '하락', match: (r) => ['down', 'peaked', 'spiked'].includes(r.summary.state) },
  { key: 'flat', label: '보합', match: (r) => r.summary.state === 'flat' },
  { key: 'quiet', label: '소량 · 데이터 없음', match: (r) => r.summary.state === 'low' || r.summary.state === 'nodata' },
];


const avg3 = (v: number[], end: number) => v.slice(end - 3, end).reduce((s, x) => s + x, 0) / 3;

async function fetchTrends(): Promise<TrendData> {
  const r = await fetch('/api/trends?market=jp', { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? '불러오지 못했어요');
  return j;
}

export default function TrendsPage() {
  const [data, setData] = useState<TrendData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchTrends().then(setData).catch((e: Error) => setError(e.message)); }, []);
  const load = async () => { try { setData(await fetchTrends()); } catch (e) { setError((e as Error).message); } };
  if (error) return <div className="px-6 py-8 text-[15px] text-x-secondary">검색 트렌드를 불러오지 못했어요 — {error}</div>;
  if (!data) return <div className="px-6 py-8 text-[15px] text-x-muted">검색 트렌드를 불러오는 중…</div>;
  return <TrendsView data={data} reload={load} />;
}

function TrendsView({ data: DATA, reload }: { data: TrendData; reload: () => Promise<void> }) {
  const INTENT = DATA.intent;
  const lastMonth = DATA.months[DATA.months.length - 1];
  const LAST_LABEL = `${lastMonth.slice(0, 4)}년 ${Number(lastMonth.slice(5, 7))}월`;
  const FETCHED = `${Number(DATA.fetchedAt.slice(5, 7))}/${Number(DATA.fetchedAt.slice(8, 10))}`;
  // 분류는 일반적인 피부과 시술 분류로 다시 붙인다(시트 대분류·중분류는 용어 참고용). 같은 일본어 검색어는 한 줄만.
  // 크기·방향은 검색어 묶음 전체(이름 + 수식어 + 한국 조합, 제외·다른 뜻 뺌)로 본다 — 묶음이 없으면 이름 검색으로.
  // 같은 분류·같은 시술명(시트의 제품·표기 변형 행: 울쎄라/울쎄라프라임/울쎄라리프트)은 한 줄로 묶는다 — 완성본의 intent가 묶음 단위(첫 행 id)다.
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
    const built = [...fams.values()].map((ms) => {
      const p = ms[0];
      const c = classify(p);
      const it = INTENT[p.id] ?? null;
      // 묶음이 있으면 묶음만 — 이름 검색으로 되돌아가면 동음이의 시술(フォトナ=게임)이 다시 커진다
      // 타 진료과 혼재(마운자로·PRP 등)는 시술명 단독 검색을 뺀다 — 내과·정형외과 수요가 크기 비교(검색량순·지도·분류 최다)를 좌우하지 않게(koo 10-14)
      const medMix = !!it && !it.ambiguous && (it.serp?.med ?? 0) >= MED_MIX;
      const series = it && (it.ambiguous || it.total.some((x) => x > 0)) ? (medMix ? it.noName : it.total) : p.volumes;
      const korea = it ? { now: avg3(it.korea, n), yearAgo: avg3(it.korea, n - 12) } : null;
      const summary = summarize(series, DATA.months);
      return {
        ...p, baseName: p.name, name: (nameCount.get(p.name) ?? 0) > 1 ? p.kr.replace(/\s*\(.*\)$/, '') : p.name, major: c.category, majorOrder: categoryOrder(c.category), middle: c.sub,
        jp: ms.length > 1 ? `${p.jp} 외 ${ms.length - 1}` : p.jp,
        searchText: ms.flatMap((m) => [m.name, m.kr, m.jp, m.en]).join(' ').toLowerCase(),
        series, summary, intent: it, korea, notable: notableOf(summary, series, it?.korea ?? null), interest: null as TrendRow['interest'],
      };
    });
    // 많이 찾는 것 — 평균은 비중이 있는 모든 시술로(필터와 상관없이 같은 기준)
    const shares = built.map((r) => interestShares(r.intent?.profile ?? null));
    const base = interestBaseline(shares);
    return built.map((r, i) => ({ ...r, interest: interestOf(shares[i], base) }));
  }, [DATA, INTENT]);
  const majors = useMemo(() => [...new Map(rows.map((r) => [r.major, r.majorOrder])).entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m), [rows]);

  const [view, setView] = useState<'procedure' | 'major'>('procedure');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [major, setMajor] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<TableSort>({ key: 'trend', dir: 'desc' });
  const onSort = (k: SortKey) => setSort((cur) => (cur.key === k ? { key: k, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: SORT_FIRST_DIR[k] }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [adding, setAdding] = useState(false);

  const inMajor = useMemo(() => rows.filter((r) => !major || r.major === major), [rows, major]);
  const counts = useMemo(() => Object.fromEntries(STATE_FILTERS.map((f) => [f.key, inMajor.filter((r) => f.match(r)).length])) as Record<StateFilter, number>, [inMajor]);
  const shown = useMemo(() => {
    const f = STATE_FILTERS.find((x) => x.key === stateFilter)!;
    const needle = q.trim().toLowerCase();
    const list = inMajor.filter((r) => f.match(r)
      && (!needle || r.searchText.includes(needle) || r.middle.toLowerCase().includes(needle)));
    // 열마다 비교할 값 — null(값 없음·소량)은 방향과 상관없이 맨 아래
    const val: Record<SortKey, (r: TrendRow) => number | string | null> = {
      name: (r) => r.name,
      volume: (r) => r.summary.now,
      trend: (r) => (r.summary.state === 'nodata' || r.summary.state === 'low' ? null : changeRank(r.summary)),
      // 1년 변화 — 신규(1년 전 소량)는 가장 크게 늘어난 쪽으로 친다
      year: (r) => (r.summary.state === 'nodata' || r.summary.state === 'low' ? null : r.summary.change ?? Number.MAX_SAFE_INTEGER),
      korea: (r) => (r.korea && r.korea.now >= 50 ? r.korea.now : null),
      interest: (r) => (r.interest?.kind === 'standout' ? r.interest.ratio : r.interest ? 1 : null),
    };
    const get = val[sort.key], sign = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const c = typeof x === 'string' ? x.localeCompare(y as string, 'ko') : x - (y as number);
      return c !== 0 ? sign * c : (b.summary.now ?? -1) - (a.summary.now ?? -1);
    });
  }, [inMajor, stateFilter, q, sort]);

  const majorRows: MajorRow[] = useMemo(() => majors.map((m) => {
    const list = rows.filter((r) => r.major === m);
    const live = list.filter((r) => r.summary.now !== null && r.summary.state !== 'low');
    // 분류 추세도 태그와 같은 기준(지금 방향 = 최근 3개월 vs 직전 3개월) — 1년 변화로 상승·하락을 붙이면 시술 태그와 어긋난다
    const changes = live.map((r) => r.summary.recent).filter((c): c is number => c !== null).sort((a, b) => a - b);
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
        <div className="mb-1 flex shrink-0 items-center gap-3">
          <h1 className="text-[20px] font-bold">검색 트렌드 <span className="text-ui font-normal text-x-secondary">일본 · 피부과 시술 {rows.length}</span></h1>
          <Button className="ml-auto" onClick={() => { setAdding(true); setSelectedId(null); }}>+ 시술 추가</Button>
        </div>
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
              <span className="ml-auto text-ui text-x-muted">표 머리를 누르면 정렬</span>
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
              <span className="ml-1 text-ui text-x-muted" title="태그는 지금 방향: 최근 3개월 평균 vs 직전 3개월(해마다 반복되는 계절은 지우고, 한 달만 튄 값은 빼고). ±20% 안쪽 보합 · +50% 이상이고 월 300 이상 급상승 · 1년 새 크게 오른 채 줄면 하락 전환 · 한 달 급등 후 꺾이면 일시 급등">ⓘ 판정 기준</span>
            </div>
          )}
          {view === 'major' && (
            <p className="text-ui text-x-muted">분류 추세는 소속 시술의 최근 3개월 변화(직전 3개월 대비, 계절 감안) 중앙값. 검색량 합계는 중복 집계 우려로 미사용</p>
          )}
        </div>

        {view === 'procedure' && shown.length > 0 && (
          <TrendMap rows={shown} open={mapOpen} onToggle={() => setMapOpen(!mapOpen)} selectedId={selectedId} onSelect={toggle} />
        )}

        {view === 'procedure'
          ? (shown.length === 0
              ? <div className="rounded-xl border border-x-border py-12 text-center text-ui text-x-secondary">조건에 맞는 시술이 없어요</div>
              : <TrendTable rows={shown} selectedId={selectedId} onSelect={toggle} sort={sort} onSort={onSort} />)
          : <MajorTable rows={majorRows} onOpen={openMajor} />}
      </main>

      {selected && (
        <TrendDetail key={selected.id} row={selected} months={DATA.months} siblings={siblings} onSelect={setSelectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
      )}
      {adding && !selected && (
        <aside className="flex w-[clamp(560px,44vw,780px)] shrink-0 flex-col overflow-y-auto border-l border-x-border bg-white">
          <div className="sticky top-0 z-10 flex items-center border-b border-x-border bg-white px-6 py-4">
            <p className="text-[18px] font-bold">시술 추가</p>
            <button onClick={() => setAdding(false)} aria-label="닫기" className="ml-auto rounded-full px-2 py-1 text-x-secondary hover:bg-x-hover">✕</button>
          </div>
          <div className="px-6 py-5">
            <ProcedureForm mode="add" onCancel={() => setAdding(false)}
              initial={{ name: '', category: major || '', sub: '', hidden: false, members: [{ id: null, kr: '', jp: '', en: '' }] }}
              onSaved={async (id) => {
                await reload(); setAdding(false);
                // 같은 분류·같은 이름이 이미 있으면 그 묶음으로 들어간다 — 묶음 첫 행을 연다
                setSelectedId(id);
              }} />
          </div>
        </aside>
      )}
    </div>
  );
}
