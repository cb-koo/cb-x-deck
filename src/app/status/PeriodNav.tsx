'use client';
// 보고 기간 선택기 — ‹ 10월 1주차 · 10/1~10/4 · 4일 ›. 진행 중인 기간은 표시만 하고 판정하지 않는다(서버가 막음).
// 고른 기간은 주소(?period=)에 남긴다 — router 대신 history.replaceState(서버 왕복 없이 즉시, 09-27 캠페인 목록 교훈).
import type { PeriodInfo } from '@/lib/clientStatusStore';
import { mdLabel } from '@/lib/clientStatus';

export function setPeriodInUrl(param: string) {
  const u = new URL(window.location.href);
  u.searchParams.set('period', param);
  window.history.replaceState(null, '', u.pathname + u.search);
}

export function PeriodNav({ info, onChange, latestParam }: { info: PeriodInfo; onChange: (param: string) => void; latestParam?: string }) {
  const btn = 'h-8 w-8 rounded-full text-[18px] text-x-secondary hover:bg-x-text/5 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} aria-label="이전 기간" onClick={() => onChange(info.prevParam)}>‹</button>
      <span className="text-[17px] font-bold">{info.label}</span>
      <span className="text-[14px] tabular-nums text-x-secondary">{mdLabel(info.start)}~{mdLabel(info.end)} · {info.days}일</span>
      {info.inProgress && <span className="rounded-full bg-[#fff4e0] px-2 py-0.5 text-[12px] font-semibold text-[#a15c00]">진행 중</span>}
      <button type="button" className={btn} aria-label="다음 기간" disabled={!info.nextParam} onClick={() => info.nextParam && onChange(info.nextParam)}>›</button>
      {latestParam && latestParam !== info.param && (
        <button type="button" onClick={() => onChange(latestParam)} className="text-[13px] text-x-blue-text hover:underline">최근 끝난 주차로</button>
      )}
    </div>
  );
}
