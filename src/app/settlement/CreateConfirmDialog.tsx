'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { SettlementCandidate } from '@/lib/settlementCalc';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import type { RowEdit } from './CandidateRow';

export function CreateConfirmDialog({ items, edits, onConfirm, onClose }: {
  items: SettlementCandidate[]; edits: Record<string, RowEdit>; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  const totals: Record<string, number> = {};
  for (const c of items) if (c.money) totals[c.money.payoutCurrency] = (totals[c.money.payoutCurrency] ?? 0) + c.money.amountGross;
  const deadlines = [...new Set(items.map((c) => edits[c.taskId].deadlineOn))];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="결제 요청 만들기" className="w-full max-w-[560px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold">결제 요청 {items.length}건을 만들어요</h2>
        <p className="mt-1 text-ui text-x-secondary tabular-nums">
          합계 {Object.entries(totals).map(([cur, v]) => formatMoney(v, cur as 'KRW' | 'JPY')).join(' / ')} · 마감 {deadlines.join(', ')}
        </p>
        <ul className="mt-3 max-h-[320px] overflow-y-auto divide-y divide-x-border text-ui">
          {items.map((c) => (
            <li key={c.taskId} className="flex items-center gap-3 py-2">
              <span className="font-medium">@{c.influencerHandle}</span>
              <span className="text-x-secondary">{TASK_TYPE_LABEL[c.taskType]}</span>
              <span className="ml-auto tabular-nums">{c.money ? formatMoney(c.money.amountGross, c.money.payoutCurrency) : '—'}</span>
              <span className="text-x-muted w-[72px]">{c.method ? PAYMENT_TYPE_LABEL[c.method.type] : ''}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-ui text-x-muted">만든 뒤에는 값이 고정돼요 — 결제 수단이나 비용이 바뀌어도 이 요청은 그대로예요. 잘못 만들면 요청 내역에서 사유를 적고 취소해요.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="primary" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{busy ? '만드는 중…' : '만들기'}</Button>
        </div>
      </div>
    </div>
  );
}
