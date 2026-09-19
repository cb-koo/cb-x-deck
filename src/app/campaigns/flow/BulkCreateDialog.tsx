'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { DISPLAY_TYPE_ORDER } from '@/lib/campaignFlowView';

// 한 번에 만들기(§4-1, b-task-7-brief.md 3단계) — 유형별 개수만 받는다. 인플루언서·원고·비용은 만든 뒤
// 표에서 행을 눌러 채운다(작업을 먼저 만들고 나중에 채우는 게 이 화면의 설계 의도 — AGENTS.md 상단 주석).
// 호출 순서는 DISPLAY_TYPE_ORDER(부모의 확정 지시, TaskAddModal 계열과 다름) — 화면에 보이는 유형 나열과 같은 순서로 만든다.
const MAX = 20;
function clamp(v: number): number {
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(Math.round(v), MAX);
}

export function BulkCreateDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (counts: Record<TaskType, number>) => Promise<void>;
}) {
  const [counts, setCounts] = useState<Record<TaskType, number>>({ post: 0, quoteRt: 0, rt: 0, visit: 0 });
  const [busy, setBusy] = useState(false);
  const total = DISPLAY_TYPE_ORDER.reduce((sum, k) => sum + counts[k], 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit() {
    if (busy || total === 0) return;
    setBusy(true);
    await onCreate(counts);
    setBusy(false);
    onClose();   // 성공이든(부모가 만든 만큼 알려준다) 일부 실패든(부모가 어디까지 됐는지 토스트로 말한다) 창은 여기서 닫는다
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="한 번에 만들기" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px]">한 번에 만들기</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <p className="mt-1.5 text-ui text-x-secondary">유형별로 몇 건 만들지 적으면 빈 작업이 그 수만큼 생겨요. 인플루언서·원고·비용은 만든 뒤 각 작업에서 채워요.</p>
        <div className="mt-4 space-y-2.5">
          {DISPLAY_TYPE_ORDER.map((type) => (
            <label key={type} className="flex items-center justify-between gap-3 text-content">
              <span>{TASK_TYPE_LABEL[type]}</span>
              <input type="number" inputMode="numeric" min={0} max={MAX} value={counts[type]}
                     onChange={(e) => setCounts((cur) => ({ ...cur, [type]: clamp(Number(e.target.value)) }))}
                     aria-label={`${TASK_TYPE_LABEL[type]} 개수`}
                     className="h-10 w-20 rounded-md border border-x-border-strong bg-white px-2 text-right text-content outline-none focus:border-x-blue" />
            </label>
          ))}
        </div>
        {total === 0 && <p className="mt-2 text-caption text-x-muted">한 유형이라도 1 이상 적어요</p>}
        <div className="mt-4 flex justify-end gap-2.5">
          <Button onClick={onClose} disabled={busy} className="h-10 px-4 text-content">취소</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || total === 0} className="h-10 px-4 text-content">
            {busy ? '만드는 중…' : `작업 ${total}개 만들기`}
          </Button>
        </div>
      </div>
    </div>
  );
}
