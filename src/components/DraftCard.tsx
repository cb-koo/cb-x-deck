'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import type { RefSnapshot } from '@/lib/draftTypes';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags } from '@/lib/draftUi';
import { MediaGrid } from '@/components/MediaGrid';
import { RefreshIcon, TrashIcon } from '@/components/XIcons';

const MODE_LABEL: Record<DraftRow['referenceMode'], string> = {
  off: '참고 없음', form: '형식만', angle: '앵글만', both: '형식 + 앵글',
};

// 초안 카드 — X 실측(600px·radius16·아바타40·본문 15/20). 지표·배지·이미지 자리 없음(없는 데이터는 자리도 안 만듦)
export function DraftCard({ draft, banned, onEdit, onAnother, anotherBusy, anotherDisabled, onDelete, onRegenPost, regenBusyIndex, onDismissFlag, onRestoreAllFlags }: {
  draft: DraftRow; banned: string[];
  onEdit: () => void; onAnother: () => void; anotherBusy: boolean; anotherDisabled: boolean;
  onDelete: () => void; onRegenPost: (index: number) => void; regenBusyIndex: number | null;
  onDismissFlag: (key: string, dismiss: boolean) => void;
  onRestoreAllFlags: () => void;
}) {
  const [refsOpen, setRefsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedPost, setCopiedPost] = useState<number | null>(null);
  const content = draft.edited ?? draft.content;
  const flags = collectDraftFlags(content, banned, draft.dismissedFlags);
  const active = flags.filter((f) => !f.dismissed);
  const dismissedCount = flags.length - active.length;
  const total = content.posts.reduce((n, p) => n + xWeightedLength(p.text), 0);
  const isThread = draft.format === 'thread';

  async function copyAll() {
    await navigator.clipboard.writeText(draftCopyText(content));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-x-border-strong bg-white">
      {/* 흰색 = X 콘텐츠층 */}
      <div className="flex gap-3 px-4 py-3">
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
              style={{ background: draft.member?.color ?? '#1d9bf0' }}>
          {(draft.member?.name ?? '초').slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-5">
            <b>{draft.member?.name ?? '초안'}</b>
            <span className="text-x-secondary"> · 초안 · {draftTimeLabel(draft.createdAt)}</span>
            {draft.edited && <span className="text-x-muted"> · 편집됨</span>}
          </p>
          <div className={isThread ? 'relative mt-1 space-y-3 pl-3 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:bg-x-border-strong' : 'mt-0.5'}>
            {content.posts.map((p, i) => {
              const hb = i === 0 ? hookBoundary(p.text) : null;
              const len = xWeightedLength(p.text);
              return (
                <div key={i}>
                  {isThread && <p className="text-caption font-bold text-x-muted">{i + 1} / {content.posts.length}</p>}
                  {hb ? (
                    <p className="whitespace-pre-wrap text-[15px] leading-5">
                      {hb.hook}
                      <span className="relative my-1.5 block border-t border-dashed border-x-border-strong">
                        <span className="absolute -top-2 right-0 bg-white px-1 text-[10.5px] text-x-muted">↑ 첫 단락 = 타임라인에서 시선을 잡는 훅</span>
                      </span>
                      {hb.rest}
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-5">{p.text}</p>
                  )}
                  <MediaGrid media={p.media} />
                  <p className="mt-1 flex items-center gap-3 text-caption tabular-nums text-x-muted">
                    <span className={len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : ''}>{len} / {X_MAX_WEIGHTED} (가중 — 일본어 약 140자)</span>
                    {isThread && (
                      <button onClick={() => onRegenPost(i)} disabled={regenBusyIndex !== null}
                              className="text-x-blue-text hover:underline disabled:opacity-50">
                        {regenBusyIndex === i ? '다시 만드는 중…' : '이 트윗만 다시'}
                      </button>
                    )}
                    {isThread && (
                      <button onClick={() => { void navigator.clipboard.writeText(p.text).catch(() => {}); setCopiedPost(i); setTimeout(() => setCopiedPost(null), 1500); }}
                              className="text-x-blue-text hover:underline">
                        {copiedPost === i ? '복사됨 ✓' : '복사'}
                      </button>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
          {/* 액션 행 — X 액션 바 자리에 우리 액션 (없는 지표를 채우지 않고 교체) */}
          <div className="mt-3 flex max-w-[440px] items-center gap-1 text-[13px] text-x-secondary">
            <button onClick={onEdit} className="flex items-center gap-1.5 rounded-full px-2 py-1 text-x-blue-text hover:bg-x-blue/10">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06zM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z" /></svg>
              편집
            </button>
            <button onClick={onAnother} disabled={anotherBusy || anotherDisabled} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5 disabled:opacity-50">
              <RefreshIcon className="h-[19px] w-[19px]" />{anotherBusy ? '만드는 중…' : '다른 각도로'}
            </button>
            <button onClick={copyAll} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>
              {copied ? '복사됨 ✓' : '복사'}
            </button>
            <button onClick={onDelete} aria-label="초안 삭제" className="flex items-center rounded-full px-2 py-1 hover:bg-red-50 hover:text-red-600">
              <TrashIcon className="h-[19px] w-[19px]" />
            </button>
            <span className="ml-auto tabular-nums">{isThread ? `${content.posts.length}개 · 총 ${total}자` : ''}</span>
          </div>
        </div>
      </div>

      {/* 회색 = 도구층: 검수 표식 + PR 안내 + 근거 풋터 (spec §2 표면 2층) */}
      <div className="border-t border-x-border bg-x-surface px-4 py-2.5">
        {active.map((f) => (
          <p key={`${f.postIndex}:${f.key}`} className="flex items-baseline gap-2 py-0.5 text-[13px]">
            <span className="border-b-2 border-amber-700 font-bold text-amber-700">{f.flag.term}</span>
            <span className="text-x-secondary">{f.flag.reason}{isThread ? ` (${f.postIndex + 1}번)` : ''}</span>
            <button onClick={() => onDismissFlag(f.key, true)} className="ml-auto shrink-0 text-x-blue-text hover:underline">무시</button>
          </p>
        ))}
        {dismissedCount > 0 && (
          <p className="py-0.5 text-caption text-x-muted">
            무시한 표식 {dismissedCount}개
            <button onClick={onRestoreAllFlags} className="ml-2 text-x-blue-text hover:underline">모두 되돌리기</button>
          </p>
        )}
        <p className="py-0.5 text-caption text-x-muted">ℹ️ PR 표기(#PR)는 원고와 함께 인플루언서에게 안내하세요 — 스테마 규제</p>

        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-x-border pt-1.5 text-[13px]">
          <button onClick={() => setRefsOpen(!refsOpen)} disabled={draft.refs.length === 0}
                  className="text-left disabled:cursor-default">
            참고 레퍼런스 {draft.refs.length}건{draft.refs.length > 0 && <span className="text-x-blue-text"> · {MODE_LABEL[draft.referenceMode]} {refsOpen ? '⌃' : '⌄'}</span>}
          </button>
          <span className="shrink-0 text-caption tabular-nums text-x-muted">
            {[draft.clientName, ...draft.procedureNames].filter(Boolean).join(' · ')}{draft.model ? ` · ${draft.model}` : ''}
          </span>
        </div>
        {refsOpen && draft.refs.map((r: RefSnapshot) => (
          <div key={r.tweetId} className="mt-2 rounded-lg border border-x-border bg-white px-3 py-2">
            <p className="text-ui"><b>{r.name ?? r.handle}</b> <span className="text-x-muted">@{r.handle}</span>
              <a href={`https://x.com/i/status/${r.tweetId}`} target="_blank" rel="noreferrer" className="ml-2 text-x-blue-text hover:underline">원문 ↗</a>
            </p>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[15px] leading-5">{r.excerpt}</p>
            {r.memos.map((m, i) => (
              <p key={i} className="mt-1 rounded-r border-l-2 border-x-blue bg-x-surface px-2 py-1 text-caption"><b>{m.member}</b> {m.text}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
