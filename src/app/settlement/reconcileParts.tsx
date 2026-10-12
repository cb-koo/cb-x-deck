'use client';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { formatMoney } from '@/lib/influencerPricing';
import { usdText } from '@/lib/settlementDisplay';

// 맞추기·그대로 두기 창 머리(스펙 2026-10-07 §9) — 제목 / `@{핸들} · {유형} · {캠페인}` / `작업 금액 {현재} → 정산팀 지급 {지급}(외화)`.
// 버튼은 판정이 '다름'일 때만 보이고, 판정은 작업 금액·지급 원화가 있어야 성립한다 — 둘 다 있다고 보고 그린다.
export function ReconcileHead({ target, title }: { target: PaymentRequestRow; title: string }) {
  const cur = target.taskCost;
  const foreign = target.paidAmountUsd !== null
    ? ` (달러 ${usdText(target.paidAmountUsd)})`
    : target.paidAmountJpy !== null ? ` (엔화 ${formatMoney(target.paidAmountJpy, 'JPY')})` : '';
  return (
    <>
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="mt-1 text-ui text-x-secondary">@{target.influencerHandle} · {TASK_TYPE_LABEL[target.taskType]} · {target.campaignName}</p>
      <p className="mt-3 text-content tabular-nums">
        작업 금액 {cur ? formatMoney(cur.amount, cur.currency) : '—'} → 정산팀 지급 {formatMoney(target.paidAmountKrw ?? 0, 'KRW')}{foreign}
      </p>
    </>
  );
}
