'use client';
import { useEffect, useState } from 'react';
import { CANCEL_REASON_CHIPS, type FlowRow } from '@/lib/campaignFlowView';
import { TASK_TYPE_LABEL, formatDateKo } from '@/lib/campaignJudgment';
import { formatAmount } from '@/lib/campaignCost';
import type { CancelReason } from '@/lib/campaignTaskInput';
import { Button } from '@/components/ui';

// 작업 취소(ADR 0002) 확인 — 삭제가 아니라 상태다. 조율은 DM에서 일어나고 도구엔 남지 않는다: 진행이
// 기본값이고 안 된 경우에만 사람이 남긴다. 그래서 사유는 선택이고, 안내는 "취소해도 되돌릴 수 있다"를
// 먼저 말한다(§8·브리프 결정 2). onConfirm은 flowActions.cancel을 감싼 것 — 성공·실패 문구는 그쪽 토스트가
// 말하고, 이 창은 BulkCreateDialog 관례대로 결과와 무관하게 제출 뒤 닫는다.
export function CancelDialog({ task, onClose, onConfirm }: {
  task: FlowRow;
  onClose: () => void;
  onConfirm: (body: { reason: CancelReason | null; note: string }) => Promise<void>;
}) {
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    await onConfirm({ reason, note: note.trim() });
    setBusy(false);
    onClose();
  }

  const who = task.influencerHandle ? `@${task.influencerHandle}` : '미배정';
  const cost = task.cost ? formatAmount(task.cost.amount, task.cost.currency) : '비용 미정';
  const summary = `${TASK_TYPE_LABEL[task.type]} · ${who} · 예정 ${task.scheduledOn ? formatDateKo(task.scheduledOn) : '미정'} · ${cost}`;
  const notice = `취소한 작업은 표에 '취소'로 남고 되돌릴 수 있어요. 비용 합계·밀림에서는 빠져요.`
    + (task.draftId ? ` 붙어 있던 원고 "${task.draftLabel ?? '(제목 없음)'}"는 떼어져 다른 작업에 쓸 수 있어요.` : '');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="작업 취소" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px]">작업 취소</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <p className="mt-1 text-ui text-x-secondary">{summary}</p>
        <p className="mt-3 text-content">{notice}</p>

        <div className="mt-4">
          <p className="text-ui text-x-secondary">취소 사유 <span className="text-x-muted">선택</span></p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CANCEL_REASON_CHIPS.map((c) => (
              <button key={c.value} type="button" aria-pressed={reason === c.value}
                      onClick={() => setReason((cur) => (cur === c.value ? null : c.value))}
                      className={`rounded-full border px-2.5 py-1 text-ui ${
                        reason === c.value ? 'border-x-blue bg-x-blue/10 text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-caption text-x-muted">거절·무응답은 이 인플루언서 프로필의 타임라인에도 한 줄 남아요</p>
        </div>

        <div className="mt-3">
          <label className="block text-ui text-x-secondary">메모 <span className="text-x-muted">선택</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄"
                   className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2.5">
          <Button onClick={onClose} disabled={busy} className="h-10 px-4 text-content">닫기</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} className="h-10 px-4 text-content">
            {busy ? '취소하는 중…' : '❌ 취소하기'}
          </Button>
        </div>
      </div>
    </div>
  );
}
