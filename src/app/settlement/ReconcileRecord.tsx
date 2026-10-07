'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { kstMonthDayTimeKo } from '@/lib/datetime';
import { costText } from '@/lib/taskChangeView';
import { undoKeepTaskCostApi } from '@/lib/settlementApi';

// 펼침의 '처리 기록'(스펙 2026-10-07 §8-6·§9) — 맞춤 / 그대로 둠(+처리 취소) / 옛 확인. 처리 기록이 없으면 그리지 않는다.
export function ReconcileRecord({ r, onChanged }: { r: PaymentRequestRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!r.diffAckAt) return null;
  // 이름이 비면 그 칸을 뺀다('· ·' 방지)
  const byAt = [r.diffAckByName, kstMonthDayTimeKo(r.diffAckAt)].filter(Boolean).join(' · ');
  const fromNote = !!r.diffAckReason && !!r.externalNote && r.diffAckReason.trim() === r.externalNote.trim();

  async function undo() {
    setBusy(true); setErr('');
    const res = await undoKeepTaskCostApi(r.id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onChanged();
  }

  return (
    <section className="mt-4 border-t border-x-border pt-3">
      <h3 className="text-[14px] font-semibold">처리 기록</h3>
      {r.diffAckKind === 'matched' && (
        <div className="mt-1.5">
          <p className="tabular-nums">작업 금액을 {costText(r.diffAckBeforeCost)} → {costText(r.diffAckTaskCost)}로 바꿨어요 · {byAt}</p>
          {r.diffAckReason && <p className="text-x-secondary">사유: {r.diffAckReason}{fromNote ? ' (정산팀 메모)' : ''}</p>}
        </div>
      )}
      {r.diffAckKind === 'kept' && (
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <div>
            <p className="tabular-nums">작업 금액 {costText(r.diffAckTaskCost)} 그대로 두기로 했어요 · {byAt}</p>
            {r.diffAckReason && <p className="text-x-secondary">사유: {r.diffAckReason}</p>}
          </div>
          <Button onClick={() => void undo()} disabled={busy}>처리 취소</Button>
        </div>
      )}
      {r.diffAckKind === null && <p className="mt-1.5 text-x-secondary">확인함 · {byAt}</p>}
      {err && <p role="alert" className="mt-2 text-[14px] text-red-700">{err}</p>}
    </section>
  );
}
