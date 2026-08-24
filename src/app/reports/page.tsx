'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow } from '@/lib/clientStore';
import type { ReportResponse, ReportUnit } from '@/lib/reportApi';
import { addDays, bucketRanges, isCalendarMonth, type SeriesPoint } from '@/lib/reportSeries';
import { kstToday } from '@/lib/datetime';
import { ReportControls, type ReportQuery } from '@/components/ReportControls';
import { ReportSummary } from '@/components/ReportSummary';
import { ReportTrends } from '@/components/ReportTrends';

function lastMonthRange(): { start: string; end: string } {
  const thisMonthFirst = kstToday().slice(0, 8) + '01';
  const end = addDays(thisMonthFirst, -1); // 지난달 말일
  return { start: end.slice(0, 8) + '01', end };
}

export default function ReportsPage() {
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [q, setQ] = useState<ReportQuery>(() => ({ clientId: '', ...lastMonthRange(), unit: 'day' }));
  // 요약(외부 API, ~7초)과 흐름(DB, 빠름)을 독립 요청으로 분리 — 흐름이 먼저 도착하면 바로 렌더하고,
  // 요약은 스켈레톤을 보여준 채 따로 기다린다(체감 로딩 단축). 오류도 층별로 따로 표시.
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  // 캐시 응답이면 "몇 분 전 조회"인지 — 응답을 받은 시점에 한 번 계산해 둔다(렌더 중 Date.now() 호출 금지: 순수성 규칙).
  const [cachedMinutesAgo, setCachedMinutesAgo] = useState<number | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [series, setSeries] = useState<{ unit: ReportUnit; points: SeriesPoint[] } | null>(null);
  // 마지막으로 발동된 요청의 순번 — 이후 응답 중 이 값과 다른 것(먼저 시작했지만 늦게 도착한 응답)은 버린다.
  // 요약·흐름 각자 이 값과 비교해 레이스 가드를 독립적으로 적용한다.
  const seqRef = useRef(0);

  useEffect(() => {
    apiFetch('/api/clients').then(async (r) => {
      // /api/clients는 {client, procedures}[] 형태 — client만 뽑는다
      const all = (await r.json()) as Array<{ client: ClientRow }>;
      const linked = all.map((x) => x.client).filter((c) => c.clinicCode);
      setClients(linked);
      setQ((prev) => ({ ...prev, clientId: linked[0]?.id ?? '' }));
    }).catch(() => setClients([]));
  }, []);

  const buckets = q.start <= q.end ? bucketRanges(q.start, q.end, q.unit).length : 0;
  const validQuery = !!q.clientId && q.start <= q.end && buckets > 0 && buckets <= 120;

  // 선택이 바뀌면(클라이언트·기간·단위) 400ms 디바운스 후 자동 조회 — 첫 진입(클라이언트 목록 로드 직후)도 포함.
  // 유효하지 않은 조합(기간 역전·버킷 초과)은 조회하지 않고 ReportControls의 오류 안내만 남긴다.
  useEffect(() => {
    if (!validQuery) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      const base = `clientId=${q.clientId}&start=${q.start}&end=${q.end}`;

      // ③ 흐름 — DB 조회라 빠르다. 독립적으로 도착하는 대로 즉시 렌더.
      setSeriesLoading(true); setSeriesError(null);
      (async () => {
        try {
          const tr = await apiFetch(`/api/reports/series?${base}&unit=${q.unit}`);
          if (seq !== seqRef.current) return;
          if (!tr.ok) {
            setSeriesError(((await tr.json()) as { error?: string }).error ?? '흐름 데이터를 불러오지 못했어요');
            setSeries(null);
          } else {
            setSeries(await tr.json());
          }
        } catch {
          if (seq !== seqRef.current) return;
          setSeriesError('흐름 데이터를 불러오지 못했어요 — 잠시 후 다시 시도해 주세요');
        }
        if (seq === seqRef.current) setSeriesLoading(false);
      })();

      // ① 요약 — 외부 API 호출이라 ~7초 걸릴 수 있다. 도착 전엔 스켈레톤을 보여준다.
      setSummaryLoading(true); setSummaryError(null);
      (async () => {
        try {
          const sr = await apiFetch(`/api/reports/summary?${base}`);
          if (seq !== seqRef.current) return;
          if (!sr.ok) {
            setSummaryError(((await sr.json()) as { error?: string }).error ?? '요약을 불러오지 못했어요');
            setReport(null); setCachedMinutesAgo(null);
          } else {
            const body = (await sr.json()) as { report: ReportResponse; cachedAt?: string };
            setReport(body.report);
            setCachedMinutesAgo(body.cachedAt ? Math.max(0, Math.round((Date.now() - new Date(body.cachedAt).getTime()) / 60000)) : null);
          }
        } catch {
          if (seq !== seqRef.current) return;
          setSummaryError('요약을 불러오지 못했어요 — 잠시 후 다시 시도해 주세요');
        }
        if (seq === seqRef.current) setSummaryLoading(false);
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [validQuery, q.clientId, q.start, q.end, q.unit]);

  const calMonth = useMemo(() => isCalendarMonth(q.start, q.end), [q.start, q.end]);

  if (clients === null) return <main className="p-6 text-x-secondary">불러오는 중…</main>;
  if (clients.length === 0) return (
    <main className="p-6">
      <h1 className="text-xl font-bold">리포트</h1>
      <p className="mt-3 text-x-secondary">아직 리포트가 연결된 클라이언트가 없어요 —
        <a href="/clients" className="text-x-blue-text underline"> 클라이언트 페이지</a>에서 &quot;월간 리포트 연결&quot;을 설정해 주세요.</p>
    </main>
  );
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-bold">리포트</h1>
      <p className="mt-1 text-caption text-x-muted">클리닉과 기간을 고르면 바로 보여드려요 — 마케팅 성과를 요약·구성·흐름 순서로</p>
      <ReportControls clients={clients} value={q} onChange={setQ} loading={summaryLoading || seriesLoading} />

      {summaryError && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{summaryError}</p>}
      {report ? <ReportSummary report={report} isCalendarMonth={calMonth} cachedMinutesAgo={cachedMinutesAgo} />
        : summaryLoading ? <SummarySkeleton /> : null}

      {seriesError && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{seriesError}</p>}
      {series && <ReportTrends unit={series.unit} points={series.points} />}
    </main>
  );
}

// 요약 층 자리 채우개 — 외부 API(~7초) 응답을 기다리는 동안 차트(③ 흐름)는 이미 보이는 상태를 유지한다.
function SummarySkeleton() {
  return (
    <section className="mt-6" aria-label="기간 요약 불러오는 중">
      <h2 className="text-base font-bold">① 기간 요약</h2>
      <p className="mt-1 text-caption text-x-muted">외부 리포트에서 불러오는 중… (몇 초 걸려요)</p>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[72px] animate-pulse rounded-lg border border-x-border bg-x-hover" />
        ))}
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border border-x-border bg-x-hover" />
        ))}
      </div>
    </section>
  );
}
