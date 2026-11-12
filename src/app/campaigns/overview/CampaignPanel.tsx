// 캠페인 현황 — 게시물별 지표 옆 패널(스펙 §4-4, 시안 drawer()).
// 숫자는 card 그대로 — 줄 순서도 buildOverview가 정했다(조회수 많은 순, 밀린 것 먼저). 여기서 다시 정렬·계산하지 않는다.
'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { formatCpv, type OverviewCard, type PostedRow, type OpenRow } from '@/lib/campaignOverview';
import { formatDateKo } from '@/lib/campaignJudgment';
import { CumulativeArea } from '@/components/charts/CumulativeArea';
import { compact, NUM } from '@/components/charts/tokens';
import { campaignWeekBand, chartLabels, metricChart, METRIC_LABEL, type OverviewMetric } from './CampaignCard';

// 시안 .ph / .phs / .drawer th / .drawer td
const PH = 'mb-[2px] mt-6 text-[15px] font-bold';
const PH_FIRST = 'mb-[2px] text-[15px] font-bold'; // 첫 제목은 위 여백 0(시안 style="margin-top:0")
const PHS = 'mb-[6px] text-[13px] text-x-muted';
const TH = 'whitespace-nowrap border-b border-x-border-strong p-2 text-left text-[12px] font-medium text-x-secondary';
const TD = 'h-[46px] whitespace-nowrap border-b border-x-border px-2 py-0 text-[14px]';
const NUMTD = `${TD} text-right tabular-nums`;
const DIM = 'text-x-muted';

// 값이 없으면 흐린 '-'(시안 td.r.dim)
function NumCell({ v }: { v: string | null }) {
  return <td className={`${NUMTD} ${v === null ? DIM : ''}`}>{v ?? '-'}</td>;
}

const handleOf = (h: string | null): string | null => (h ? `@${h}` : null);

function PostedTableRow({ r }: { r: PostedRow }) {
  const who = handleOf(r.handle) ?? '-';
  const cells = (
    <>
      <td className={TD}>{r.url
        // 키보드로도 열 수 있게 첫 칸은 진짜 링크 — 줄 클릭과 겹쳐 두 번 열리지 않게 전파를 막는다
        ? <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-inherit no-underline">{who}</a>
        : who}</td>
      <td className={TD}>{r.typeLabel}</td>
      <td className={TD}>{formatDateKo(r.postedOn.slice(0, 10))}</td>
      <NumCell v={r.views === null ? null : NUM.format(r.views)} />
      <NumCell v={r.bookmarks === null ? null : NUM.format(r.bookmarks)} />
      <NumCell v={r.likes === null ? null : NUM.format(r.likes)} />
      <NumCell v={r.cpvKrw === null ? null : `${r.cpvKrw.toFixed(1)}원`} />
    </>
  );
  // 링크가 있는 줄만 누를 수 있다 — 없는 줄에 손가락·hover를 주면 거짓 어포던스
  if (!r.url) return <tr>{cells}</tr>;
  const url = r.url;
  return (
    <tr className="cursor-pointer [&:hover>td]:bg-x-surface" onClick={() => window.open(url, '_blank', 'noreferrer')}>
      {cells}
    </tr>
  );
}

function OpenTableRow({ r }: { r: OpenRow }) {
  const who = handleOf(r.handle);
  const date = r.scheduledOn === null ? null : formatDateKo(r.scheduledOn);
  return (
    <tr>
      <td className={`${TD} ${who ? '' : DIM}`}>{who ?? '미정'}</td>
      <td className={TD}>{r.typeLabel}</td>
      {date === null
        ? <td className={`${TD} ${DIM}`}>미정</td>
        : r.overdueDays !== null
          ? <td className={`${TD} font-semibold text-[#b45309]`}>{date} ({r.overdueDays}일 지남)</td>
          : <td className={TD}>{date}</td>}
    </tr>
  );
}

// 비용 15만원 — 만원 단위, 소수는 한 자리까지
const manwon = (krw: number): string => `${NUM.format(Math.round(krw / 1000) / 10)}만원`;

export function CampaignPanel({ card, weekLabel, metric, onClose }: { card: OverviewCard; weekLabel: string; metric: OverviewMetric; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // 열리면 닫기 버튼으로, 닫히면 연 버튼(카드의 '게시물별 지표 보기')으로 초점을 돌려준다
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  useEffect(() => {
    // 한글 입력 조합 중 Esc는 조합 취소일 뿐 — 패널을 닫지 않는다(CancelDialog 관례)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 패널이 열린 동안 뒤 화면이 같이 스크롤되지 않게 — 이 화면은 body가 아니라 GlobalShell의 overflow-y-auto 칸이
  // 스크롤되므로, 패널 위쪽의 스크롤 칸을 전부 찾아 잠그고 닫을 때 원래 값으로 돌린다
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const locked: Array<[HTMLElement, string]> = [];
    for (let el = dialogRef.current?.parentElement ?? null; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY;
      if (el === document.body || oy === 'auto' || oy === 'scroll') {
        locked.push([el, el.style.overflowY]);
        el.style.overflowY = 'hidden';
      }
    }
    return () => { for (const [el, prev] of locked) el.style.overflowY = prev; };
  }, []);

  const q = card.quantity, p = card.perf;
  const mc = metricChart(card, metric);
  const kpis = [
    { l: '조회수', v: p.views.value === null ? '-' : compact(p.views.value), d: null },
    { l: '저장수', v: p.bookmarks.value === null ? '-' : NUM.format(p.bookmarks.value), d: null },
    { l: 'CPV', v: formatCpv(p.cpv), d: p.spentKrw > 0 ? `비용 ${manwon(p.spentKrw)}` : null },
  ];

  return (
    <>
      {/* 바깥을 누르면 닫힌다(시안 .shade) */}
      <div className="fixed inset-0 z-40 bg-[rgba(15,20,25,.28)]" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`${card.title} 게시물별 지표`}
           className="fixed bottom-0 right-0 top-0 z-50 w-[min(600px,100%)] overflow-y-auto border-l border-x-border-strong bg-white px-[26px] py-6 text-[15px] leading-[1.45] text-x-text shadow-[-8px_0_24px_rgba(15,20,25,.12)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[19px] font-bold">{card.title}</div>
            <div className="mt-[2px] text-[13px] text-x-muted">{weekLabel}, 게시 {q.posted} / {q.planned}건</div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="닫기"
                  className="h-[34px] w-[34px] flex-none cursor-pointer rounded-full border-0 bg-x-surface text-[16px] text-x-secondary">✕</button>
        </div>

        <div className="mb-[22px] mt-[18px] grid grid-cols-3 gap-[10px]">
          {kpis.map((k) => (
            <div key={k.l} className="rounded-[10px] bg-x-surface px-[14px] py-3">
              <div className="text-[13px] text-x-secondary">{k.l}</div>
              <div className="text-[22px] font-bold">{k.v}</div>
              {k.d && <div className="text-[12px] text-x-muted">{k.d}</div>}
            </div>
          ))}
        </div>

        <div className={PH_FIRST}>날짜별 누적 {METRIC_LABEL[metric]}</div>
        {mc ? (
          <CumulativeArea labels={chartLabels(mc.chart.days)} values={mc.series} todayIndex={mc.chart.todayIndex} height={220}
                          marks={mc.chart.postedPerDay.map((n) => (n > 0 ? `게시 ${n}건` : null))}
                          band={campaignWeekBand(mc.chart.days)} ariaLabel={`날짜별 누적 ${METRIC_LABEL[metric]}`} />
        ) : (
          // 카드와 같은 빈 상태(metricChart — 차트가 없거나 이 지표 숫자가 '-')
          <div className={PHS}>게시되면 여기에 성과 흐름이 나와요.</div>
        )}

        <div className={PH}>게시된 작업 {card.posted.length}건</div>
        {card.posted.length > 0 ? (<>
          <div className={PHS}>조회수가 많은 순서예요. 줄을 누르면 X 게시물이 새 창으로 열려요.</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={TH}>인플루언서</th><th className={TH}>작업 내용</th><th className={TH}>게시일</th>
                <th className={`${TH} text-right`}>조회수</th><th className={`${TH} text-right`}>저장수</th>
                <th className={`${TH} text-right`}>좋아요</th><th className={`${TH} text-right`}>CPV</th>
              </tr></thead>
              <tbody>{card.posted.map((r) => <PostedTableRow key={r.taskId} r={r} />)}</tbody>
            </table>
          </div>
        </>) : (
          <div className={PHS}>아직 게시된 작업이 없어요.</div>
        )}

        {/* 남은 작업이 없으면 구역째 숨긴다 */}
        {card.open.length > 0 && (<>
          <div className={PH}>게시 전 작업 {card.open.length}건</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={TH}>인플루언서</th><th className={TH}>작업 내용</th><th className={TH}>게시 예정일</th>
              </tr></thead>
              <tbody>{card.open.map((r) => <OpenTableRow key={r.taskId} r={r} />)}</tbody>
            </table>
          </div>
        </>)}

        <div className="mt-6 flex justify-end">
          <Link href={`/campaigns/flow?id=${card.campaignId}`} className="text-[14px] font-semibold text-x-blue-text no-underline">
            {card.title} 캠페인 열기 →
          </Link>
        </div>
      </div>
    </>
  );
}
