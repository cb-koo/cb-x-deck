'use client';
// 이슈 상세 — 오른쪽 480px 패널(시안 ⑤). 상태 세 칸과 해결 답은 처리 담당자에게만 보인다(스펙 §5) — 서버 PATCH도 같은 판정으로 막는다.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { ImageLightbox } from '@/components/ImageLightbox';
import { signIssueScreenshot } from '@/lib/issueClient';
import { relativeDay } from '@/lib/ownedChannels';
import {
  ISSUE_STATUSES, ISSUE_STATUS_LABEL, MAX_ISSUE_REPLY, hasUnseenReply, issueLabel, locationHref, locationLine,
  type IssueReport, type IssueStatus,
} from '@/lib/issueReport';

// 접수 = 주황(먼저 볼 것), 확인 중 = 파랑, 해결 = 초록(캠페인 '게시' 칩 색)
export const ISSUE_STATUS_CHIP: Record<IssueStatus, string> = {
  open: 'bg-[#fff4e5] text-[#b45309]',
  checking: 'bg-[#e8f5fd] text-[#1573ad]',
  resolved: 'bg-[#e6f6ee] text-[#15803d]',
};

const kstTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' });

const LABEL = 'mb-1 text-ui text-x-muted';

export function IssueDetailPanel({ id, canHandle, memberId, onClose }: {
  id: string; canHandle: boolean; memberId: string; onClose: () => void;
}) {
  const [issue, setIssue] = useState<IssueReport | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [shotUrls, setShotUrls] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);   // 크게 보는 스크린샷 순서
  // 고르는 중인 상태·답 — '해결'은 답과 함께 [해결로 바꾸기]로 저장하고, 접수↔확인 중은 누르면 바로 저장한다
  const [statusDraft, setStatusDraft] = useState<IssueStatus | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/issues/${id}`);
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      if (!r.ok) { setLoadErr(j.error || '불러오지 못했어요'); return; }
      const i = j as IssueReport;
      setIssue(i);
      setReplyDraft(i.reply ?? '');
      // 보낸 사람이 답을 열어 봤다 — 사이드바 숫자를 줄인다
      if (i.reporterId === memberId && hasUnseenReply(i)) {
        await apiFetch(`/api/issues/${id}/seen`, { method: 'POST' }).catch(() => null);
        window.dispatchEvent(new Event('cbx-issues-changed'));
      }
      if (i.screenshotPaths.length) {
        // 한 장이 실패해도 나머지는 보인다 — 실패한 자리는 빼고 순서는 지킨다
        const urls = await Promise.all(i.screenshotPaths.map((p) => signIssueScreenshot(p).catch(() => null)));
        if (alive) setShotUrls(urls.filter((u): u is string => !!u));
      }
    })().catch(() => { if (alive) setLoadErr('불러오지 못했어요'); });
    return () => { alive = false; };
  }, [id, memberId]);

  // Esc로 닫기 — 확대 보기가 떠 있으면 그쪽이 먼저 받는다(ImageLightbox가 전파를 멈춘다)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useCallback(async (patch: { status?: IssueStatus; reply?: string | null }) => {
    setBusy(true); setSaveErr('');
    try {
      const r = await apiFetch(`/api/issues/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setSaveErr(j.error || '저장하지 못했어요 — 다시 시도해주세요'); return; }
      const i = j as IssueReport;
      setIssue(i); setStatusDraft(null); setReplyDraft(i.reply ?? '');
      window.dispatchEvent(new Event('cbx-issues-changed'));
    } finally { setBusy(false); }
  }, [id]);

  const pickStatus = (s: IssueStatus) => {
    if (!issue || busy) return;
    if (s === 'resolved' && issue.status !== 'resolved') { setStatusDraft('resolved'); return; }   // 답과 함께 확정
    setStatusDraft(null);
    if (s !== issue.status) void save({ status: s });
  };

  const shownStatus = statusDraft ?? issue?.status ?? 'open';
  const replyChanged = !!issue && replyDraft.trim() !== (issue.reply ?? '');
  const resolving = statusDraft === 'resolved';

  return (
    <aside role="dialog" aria-label="이슈 자세히"
           className="fixed inset-y-0 right-0 z-40 flex w-[480px] max-w-[calc(100vw-80px)] flex-col border-l border-x-border bg-white shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-x-border px-6 pb-4 pt-5">
        <h2 className="min-w-0 truncate text-[18px] font-bold">
          {issue && <span className="mr-2 tabular-nums text-x-secondary">{issueLabel(issue.no)}</span>}
          {issue?.reporterName ?? ' '}
          {issue && <span className="ml-2 text-[14px] font-normal text-x-muted">{relativeDay(issue.createdAt, now)} {kstTime(issue.createdAt)}</span>}
        </h2>
        <button type="button" onClick={onClose} aria-label="닫기" className="rounded px-1.5 text-[18px] text-x-secondary hover:bg-x-hover">✕</button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 text-[14px]">
        {!issue && !loadErr && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
        {loadErr && <p className="py-8 text-center text-ui text-x-secondary">{loadErr}</p>}
        {issue && (
          <>
            <div>
              <p className={LABEL}>보낸 곳</p>
              <p>
                {locationLine(issue.location)}
                <Link href={locationHref(issue.location)} className="ml-2 whitespace-nowrap text-x-blue-text hover:underline">이 화면 열기 ↗</Link>
              </p>
              {/* 가운데 창은 주소에 남지 않아 링크로 다시 열 수 없다 — 스크린샷과 열린 화면이 다른 이유를 미리 말한다(koo QA 10-22) */}
              {issue.location.dialog && (
                <p className="mt-1 text-ui text-x-muted">
                  링크는 {issue.location.taskId ? '작업 패널' : '화면'}까지 열어요. ‘{issue.location.dialog}’ 창은 거기서 직접 열어 주세요.
                </p>
              )}
            </div>
            <div>
              <p className={LABEL}>내용</p>
              <p className="whitespace-pre-wrap break-words leading-relaxed">{issue.body}</p>
            </div>
            {issue.screenshotPaths.length > 0 && (
              shotUrls ? (
                <div>
                  <p className={LABEL}>스크린샷 {shotUrls.length}장</p>
                  <div className={`grid gap-2 ${shotUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {shotUrls.map((u, k) => (
                      <button key={u} type="button" onClick={() => setZoom(k)} aria-label={`스크린샷 ${k + 1} 크게 보기`}
                              className="block overflow-hidden rounded-[10px] border border-x-border bg-x-surface">
                        {/* eslint-disable-next-line @next/next/no-img-element -- 비공개 버킷 서명 URL */}
                        <img src={u} alt={`보낸 스크린샷 ${k + 1}`} className={`w-full object-contain ${shotUrls.length === 1 ? 'max-h-64' : 'h-32'}`} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : <p className="text-ui text-x-muted">스크린샷 불러오는 중…</p>
            )}

            <div>
              <p className={LABEL}>상태</p>
              {canHandle ? (
                <div className="inline-flex overflow-hidden rounded-full border border-x-border-strong" role="radiogroup" aria-label="상태">
                  {ISSUE_STATUSES.map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={shownStatus === s} disabled={busy} onClick={() => pickStatus(s)}
                            className={`border-r border-x-border-strong px-3.5 py-1.5 text-ui font-semibold last:border-r-0 disabled:opacity-60 ${shownStatus === s ? ISSUE_STATUS_CHIP[s] : 'text-x-secondary hover:bg-x-hover'}`}>
                      {ISSUE_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              ) : (
                <span className={`inline-block rounded-full px-2 py-0.5 text-ui ${ISSUE_STATUS_CHIP[issue.status]}`}>{ISSUE_STATUS_LABEL[issue.status]}</span>
              )}
            </div>

            {canHandle ? (
              <div>
                <label htmlFor="issue-reply" className={`block ${LABEL}`}>해결 답 (보낸 사람에게 보여요)</label>
                <input id="issue-reply" value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} maxLength={MAX_ISSUE_REPLY}
                       placeholder="예: 저장 후 표가 바로 바뀌게 고쳤어요"
                       className="w-full rounded-[10px] border border-x-border-strong px-3 py-2.5 text-[14px] outline-none placeholder:text-x-muted focus:border-x-blue" />
                {issue.reply && issue.repliedByName && (
                  <p className="mt-1 text-caption text-x-muted">{issue.repliedByName}{issue.repliedAt ? `, ${relativeDay(issue.repliedAt, now)}` : ''}</p>
                )}
              </div>
            ) : issue.reply ? (
              <div>
                <p className={LABEL}>해결 답</p>
                <p className="leading-relaxed">{issue.reply}</p>
                {issue.repliedByName && <p className="mt-1 text-caption text-x-muted">{issue.repliedByName}{issue.repliedAt ? `, ${relativeDay(issue.repliedAt, now)}` : ''}</p>}
              </div>
            ) : null}
            {saveErr && <p role="alert" className="text-ui text-red-600">{saveErr}</p>}
          </>
        )}
      </div>

      {canHandle && issue && (resolving || replyChanged) && (
        <div className="flex justify-end gap-2 border-t border-x-border px-6 py-3">
          <Button onClick={() => { setStatusDraft(null); setReplyDraft(issue.reply ?? ''); setSaveErr(''); }} disabled={busy}>취소</Button>
          <Button variant="primary" disabled={busy}
                  onClick={() => void save(resolving ? { status: 'resolved', reply: replyDraft } : { reply: replyDraft })}>
            {busy ? '저장 중…' : resolving ? '해결로 바꾸기' : '답 저장'}
          </Button>
        </div>
      )}

      {zoom !== null && shotUrls && <ImageLightbox urls={shotUrls} index={zoom} onIndexChange={setZoom} onClose={() => setZoom(null)} />}
    </aside>
  );
}
