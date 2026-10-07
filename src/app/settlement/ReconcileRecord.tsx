'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { kstMonthDayTimeKo } from '@/lib/datetime';
import { costText } from '@/lib/taskChangeView';
import { undoKeepTaskCostApi } from '@/lib/settlementApi';

const PILL = 'inline-flex self-start items-center rounded-full px-3 py-1 text-[14px] font-semibold';
const BYAT = 'whitespace-nowrap text-[14px] text-x-muted';

// 펼침 요약 카드의 '처리 칸'(10-07 koo QA, 스펙 §9) — 요약 카드 오른쪽 끝에 구분선과 함께 붙는다.
// 판정이 '다름'이면(처리 기록이 있어도 작업 금액이 바뀌어 다시 다름이 된 경우·옛 확인 포함) 처리 기록 대신 '아직 처리하지 않았어요' + 두 버튼 —
// 아직 정할 일이 남았기 때문. '다름'이 아니면 처리 기록(맞춤 / 그대로 둠 + 처리 취소 / 옛 확인). 둘 다 아니면 그리지 않는다(두 금액만).
// 두 버튼은 표 행과 같은 핸들러(onKeep/onMatch)를 받는다 — 창은 RequestList가 연다.
export function ReconcileRecord({ r, mismatch, onKeep, onMatch, onChanged }: {
  r: PaymentRequestRow; mismatch: boolean; onKeep: () => void; onMatch: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!mismatch && !r.diffAckAt) return null;
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

  const kept = !mismatch && r.diffAckKind === 'kept';
  return (
    <>
      <div aria-hidden className="h-px self-stretch bg-x-border md:mx-7 md:h-auto md:w-px" />
      <div className="flex min-w-0 flex-[1.1] flex-col gap-2">
        {mismatch ? (
          <>
            <span className="text-content">아직 처리하지 않았어요</span>
            {/* 확정(맞추기)이 오른쪽·진한 버튼 — 표 행과 같은 순서 */}
            <span className="flex flex-wrap items-center gap-1.5">
              <Button onClick={onKeep}>그대로 두기</Button>
              <Button variant="primary" onClick={onMatch}>지급 금액에 맞추기</Button>
            </span>
          </>
        ) : r.diffAckKind === 'matched' ? (
          <>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`${PILL} bg-emerald-50 text-emerald-700`}>지급 금액에 맞춤</span>
              <span className={BYAT}>{byAt}</span>
            </span>
            <span className="text-content tabular-nums">작업 금액을 {costText(r.diffAckBeforeCost)} → {costText(r.diffAckTaskCost)}로 바꿨어요</span>
            {r.diffAckReason && <span className="text-[14px] text-x-muted">사유: {r.diffAckReason}{fromNote ? ' (정산팀 메모)' : ''}</span>}
          </>
        ) : kept ? (
          <>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`${PILL} bg-slate-100 text-slate-700`}>그대로 두기로 함</span>
              <span className={BYAT}>{byAt}</span>
            </span>
            <span className="text-content tabular-nums">작업 금액 {costText(r.diffAckTaskCost)} 그대로 두기로 했어요</span>
            {r.diffAckReason && <span className="text-[14px] text-x-muted">사유: {r.diffAckReason}</span>}
          </>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-x-muted">
            <span>확인함</span>
            <span className="whitespace-nowrap">{byAt}</span>
          </span>
        )}
        {err && <p role="alert" className="text-[14px] text-red-700">{err}</p>}
      </div>
      {kept && <Button onClick={() => void undo()} disabled={busy} className="self-start md:ml-4 md:self-center">처리 취소</Button>}
    </>
  );
}
