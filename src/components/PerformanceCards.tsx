// src/components/PerformanceCards.tsx
'use client';
import { formatFull } from '@/lib/format';
import { formatPct, rate } from '@/lib/performanceJudgment';

// 결정 카드 4 — 숫자만 던지지 않고 판단 한 줄을 붙인다(UX 원칙 3). 넷째는 결정 문장 카드.
export function PerformanceCards({ taps, arrivals, clicks, views, top3 }: {
  taps: number; arrivals: number; clicks: number | null; views: number | null;
  top3: { share: number | null; titles: string[] };
}) {
  const tapRate = rate(taps, arrivals);
  const arrivalRate = rate(arrivals, clicks);
  const clickRate = rate(clicks, views);
  const card = 'flex flex-col gap-1.5 rounded-xl border border-x-border px-5 py-4';
  return (
    // 순서 = 사용자 흐름: 조회 → 도착 → 탭 → 결정(koo QA 08-26). 넷째 카드의 라벨은 값이 없어도 바뀌지 않는다 — 라벨이 바뀌면 카드가 무엇인지 잃는다
    <div className="grid grid-cols-4 gap-4">
      <div className={card}>
        <span className="text-[26px] font-extrabold tabular-nums">{views === null ? '—' : formatFull(views)}</span>
        <span className="text-ui font-semibold text-x-secondary">콘텐츠 조회</span>
        <span className="text-[12px] text-x-muted">본문 트윗 기준{clickRate !== null && ` · 클릭률 ${formatPct(clickRate, 1)}`}</span>
        <span className="text-caption text-x-muted">마지막 새로고침 기준</span>
      </div>
      <div className={card}>
        <span className="text-[26px] font-extrabold tabular-nums">{formatFull(arrivals)}</span>
        <span className="text-ui font-semibold text-x-secondary">랜딩 도착(사람)</span>
        <span className="text-[12px] text-x-muted">{arrivalRate === null ? '링크 클릭은 새로고침 후 보여요' : `링크 클릭 ${formatFull(clicks)} 중 ${formatPct(arrivalRate)}가 페이지까지 왔어요`}</span>
      </div>
      <div className={card}>
        <span className="text-[26px] font-extrabold tabular-nums">{formatFull(taps)}</span>
        <span className="text-ui font-semibold text-x-secondary">LINE 탭</span>
        <span className="text-[12px] text-x-muted">{tapRate === null ? '아직 도착이 없어요' : `도착 100명 중 ${Math.round(tapRate * 100)}명이 눌렀어요`}</span>
      </div>
      <div className={`${card} border-l-[3px] border-l-x-blue bg-[#f3f9fd]`}>
        <span className="text-[26px] font-extrabold tabular-nums text-x-blue-text">{top3.share === null ? '—' : formatPct(top3.share)}</span>
        <span className="text-ui font-semibold text-x-secondary">탭 상위 {top3.titles.length || 3}개 콘텐츠의 탭 비중</span>
        <span className="text-[12px] text-x-muted">{top3.titles.length ? top3.titles.join(' · ') : '탭이 들어오면 어떤 콘텐츠가 만들었는지 여기 보여요'}</span>
      </div>
    </div>
  );
}
