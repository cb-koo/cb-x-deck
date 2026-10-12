'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PendingRow } from '@/lib/settlementAutoStore';
import { HOLD_REASON_MAX } from '@/lib/settlementAuto';
import { holdPendingApi } from '@/lib/settlementApi';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';

// [보내지 않기](스펙 2026-10-12 §7) — 사유 칩은 아래 칸을 채워 줄 뿐, 직접 고쳐 써도 된다(작업 취소 창 칩과 같은 모양·koo 10-12 확정)
export const HOLD_REASON_CHIPS = ['인플과 금액 협의 중', '게시 내용 확인 중', '지급하지 않음'] as const;

export function HoldDialog({ target, onDone, onClose }: { target: PendingRow; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  async function go() {
    const r = reason.trim();
    if (!r) { setErr('사유를 골라 주거나 적어 주세요'); return; }
    setBusy(true);
    const res = await holdPendingApi(target.cand.taskId, r);
    setBusy(false);
    if (res.ok) onDone(); else setErr(res.error);
  }
  const c = target.cand;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="보내지 않기" className="w-full max-w-[460px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-ui text-x-secondary">{TASK_TYPE_LABEL[c.taskType]} · @{c.influencerHandle} · {c.campaignName}</p>
        <h2 className="mt-1 text-[16px] font-semibold">보내지 않기</h2>
        <p className="mt-1 text-ui text-x-secondary">자동으로 보내지 않고 &apos;멈춘 작업&apos;에 둬요. 나중에 [보내기]를 누르면 바로 보내요.</p>
        <div className="mt-3 text-ui text-x-secondary">사유 <span className="text-red-600">필수</span></div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {HOLD_REASON_CHIPS.map((k) => (
            <button key={k} type="button" onClick={() => { setReason(k); setErr(''); }} aria-pressed={reason === k}
                    className={`rounded-full border px-2.5 py-1 text-ui ${reason === k ? 'border-x-blue bg-x-blue/10 text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>{k}</button>
          ))}
        </div>
        <input id="hold-reason" aria-label="사유" maxLength={HOLD_REASON_MAX} value={reason} onChange={(e) => { setReason(e.target.value); setErr(''); }}
               className="mt-2 h-10 w-full rounded-lg border border-x-border px-2.5 text-ui" placeholder="예: 인플과 금액 협의 중" />
        {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={busy}>닫기</Button>
          <Button type="button" variant="primary" onClick={go} disabled={busy}>{busy ? '멈추는 중…' : '보내지 않기'}</Button>
        </div>
      </div>
    </div>
  );
}
