'use client';
import { useEffect, useState } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { TASK_TYPE_LABEL, SETTLED_ELSEWHERE_NOTE_MAX } from '@/lib/campaignJudgment';
import { formatAmount } from '@/lib/campaignCost';
import { Button } from '@/components/ui';

// 다른 곳에서 정산함(061) 확인 — 표시하면 무엇이 바뀌는지 먼저 말한다(UX 원칙 2). 메모는 선택.
// onConfirm은 flowActions.settleElsewhere를 감싼 것 — 성공·실패 문구는 그쪽 토스트가 말하고, 이 창은 CancelDialog 관례대로 제출 뒤 닫는다.
export function SettleElsewhereDialog({ task, onClose, onConfirm }: {
  task: FlowRow;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
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
    await onConfirm(note.trim());
    setBusy(false);
    onClose();
  }

  const who = task.influencerHandle ? `@${task.influencerHandle}` : '미배정';
  const cost = task.cost ? formatAmount(task.cost.amount, task.cost.currency) : '비용 미정';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="다른 곳에서 정산함" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px]">다른 곳에서 정산했어요</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <p className="mt-1 text-ui text-x-secondary">{TASK_TYPE_LABEL[task.type]} · {who} · {cost}</p>
        <p className="mt-3 text-content">
          정산 대기 목록에서 빠지고, 이 작업으로는 정산 요청을 보낼 수 없게 돼요(두 번 지급 방지).
          비용은 예산·집행액에 그대로 잡혀요. 나중에 되돌릴 수 있어요.
        </p>

        <div className="mt-4">
          <label className="block text-ui text-x-secondary">어디서 정산했나요? <span className="text-x-muted">선택</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 구글폼" maxLength={SETTLED_ELSEWHERE_NOTE_MAX}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
                   className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2.5">
          <Button onClick={onClose} disabled={busy} className="h-10 px-4 text-content">닫기</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy} className="h-10 px-4 text-content">
            {busy ? '표시하는 중…' : '정산함으로 표시'}
          </Button>
        </div>
      </div>
    </div>
  );
}
