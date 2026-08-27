'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { CampaignSummary, PerfSummary } from '@/lib/campaignJudgment';
import { moneyParts, formatAmount, type MoneyByCurrency } from '@/lib/campaignCost';
import { overdueJudgment, publishedSub, costSub, perfSub } from '@/lib/campaignTableView';
import { toKrw, remainingOf, monthShort, budgetTipText, type CampaignMonthBudget } from '@/lib/clientBudget';
import { InfoTip } from '@/components/InfoTip';

// 요약 칸 — 순서는 조회 → 게시됨 → 밀림 → 비용 합계 → 월 예산 잔액(koo 결정 08-28: 성과 → 진행 → 돈 순으로 읽히고,
// 돈 두 칸이 나란히 붙는다. 이전의 예외 우선 순서(밀림 먼저, 캠페인 스펙 §3-2)를 대체). 숫자 26px, 라벨은 아래 13px(가독성 기준).
// 값은 전부 판정 함수의 결과를 받는다 — 카드가 따로 세지 않는다(표와 다른 숫자가 나오면 안 된다).
// 보조 줄은 '판단 한 줄'만 둔다(QA 1라운드) — "통화별로 따로 계산" 같은 방법 설명은 라벨 옆 ⓘ(InfoTip)로 옮겼다.
//
// QA 7라운드(결정 B): 칸마다 테두리·배경을 두는 카드 4장 → '캠페인 요약' 패널 하나 안의 4칸 + 얇은 세로 구분선.
// 패널(CampaignDetail의 PANEL) 안에 또 카드가 있으면 테두리가 겹쳐 '패널 속 패널'로 읽힌다.
// 밀림 경고는 빨간 배경 대신 숫자·라벨 빨강으로만 말한다 — 칸 배경을 쓰면 구분선 격자 안에 색 블록이 떠 보인다.
function Card({ alert, value, label, sub, good, tip }: {
  alert?: boolean; value: ReactNode; label: string; sub: ReactNode; good?: boolean; tip?: string;
}) {
  return (
    // 구분선은 칸마다 왼쪽 1px(첫 칸은 없음) — divide-x-* 는 폭/색 해석이 갈리는 이름이라 쓰지 않는다
    <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0">
      <p className={`text-[26px] font-bold leading-tight tabular-nums ${alert ? 'text-red-700' : ''}`}>{value}</p>
      <p className={`mt-1 flex items-center gap-1.5 text-ui font-bold ${alert ? 'text-red-700' : 'text-x-secondary'}`}>
        {label}
        {tip ? <InfoTip text={tip} label={`${label} 설명 보기`} /> : null}
      </p>
      {/* 보조 줄이 비어 있으면(통화 두 줄) 아예 그리지 않는다 — 빈 줄만큼 카드 높이가 들쭉날쭉해지지 않게 최소 높이는 유지 */}
      <p className={`min-h-[18px] text-ui ${good ? 'text-green-700' : 'text-x-muted'}`}>{sub}</p>
    </div>
  );
}

export function SummaryCards({ summary, perf, total, budget, clientId }: {
  summary: CampaignSummary; perf: PerfSummary; total: MoneyByCurrency;
  budget: CampaignMonthBudget | null;   // 이 달 클라이언트 예산(서버). 클라 없는 캠페인은 null → 4칸 유지
  clientId: string | null;
}) {
  const money = moneyParts(total);
  // 잔액 = 예산 − (다른 캠페인 몫 + 이 캠페인 합계 환산). 이 캠페인 몫을 화면의 total에서 더해야
  // 비용 셀을 고친 순간 '비용 합계' 칸과 같은 박자로 움직인다(스펙 §6-2, UX 원칙 4).
  const spentKrw = budget ? budget.othersKrw + toKrw(total).krw : 0;
  const remaining = budget ? remainingOf(budget.amount, spentKrw) : null;
  return (
    <div className={`grid ${budget ? 'grid-cols-5' : 'grid-cols-4'}`}>
      <Card value={perf.views === null ? '—' : perf.views.toLocaleString('ko-KR')} label="조회" sub={perfSub(perf)} />
      <Card value={<>{summary.published} <span className="text-content font-normal text-x-muted">/ {summary.total}</span></>}
            label="게시됨" sub={publishedSub(summary)} />
      <Card alert={summary.overdue > 0} value={summary.overdue > 0 ? `⚠ ${summary.overdue}` : '0'} label="밀림"
            sub={overdueJudgment(summary.overdue)} good={summary.overdue === 0} />
      {/* 통화별 두 숫자 — 합치지 않는다(§2-4). 비어 있으면 — */}
      <Card value={money.length === 0 ? '—' : (
              <span className="flex flex-col">{money.map((m) => <span key={m.currency}>{formatAmount(m.amount, m.currency)}</span>)}</span>
            )}
            label="비용 합계" sub={costSub(total)} tip="통화가 다르면 합치지 않고 따로 보여요" />
      {budget && (budget.amount === null ? (
        <Card value="—" label="월 예산"
              sub={clientId
                ? <>미설정 — <Link href={`/clients?client=${clientId}`} className="text-x-blue-text hover:underline">클라이언트 설정에서 입력</Link></>
                : '미설정'} />
      ) : (
        <Card alert={remaining !== null && remaining < 0}
              value={remaining !== null && remaining < 0 ? `−${formatAmount(-remaining, 'KRW')}` : formatAmount(remaining ?? 0, 'KRW')}
              label={`${monthShort(budget.month)} 예산 잔액`}
              sub={`${formatAmount(budget.amount, 'KRW')} 중 ${formatAmount(spentKrw, 'KRW')} 사용 · 캠페인 ${budget.campaignCount}개`}
              tip={`클라이언트의 ${monthShort(budget.month)}에 시작한 캠페인 비용을 전부 합쳐 예산과 대조해요. ${budgetTipText()}`} />
      ))}
    </div>
  );
}
