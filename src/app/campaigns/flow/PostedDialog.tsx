'use client';
import { useEffect } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { TASK_TYPE_LABEL, formatDateKo } from '@/lib/campaignJudgment';
import { PostedForm } from '../PostedCell';

// 게시 확인은 한 창에서 끝낸다(b-task-9-brief.md §3) — 언제·링크·(RT면) 증빙. 표의 팝오버가 이미 이 셋을
// 받고 있으므로 그 폼(PostedForm)을 그대로 쓴다. 게시 전·취소 아닌 작업의 패널에서만 연다(Task 10의 행
// 메뉴는 별도) — 그래서 여기 오는 task는 항상 postedAt이 없다(§4-4, FlowDetail이 그 조건에서만 연다).
export function PostedDialog({ task, today, onClose, onSubmit }: {
  task: FlowRow;
  today: string;
  onClose: () => void;
  onSubmit: (date: string, postUrl?: string, proof?: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const who = task.influencerHandle ? `@${task.influencerHandle}` : '미배정';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="게시 확인" className="w-full max-w-[520px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-ui text-x-secondary">{TASK_TYPE_LABEL[task.type]} · {who} · 예정 {task.scheduledOn ? formatDateKo(task.scheduledOn) : '미정'}</p>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <div className="mt-3">
          <PostedForm task={task} today={today}
                      onSubmit={(date, postUrl, proof) => { onSubmit(date, postUrl, proof); onClose(); }}
                      onCancel={onClose} />
        </div>
        <p className="mt-3 text-caption text-x-muted">확인하면 이 작업이 게시로 내려가고, 비용·인플루언서가 있으면 정산 대기에 잡혀요. 게시 확인은 되돌리지 않아요.</p>
      </div>
    </div>
  );
}
