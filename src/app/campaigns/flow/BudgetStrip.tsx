'use client';
import Link from 'next/link';
import { InfoTip } from '@/components/InfoTip';
import { formatAmount, type MoneyByCurrency } from '@/lib/campaignCost';
import { toKrw, periodLabel, badgeText, budgetBreakdown, JPY_TO_KRW, type CampaignPeriodBudget } from '@/lib/clientBudget';
import { PENDING_BLUE, PENDING_GRAY } from './FlowCards';

// 이 기간 클라이언트 예산 한 줄(koo 09-27 A안) — 위 카드 세 장은 "이 캠페인", 이 줄은 "이 기간 전체"로 층을 나눈다.
// 예산 = 집행 + 예정 + 남음(budgetBreakdown). 잔액은 막대 위 두 지점 — 집행까지(지금 남은 예산)와 예정까지(예정까지 쓰면
// 남는 예산). 색은 두 축만: 진한 = 집행, 빗금 = 예정 / 파랑 = 이 캠페인, 회색 = 다른 캠페인.
// 이 캠페인 몫은 화면의 작업(spent·plannedTotal — 카드와 같은 값)으로, 다른 캠페인 몫은 서버 판정(othersKrw·othersSpentKrw)으로 —
// 게시 확인 직후 낙관 갱신에도 카드와 이 줄이 같은 숫자를 말한다.
const sign = (n: number) => (n < 0 ? `−${formatAmount(-n, 'KRW')}` : formatAmount(n, 'KRW'));

export function BudgetStrip({ budget, clientId, spent, plannedTotal }: {
  budget: CampaignPeriodBudget | null;   // null = 클라이언트 없는 캠페인 — 줄 자체를 그리지 않는다
  clientId: string | null;
  spent: MoneyByCurrency;
  plannedTotal: MoneyByCurrency;
}) {
  if (!budget) return null;
  const budgetHref = clientId ? `/clients?client=${clientId}` : null;
  if (!budget.period) {
    return (
      <p className="text-content text-x-secondary">
        이 기간 예산이 없어요
        {budgetHref && <> · <Link href={budgetHref} className="text-x-blue-text hover:underline">클라이언트에서 예산 넣기</Link></>}
      </p>
    );
  }

  const amount = budget.period.amountKrw;
  const b = budgetBreakdown(amount, {
    othersPlannedKrw: budget.othersKrw, othersSpentKrw: budget.othersSpentKrw,
    thisPlannedKrw: toKrw(plannedTotal).krw, thisSpentKrw: toKrw(spent).krw,
  });
  // 막대는 예산이 전체 길이 — 넘치면 100%에서 자른다(숫자는 실제 값 그대로).
  let used = 0;
  const w = (v: number) => { const pct = amount > 0 ? Math.max(0, Math.min(100 - used, (v / amount) * 100)) : 0; used += pct; return pct; };
  const segs = [
    { key: 'os', v: b.othersSpent, cls: 'bg-x-secondary', label: '다른 캠페인 집행' },
    { key: 'ts', v: b.thisSpent, cls: 'bg-x-blue', label: '이 캠페인 집행' },
    { key: 'tp', v: b.thisPending, cls: PENDING_BLUE, label: '이 캠페인 예정' },
    { key: 'op', v: b.othersPending, cls: PENDING_GRAY, label: '다른 캠페인 예정' },
  ].map((s) => ({ ...s, width: w(s.v) }));
  const tip = `캠페인은 시작일이 속한 기간에 전액 잡혀요 · 집행 = 게시 확인된 작업 비용, 예정 = 아직 게시 전 작업 비용과 인플별 추가 비용 · `
    + `엔화는 1엔 = ${JPY_TO_KRW}원으로 환산 · 송금 수수료는 빠져 있어요`;

  // 세 줄로 끝낸다(koo 09-28 '예산 칸이 너무 큼') — ① 예산 + 잔액 두 개 ② 막대 ③ 범례. 잔액 숫자는 카드의 큰 숫자(26px)가
  // 아니라 본문 굵은 글씨 — 이 줄은 캠페인 카드 아래의 보조 층이라 위 카드보다 무거우면 안 된다.
  const remain = (label: string, v: number) => (
    <span className="whitespace-nowrap">
      <span className="text-x-secondary">{label}</span>{' '}
      <b className={`font-bold tabular-nums ${v < 0 ? 'text-red-700' : ''}`}>{sign(v)}</b>
    </span>
  );
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-content">
        <p className="flex items-center gap-1.5">
          <span className="text-x-secondary">{periodLabel(budget.period)} 예산</span>
          <b className="font-bold tabular-nums">{formatAmount(amount, 'KRW')}</b>
          <span className="text-ui text-x-muted">· 캠페인 {budget.campaignCount}개</span>
          <InfoTip text={tip} label="예산 줄 설명 보기" />
        </p>
        <p className="flex items-baseline gap-3">
          {remain('지금 남은 예산', b.remainingNow)}
          <span aria-hidden className="text-x-border-strong">|</span>
          {remain('예정까지 쓰면', b.remainingAfterPlan)}
        </p>
      </div>

      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-x-border">
        {segs.map((s) => s.width > 0 && <div key={s.key} className={`h-full ${s.cls}`} style={{ width: `${s.width}%` }} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-ui text-x-secondary">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {segs.filter((s) => s.v > 0).map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${s.cls}`} />
              {s.label} <span className="tabular-nums text-x-text">{formatAmount(s.v, 'KRW')}</span>
            </li>
          ))}
          {b.remainingAfterPlan > 0 && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-x-border-strong bg-x-border" />남음
            </li>
          )}
          {budget.badge && <li>{badgeText(budget.badge)}</li>}
        </ul>
        {budgetHref && <Link href={budgetHref} className="shrink-0 hover:underline">클라이언트 예산 ↗</Link>}
      </div>
    </div>
  );
}
