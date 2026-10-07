'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { CURRENCIES, CURRENCY_LABEL, parseAmount, sameTaskCost, type Currency, type TaskCost } from '@/lib/campaignCost';
import { formatMoney } from '@/lib/influencerPricing';
import { suggestTaskCostFromPaid, budgetDeltaKrw } from '@/lib/settlementCalc';
import { usdText, RECONCILE_REASON_MAX } from '@/lib/settlementDisplay';
import { matchTaskCostApi } from '@/lib/settlementApi';
import { ReconcileHead } from './reconcileParts';
import { signedMoney } from './tableStyle';

const FIELD = 'rounded-lg border border-x-border bg-white px-2.5 py-1.5 text-content';

// 작업 금액 바꾸기(스펙 2026-10-07 §5-1·§9). 저장 = 작업 금액 + 이력 + 처리 기록 한 트랜잭션(서버). 창을 연 뒤 값이 바뀌었으면 409 문구를 그대로 보인다.
export function MatchDialog({ target, onDone, onClose }: { target: PaymentRequestRow; onDone: () => void; onClose: () => void }) {
  const current = target.taskCost as TaskCost;
  // 정확히 비교 가능한 지급만 미리 채운다 — 달러·엔화 없음은 비워 둔다(환산값을 넣으면 틀린 금액이 그럴듯해 보인다)
  const suggestion = suggestTaskCostFromPaid({
    payoutCurrency: target.payoutCurrency, paidAmountKrw: target.paidAmountKrw, paidAmountJpy: target.paidAmountJpy,
    fee: target.fee, rateKrwPerJpy: target.rateKrwPerJpy, taskCurrency: current.currency,
  });
  const [amount, setAmount] = useState(suggestion ? String(suggestion.cost.amount) : '');
  const [currency, setCurrency] = useState<Currency>(current.currency);
  const [reason, setReason] = useState((target.externalNote ?? '').slice(0, RECONCILE_REASON_MAX));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const parsed = amount.trim() === '' ? null : parseAmount(amount);
  const next: TaskCost | null = parsed === null ? null : { amount: parsed, currency };
  const changes = next !== null && !sameTaskCost(next, current);
  const canSave = changes && next !== null && next.amount > 0 && reason.trim() !== '' && !busy;

  async function save() {
    if (!next || !canSave) return;
    setBusy(true); setErr('');
    const r = await matchTaskCostApi(target, next, reason.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="작업 금액 바꾸기" className="w-full max-w-[480px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <ReconcileHead target={target} title="작업 금액 바꾸기" />
        <label className="mt-4 block text-ui font-semibold text-x-secondary">새 작업 금액
          <span className="mt-1 flex gap-2 font-normal">
            <input autoFocus inputMode="numeric" className={`${FIELD} min-w-0 flex-1 tabular-nums`} value={amount}
                   onChange={(e) => { setAmount(e.target.value); setErr(''); }} />
            <select className={FIELD} value={currency} onChange={(e) => { setCurrency(e.target.value as Currency); setErr(''); }} aria-label="새 작업 금액 통화">
              {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
            </select>
          </span>
        </label>
        {suggestion && suggestion.feeAmount > 0 && (
          <p className="mt-1 text-ui text-x-muted">정산팀 지급 {formatMoney(suggestion.paid, suggestion.paidCurrency)} 중 송금 수수료 {formatMoney(suggestion.feeAmount, suggestion.paidCurrency)}를 뺀 금액이에요.</p>
        )}
        {!suggestion && (
          <p className="mt-1 text-ui text-amber-700">
            {target.paidAmountUsd !== null && <>정산팀은 달러 {usdText(target.paidAmountUsd)}로 보냈어요. </>}
            원화 {formatMoney(target.paidAmountKrw ?? 0, 'KRW')}은 정산팀이 바꾼 값이라, 실제로 약속한 금액을 적어 주세요.
          </p>
        )}
        <label className="mt-4 block text-ui font-semibold text-x-secondary">사유
          <textarea className="mt-1 w-full rounded-lg border border-x-border p-2 text-content font-normal" rows={2} maxLength={RECONCILE_REASON_MAX}
                    value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }} />
        </label>
        {target.externalNote && <p className="mt-1 text-ui text-x-muted">정산팀 메모를 먼저 넣어 뒀어요. 고쳐 써도 돼요.</p>}
        {changes && next && budgetDeltaKrw(current, next) !== 0 && (
          <p className="mt-3 text-ui text-x-secondary tabular-nums">{target.campaignName} 집행액이 {signedMoney(budgetDeltaKrw(current, next), 'KRW')} 돼요</p>
        )}
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
            {next ? `${formatMoney(next.amount, next.currency)}으로 바꾸기` : '바꾸기'}
          </Button>
        </div>
      </div>
    </div>
  );
}
