'use client';
import { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { DraftRow } from '@/lib/draftStore';
import type { RefSnapshot } from '@/lib/draftTypes';
import { xWeightedLength, X_MAX_WEIGHTED } from '@/lib/xLength';
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags, variantLabel } from '@/lib/draftUi';
import { MediaGrid } from '@/components/MediaGrid';
import { RefreshIcon, TrashIcon } from '@/components/XIcons';
import { useTranslations } from '@/components/useTranslations';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import type { DraftStatus } from '@/lib/draftStatus';

const MODE_LABEL: Record<DraftRow['referenceMode'], string> = {
  off: '참고 없음', form: '형식만', angle: '앵글만', both: '형식 + 앵글',
};

// 초안 카드 — X 실측(600px·radius16·아바타40·본문 15/20). 지표·배지·이미지 자리 없음(없는 데이터는 자리도 안 만듦)
export function DraftCard({ draft, banned, onEdit, onRewrite, rewriteBusy, onDelete, onRegenPost, regenBusyIndex, onDismissFlag, onRestoreAllFlags, onChangeStatus, siblingTotal }: {
  draft: DraftRow; banned: string[];
  onEdit: () => void; onRewrite: (feedback: string, baseIndex: number) => void; rewriteBusy: boolean;
  onDelete: () => void; onRegenPost: (index: number) => void; regenBusyIndex: number | null;
  onDismissFlag: (key: string, dismiss: boolean) => void;
  onRestoreAllFlags: () => void;
  onChangeStatus: (s: DraftStatus) => void;
  siblingTotal: number | null; // 다중 시안 형제 수 (batch 없으면 null)
}) {
  const [refsOpen, setRefsOpen] = useState(false);
  // 레퍼런스 번역 — 덱/보관함과 같은 훅·같은 캐시(tweet_translation, tweet_id 단위 전역).
  // 덱에서 이미 번역한 트윗은 여기서 과금 없이 재사용되고, 여기서 번역한 것도 덱에서 재사용된다.
  const refTr = useTranslations();
  const [copied, setCopied] = useState(false);
  const [copiedPost, setCopiedPost] = useState<number | null>(null);
  const [rwOpen, setRwOpen] = useState(false);   // 다시 쓰기 피드백 입력 열림
  const [rwText, setRwText] = useState('');
  const current = draft.edited ?? draft.content;
  const flags = collectDraftFlags(current, banned, draft.dismissedFlags);
  const active = flags.filter((f) => !f.dismissed);
  const dismissedCount = flags.length - active.length;
  const isThread = draft.format === 'thread';

  // 버전 이력 — 재생성 직전 스냅샷들(history) + 현재 표시본. ‹ 1/2 › 페이저로 이전 버전 열람.
  // verIdx=null은 '항상 최신' — 새 버전이 생겨도 자동으로 따라간다.
  const versions = [...draft.history, current];
  const [verIdx, setVerIdx] = useState<number | null>(null);
  const shownIdx = Math.min(verIdx ?? versions.length - 1, versions.length - 1);
  const shown = versions[shownIdx];
  const isLatest = shownIdx === versions.length - 1;
  const total = shown.posts.reduce((n, p) => n + xWeightedLength(p.text), 0);

  async function copyAll() {
    await navigator.clipboard.writeText(draftCopyText(shown));
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  // 검토용 한국어 번역 — 보고 있는 버전 기준. 카드 로컬은 한 버전 슬롯만 들고,
  // 버전을 오가면 서버의 버전별 캐시(draft.translation 맵)에서 무과금으로 다시 받아온다.
  const [trPosts, setTrPosts] = useState<string[] | null>(null);
  const [trFor, setTrFor] = useState('');
  const [showTr, setShowTr] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [trErr, setTrErr] = useState('');
  const srcKey = JSON.stringify(shown.posts.map((p) => p.text));
  const hasTr = trPosts !== null && trFor === srcKey;

  async function toggleTranslate() {
    if (showTr && hasTr) { setShowTr(false); return; }
    if (hasTr) { setShowTr(true); return; }
    setTranslating(true); setTrErr('');
    const key = srcKey; // 요청 중 버전 이동 대비 — 응답을 요청 시점 버전에 귀속
    try {
      const r = await apiFetch(`/api/drafts/${draft.id}/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionIndex: shownIdx }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setTrErr((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      setTrPosts((body as { posts: string[] }).posts); setTrFor(key); setShowTr(true);
    } catch {
      setTrErr('번역에 실패했어요 — 네트워크를 확인해주세요');
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-x-border-strong bg-white">
      {/* 상단 도구층 스트립 — 상태·조건 메타를 좌상단 동일 위치에, 카드를 열지 않고 훑도록 (스펙 §DraftCard) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-x-border bg-x-surface px-4 py-2">
        <DraftStatusChip status={draft.status} onChange={onChangeStatus} />
        {/* 인플루언서 배정 — 상태와 나란히 "누구에게·어디까지"를 한 자리에서 (스펙 §F). 미배정이면 자리 자체를 만들지 않는다 */}
        {draft.influencerHandle && (
          <span className="text-caption text-x-muted">@{draft.influencerHandle}</span>
        )}
        {draft.batchId !== null && siblingTotal !== null && (
          <span className="text-caption text-x-muted">
            시안 {variantLabel(draft.variantIndex ?? 0)} · 같은 조건 {siblingTotal}개 중
          </span>
        )}
        <span className="ml-auto text-caption text-x-muted">
          {[...draft.procedureNames, draft.format === 'thread' ? '스레드' : '단문'].join(' · ')}
        </span>
      </div>
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
            {shown.posts.map((p, i) => {
              const hb = i === 0 ? hookBoundary(p.text) : null;
              const len = xWeightedLength(p.text);
              return (
                <div key={i}>
                  {isThread && <p className="text-caption font-bold text-x-muted">{i + 1} / {shown.posts.length}</p>}
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
                  {showTr && hasTr && (
                    <div className="mt-1 rounded-lg border border-x-border bg-x-blue/[0.03] px-2.5 py-2">
                      <span className="text-[10px] font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                      <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-5">{trPosts?.[i]}</p>
                    </div>
                  )}
                  <MediaGrid media={p.media} />
                  <p className="mt-1 flex items-center gap-3 text-caption tabular-nums text-x-muted">
                    <span className={len > X_MAX_WEIGHTED ? 'font-bold text-amber-700' : ''}>X 기준 {len} / {X_MAX_WEIGHTED}{len > X_MAX_WEIGHTED && ` — ${len - X_MAX_WEIGHTED} 줄여야 해요`}</span>
                    {isThread && isLatest && (
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
          {versions.length > 1 && (
            <p className="mt-1.5 flex items-center justify-end gap-1.5 text-caption tabular-nums text-x-muted">
              {!isLatest && <span>이전 버전 (읽기 전용)</span>}
              <button onClick={() => setVerIdx(shownIdx - 1)} disabled={shownIdx === 0} aria-label="이전 버전 보기"
                      className="rounded px-1.5 text-[15px] leading-none text-x-blue-text hover:bg-x-blue/10 disabled:opacity-30 disabled:hover:bg-transparent">‹</button>
              {shownIdx + 1} / {versions.length}
              <button onClick={() => setVerIdx(shownIdx + 2 >= versions.length ? null : shownIdx + 1)} disabled={isLatest} aria-label="다음 버전 보기"
                      className="rounded px-1.5 text-[15px] leading-none text-x-blue-text hover:bg-x-blue/10 disabled:opacity-30 disabled:hover:bg-transparent">›</button>
            </p>
          )}
          <p className="mt-2 text-[13px]">
            <button onClick={toggleTranslate} disabled={translating} className="text-x-blue-text hover:underline disabled:opacity-50">
              {translating ? '번역 중…' : showTr && hasTr ? '원문만 보기' : '🌐 번역 보기'}
            </button>
            {trErr && <span className="ml-2 text-red-600">{trErr}</span>}
          </p>
          {/* 액션 행 — X 액션 바 자리에 우리 액션 (없는 지표를 채우지 않고 교체) */}
          <div className="mt-3 flex max-w-[440px] items-center gap-1 text-[13px] text-x-secondary">
            <button onClick={onEdit} disabled={!isLatest} title={isLatest ? undefined : '이전 버전을 보는 중 — 편집은 최신 버전에서'}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 text-x-blue-text hover:bg-x-blue/10 disabled:opacity-50 disabled:hover:bg-transparent">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M14.06 9.02l.92.92L5.92 19H5v-.92l9.06-9.06zM17.66 3c-.25 0-.51.1-.7.29l-1.83 1.83 3.75 3.75 1.83-1.83c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.2-.2-.45-.29-.71-.29zm-3.6 3.19L3 17.25V21h3.75L17.81 9.94l-3.75-3.75z" /></svg>
              편집
            </button>
            <button onClick={() => setRwOpen(!rwOpen)} disabled={rewriteBusy}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5 disabled:opacity-50 disabled:hover:bg-transparent">
              <RefreshIcon className="h-[19px] w-[19px]" />{rewriteBusy ? '다시 쓰는 중…' : '다시 쓰기'}
            </button>
            <button onClick={copyAll} className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-x-text/5">
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-current" aria-hidden><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>
              {copied ? '복사됨 ✓' : '복사'}
            </button>
            <button onClick={onDelete} aria-label="초안 삭제" className="flex items-center rounded-full px-2 py-1 hover:bg-red-50 hover:text-red-600">
              <TrashIcon className="h-[19px] w-[19px]" />
            </button>
            <span className="ml-auto tabular-nums">{isThread ? `${shown.posts.length}개 · 총 ${total}자` : ''}</span>
          </div>
          {rwOpen && !rewriteBusy && (
            <div className="mt-2 rounded-xl border border-x-border-strong p-2.5">
              {!isLatest && (
                <p className="mb-1 text-caption text-x-muted">지금 보고 있는 {shownIdx + 1}번 버전을 기준으로 다시 써요 — 결과는 새 버전({versions.length + 1}번)으로 추가됩니다</p>
              )}
              <textarea value={rwText} onChange={(e) => setRwText(e.target.value)} rows={2} autoFocus
                        placeholder="고칠 점이나 원하는 방향을 적어주세요 — 비워두면 같은 조건으로 다시 생성해요"
                        className="w-full resize-y text-[15px] leading-5 outline-none placeholder:text-x-muted" />
              <div className="mt-1.5 flex items-center justify-end gap-2">
                <button onClick={() => { setRwOpen(false); setRwText(''); }}
                        className="rounded-full px-3 py-1 text-[13px] text-x-secondary hover:bg-x-text/5">취소</button>
                <button onClick={() => { onRewrite(rwText.trim(), shownIdx); setRwOpen(false); setRwText(''); setVerIdx(null); }}
                        className="rounded-full bg-x-blue px-3 py-1 text-[13px] font-bold text-white hover:opacity-90">
                  {rwText.trim() ? '피드백 반영해 다시 쓰기' : '같은 조건으로 다시 쓰기'}
                </button>
              </div>
            </div>
          )}
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
          <button onClick={() => { const opening = !refsOpen; setRefsOpen(opening); if (opening) void refTr.loadCached(draft.refs.map((r) => r.tweetId)); }}
                  disabled={draft.refs.length === 0}
                  className="text-left disabled:cursor-default">
            참고 레퍼런스 {draft.refs.length}건{draft.refs.length > 0 && <span className="text-x-blue-text"> · {MODE_LABEL[draft.referenceMode]} {refsOpen ? '⌃' : '⌄'}</span>}
          </button>
          <span className="shrink-0 text-caption tabular-nums text-x-muted">
            {[draft.clientName, ...draft.procedureNames].filter(Boolean).join(' · ')}
          </span>
        </div>
        {refsOpen && draft.refs.map((r: RefSnapshot) => (
          <div key={r.tweetId} className="mt-2 rounded-lg border border-x-border bg-white px-3 py-2">
            <p className="text-ui"><b>{r.name ?? r.handle}</b> <span className="text-x-muted">@{r.handle}</span>
              <a href={`https://x.com/i/status/${r.tweetId}`} target="_blank" rel="noreferrer" className="ml-2 text-x-blue-text hover:underline">원문 ↗</a>
            </p>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[15px] leading-5">{r.excerpt}</p>
            {refTr.showTranslations && refTr.translations[r.tweetId] && (
              <div className="mt-1 rounded-lg border border-x-border bg-x-blue/[0.03] px-2.5 py-1.5">
                <span className="text-[10px] font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[15px] leading-5">{refTr.translations[r.tweetId].content}</p>
              </div>
            )}
            {r.memos.map((m, i) => (
              <p key={i} className="mt-1 rounded-r border-l-2 border-x-blue bg-x-surface px-2 py-1 text-caption"><b>{m.member}</b> {m.text}</p>
            ))}
          </div>
        ))}
        {refsOpen && draft.refs.length > 0 && (
          <p className="mt-1.5 text-[13px]">
            <button onClick={() => void refTr.translateAll(draft.refs.map((r) => r.tweetId))} disabled={refTr.translatingAll}
                    className="text-x-blue-text hover:underline disabled:opacity-50">
              {refTr.translatingAll ? '번역 중…' : refTr.showTranslations ? '원문만 보기' : '🌐 번역 보기'}
            </button>
            {refTr.translateErr && <span className="ml-2 text-red-600">{refTr.translateErr}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
