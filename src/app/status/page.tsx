// 클라이언트 현황 — 전체 보기. 지난주 결과로 클라이언트마다 캠페인 방향(유지·관찰·조정)을 정하는 출발점. 스펙 2026-10-09 §3
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { DECISION_ORDER, mdLabel } from '@/lib/clientStatus';
import { StageChips } from './StageChips';
import type { StatusRow } from '@/lib/clientStatusStore';
import { Sparkline } from '@/components/charts/Sparkline';
import { Delta } from '@/components/charts/ChartCard';
import { NUM } from '@/components/charts/tokens';
import { DecisionChip } from './DecisionChip';

type Data = { baseWeek: { start: string; end: string }; rows: StatusRow[]; unlinked: string[] };

// 한 줄 6칸(koo: 한 행 정보 6개 이하) — 판정 칸에 칩·구간 점검·이유를 함께, 예약·매출은 한 칸에
const COLS = 'minmax(110px,0.8fr) minmax(300px,2.4fr) 132px minmax(120px,0.8fr) minmax(190px,1.1fr) 92px';
const man = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${NUM.format(Math.round(n / 1e4))}만`);

export default function StatusOverviewPage() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/status');
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as Data);
      setErr(false);
    } catch { setErr(true); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(influencers/page.tsx 관례)
  useEffect(() => { load(); }, [load]);

  // 손볼 곳이 위로 — 조정 검토 → 관찰 → 보류 → 유지
  const rows = useMemo(() => [...(data?.rows ?? [])].sort((a, b) => DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision] || a.name.localeCompare(b.name, 'ko')), [data]);
  const open = rows.filter((r) => !r.confirmed).length;

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-8">
      <h1 className="mb-1 text-[20px] font-bold">클라이언트 현황</h1>
      <p className="mb-5 text-ui text-x-muted">
        {data ? `${mdLabel(data.baseWeek.start)}~${mdLabel(data.baseWeek.end)} 결과로 ` : ''}클라이언트마다 이번 주 캠페인 방향을 정해요. 줄을 누르면 근거 차트와 판정 확정 화면이 열려요.
      </p>

      {err && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">현황을 불러오지 못했어요</p>
          <button type="button" onClick={() => { setErr(false); void load(); }} className="text-ui text-x-blue-text hover:underline">다시 시도</button>
        </div>
      )}
      {!data && !err && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}

      {data && (
        <>
          {rows.length > 0 && (
            <p className="mb-3 text-ui text-x-secondary">
              {open === 0 ? '이번 주 판정을 모두 확정했어요' : `확정 안 한 클라이언트 ${open}곳 — 점선 칩은 규칙이 제안한 판정이에요`}
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-x-border">
            <div className="min-w-[1080px]">
              <div className="grid items-center gap-4 border-b border-x-border bg-x-surface px-4 text-[13px] text-x-muted" style={{ gridTemplateColumns: COLS, height: 40 }}>
                <span>클라이언트</span><span>판정 · 볼 곳</span><span>신규 인입 · 8주</span><span>X 반응 · 지난주</span><span>예약 · 매출 · 4주</span><span title="클리닉 LINE 예약 매출 ÷ 우리 작업 비용">비용 대비 매출</span>
              </div>
              {rows.map((r) => (
                <Link key={r.id} href={`/status/${r.id}`} className="grid items-center gap-4 border-b border-x-border px-4 text-[15px] last:border-b-0 hover:bg-x-hover"
                  style={{ gridTemplateColumns: COLS, minHeight: 56 }}>
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
                  <span className="flex items-baseline gap-1.5 whitespace-nowrap tabular-nums" title={`직전 4주 예약 ${r.reserversPrev4}명 · 매출 ${man(r.revenuePrev4)}원`}>
                    <b>{r.reservers4}명</b><span className="text-x-muted">·</span><b>{man(r.revenue4)}</b>
                    <Delta diff={Math.round((r.revenue4 - r.revenuePrev4) / 1e4)} unit="만" good="up" base={`직전 4주 ${man(r.revenuePrev4)}원`} size={13} />
                  </span>
                  <span className="tabular-nums">{r.roas4 === null ? <span className="text-x-muted" title="최근 4주 작업 비용이 없어요">—</span> : <b className={r.roas4 < 1 ? 'text-red-600' : ''}>{r.roas4 >= 10 ? Math.round(r.roas4) : r.roas4 === 0 ? 0 : r.roas4.toFixed(1)}배</b>}</span>
                </Link>
              ))}
              {rows.length === 0 && <p className="py-10 text-center text-ui text-x-secondary">LINE·예약 데이터가 연결된 클라이언트가 없어요</p>}
            </div>
          </div>
          {data.unlinked.length > 0 && (
            <p className="mt-3 text-[13px] text-x-muted" title={data.unlinked.join(', ')}>
              그 밖의 {data.unlinked.length}곳은 LINE·예약 데이터가 연결되지 않아 여기 없어요 — 연결하려면 클라이언트 설정에서 리포트 코드를 넣어요.
            </p>
          )}
        </>
      )}
    </main>
  );
}
