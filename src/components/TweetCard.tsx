'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { StoredTweet, TweetTranslation } from '@/lib/types';
import { formatCount, formatDate } from '@/lib/format';
import { flagYakkiho } from '@/lib/complianceFlags';
import { MediaGrid } from './MediaGrid';
import { QuotedCard } from './QuotedCard';
import { TweetText } from './TweetText';
import { TweetExpansion } from './TweetExpansion';
import { Button } from './ui';
import { ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon, ShareIcon, PenIcon } from './XIcons';
import { tweetPermalink } from '@/lib/tweetLink';
import { useToast } from '@/lib/toastContext';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export interface TweetCardProps {
  tweet: StoredTweet;
  meId?: string | null;
  onSave?: (tweetId: string) => void;
  onUnsave?: (tweetId: string) => void;
  onSaveMemo?: (tweetId: string, memo: string) => Promise<boolean>;   // 있으면 저장 직후 인라인 메모 캡처 활성 (덱 전용)
  libraryHref?: string;   // 저장 후 "보관함에서 이어보기" 링크 (덱에서만 전달)
  onDismiss?: (tweetId: string) => void;
  onUndismiss?: (tweetId: string) => void;
  dismissedView?: boolean;
  tourAnchor?: boolean;
  translation?: TweetTranslation | null;
  showTranslation?: boolean;              // 컬럼 기본 표시 상태
  onTranslate?: (tweetId: string) => void;
  translating?: boolean;                  // 이 카드 번역 진행 중
  showCollectedAt?: boolean;              // 기본 true. 표 보기 팝업은 이 정보를 모달 헤더로 올려서 false를 넘긴다
}

// hover: Reply·View·Bookmark 파랑, Repost 초록, Like 핑크 (실제 X 동작)
const metricBase = 'group flex items-center gap-1 text-ui text-x-secondary transition-colors';

export function TweetCard({ tweet: t, meId, onSave, onUnsave, onSaveMemo, libraryHref, onDismiss, onUndismiss, dismissedView, tourAnchor,
                            translation, showTranslation, onTranslate, translating, showCollectedAt = true }: TweetCardProps) {
  const [showOverride, setShowOverride] = useState<boolean | null>(null);
  const { show } = useToast();
  const showTr = showOverride ?? showTranslation ?? false;
  const savedByMe = !!meId && t.savedBy.some((m) => m.id === meId);

  // 저장 시점 인라인 메모 캡처 (onSaveMemo 있을 때만 = 덱). 캡처 순간만 노출, 정리·수정은 보관함.
  const [memoTouched, setMemoTouched] = useState(false);   // 이번 세션에 저장을 눌러 캡처 흐름 진입
  const [memoOpen, setMemoOpen] = useState(false);          // 입력칸 펼침
  const [memoDone, setMemoDone] = useState(false);          // 메모 등록 완료
  const [memo, setMemo] = useState('');
  const [memoBusy, setMemoBusy] = useState(false);
  const [memoErr, setMemoErr] = useState(false);
  function handleSave() {
    onSave?.(t.tweetId);
    if (onSaveMemo) { setMemoTouched(true); setMemoOpen(true); setMemoDone(false); setMemoErr(false); }
  }
  function handleUnsave() {
    onUnsave?.(t.tweetId);
    setMemoTouched(false); setMemoOpen(false); setMemoDone(false); setMemo(''); setMemoErr(false);
  }
  async function submitMemo() {
    const text = memo.trim();
    if (!text || memoBusy || !onSaveMemo) return;
    setMemoBusy(true); setMemoErr(false);
    const ok = await onSaveMemo(t.tweetId, text);   // 실패해도 입력 보존 → 재시도
    setMemoBusy(false);
    if (ok) { setMemoOpen(false); setMemoDone(true); } else setMemoErr(true);
  }
  // 링크 복사 — X와 같은 자리·아이콘의 공유 버튼. 실패해도 버튼을 숨기지 않고 이유를 말한다 (설계 §E)
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(tweetPermalink(t.authorHandle, t.tweetId));
      show('링크를 복사했어요', { duration: 2500 });
    } catch {
      show('링크를 복사하지 못했어요 — 브라우저 권한을 확인해 주세요');
    }
  }
  const profileUrl = `https://x.com/${t.authorHandle}`;
  const yakkiho = flagYakkiho(t.text);
  const hasEyebrow = t.authorFollowers !== null;
  return (
    <article className="border-b border-x-border bg-white text-content text-x-text">
      {/* 흰 영역 = X 원본 + 계정 컨텍스트 (spec §7) */}
      {/* 카드 hover 하이라이트 없음 — X에선 카드 전체 클릭(상세 이동) 신호지만 덱 카드는 전체 클릭 동작이 없어 거짓 어포던스 (2026-07-19 사용자 결정) */}
      <div className="flex gap-3 px-4 pb-2 pt-3">
        {/* 아이브로(팔로워 캡션)가 있을 때만 pt-4 — 아바타를 이름 줄에 맞춤 */}
        <a href={profileUrl} target="_blank" rel="noopener" className={`shrink-0 self-start${hasEyebrow ? ' pt-4' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.authorAvatarUrl
            ? <img src={t.authorAvatarUrl} alt="" className="h-10 w-10 rounded-full" />
            : <div className="h-10 w-10 rounded-full bg-x-border-strong" />}
        </a>
        <div className="min-w-0 flex-1">
          {/* 아이브로 — 계정 규모 → 누구 → 내용 순서 (박스 배지 폐지) */}
          {hasEyebrow && (
            <p className="text-caption text-x-muted">팔로워 {formatCount(t.authorFollowers!)}</p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-1">
            {t.isNew && (
              <span className="rounded bg-x-blue px-1 text-[10px] font-bold leading-4 text-white"
                    title="직전 새로고침 이후 새로 들어온 트윗">NEW</span>
            )}
            {yakkiho.length > 0 && (
              <span title={`薬機法 리스크 용어: ${yakkiho.join(', ')} (표식일 뿐, 차단 아님)`}
                    className="rounded bg-amber-100 px-1 text-[10px] font-bold leading-4 text-amber-700">⚠️ 薬機法</span>
            )}
            <a href={profileUrl} target="_blank" rel="noopener" className="flex min-w-0 items-baseline gap-x-1">
              <span className="truncate font-bold hover:underline">{t.authorName ?? t.authorHandle}</span>
              <span className="truncate text-x-secondary">@{t.authorHandle}</span>
            </a>
            {t.tweetUrl
              ? <a href={t.tweetUrl} target="_blank" rel="noopener"
                   className="text-x-secondary hover:underline">· {timeAgo(t.tweetCreatedAt)}</a>
              : <span className="text-x-secondary">· {timeAgo(t.tweetCreatedAt)}</span>}
          </div>
          <TweetText text={t.text} className="mt-0.5" />
          {translation ? (
            showTr ? (
              <div className="mt-1 rounded-lg border border-x-border bg-x-blue/[0.03] px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                  <button onClick={() => setShowOverride(false)} className="text-caption text-x-muted hover:underline">원문만 보기</button>
                </div>
                <TweetText text={translation.content} />
              </div>
            ) : (
              <button onClick={() => setShowOverride(true)} className="mt-1 text-caption text-x-blue-text hover:underline">🌐 번역 보기</button>
            )
          ) : (
            onTranslate && (
              <button onClick={() => { onTranslate(t.tweetId); setShowOverride(true); }} disabled={translating}
                      title="이 카드를 한국어로" className="mt-1 text-caption text-x-blue-text hover:underline disabled:opacity-50">
                {translating ? '번역 중…' : '🌐 번역'}
              </button>
            )
          )}
          <MediaGrid media={t.media} />
          {t.quoted && <QuotedCard quoted={t.quoted} translation={showTr ? (translation?.quotedContent ?? null) : null} />}
          {/* 엔게이지먼트 바 — 실제 X 순서: Reply · Repost · Like · View · Bookmark */}
          <div className="mt-3 flex max-w-[425px] items-center justify-between">
            <span title="답글 (Reply)" className={`${metricBase} hover:text-x-blue-text`}>
              <ReplyIcon /> {formatCount(t.metrics.replies)}
            </span>
            <span title="리포스트 (Repost)" className={`${metricBase} hover:text-x-green`}>
              <RepostIcon /> {formatCount(t.metrics.retweets)}
            </span>
            <span title="좋아요 (Like)" className={`${metricBase} hover:text-x-pink`}>
              <LikeIcon /> {formatCount(t.metrics.likes)}
            </span>
            <span title="조회수 (View)" className={`${metricBase} hover:text-x-blue-text`}>
              <ViewIcon /> {formatCount(t.metrics.views)}
            </span>
            <span title="북마크 (Bookmark)" className={`${metricBase} hover:text-x-blue-text`}>
              <BookmarkIcon /> {formatCount(t.metrics.bookmarks)}
            </span>
            {/* 공유 — 이 줄에서 유일하게 누를 수 있는 요소. 지표는 글자색만 변하고 이것만 원형 배경이 생겨
                "누를 수 있음"을 구분한다. 파랑은 호버 상태에만 쓴다(상시 의미색 3용도 제한과 무관).
                액션은 풋터 존 규칙(2026-07-19 §7)의 의도된 예외 — X 손버릇 자리이기 때문 (설계 2026-07-30 §C).
                음수 마진은 34px 히트 영역을 확보하면서 줄 높이·정렬을 그대로 두기 위한 것. */}
            <button type="button" onClick={copyLink}
                    aria-label="링크 복사" title="이 트윗 링크를 복사합니다"
                    className="-my-2 -mr-2 flex items-center rounded-full p-2 text-x-secondary transition-colors hover:bg-x-blue/10 hover:text-x-blue-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-blue">
              <ShareIcon />
            </button>
          </div>
        </div>
      </div>
      {/* 덱 풋터 존 — 회색 = 덱 기능층: 액션 줄(탐색|판단) + 시스템 메타 (spec §7) */}
      <div className="border-t border-x-border bg-x-surface px-2 pb-1 pt-1">
        <TweetExpansion tweetId={t.tweetId} toolbarRight={
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <span className="flex items-center gap-0.5 pr-1">
              {t.savedBy.filter((m) => m.id !== meId).map((m) => (
                <span key={m.id} title={`${m.name} 저장`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ backgroundColor: m.color }}>
                  {m.name.slice(0, 1)}
                </span>
              ))}
            </span>
            {t.savedBy.length > 0 && (
              <a href={`/generate?ref=${t.tweetId}`} title="이 트윗을 레퍼런스로 초안 만들기"
                 className="flex items-center gap-1 rounded-full px-2 py-1 text-ui text-x-secondary hover:bg-x-blue/10 hover:text-x-blue-text">
                <PenIcon className="h-[15px] w-[15px]" />초안
              </a>
            )}
            {(onSave || onUnsave) && (savedByMe
              ? <Button variant="ghost" onClick={handleUnsave} data-tour={tourAnchor ? 'col-save' : undefined} className="font-medium text-amber-500">★ 저장됨</Button>
              : <Button variant="ghost" onClick={handleSave} data-tour={tourAnchor ? 'col-save' : undefined}>☆ 저장</Button>)}
            {dismissedView
              ? <Button variant="ghost" onClick={() => onUndismiss?.(t.tweetId)}>되돌리기</Button>
              : onDismiss && <Button variant="ghost" onClick={() => onDismiss(t.tweetId)} title="벤치마크 무관 — 숨김" className="text-x-muted">✕ 버림</Button>}
          </span>
        } />
        {/* 저장 시점 인라인 메모 캡처 (덱 전용) — 캡처는 여기서 한 줄, 열람·수정·팀 코멘트는 보관함 (checklist §L) */}
        {onSaveMemo && memoOpen && (
          <div className="px-1 pt-1">
            {/* 지속 라벨 — placeholder는 포커스 시 사라지므로 무엇을 적는 칸인지 라벨로 고정 (checklist §L-3) */}
            <label htmlFor={`memo-${t.tweetId}`} className="block text-caption text-x-muted">
              메모 남기기 <span className="text-x-muted">(선택 · 나중에 보관함에서 정리)</span>
            </label>
            {/* items-stretch + 입력칸 min-h로 등록·✕ 버튼도 같은 높이(≈34px)로 커져 클릭 타깃 확보 (checklist §C·I) */}
            <div className="mt-0.5 flex items-stretch gap-1">
              <input
                id={`memo-${t.tweetId}`}
                autoFocus
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitMemo();   // IME 조합 중 Enter 무시
                  else if (e.key === 'Escape') setMemoOpen(false);                      // 접기 — 입력은 보존
                }}
                placeholder="예: 미니멀 스킨케어 벤치마킹"
                className="min-h-[34px] w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
              <button onClick={submitMemo} disabled={memoBusy || !memo.trim()}
                      className="shrink-0 rounded px-3 text-caption text-x-secondary hover:bg-x-hover disabled:opacity-40">
                {memoBusy ? '저장 중…' : '등록'}
              </button>
              <button onClick={() => setMemoOpen(false)} title="접기" aria-label="메모 접기"
                      className="shrink-0 rounded px-2.5 text-caption text-x-muted hover:bg-x-hover">✕</button>
            </div>
          </div>
        )}
        {onSaveMemo && memoOpen && memoErr && (
          <p className="px-1 pt-0.5 text-caption text-red-500">
            메모를 저장하지 못했어요. <button onClick={submitMemo} className="underline">다시 시도</button>
          </p>
        )}
        {onSaveMemo && !memoOpen && memoTouched && !memoDone && (
          <button onClick={() => { setMemoErr(false); setMemoOpen(true); }}
                  className="mx-1 mt-0.5 inline-block rounded px-1 py-1.5 text-caption text-x-blue-text hover:bg-x-hover hover:underline">＋ 메모 남기기</button>
        )}
        {onSaveMemo && memoDone && (
          <p className="px-1 pt-1 text-caption text-x-muted">
            ✓ 메모를 남겼어요 · {libraryHref
              // -my-1 py-1: 줄 높이는 유지한 채 링크 클릭 영역만 세로로 확장 (checklist §C·I)
              ? <Link href={libraryHref} className="-my-1 inline-block py-1 text-x-blue-text hover:underline">보관함</Link>
              : '보관함'}에서 이어서 정리할 수 있어요
          </p>
        )}
        {/* 표 보기 팝업은 이 정보를 모달 헤더로 올려 잡는다(2차 설계 §A-4) — 두 번 나오지 않게 여기선 끈다.
            덱 카드는 프롭을 안 넘겨 기본값 true라 지금 그대로다. */}
        {showCollectedAt && (
          <p className="px-1 text-right text-caption text-x-muted">
            수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}
          </p>
        )}
      </div>
    </article>
  );
}
