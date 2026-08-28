'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { formatMoney } from '@/lib/influencerPricing';

export function CancelDialog({ target, onConfirm, onClose }: { target: PaymentRequestRow; onConfirm: (reason: string) => Promise<string | null>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    const r = reason.trim();
    if (!r) { setErr('취소 사유를 적어 주세요'); return; }
    if (r.length > 200) { setErr('사유는 200자까지예요'); return; }
    setBusy(true);
    const e = await onConfirm(r);
    setBusy(false);
    if (e) setErr(e);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="요청 취소" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[16px] font-semibold">이 요청을 취소할까요?</h2>
        <p className="mt-1 text-ui text-x-secondary">@{target.influencerHandle} · {formatMoney(target.amountGross, target.payoutCurrency)}</p>
        <label className="mt-3 block text-ui text-x-secondary">사유 <span className="text-red-600">필수</span>
          <textarea className="mt-1 w-full rounded-lg border border-x-border p-2 text-ui" rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} placeholder="예: 금액 착오 — 3,000엔이 아니라 5,000엔" />
        </label>
        <p className="mt-2 text-ui text-x-muted">취소해도 기록은 남아요(누가·언제·왜). 이 작업은 다시 검토 대기에 나타나요.</p>
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>닫기</Button>
          <Button variant="primary" onClick={go} disabled={busy}>{busy ? '취소하는 중…' : '취소 확정'}</Button>
        </div>
      </div>
    </div>
  );
}
