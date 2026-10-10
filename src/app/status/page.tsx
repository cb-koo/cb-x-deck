// 클라이언트 현황 — 전체 보기. 주간 = 그 주차 결과로 캠페인 방향(유지·관찰·조정), 월간 = 그 달 결과로 큰 방향(확대·유지·축소·전환).
// 스펙 2026-10-09 §3 (기간 개정 10-10)
'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { DECISION_ORDER, DECISION_LABEL, type Decision } from '@/lib/clientStatus';
import type { StatusRow, PeriodInfo } from '@/lib/clientStatusStore';
import type { MonthStatusRow } from '@/lib/clientMonthStore';
import { StageChips } from './StageChips';
import { PeriodNav, setPeriodInUrl } from './PeriodNav';
import { Sparkline } from '@/components/charts/Sparkline';
import { Delta } from '@/components/charts/ChartCard';
import { NUM } from '@/components/charts/tokens';
import { DecisionChip, DirectionChip } from './DecisionChip';

type WeekData = { kind: 'week'; period: PeriodInfo; rows: StatusRow[]; unlinked: string[] };
type MonthData = { kind: 'month'; period: PeriodInfo; rows: MonthStatusRow[]; unlinked: string[] };
type Data = WeekData | MonthData;

// 한 줄 6칸(koo: 한 행 정보 6개 이하)
const COLS = 'minmax(110px,0.8fr) minmax(300px,2.4fr) 132px minmax(120px,0.8fr) minmax(190px,1.1fr) 92px';
const man = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${NUM.format(Math.round(n / 1e4))}만`);
const roasText = (v: number) => `${v >= 10 ? Math.round(v) : v === 0 ? 0 : v.toFixed(1)}배`;

export default function StatusOverviewPage() {
  // useSearchParams는 Suspense 경계 필수(influencers/page.tsx 관례)
  return <Suspense><Overview /></Suspense>;
}

function Overview() {
  const sp = useSearchParams();
  const [period, setPeriod] = useState<string | null>(() => sp.get('period'));
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/status${period ? `?period=${encodeURIComponent(period)}` : ''}`);
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as Data);
      setErr(false);
    } catch { setErr(true); }
  }, [period]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 기간이 바뀔 때마다 로드, setState는 전부 비동기 콜백(influencers/page.tsx 관례)
  useEffect(() => { load(); }, [load]);

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-8">
      <h1 className="mb-1 text-[20px] font-bold">클라이언트 현황</h1>
      <p className="mb-4 text-ui text-x-muted">
        주간은 주차 결과로 캠페인 방향을, 월간은 그 달 결과로 큰 방향을 정해요. 줄을 누르면 근거 차트와 기록 화면이 열려요.
      </p>
      {data && <div className="mb-4"><PeriodNav info={data.period} onChange={(p) => { setPeriodInUrl(p); setData(null); setPeriod(p); }} /></div>}

      {err && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">현황을 불러오지 못했어요</p>
          <button type="button" onClick={() => { setErr(false); void load(); }} className="text-ui text-x-blue-text hover:underline">다시 시도</button>
        </div>
      )}
      {!data && !err && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {data?.kind === 'week' && <WeekTable data={data} />}
      {data?.kind === 'month' && <MonthTable data={data} />}
      {data && data.unlinked.length > 0 && (
        <p className="mt-3 text-[13px] text-x-muted" title={data.unlinked.join(', ')}>
          그 밖의 {data.unlinked.length}곳은 LINE·예약 데이터가 연결되지 않아 여기 없어요 — 연결하려면 클라이언트 설정에서 리포트 코드를 넣어요.
        </p>
      )}
    </main>
  );
}

function Table({ head, children, empty }: { head: React.ReactNode; children: React.ReactNode; empty: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-x-border">
      <div className="min-w-[1080px]">
        <div className="grid items-center gap-4 border-b border-x-border bg-x-surface px-4 text-[13px] text-x-muted" style={{ gridTemplateColumns: COLS, height: 40 }}>{head}</div>
        {children}
        {empty && <p className="py-10 text-center text-ui text-x-secondary">LINE·예약 데이터가 연결된 클라이언트가 없어요</p>}
      </div>
    </div>
  );
}
const ROW = 'grid items-center gap-4 border-b border-x-border px-4 text-[15px] last:border-b-0 hover:bg-x-hover';

function WeekTable({ data }: { data: WeekData }) {
  // 손볼 곳이 위로 — 조정 검토 → 관찰 → 보류 → 유지
  const rows = useMemo(() => [...data.rows].sort((a, b) => DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision] || a.name.localeCompare(b.name, 'ko')), [data]);
  const open = rows.filter((r) => !r.confirmed).length;
  return (
    <>
      {rows.length > 0 && (
        <p className="mb-3 text-ui text-x-secondary">
          {data.period.inProgress ? '진행 중인 주차예요 — 숫자는 지금까지 쌓인 값이고, 판정은 주차가 끝난 뒤에 해요'
            : open === 0 ? '이 주차 판정을 모두 확정했어요' : `확정 안 한 클라이언트 ${open}곳 — 점선 칩은 규칙이 제안한 판정이에요`}
        </p>
      )}
      <Table empty={rows.length === 0} head={<>
        <span>클라이언트</span><span>판정 · 볼 곳</span><span>신규 인입 · 8주차</span><span>X 반응 · 이 주차</span><span>예약 · 매출 · 4주차</span><span title="클리닉 LINE 예약 매출 ÷ 우리 작업 비용">비용 대비 매출</span>
      </>}>
        {rows.map((r) => (
          <Link key={r.id} href={`/status/${r.id}?period=${data.period.param}`} className={ROW} style={{ gridTemplateColumns: COLS, minHeight: 56 }}>
            <span className="truncate font-semibold">{r.name}</span>
            <span className="flex min-w-0 items-center gap-2">
              <DecisionChip decision={r.decision} draft={!r.confirmed} />
              <StageChips checks={r.checks} max={1} />
              <span className="truncate text-[14px] text-x-secondary" title={r.memo || r.reason}>{r.memo || r.reason}</span>
            </span>
            <span className="flex items-center gap-2">
              <Sparkline values={r.newInflow8} band={r.band ?? undefined} width={80} height={28} />
              <b className="tabular-nums">{r.newInflowLast ?? '—'}명</b>
            </span>
            <span className="truncate tabular-nums">
              {r.postsLast === 0 ? <span className="text-x-muted">게시 없음</span> : <>북마크 <b>{NUM.format(r.bookmarksLast)}</b> <span className="text-x-muted">· 글 {r.postsLast}</span></>}
            </span>
            <span className="flex items-baseline gap-1.5 whitespace-nowrap tabular-nums" title={`직전 4주차 예약 ${r.reserversPrev4}명 · 매출 ${man(r.revenuePrev4)}원`}>
              <b>{r.reservers4}명</b><span className="text-x-muted">·</span><b>{man(r.revenue4)}</b>
              <Delta diff={Math.round((r.revenue4 - r.revenuePrev4) / 1e4)} unit="만" good="up" base={`직전 4주차 ${man(r.revenuePrev4)}원`} size={13} />
            </span>
            <span className="tabular-nums">{r.roas4 === null ? <span className="text-x-muted" title="최근 4주차 작업 비용이 없어요">—</span> : <b className={r.roas4 < 1 ? 'text-red-600' : ''}>{roasText(r.roas4)}</b>}</span>
          </Link>
        ))}
      </Table>
    </>
  );
}

const VERDICT_KEYS: Decision[] = ['keep', 'watch', 'adjust', 'hold'];
function MonthTable({ data }: { data: MonthData }) {
  const rows = useMemo(() => [...data.rows].sort((a, b) => Number(!!a.direction) - Number(!!b.direction) || a.name.localeCompare(b.name, 'ko')), [data]);
  const open = rows.filter((r) => !r.direction).length;
  return (
    <>
      {rows.length > 0 && (
        <p className="mb-3 text-ui text-x-secondary">
          {data.period.inProgress ? '진행 중인 달이에요 — 숫자는 지금까지 쌓인 값(사람 수는 일별 합산이라 근사)이고, 방향은 달이 끝난 뒤에 기록해요'
            : open === 0 ? '이 달 방향을 모두 기록했어요' : `방향을 기록 안 한 클라이언트 ${open}곳`}
        </p>
      )}
      <Table empty={rows.length === 0} head={<>
        <span>클라이언트</span><span>월 방향 · 주차 판정</span><span>신규 인입 · 전월 대비</span><span>X 반응 · 이 달</span><span>예약 매출 · 전월 대비</span><span title="클리닉 LINE 예약 매출 ÷ 우리 작업 비용">비용 대비 매출</span>
      </>}>
        {rows.map((r) => (
          <Link key={r.id} href={`/status/${r.id}?period=${data.period.param}`} className={ROW} style={{ gridTemplateColumns: COLS, minHeight: 56 }}>
            <span className="truncate font-semibold">{r.name}</span>
            <span className="flex min-w-0 items-center gap-2">
              {r.direction ? <DirectionChip direction={r.direction} /> : <span className="rounded-full border border-dashed border-x-border-strong px-2.5 py-0.5 text-[13px] text-x-muted">미정</span>}
              <span className="truncate text-[14px] text-x-secondary" title={r.memo}>
                {VERDICT_KEYS.filter((k) => r.weekVerdicts[k]).map((k) => `${DECISION_LABEL[k]} ${r.weekVerdicts[k]}`).join(' · ') || `주차 판정 0/${r.weeksTotal}`}
                {r.memo ? ` — ${r.memo}` : ''}
              </span>
            </span>
            <span className="flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
              <b>{r.newInflow ?? '—'}명</b>
              {r.newInflow !== null && r.newInflowPrev !== null && <Delta diff={r.newInflow - r.newInflowPrev} unit="명" good="up" base={`전월 ${r.newInflowPrev}명`} size={13} />}
            </span>
            <span className="truncate tabular-nums">
              {r.postCount === 0 ? <span className="text-x-muted">게시 없음</span> : <>북마크 <b>{NUM.format(r.bookmarks)}</b> <span className="text-x-muted">· 글 {r.postCount}</span></>}
            </span>
            <span className="flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
              <b>{r.revenue === null ? '—' : man(r.revenue)}</b>
              {r.revenue !== null && r.revenuePrev !== null && <Delta diff={Math.round((r.revenue - r.revenuePrev) / 1e4)} unit="만" good="up" base={`전월 ${man(r.revenuePrev)}원`} size={13} />}
            </span>
            <span className="tabular-nums">{r.roas === null ? <span className="text-x-muted" title="이 달 작업 비용이 없어요">—</span> : <b className={r.roas < 1 ? 'text-red-600' : ''}>{roasText(r.roas)}</b>}</span>
          </Link>
        ))}
      </Table>
    </>
  );
}
