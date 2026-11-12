// 캠페인 현황 — 이번 주 주차 캠페인 전체를 한 화면에서 보고 들어갈 캠페인을 고르는 읽기 전용 화면. 스펙 2026-11-12
'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { addDays, formatDateKo } from '@/lib/campaignJudgment';
import { kstDateTime } from '@/lib/datetime';
import type { Overview } from '@/lib/campaignOverview';
import { OverviewTiles } from './OverviewTiles';
import { CampaignCard, METRIC_LABEL, type OverviewMetric } from './CampaignCard';

export default function CampaignOverviewPage() {
  // useSearchParams는 Suspense 경계 필수(influencers/performance 관례)
  return <Suspense><OverviewView /></Suspense>;
}

// '11/9 월' → '11/9 (월)' — 머리글의 주 범위·최종 업데이트 표기(시안)
function dayWithDow(date: string): string {
  const [md, dow] = formatDateKo(date).split(' ');
  return md && dow ? `${md} (${dow})` : '';
}
// 성과 최종 업데이트는 한국 시각으로 — '11/12 (목) 14:05'
function updatedLabel(iso: string): string {
  const kst = kstDateTime(iso);
  return kst ? `${dayWithDow(kst.slice(0, 10))} ${kst.slice(11, 16)}` : '';
}

const NAV_BTN = 'h-8 w-8 rounded-full border border-x-border-strong bg-white text-[16px] text-x-secondary disabled:opacity-40';

function OverviewView() {
  const sp = useSearchParams();
  // 주소가 첫 상태 — 이후 이동은 history.replaceState(router.replace는 서버 왕복으로 클릭이 멈춘다, 09-27 캠페인 목록 사례)
  const [week, setWeek] = useState<string | null>(() => sp.get('week'));
  const [data, setData] = useState<Overview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [metric, setMetric] = useState<OverviewMetric>('views');
  const [openId, setOpenId] = useState<string | null>(null);
  // 주를 빨리 넘기면 늦게 온 옛 주 응답이 새 주를 덮지 않게 마지막 요청만 받는다
  const reqSeq = useRef(0);

  const load = useCallback(async (w: string | null) => {
    const seq = ++reqSeq.current;
    try {
      const r = await apiFetch(`/api/campaigns/overview${w ? `?week=${encodeURIComponent(w)}` : ''}`);
      if (!r.ok) throw new Error(String(r.status));
      const body = (await r.json()) as Overview;
      if (seq !== reqSeq.current) return;
      setData(body);
      setLoadErr(false);
    } catch {
      if (seq !== reqSeq.current) return;
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    } finally {
      if (seq === reqSeq.current) setLoaded(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 주가 바뀔 때마다 1회 로드, setState는 전부 비동기 콜백(influencers/performance 관례)
  useEffect(() => { void load(week); }, [load, week]);
  const retry = () => { setLoaded(false); setLoadErr(false); void load(week); };

  // 주 이동 — 주소만 바꾸고(replaceState) 다시 불러온다. 연 패널은 다른 주의 캠페인이라 닫는다
  const goWeek = (weekStart: string) => {
    window.history.replaceState(null, '', `?week=${weekStart}`);
    setLoaded(false);
    setLoadErr(false);
    setOpenId(null);
    setWeek(weekStart);
  };

  const ready = loaded && !loadErr && data !== null;
  return (
    // @container — 카드 3열·2열과 수량 칸 4칸은 창이 아니라 본문 폭으로 정한다(사이드바 유무와 무관, 시안 .main)
    <main className="@container min-w-0 px-4 pb-7 pt-5 text-[15px] leading-[1.45] min-[901px]:px-7 min-[901px]:pb-9 min-[901px]:pt-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold">캠페인 현황</h1>
          {ready && data.perfUpdatedAt && (
            <div className="mt-1 text-[13px] text-x-muted">성과 최종 업데이트 {updatedLabel(data.perfUpdatedAt)}</div>
          )}
        </div>
        {ready && (
          <div className="flex items-center gap-2">
            <button type="button" className={NAV_BTN} aria-label="지난 주" onClick={() => goWeek(addDays(data.week.weekStart, -7))}>‹</button>
            <b>{data.weekName.replace(/월(?=\d)/, '월 ')}</b>
            <span className="text-x-secondary">{dayWithDow(data.week.weekStart)} ~ {dayWithDow(data.week.weekEnd)}</span>
            {/* 아직 오지 않은 주는 볼 게 없다 — 이번 주에서 멈춘다 */}
            <button type="button" className={NAV_BTN} aria-label="다음 주" disabled={data.week.isCurrent}
                    onClick={() => goWeek(addDays(data.week.weekStart, 7))}>›</button>
          </div>
        )}
      </div>

      {!loaded && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">캠페인 현황을 불러오지 못했어요</p>
          <Button onClick={retry}>다시 시도</Button>
        </div>
      )}
      {ready && (<>
        <OverviewTiles tiles={data.tiles} />

        <div className="mb-[14px] mt-10 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="mb-1 text-[17px] font-bold">주차 캠페인</h2>
            <div className="text-[13px] text-x-muted">계획 수량은 캠페인에 등록된 작업 수예요 (진행 안 됨 처리한 작업은 빼요). 조회수는 게시 후 14일까지 계속 늘어요.</div>
          </div>
          {/* 지표 전환은 모든 카드와 패널에 함께 걸린다 */}
          <div className="inline-flex overflow-hidden rounded-full border border-x-border-strong" role="group" aria-label="흐름 차트 지표">
            {(['views', 'bookmarks'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}
                      className={`cursor-pointer px-[14px] py-[6px] text-[13px] ${metric === m ? 'bg-x-text text-white' : 'bg-white text-x-secondary'}`}>
                {METRIC_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {data.cards.length === 0 ? (
          <div className="rounded-xl border border-x-border py-12 text-center text-ui text-x-secondary">이 주에 시작한 주차 캠페인이 없어요.</div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 @min-[560px]:grid-cols-2 @min-[880px]:grid-cols-3">
            {data.cards.map((c) => (
              <CampaignCard key={c.campaignId} card={c} metric={metric} open={openId === c.campaignId} onOpen={() => setOpenId(c.campaignId)} />
            ))}
          </div>
        )}

        {/* Task 6: 방문협찬(장기 캠페인) 표 LongCampaignTable(data.long)이 여기, 옆 패널 CampaignPanel(openId·metric)이 main 끝에 붙는다 */}
      </>)}
    </main>
  );
}
