'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { KEEP_REASONS, composeKeepReason, RECONCILE_REASON_MAX, type KeepReason } from '@/lib/settlementDisplay';
import { keepTaskCostApi } from '@/lib/settlementApi';
import { ReconcileHead } from './reconcileParts';

// 작업 금액 그대로 두기(스펙 2026-10-07 §5-2·§9) — 작업은 안 바뀌고 처리 기록만. 기타는 메모 필수.
export function KeepDialog({ target, onDone, onClose }: { target: PaymentRequestRow; onDone: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<KeepReason>(KEEP_REASONS[0]);
  // 저장 값은 '{선택지} — {메모}'라 메모 한도는 선택지 길이만큼 줄어든다(길이 때문에 버튼이 막히거나 서버가 거절하는 일이 없게)
  const memoMax = (k: KeepReason) => RECONCILE_REASON_MAX - `${k} — `.length;
  const [memo, setMemo] = useState((target.externalNote ?? '').slice(0, memoMax(KEEP_REASONS[0])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  const reason = composeKeepReason(kind, memo);

  async function save() {
    if (!reason || busy) return;
    setBusy(true); setErr('');
    const r = await keepTaskCostApi(target, kind, memo.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="작업 금액 그대로 두기" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <ReconcileHead target={target} title="작업 금액 그대로 두기" />
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">사유</legend>
          {KEEP_REASONS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-content">
              <input type="radio" name="keep-reason" className="h-4 w-4" autoFocus={kind === k} checked={kind === k} onChange={() => { setKind(k); setMemo((m) => m.slice(0, memoMax(k))); setErr(''); }} />
              {k}
            </label>
          ))}
        </fieldset>
        <label className="mt-3 block text-ui font-semibold text-x-secondary">메모
          <textarea className="mt-1 w-full rounded-lg border border-x-border p-2 text-content font-normal" rows={2} maxLength={memoMax(kind)}
                    value={memo} onChange={(e) => { setMemo(e.target.value); setErr(''); }} />
        </label>
        {target.externalNote && <p className="mt-1 text-ui text-x-muted">정산팀 메모를 먼저 넣어 뒀어요. 고쳐 써도 돼요.</p>}
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>취소</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!reason || busy}>그대로 두기</Button>
        </div>
      </div>
    </div>
  );
}
