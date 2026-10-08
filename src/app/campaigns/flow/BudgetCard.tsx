'use client';
import Link from 'next/link';
import { InfoTip } from '@/components/InfoTip';
import { formatAmount, type MoneyByCurrency } from '@/lib/campaignCost';
import { toKrw, periodLabel, badgeText, JPY_TO_KRW, type CampaignPeriodBudget } from '@/lib/clientBudget';
import { budgetCardView, remainText, type BudgetSegKey } from '@/lib/flowCards';
import {
  CARD, LABEL_ROW, LABEL_WRAP, LABEL, BIG, BAR, TBL, TBL_HEAD, TBL_KEY, TBL_VAL, SWATCH,
  C_THIS_SPENT, C_THIS_PENDING, C_OTHERS_SPENT, C_OTHERS_PENDING, C_REST,
} from './cardStyles';

// 클라이언트 예산 카드(2×2의 네 번째, koo 10-08) — 위 세 카드는 "이 캠페인", 이 카드는 "이 기간 전체".
// 예산 = 집행 + 예정 + 남음(budgetBreakdown). 결과 두 개(현재 남은 예산 · 전체 작업 완료 후 남은 예산)를 먼저 말하고,
// 막대와 표(A안)로 그 구성을 보여 준다. 이 캠페인 몫은 화면의 작업(spent·plannedTotal — 비용 카드와 같은 값)으로,
// 다른 캠페인 몫은 서버 판정(othersKrw·othersSpentKrw)으로 — 게시 확인 직후 낙관 갱신에도 두 카드가 같은 숫자를 말한다.
const SEG_COLOR: Record<BudgetSegKey, string> = {
  othersSpent: C_OTHERS_SPENT, othersPending: C_OTHERS_PENDING, thisSpent: C_THIS_SPENT, thisPending: C_THIS_PENDING,
};

export function BudgetCard({ budget, clientId, spent, plannedTotal }: {
  budget: CampaignPeriodBudget;   // 클라이언트 없는 캠페인(null)은 부모가 이 칸을 아예 그리지 않는다
  clientId: string | null;
  spent: MoneyByCurrency;
  plannedTotal: MoneyByCurrency;
}) {
  const budgetHref = clientId ? `/clients?client=${clientId}` : null;
  const head = (period: string | null, tip: string | null) => (
    <div className={LABEL_ROW}>
      <span className={LABEL_WRAP}>
        <span className={LABEL}>클라이언트 예산{period && <span className="ml-[6px] font-normal text-x-muted">{period}</span>}</span>
        {tip && <InfoTip text={tip} label="예산 계산 방법 보기" />}
      </span>
      {budgetHref && <Link href={budgetHref} className="whitespace-nowrap text-[13px] text-x-blue-text hover:underline">예산 설정 ↗</Link>}
    </div>
  );

  if (!budget.period) {
    return (
      <section aria-label="클라이언트 예산" className={CARD}>
        {head(null, null)}
        <p className="mt-[4px] text-[14px] text-x-secondary">
          이 기간 예산이 없어요
          {budgetHref && <> · <Link href={budgetHref} className="text-x-blue-text hover:underline">클라이언트에서 예산 넣기</Link></>}
        </p>
      </section>
    );
  }

  const amount = budget.period.amountKrw;
  const { b, segs, pendingTotal } = budgetCardView(amount, {
    othersPlannedKrw: budget.othersKrw, othersSpentKrw: budget.othersSpentKrw,
    thisPlannedKrw: toKrw(plannedTotal).krw, thisSpentKrw: toKrw(spent).krw,
  });
  const now = remainText(b.remainingNow);
  const after = remainText(b.remainingAfterPlan);
  const tip = `캠페인은 시작일이 속한 기간에 전액 잡혀요 · 집행 = 게시 확인된 작업 비용, 예정 = 아직 게시 전 작업 비용과 인플별 추가 비용 · `
    + `엔화는 1엔 = ${JPY_TO_KRW}원으로 환산 · 송금 수수료는 빠져 있어요`;
  const won = (v: number) => formatAmount(v, 'KRW');
  const cell = (v: number, color: string) => (
    <div className={TBL_VAL}><i aria-hidden className={`${SWATCH} ${color}`} />{won(v)}</div>
  );

  return (
    <section aria-label="클라이언트 예산" className={CARD}>
      {head(periodLabel(budget.period), tip)}
      {/* 결과 두 개 — 좁은 카드(안쪽 400px 미만)에선 두 번째가 아래로 내려가고 구분선이 위 가는 선이 된다.
          넓어도 금액이 길면(초과 등) flex-wrap이 받아 준다 — 숫자가 카드 밖으로 넘치지 않게 */}
      <div className="mt-[4px] flex flex-wrap items-end gap-y-[4px] @max-[400px]:flex-col @max-[400px]:items-stretch @max-[400px]:gap-y-[6px]">
        <div className="mr-[20px] @max-[400px]:mr-0">
          <div className="text-[13px] leading-[18px] text-x-muted">현재 남은 예산</div>
          <div className={`${BIG} whitespace-nowrap ${now.over ? 'text-red-700' : ''}`}>{now.text}</div>
        </div>
        <div className="border-l border-x-border pl-[20px] @max-[400px]:border-l-0 @max-[400px]:border-t @max-[400px]:pl-0 @max-[400px]:pt-[6px]">
          <div className="flex items-center gap-[2px] text-[13px] leading-[18px] text-x-muted">
            전체 작업 완료 후 남은 예산
            <InfoTip text={`잡혀 있는 작업(게시 전 ${won(pendingTotal)})까지 모두 게시되면 남는 금액이에요`} label="전체 작업 완료 후 남은 예산 설명 보기" />
          </div>
          <div className={`whitespace-nowrap pb-[3px] text-[18px] font-bold leading-[24px] tabular-nums ${after.over ? 'text-red-700' : ''}`}>{after.text}</div>
        </div>
      </div>

      <div className="mt-auto pt-[8px]">
        <div className={BAR} role="img"
             aria-label={`예산 ${won(amount)} 중 다른 캠페인 집행 ${won(b.othersSpent)} · 예정 ${won(b.othersPending)} · 이 캠페인 집행 ${won(b.thisSpent)} · 예정 ${won(b.thisPending)}`}>
          {segs.map((s) => s.width > 0 && <i key={s.key} className={`block h-full ${SEG_COLOR[s.key]}`} style={{ width: `${s.width}%` }} />)}
        </div>
        {/* 범례 = 작은 표(A안, koo 10-08) — 칸마다 그 막대 색 */}
        <div className={`mt-[8px] ${TBL}`}>
          <div className={TBL_HEAD} /><div className={TBL_HEAD}>집행</div><div className={TBL_HEAD}>예정</div>
          <div className={TBL_KEY}>다른 캠페인</div>{cell(b.othersSpent, C_OTHERS_SPENT)}{cell(b.othersPending, C_OTHERS_PENDING)}
          <div className={TBL_KEY}>이 캠페인</div>{cell(b.thisSpent, C_THIS_SPENT)}{cell(b.thisPending, C_THIS_PENDING)}
          {/* 남음은 예정 칸이 비어 있다 — 좁은 카드에선 두 칸을 합쳐 오른쪽 끝에 둔다('초과'가 붙은 긴 금액이 집행 칸 폭을 키우지 않게) */}
          <div className={TBL_KEY}>남음</div>
          <div className={`${TBL_VAL} @max-[400px]:col-span-2 ${after.over ? 'text-red-700' : ''}`}><i aria-hidden className={`${SWATCH} ${C_REST}`} />{after.text}</div>
          <div className={`${TBL_VAL} @max-[400px]:hidden`} />
        </div>
        <p className="mt-[4px] whitespace-nowrap text-[13px] leading-[18px] text-x-muted">기간 예산 {won(amount)} · 캠페인 {budget.campaignCount}개</p>
        {budget.badge && <p className="text-[13px] leading-[18px] text-x-muted">{badgeText(budget.badge)}</p>}
      </div>
    </section>
  );
}
