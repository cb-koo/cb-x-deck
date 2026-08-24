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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [series, setSeries] = useState<{ unit: ReportUnit; points: SeriesPoint[] } | null>(null);
  // 마지막으로 발동된 요청의 순번 — 이후 응답 중 이 값과 다른 것(먼저 시작했지만 늦게 도착한 응답)은 버린다.
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
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const base = `clientId=${q.clientId}&start=${q.start}&end=${q.end}`;
        const [sr, tr] = await Promise.all([
          apiFetch(`/api/reports/summary?${base}`),
          apiFetch(`/api/reports/series?${base}&unit=${q.unit}`),
        ]);
        if (seq !== seqRef.current) return; // 그 사이 더 최신 요청이 발동됨 — 이 응답은 버린다
        if (!sr.ok || !tr.ok) {
          const bad = !sr.ok ? sr : tr;
          setError(((await bad.json()) as { error?: string }).error ?? '리포트를 불러오지 못했어요');
          setReport(null); setSeries(null);
        } else {
          setReport(((await sr.json()) as { report: ReportResponse }).report);
          setSeries(await tr.json());
        }
      } catch {
        if (seq !== seqRef.current) return;
        setError('리포트를 불러오지 못했어요 — 잠시 후 다시 시도해 주세요');
      }
      if (seq === seqRef.current) setLoading(false);
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
      <ReportControls clients={clients} value={q} onChange={setQ} loading={loading} />
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      {report && <ReportSummary report={report} isCalendarMonth={calMonth} />}
      {series && <ReportTrends unit={series.unit} points={series.points} />}
    </main>
  );
}
