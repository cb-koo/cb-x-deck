'use client';
import type { ReactNode } from 'react';
import type { CampaignSummary, PerfSummary } from '@/lib/campaignJudgment';
import { moneyParts, formatAmount, type MoneyByCurrency } from '@/lib/campaignCost';
import { overdueJudgment, publishedSub, perfSub } from '@/lib/campaignTableView';

// 요약 카드 4 — 예외 우선 순서(밀림 → 게시 → 비용 → 조회, 스펙 §3-2). 숫자 26px, 라벨은 아래 13px(가독성 기준).
// 값은 전부 판정 함수의 결과를 받는다 — 카드가 따로 세지 않는다(표와 다른 숫자가 나오면 안 된다).
function Card({ alert, value, label, sub }: { alert?: boolean; value: ReactNode; label: string; sub: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${alert ? 'border-red-200 bg-red-50' : 'border-x-border bg-white'}`}>
      <p className={`text-[26px] font-bold leading-tight tabular-nums ${alert ? 'text-red-700' : ''}`}>{value}</p>
      <p className="mt-1 text-ui font-bold text-x-secondary">{label}</p>
      <p className="text-ui text-x-muted">{sub}</p>
    </div>
  );
}

export function SummaryCards({ summary, perf, total }: { summary: CampaignSummary; perf: PerfSummary; total: MoneyByCurrency }) {
  const money = moneyParts(total);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card alert={summary.overdue > 0} value={summary.overdue > 0 ? `⚠ ${summary.overdue}` : '0'} label="밀림" sub={overdueJudgment(summary.overdue)} />
      <Card value={<>{summary.published} <span className="text-content font-normal text-x-muted">/ {summary.total}</span></>}
            label="게시됨" sub={publishedSub(summary)} />
      {/* 통화별 두 숫자 — 합치지 않는다(§2-4). 비어 있으면 — */}
      <Card value={money.length === 0 ? '—' : (
              <span className="flex flex-col">{money.map((m) => <span key={m.currency}>{formatAmount(m.amount, m.currency)}</span>)}</span>
            )}
            label="비용 합계" sub="통화별로 따로 계산 — 원과 엔은 합치지 않아요" />
      <Card value={perf.views === null ? '—' : perf.views.toLocaleString('ko-KR')} label="조회 합계" sub={perfSub(perf)} />
    </div>
  );
}
