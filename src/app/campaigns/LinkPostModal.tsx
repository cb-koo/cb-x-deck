'use client';
import { useEffect, useState } from 'react';
import type { CampaignTaskItem } from '@/lib/campaignStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { registerTrackedPostApi, linkTrackedPostApi } from '@/lib/campaignApi';
import { Button } from '@/components/ui';

// 게시물 연결(스펙 §3-2 단계 셀 옆) — 올라간 게시물 링크를 붙이면 (1) 트래킹 등록(taskId 없이 — POST가 taskId를 받으면 기존 연결을
// 확인 없이 덮어쓰므로) → (2) PATCH로 이 작업에 연결한다. 이미 다른(취소 안 된) 작업의 본 게시물이면 서버가 409로 막고(ISSUE-016 P1,
// 예전엔 확인 창 한 번으로 옮겨져 그 작업의 성과가 비었다) 이 창이 그 작업을 [열기]로 안내한다 — 옮기려면 그 작업에서 먼저 연결을 푼다. 둘 다 기존 라우트(POST /api/tracking·PATCH /api/tracking/[id]) — 새 API 없음.
// 연결되면 '게시됨' 판정·조회수가 잡힌다(§2-4). 소수 케이스용 진입점 — 자동 매칭은 백로그(§9).
export function LinkPostModal({ task, onClose, onLinked, onOpenTask }: {
  task: CampaignTaskItem; onClose: () => void; onLinked: () => void;
  onOpenTask?: (taskId: string, campaignId: string) => void;   // 이미 다른 작업의 게시물일 때 [열기] — 없으면 문구만
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [owner, setOwner] = useState<{ taskId: string; campaignId: string } | null>(null);
  const parsed = parseTweetLink(url);
  // 빈 칸은 오류가 아니라 아직 안 쓴 상태(TrackAddForm 관례)
  const showParseErr = url.trim().length > 0 && !parsed.ok && parsed.reason !== 'empty';
  const title = [task.influencerHandle ? `@${task.influencerHandle}` : null, TASK_TYPE_LABEL[task.type], task.draftLabel]
    .filter(Boolean).join(' · ');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit() {
    if (!parsed.ok || busy) return;
    setBusy(true); setErr(''); setOwner(null);
    const reg = await registerTrackedPostApi(url.trim());
    if (!reg.ok) { setErr(reg.error); setBusy(false); return; }
    const row = reg.data.row;
    // 게시물 하나는 작업 하나에만 붙는다 — 이미 다른 작업의 것이면 서버가 막고 어느 작업인지 알려 준다(확인 창 없이)
    const link = await linkTrackedPostApi(row.id, { taskId: task.id });
    setBusy(false);
    if (!link.ok) {
      setErr(link.error);
      const b = link.body as { code?: string; taskId?: string; campaignId?: string } | undefined;
      if (b?.code === 'POST_DUPLICATE' && b.taskId && b.campaignId) setOwner({ taskId: b.taskId, campaignId: b.campaignId });
      return;
    }
    // 라우트는 연결 뒤 다시 조회한 행을 준다 — null이면 그 사이 게시물이 지워진 것이라 연결이 남지 않았다(거짓 성공 방지)
    if (!link.data.row) { setErr('게시물을 찾을 수 없어요 — 삭제됐을 수 있어요'); return; }
    onLinked();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true" aria-label="게시물 연결" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-content font-bold">게시물 연결</h2>
        <p className="mt-0.5 truncate text-ui text-x-muted">{title}</p>
        {/* 이미 게시 확인된 작업에도 쓴다(게시 확인 때 링크 등록이 실패한 경우) — 그때 '게시됨으로 표시된다'고
            말하면 이미 된 일을 다시 한다는 뜻으로 읽힌다. 상태에 따라 실제로 달라지는 것만 말한다. */}
        <p className="mt-3 text-ui text-x-secondary">
          {task.postedAt
            ? <>인플루언서가 올린 게시물 링크를 붙이면 조회·좋아요가 트래킹에서 넘어와요. 게시 확인은 이미 돼 있어요.</>
            : <>인플루언서가 올린 게시물 링크를 붙이면 이 작업이 <b>게시됨</b>으로 표시되고, 조회·좋아요가 트래킹에서 넘어와요.</>}
        </p>
        <input autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="https://x.com/계정/status/…" aria-label="게시물 링크"
               autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
               aria-invalid={showParseErr ? true : undefined}
               className="mt-2 h-10 w-full rounded-lg border border-x-border-strong bg-white px-3 text-content outline-none focus:border-x-blue" />
        {showParseErr && <p className="mt-1 text-ui text-red-600">{tweetLinkParseMessage(parsed.ok ? 'invalid' : parsed.reason)}</p>}
        {err && (
          <p role="alert" className="mt-1 text-ui text-red-600">
            {err}
            {owner && onOpenTask && (
              <button type="button" onClick={() => { onClose(); onOpenTask(owner.taskId, owner.campaignId); }}
                      className="ml-2 text-x-blue-text hover:underline">열기</button>
            )}
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-3">
          <Button type="button" onClick={onClose} disabled={busy} className="h-10 px-4 text-content">취소</Button>
          <Button type="button" variant="primary" onClick={() => void submit()} disabled={!parsed.ok || busy} className="h-10 px-4 text-content">
            {busy ? '연결하는 중…' : '연결'}
          </Button>
        </div>
      </div>
    </div>
  );
}
