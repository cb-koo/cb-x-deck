// src/app/performance/page.tsx
'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatFull } from '@/lib/format';
import { kstDateTime, kstDate, kstToday, kstDaysAgo } from '@/lib/datetime';
import { ALL_CAMPAIGNS, type PerformanceData, type ContentRow } from '@/lib/performanceStore';
import type { Range } from '@/lib/landingEventStore';
import { groupByInfluencer, sortRows, topShare, type PerfSortKey } from '@/lib/performanceJudgment';
import { PerformanceCards } from '@/components/PerformanceCards';
import { PerformanceTable, type Grouping, type TableRow } from '@/components/PerformanceTable';

export default function PerformancePage() {
  // useSearchParams는 Suspense 경계 필수(tracking·clients 선례)
  return <Suspense><PerformanceView /></Suspense>;
}

// 프리셋 이름은 '전체 기간' — '캠페인 전체'는 캠페인 select의 '모든 캠페인'과 헷갈렸다(koo QA 08-26)
const RANGES: Array<[Exclude<Range, 'custom'>, string]> = [['all', '전체 기간'], ['7d', '최근 7일'], ['30d', '최근 30일']];
const md = (ymd: string) => ymd.slice(5).replace('-', '/');

function PerformanceView() {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const campaign = sp.get('campaign');
  const range: Range = (['all', '7d', '30d', 'custom'] as Range[]).includes(sp.get('range') as Range) ? (sp.get('range') as Range) : 'all';
  const from = sp.get('from'); const to = sp.get('to');
  // 주소가 상태다 — 캠페인·기간 프리셋·직접 지정 날짜 전부 URL에(새로고침·공유 유지). 프리셋을 고르면 날짜는 지운다.
  const setParams = useCallback((next: { campaign?: string | null; range?: Range; from?: string | null; to?: string | null }) => {
    const p = new URLSearchParams(sp.toString());
    if (next.campaign !== undefined) { if (next.campaign) p.set('campaign', next.campaign); else p.delete('campaign'); }
    if (next.range !== undefined) {
      if (next.range === 'all') p.delete('range'); else p.set('range', next.range);
      if (next.range !== 'custom') { p.delete('from'); p.delete('to'); }
    }
    if (next.from !== undefined) { if (next.from) p.set('from', next.from); else p.delete('from'); }
    if (next.to !== undefined) { if (next.to) p.set('to', next.to); else p.delete('to'); }
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const [data, setData] = useState<PerformanceData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [grouping, setGrouping] = useState<Grouping>('content');
  const [sort, setSort] = useState<PerfSortKey>('taps');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // setState는 전부 await 뒤 — 동기 setState를 앞에 두면 set-state-in-effect에 걸린다(tracking 관례)
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(); if (campaign) q.set('campaign', campaign); q.set('range', range);
      if (range === 'custom') { if (from) q.set('from', from); if (to) q.set('to', to); }
      const r = await apiFetch(`/api/performance?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as PerformanceData);
      setLoadErr(false);
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    }
  }, [campaign, range, from, to]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 필터가 바뀔 때 다시 읽는다, setState는 전부 비동기 콜백
  useEffect(() => { load(); }, [load]);

  const onSort = useCallback((k: PerfSortKey) => {
    setSort((cur) => { if (cur === k) { setDir((d) => (d === 'desc' ? 'asc' : 'desc')); return cur; } setDir('desc'); return k; });
  }, []);

  // 탭 기여 분모·제외 방문은 utm_content 단위(같은 값을 쓰는 링크가 둘이면 한 번만)
  const uniqueRows = useMemo(() => {
    const seen = new Set<string>(); const out: ContentRow[] = [];
    for (const r of data?.rows ?? []) { if (seen.has(r.utmContent)) continue; seen.add(r.utmContent); out.push(r); }
    return out;
  }, [data]);
  const totalTaps = uniqueRows.reduce((s, r) => s + r.taps, 0);
  const totalArrivals = uniqueRows.reduce((s, r) => s + r.arrivals, 0);
  const totalClicks = uniqueRows.some((r) => r.clicks !== null) ? uniqueRows.reduce((s, r) => s + (r.clicks ?? 0), 0) : null;
  const totalViews = uniqueRows.some((r) => r.views !== null) ? uniqueRows.reduce((s, r) => s + (r.views ?? 0), 0) : null;

  const tableRows: TableRow[] = useMemo(() => {
    const base: TableRow[] = (data?.rows ?? []).map((r) => ({
      key: r.linkId, title: r.title, influencerHandle: r.influencerHandle, contentCount: 1,
      views: r.views, clicks: r.clicks, arrivals: r.arrivals, taps: r.taps, postedAt: r.postedAt,
      draftId: r.draftId, utmContent: r.utmContent, format: r.format, threadTotal: r.threadTotal, posts: r.posts, sharedUtmContent: r.sharedUtmContent,
    }));
    return sortRows(grouping === 'content' ? base : groupByInfluencer(base), sort, dir);
  }, [data, grouping, sort, dir]);

  const top3 = topShare(uniqueRows);
  const allCampaigns = data?.selected === ALL_CAMPAIGNS;
  const selected = data?.campaigns.find((c) => c.code === data.selected) ?? null;
  // 기간 라벨은 서버가 실제로 적용한 기간(data.range)으로 — custom인데 날짜가 반쪽이면 all로 돌아온다
  const applied = data?.range ?? 'all';
  const firstAt = allCampaigns
    ? [...(data?.campaigns ?? [])].map((c) => c.firstAt).sort()[0] ?? null
    : selected?.firstAt ?? null;
  const periodLabel = applied === 'custom' && data?.from && data?.to
    ? `${md(data.from)} ~ ${md(data.to)} · 서울 기준`
    : applied === 'all'
      ? `${firstAt ? md(kstDate(firstAt)) : ''} ~ ${md(kstToday())} · 서울 기준`
      : `${md(kstDaysAgo(applied === '7d' ? 6 : 29))} ~ ${md(kstToday())} · 서울 기준`;
  const customPending = range === 'custom' && applied !== 'custom';

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <h1 className="mb-1 text-[20px] font-bold">성과</h1>
      <p className="mb-4 text-caption text-x-muted">인플루언서·콘텐츠별로 랜딩 방문과 LINE 탭을 모아 봐요. 브릿지 페이지에서 바로 들어오는 기록이라 새로고침이 필요 없어요.</p>

      {data === null && !loadErr && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">성과를 불러오지 못했습니다</p>
          <Button onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      {data && !loadErr && data.campaigns.length === 0 && (
        <p className="py-8 text-center text-ui text-x-secondary">
          트래킹 링크를 만들면 그 링크로 들어온 랜딩 방문과 LINE 탭이 여기 모여요. <a href="/tracking?view=links" className="text-x-blue-text hover:underline">링크 만들기 →</a>
        </p>
      )}
      {data && !loadErr && data.campaigns.length > 0 && (<>
        {/* 필터 바 — 캠페인 select + 기간 세그먼트(library 보기 방식 세그먼트 규격) */}
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-x-border px-4 py-3">
          <select value={data.selected ?? ''} onChange={(e) => setParams({ campaign: e.target.value })} aria-label="캠페인"
                  className="rounded-lg border border-x-border-strong bg-white px-3 py-1.5 text-ui font-semibold">
            {/* 모든 캠페인 = 링크 전부 합산 — 캠페인끼리 비교하려면 여기서 본다(koo QA 08-26) */}
            <option value={ALL_CAMPAIGNS}>모든 캠페인</option>
            {data.campaigns.map((c) => <option key={c.code} value={c.code}>{c.code}{c.clientName ? ` · ${c.clientName}` : ''}</option>)}
          </select>
          <div role="group" aria-label="기간" className="flex h-7 w-fit overflow-hidden rounded-lg border border-x-border-strong">
            {RANGES.map(([v, label], i) => (
              <button key={v} onClick={() => setParams({ range: v })} aria-pressed={range === v && !customPending && applied === v}
                      className={`h-full px-3 text-[13px] ${i > 0 ? 'border-l border-x-border-strong' : ''} ${range === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* 직접 지정 — 둘 다 고르면 적용된다(반쪽이면 전체 기간 그대로, 힌트로 말한다). 날짜는 서울 기준 */}
          <label className={`flex items-center gap-1.5 text-ui ${range === 'custom' ? 'text-x-text' : 'text-x-secondary'}`}>
            직접 지정
            <input type="date" value={from ?? ''} max={to ?? undefined} aria-label="시작일"
                   onChange={(e) => setParams({ range: 'custom', from: e.target.value || null })}
                   className="rounded-lg border border-x-border-strong bg-white px-2 py-1 text-ui" />
            <span className="text-x-muted">~</span>
            <input type="date" value={to ?? ''} min={from ?? undefined} aria-label="종료일"
                   onChange={(e) => setParams({ range: 'custom', to: e.target.value || null })}
                   className="rounded-lg border border-x-border-strong bg-white px-2 py-1 text-ui" />
          </label>
          <span className="ml-auto text-ui text-x-muted">
            {customPending ? '시작일과 종료일을 모두 고르면 그 기간으로 바뀌어요 · 지금은 전체 기간' : periodLabel}
          </span>
        </div>

        <PerformanceCards taps={totalTaps} arrivals={totalArrivals} clicks={totalClicks} views={totalViews} top3={top3} />

        <div className="mb-2 mt-8 flex flex-wrap items-center gap-4">
          <span className="text-ui font-bold text-x-secondary">묶어 보기</span>
          <div role="group" aria-label="묶어 보기" className="flex h-7 w-fit overflow-hidden rounded-lg border border-x-border-strong">
            {([['content', '콘텐츠'], ['influencer', '인플루언서']] as const).map(([v, label], i) => (
              <button key={v} onClick={() => { setGrouping(v); setExpandedKey(null); }} aria-pressed={grouping === v}
                      className={`h-full px-3 text-[13px] ${i > 0 ? 'border-l border-x-border-strong' : ''} ${grouping === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-ui text-x-muted">{grouping === 'content' ? '콘텐츠 = 원고 하나 = 고유 링크 하나예요' : '같은 사람의 콘텐츠를 합쳐 보여요'}</span>
          <span className="ml-auto text-[12px] text-x-muted">정렬: {sort === 'tapRate' ? '탭률 — 방문이 적은 건 뒤로 보내요' : '헤더를 눌러 바꿀 수 있어요'}</span>
        </div>
        {/* 투명 표기(Fathom식): 무엇을 세지 않았는지, 조회·클릭이 어느 시점 값인지 한 줄 */}
        <p className="mb-2 text-ui text-x-muted">
          {data.rows.length > 0 && totalArrivals === 0 && '아직 들어온 방문이 없어요 — 브릿지가 연결되면 바로 채워져요 · '}
          프리페치·봇으로 보이는 방문 {formatFull(data.excluded)}건은 세지 않았어요
          {data.snapshotAt && ` · 조회·클릭은 마지막 새로고침(${kstDateTime(data.snapshotAt)}) 기준이라 기간과 무관해요`}
        </p>

        <PerformanceTable rows={tableRows} grouping={grouping} totalTaps={totalTaps} sort={sort} dir={dir} onSort={onSort}
                          expandedKey={expandedKey} onToggleExpand={(k) => setExpandedKey((cur) => (cur === k ? null : k))} />

        {/* 미연결 유입 — 버리지 않고 접힌 줄로(아는 만큼만 말한다) */}
        {data.unlinked.total > 0 && (
          <details className="mt-3 text-ui text-x-muted">
            <summary className="cursor-pointer" title="꼬리표 = 링크에 붙는 utm_content 값이에요. 생성기로 만든 링크와 맞지 않는 값이면 여기 모여요">
              링크와 연결되지 않은 랜딩 방문 {formatFull(data.unlinked.total)}건 — 꼬리표 없음 {formatFull(data.unlinked.byContent.find((b) => b.utmContent === null)?.arrivals ?? 0)} · 모르는 꼬리표 {formatFull(data.unlinked.byContent.filter((b) => b.utmContent !== null).reduce((s, b) => s + b.arrivals, 0))}
            </summary>
            <table className="mt-2 text-ui"><tbody>
              {data.unlinked.byContent.slice(0, 5).map((b) => (
                <tr key={b.utmContent ?? '(없음)'}><td className="pr-6 py-1">{b.utmContent !== null ? <code className="text-ui">{b.utmContent}</code> : '(꼬리표 없음)'}</td><td className="pr-6 text-right tabular-nums">도착 {formatFull(b.arrivals)}</td><td className="text-right tabular-nums">탭 {formatFull(b.taps)}</td></tr>
              ))}
              {data.unlinked.byContent.length > 5 && <tr><td colSpan={3} className="py-1 text-x-muted">그 외 {data.unlinked.byContent.length - 5}종</td></tr>}
            </tbody></table>
          </details>
        )}
      </>)}
    </main>
  );
}
