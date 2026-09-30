// 인플루언서 성과 — 캠페인에 참여한 인플을 성과로 줄 세워 섭외할 인플을 고르는 화면. 스펙 2026-09-30
'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import {
  sortPerfRows, parsePerfQuery, perfQueryString, firstDir,
  type PerfRow, type PerfQuery, type SortKey, type Agg,
} from '@/lib/influencerPerformance';
import { InfluencerPerfTable } from './InfluencerPerfTable';

export default function InfluencerPerformancePage() {
  // useSearchParams는 Suspense 경계 필수(influencers/page.tsx 관례)
  return <Suspense><PerfView /></Suspense>;
}

const AGGS: Array<[Agg, string]> = [['median', '중앙값'], ['mean', '평균']];

function PerfView() {
  const sp = useSearchParams();
  // 주소가 첫 상태 — 이후 변경은 history.replaceState(router.replace는 서버 왕복으로 클릭이 멈춘다, 09-27 캠페인 목록 사례)
  const [query, setQuery] = useState<PerfQuery>(() => parsePerfQuery((k) => sp.get(k)));
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/influencers/performance');
      if (!r.ok) throw new Error(String(r.status));
      setRows((await r.json()) as PerfRow[]);
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

  const apply = (next: PerfQuery) => {
    setQuery(next);
    const q = perfQueryString(next);
    window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
  };
  const onSort = (key: SortKey) =>
    apply({ ...query, sort: key, dir: query.sort === key ? (query.dir === 'asc' ? 'desc' : 'asc') : firstDir(key) });
  const setAgg = (agg: Agg) => apply({ ...query, agg });
  const onToggle = (h: string) => setExpanded((s) => { const n = new Set(s); if (n.has(h)) n.delete(h); else n.add(h); return n; });

  const sorted = useMemo(() => sortPerfRows(rows, query.sort, query.dir, query.agg), [rows, query]);

  return (
    <main className="mx-auto max-w-none px-6 py-8">
      <h1 className="mb-1 text-[20px] font-bold">인플루언서 성과</h1>
      <p className="mb-4 text-ui text-x-muted">캠페인에 참여한 인플의 게시물 성과를 비교해요. 열 이름을 누르면 그 기준으로 줄을 세워요.</p>

      {!loaded && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">성과를 불러오지 못했어요</p>
          <Button onClick={retry}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && rows.length === 0 && (
        <p className="py-8 text-center text-ui text-x-secondary">
          아직 캠페인 작업이 없어요 — 캠페인에서 작업을 만들고 게시되면 여기에 성과가 모여요{' '}
          <Link href="/campaigns/flow" className="text-x-blue-text hover:underline">캠페인으로 →</Link>
        </p>
      )}
      {loaded && !loadErr && rows.length > 0 && (<>
        {/* 표 위 오른쪽 — 성과 열 전체와 정렬이 이 기준으로 바뀐다(스펙 §4-2) */}
        <div className="mb-3 flex items-center justify-end gap-3">
          <span className="text-ui text-x-muted">기본은 중앙값 — 한 번 크게 터진 글에 덜 흔들려요</span>
          <div role="group" aria-label="성과 기준" className="flex h-8 w-fit overflow-hidden rounded-lg border border-x-border-strong">
            {AGGS.map(([v, label], i) => (
              <button key={v} type="button" onClick={() => setAgg(v)} aria-pressed={query.agg === v}
                      className={`h-full px-3.5 text-ui ${i > 0 ? 'border-l border-x-border-strong' : ''} ${query.agg === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <InfluencerPerfTable rows={sorted} agg={query.agg} sort={query.sort} dir={query.dir}
                             onSort={onSort} expanded={expanded} onToggle={onToggle} />
      </>)}
    </main>
  );
}
