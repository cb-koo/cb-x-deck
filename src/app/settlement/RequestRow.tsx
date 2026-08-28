'use client';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { describeSnapshot } from '@/lib/settlementCalc';
import { kstMonthDay } from '@/lib/datetime';

export function RequestRow({ r, open, onToggle, onCancel }: { r: PaymentRequestRow; open: boolean; onToggle: () => void; onCancel: () => void }) {
  const cancelled = r.status === 'cancelled';
  const costAmount = r.costCurrency === 'KRW' ? r.amountKrw : Math.round(r.amountKrw / r.rateKrwPerJpy);
  const base = r.costCurrency === r.payoutCurrency ? formatMoney(r.amountNet, r.payoutCurrency) : `${formatMoney(costAmount, r.costCurrency)} → ${formatMoney(r.amountNet, r.payoutCurrency)}`;
  return (
    <li className="px-4 py-3" style={{ minHeight: 76 }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 text-left text-[15px]">
        <span className="font-semibold">@{r.influencerHandle}</span>
        <span className="rounded-full border border-x-border px-2 py-0.5 text-ui">{TASK_TYPE_LABEL[r.taskType]}</span>
        <span className="text-x-secondary truncate">{r.clientName} · {r.campaignName}</span>
        <span className="ml-auto tabular-nums font-medium whitespace-nowrap">{base}{r.feeAmount > 0 && <span className="ml-1 text-x-muted font-normal">+ {r.feeAmount.toLocaleString('ko-KR')}</span>}</span>
        <span className="text-ui text-x-secondary whitespace-nowrap">{PAYMENT_TYPE_LABEL[r.paymentMethod.type]}</span>
        <span className={`rounded-full px-2 py-0.5 text-ui whitespace-nowrap ${cancelled ? 'bg-x-surface text-x-secondary' : 'bg-x-blue/10 text-x-blue-text'}`}>
          {cancelled ? `취소됨 ${kstMonthDay(r.cancelledAt)}` : `요청됨 ${kstMonthDay(r.createdAt)}`}
        </span>
      </button>
      <div className="mt-1 pl-0 text-ui text-x-muted">마감 {r.deadlineOn} · 요청자 {r.requesterName}</div>
      {open && (
        <div className="mt-3 rounded-xl bg-x-surface p-4 text-ui">
          <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5">
            <Item k="요청자" v={r.requesterName} />
            <Item k="클리닉" v={r.clientName} />
            <Item k="분류" v={r.category} sub={r.categoryDefault && r.categoryDefault !== r.category ? `미리 채운 값: ${r.categoryDefault}` : undefined} />
            <Item k="항목" v={r.itemText} />
            <Item k="목적" v={r.purposeText} />
            <Item k="금액" v={`${formatMoney(r.amountGross, r.payoutCurrency)}${r.feeAmount > 0 ? ` (${r.amountNet.toLocaleString('ko-KR')} + ${r.feeAmount.toLocaleString('ko-KR')} 수수료)` : ''}`}
                  sub={`원화 ${formatMoney(r.amountKrw, 'KRW')} · 환율 ${r.rateKrwPerJpy}원 = 1엔`} />
            <Item k="데드라인" v={r.deadlineOn} />
            <Item k="결제수단" v={describeSnapshot(r.paymentMethod)} />
            <Item k="참고자료" v={r.referenceUrl ? <a href={r.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline break-all">{r.referenceUrl}</a> : '—'} />
            <Item k="메모" v={r.note || '—'} />
          </dl>
          <div className="mt-3 flex items-center justify-between text-x-muted">
            <span>만든 사람 {r.requesterName} · {new Date(r.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              {cancelled && <> · <span className="text-x-secondary">취소 · {r.cancelledByName} · {r.cancelledAt ? new Date(r.cancelledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''} · {r.cancelReason}</span></>}
            </span>
            {!cancelled && <Button onClick={onCancel}>취소</Button>}
          </div>
        </div>
      )}
    </li>
  );
}
function Item({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (<><dt className="text-x-secondary">{k}</dt><dd className="min-w-0">{v}{sub && <div className="text-x-muted">{sub}</div>}</dd></>);
}
