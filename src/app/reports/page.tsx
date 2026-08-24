'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow } from '@/lib/clientStore';
import type { ReportResponse, ReportUnit } from '@/lib/reportApi';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- inclusiveDays는 Task 10의 ReportTrends periodDays 계산용(주석 처리된 렌더에서 소비 예정)
import { addDays, inclusiveDays, isCalendarMonth, type SeriesPoint } from '@/lib/reportSeries';
import { kstToday } from '@/lib/datetime';
import { ReportControls, type ReportQuery } from '@/components/ReportControls';
import { ReportSummary } from '@/components/ReportSummary';
// import { ReportTrends } from '@/components/ReportTrends'; // Task 10에서 생성 — 그 전까지는 주석 처리

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- series는 Task 10의 ReportTrends가 소비 예정(요약과 함께 미리 받아둠, load() 참고)
  const [series, setSeries] = useState<{ unit: ReportUnit; points: SeriesPoint[] } | null>(null);

  useEffect(() => {
    apiFetch('/api/clients').then(async (r) => {
      const all = (await r.json()) as ClientRow[];
      const linked = all.filter((c) => c.clinicCode);
      setClients(linked);
      setQ((prev) => ({ ...prev, clientId: linked[0]?.id ?? '' }));
    }).catch(() => setClients([]));
  }, []);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const base = `clientId=${q.clientId}&start=${q.start}&end=${q.end}`;
      const [sr, tr] = await Promise.all([
        apiFetch(`/api/reports/summary?${base}`),
        apiFetch(`/api/reports/series?${base}&unit=${q.unit}`),
      ]);
      if (!sr.ok || !tr.ok) {
        const bad = !sr.ok ? sr : tr;
        setError(((await bad.json()) as { error?: string }).error ?? '리포트를 불러오지 못했어요');
        setReport(null); setSeries(null);
      } else {
        setReport(((await sr.json()) as { report: ReportResponse }).report);
        setSeries(await tr.json());
      }
    } catch { setError('리포트를 불러오지 못했어요 — 잠시 후 다시 시도해 주세요'); }
    setLoading(false);
  };

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
      <p className="mt-1 text-caption text-x-muted">클리닉과 기간을 고르고 불러오면, 마케팅 성과를 요약·구성·흐름 순서로 보여드려요</p>
      <ReportControls clients={clients} value={q} onChange={setQ} onLoad={load} loading={loading} />
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      {report && <ReportSummary report={report} isCalendarMonth={calMonth} />}
      {/* Task 10: <ReportTrends unit={series.unit} points={series.points} periodDays={inclusiveDays(q.start, q.end)} /> — 아직 미구현 */}
    </main>
  );
}
