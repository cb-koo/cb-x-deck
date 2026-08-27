'use client';
import { useEffect } from 'react';
import type { CheckPostedResult } from '@/lib/checkPosted';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { Button } from '@/components/ui';

// 게시 확인 결과(스펙 §3-3) — 숫자만 던지지 않고 판단까지: 확인됨/아직/건너뜀/사라짐을 이유와 함께.
const at = (h: string) => `@${h}`;
export function CheckPostedModal({ result, tasks, onClose, onMarkRemoved }: {
  result: CheckPostedResult; tasks: CampaignTaskItem[]; onClose: () => void;
  onMarkRemoved: (taskId: string) => void;   // "게시 내림으로 표시" — 오늘 날짜, 사유 '리포스트 목록에서 사라짐'
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const targetOf = (taskId: string) => { const t = tasks.find((x) => x.id === taskId); return t?.target ? `${t.target.influencerHandle ? at(t.target.influencerHandle) : '미배정'} ${TASK_TYPE_LABEL[t.target.type]}` : '대상'; };
  const reasonOf = (s: CheckPostedResult['skipped'][number]) => s.reason === 'no_target' ? '대상 미정' : s.reason === 'no_handle' ? '인플루언서 미배정' : `대상 게시글(${targetOf(s.taskId)})이 아직 게시 전`;
  const nothing = result.confirmed.length + result.pending.length + result.skipped.length + result.missing.length + result.unreadable.length === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[560px] rounded-2xl bg-white p-5" role="dialog" aria-modal="true" aria-label="게시 확인 결과" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px] font-bold">게시 확인 결과</h2>
        {nothing && <p className="mt-3 text-content text-x-secondary">확인할 RT 작업이 없어요.</p>}
        <ul className="mt-3 space-y-3 text-content">
          {result.confirmed.length > 0 && <li><span className="font-bold text-green-700">확인됨 {result.confirmed.length}건</span> — {result.confirmed.map((h) => at(h.handle)).join(' ')} → 게시 확인을 채웠어요</li>}
          {result.pending.length > 0 && <li><span className="font-bold">아직 {result.pending.length}건</span> — {result.pending.map((h) => at(h.handle)).join(' ')} <span className="text-ui text-x-muted">(목록에 없음 · 비공개 계정이거나 아직 안 했을 수 있어요)</span></li>}
          {result.skipped.length > 0 && (
            <li><span className="font-bold text-x-secondary">건너뜀 {result.skipped.length}건</span>
              <ul className="mt-1 space-y-0.5 text-ui text-x-secondary">{result.skipped.map((s) => <li key={s.taskId}>{s.handle ? at(s.handle) : '(미배정)'}: {reasonOf(s)}</li>)}</ul>
            </li>
          )}
          {result.missing.map((h) => (
            <li key={h.taskId} className="rounded-lg bg-amber-50 px-3 py-2">
              <span className="font-bold text-amber-800">{at(h.handle)}의 RT가 목록에 없어요</span> — 내려졌을 수 있어요
              <button type="button" onClick={() => onMarkRemoved(h.taskId)} className="ml-2 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 text-ui hover:bg-amber-100">게시 내림으로 표시</button>
            </li>
          ))}
          {result.unreadable.map((u) => <li key={u.tweetId} className="text-ui text-x-secondary">대상 게시글({u.tweetId})을 읽을 수 없어요 — 삭제·비공개일 수 있어요</li>)}
          {result.partial.length > 0 && <li className="text-ui text-x-muted">리포스트 목록이 길어 일부만 확인한 게시글이 {result.partial.length}개 있어요</li>}
        </ul>
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={onClose} className="h-10 px-4 text-content">닫기</Button></div>
      </div>
    </div>
  );
}
