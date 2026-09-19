'use client';
import { useEffect } from 'react';
import type { FlowRow } from '@/lib/campaignFlowView';
import { TASK_TYPE_LABEL, formatDateKo } from '@/lib/campaignJudgment';
import { RemovedForm } from '../PostedCell';

// 게시 내림 표시(koo 09-19 결정 3) — PostedDialog와 같은 골격(요약 줄·폼·안내)으로 맞춘다(새로 디자인하지
// 않는다). 폼은 기존 화면의 RemovedForm을 그대로 쓴다(PostedDialog가 PostedForm을 쓰는 것과 같은 이유 —
// 문구·검증·증빙 칸 동작이 두 화면에서 갈라지면 안 된다). 패널의 [내림 표시] 버튼과 이 다이얼로그를 여는
// 조건은 항상 "게시됐고 아직 내려지지 않음"(FlowDetail이 그 조건에서만 연다) — 취소된 작업엔 두지 않는다(R18).
export function RemovedDialog({ task, today, proofSignedUrl, onClose, onSetProof, onSubmit }: {
  task: FlowRow;
  today: string;
  proofSignedUrl: string | null;
  onClose: () => void;
  onSetProof: (path: string | null) => void;
  onSubmit: (date: string, reason: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const who = task.influencerHandle ? `@${task.influencerHandle}` : '미배정';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="게시 내림 표시" className="w-full max-w-[520px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-ui text-x-secondary">{TASK_TYPE_LABEL[task.type]} · {who} · 게시 {task.postedAt ? formatDateKo(task.postedAt) : '미정'}</p>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <div className="mt-3">
          <RemovedForm task={task} today={today} proofSignedUrl={proofSignedUrl}
                       onSetProof={onSetProof}
                       onSubmit={(date, reason) => { onSubmit(date, reason); onClose(); }}
                       onCancel={onClose} />
        </div>
        <p className="mt-3 text-caption text-x-muted">게시는 그대로 남고 &quot;내려짐&quot;만 붙어요 — 잘못 표시했으면 [내림 취소]로 언제든 되돌릴 수 있어요.</p>
      </div>
    </div>
  );
}
