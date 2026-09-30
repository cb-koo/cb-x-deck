// 인플루언서 성과 — 캠페인에 참여한 인플을 성과로 줄 세워 섭외할 인플을 고르는 화면. 스펙 2026-09-30
'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import {
  sortPerfRows, parsePerfQuery, perfQueryString, firstDir, buildFilteredRows, buildPerfRows, isFilterOn, filterSummary,
  optionCounts, EMPTY_FILTER,
  type PerfInfluencerInput, type PerfQuery, type PerfFilter, type SortKey, type Agg,
} from '@/lib/influencerPerformance';
import { InfluencerPerfTable } from './InfluencerPerfTable';
import { PerfFilterBar, type ClientOption } from './PerfFilterBar';

export default function InfluencerPerformancePage() {
  // useSearchParams는 Suspense 경계 필수(influencers/page.tsx 관례)
  return <Suspense><PerfView /></Suspense>;
}

const SEARCH_URL_DELAY = 300;   // 검색은 입력이 끊기지 않게 화면은 즉시, 주소만 늦게 쓴다(스펙 §15-2)

function PerfView() {
  const sp = useSearchParams();
  // 주소가 첫 상태 — 이후 변경은 history.replaceState(router.replace는 서버 왕복으로 클릭이 멈춘다, 09-27 캠페인 목록 사례)
  const [query, setQuery] = useState<PerfQuery>(() => parsePerfQuery((k) => sp.get(k)));
  const [inputs, setInputs] = useState<PerfInfluencerInput[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/influencers/performance');
      if (!r.ok) throw new Error(String(r.status));
      setInputs((await r.json()) as PerfInfluencerInput[]);
      setLoadErr(false);
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    } finally {
      setLoaded(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(influencers/page.tsx 관례)
  useEffect(() => { load(); }, [load]);
  // 재시도 — 에러를 지우고 로딩 표시로 되돌린 뒤 다시 부른다. loaded=false인 동안 버튼이 사라져 중복 요청을 막는다.
  const retry = () => { setLoaded(false); setLoadErr(false); void load(); };

  // 클라이언트 목록 = 불러온 전체 작업에서(걸러진 행에서 뽑으면 하나 고르는 순간 목록이 하나로 줄어든다)
  const clients = useMemo<ClientOption[]>(() => {
    const m = new Map<string, string>();
    for (const inf of inputs) for (const t of inf.tasks) if (t.clientId && !m.has(t.clientId)) m.set(t.clientId, t.clientName ?? '(이름 없음)');
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [inputs]);
  // 주소의 client 중 목록에 없는 id(삭제·오타)는 버린다 — 틀린 쿼리는 기본값(스펙 §4-5·§16)
  const view = useMemo<PerfQuery>(() => {
    const known = query.clientIds.filter((id) => clients.some((c) => c.id === id));
    return known.length === query.clientIds.length ? query : { ...query, clientIds: known };
  }, [query, clients]);

  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (urlTimer.current) clearTimeout(urlTimer.current); }, []);
  // 주소 쓰기는 항상 대기 중인 것을 먼저 취소한다 — 검색 직후 정렬을 누르면 늦게 도는 옛 주소가 새 정렬을 덮지 않게
  const apply = (next: PerfQuery, delay = 0) => {
    setQuery(next);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    const write = () => {
      const q = perfQueryString(next);
      window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
    };
    if (delay > 0) urlTimer.current = setTimeout(write, delay); else write();
  };
  const onSort = (key: SortKey) =>
    apply({ ...view, sort: key, dir: view.sort === key ? (view.dir === 'asc' ? 'desc' : 'asc') : firstDir(key) });
  const setAgg = (agg: Agg) => apply({ ...view, agg });
  const onFilter = (patch: Partial<PerfFilter>) => apply({ ...view, ...patch }, 'q' in patch ? SEARCH_URL_DELAY : 0);
  const clearFilter = () => apply({ ...view, ...EMPTY_FILTER });   // 정렬·중앙값/평균은 그대로
  const onToggle = (h: string) => setExpanded((s) => { const n = new Set(s); if (n.has(h)) n.delete(h); else n.add(h); return n; });

  // 필터 전 전체 인원(게시한 작업이 있는 인플) — 제목 옆 숫자. 필터 결과 인원은 요약 줄이 말한다(스펙 §18-5)
  const total = useMemo(() => buildPerfRows(inputs).length, [inputs]);
  const hasAny = total > 0;
  const filtered = useMemo(() => buildFilteredRows(inputs, view), [inputs, view]);
  const counts = useMemo(() => optionCounts(inputs, view), [inputs, view]);
  const sorted = useMemo(() => sortPerfRows(filtered, view.sort, view.dir, view.agg), [filtered, view]);
  const filterOn = isFilterOn(view);
  const clientNames = clients.filter((c) => view.clientIds.includes(c.id)).map((c) => c.name);

  return (
    // 화면 높이를 채우는 세로 flex — 표 칸만 남은 높이 안에서 스크롤해 열 머리가 위에 고정된다(스펙 §18-1).
    // h-full = GlobalShell 스크롤 래퍼(h-screen flex의 늘어난 칸)의 높이. 위 줄들은 shrink-0, 표 칸은 min-h-0으로 줄어든다 —
    // 요약 줄이 생기고 사라져도 높이 계산식 없이 맞는다. 표가 짧으면 표 칸은 내용 높이 그대로(빈 테두리가 바닥까지 늘지 않는다).
    <main className="mx-auto flex h-full max-w-none flex-col px-6 py-8">
      <h1 className="mb-1 shrink-0 text-[20px] font-bold">
        인플루언서 성과 {hasAny && <span className="text-ui font-normal text-x-secondary">{total}</span>}
      </h1>
      <p className="mb-4 shrink-0 text-ui text-x-muted">캠페인에서 게시까지 한 인플의 게시물 성과를 비교해요. 열 이름을 누르면 그 기준으로 줄을 세워요.</p>

      {!loaded && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">성과를 불러오지 못했어요</p>
          <Button onClick={retry}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && !hasAny && (
        <p className="py-8 text-center text-ui text-x-secondary">
          아직 게시된 캠페인 작업이 없어요 — 캠페인에서 작업이 게시되면 여기에 성과가 모여요{' '}
          <Link href="/campaigns/flow" className="text-x-blue-text hover:underline">캠페인으로 →</Link>
        </p>
      )}
      {loaded && !loadErr && hasAny && (<>
        <div className="mb-3 shrink-0 space-y-2">
          <PerfFilterBar filter={view} clients={clients} counts={counts} onChange={onFilter} agg={view.agg} onAgg={setAgg} />
          {/* 무엇으로 계산했는지 한 줄(스펙 §15-2) — 필터가 없으면 줄 자체가 없다. 0명이면 아래 빈 상태가 대신 말한다 */}
          {filterOn && sorted.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 text-ui text-x-muted">
              <span>{filterSummary(view, clientNames, sorted.length)}</span>
              <button type="button" onClick={clearFilter} className="text-x-blue-text hover:underline">필터 지우기</button>
            </p>
          )}
        </div>
        {sorted.length === 0 ? (
          <div className="shrink-0 rounded-xl border border-x-border py-12 text-center">
            <p className="mb-1.5 text-ui text-x-secondary">조건에 맞는 인플이 없어요</p>
            <button type="button" onClick={clearFilter} className="text-ui text-x-blue-text hover:underline">필터 지우기</button>
          </div>
        ) : (
          <InfluencerPerfTable rows={sorted} agg={view.agg} sort={view.sort} dir={view.dir}
                               onSort={onSort} expanded={expanded} onToggle={onToggle} />
        )}
      </>)}
    </main>
  );
}
