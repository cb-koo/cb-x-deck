'use client';
import { useState } from 'react';
import type { StoredTweet, TweetTranslation } from '@/lib/types';
import { formatCount, formatDate } from '@/lib/format';
import { flagYakkiho } from '@/lib/complianceFlags';
import { MediaGrid } from './MediaGrid';
import { QuotedCard } from './QuotedCard';
import { TweetText } from './TweetText';
import { TweetExpansion } from './TweetExpansion';
import { Button } from './ui';
import { ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon } from './XIcons';

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
  onDismiss?: (tweetId: string) => void;
  onUndismiss?: (tweetId: string) => void;
  dismissedView?: boolean;
  tourAnchor?: boolean;
  translation?: TweetTranslation | null;
  showTranslation?: boolean;              // 컬럼 기본 표시 상태
  onTranslate?: (tweetId: string) => void;
  translating?: boolean;                  // 이 카드 번역 진행 중
}

// hover: Reply·View·Bookmark 파랑, Repost 초록, Like 핑크 (실제 X 동작)
const metricBase = 'group flex items-center gap-1 text-ui text-x-secondary transition-colors';

export function TweetCard({ tweet: t, meId, onSave, onUnsave, onDismiss, onUndismiss, dismissedView, tourAnchor,
                            translation, showTranslation, onTranslate, translating }: TweetCardProps) {
  const [showOverride, setShowOverride] = useState<boolean | null>(null);
  const showTr = showOverride ?? showTranslation ?? false;
  const savedByMe = !!meId && t.savedBy.some((m) => m.id === meId);
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
                  <span className="text-[10px] font-bold text-x-blue" title="자동 기계번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                  <button onClick={() => setShowOverride(false)} className="text-caption text-x-muted hover:underline">원문만 보기</button>
                </div>
                <TweetText text={translation.content} />
              </div>
            ) : (
              <button onClick={() => setShowOverride(true)} className="mt-1 text-caption text-x-blue hover:underline">🌐 번역 보기</button>
            )
          ) : (
            onTranslate && (
              <button onClick={() => { onTranslate(t.tweetId); setShowOverride(true); }} disabled={translating}
                      title="이 카드를 한국어로" className="mt-1 text-caption text-x-blue hover:underline disabled:opacity-50">
                {translating ? '번역 중…' : '🌐 번역'}
              </button>
            )
          )}
          <MediaGrid media={t.media} />
          {t.quoted && <QuotedCard quoted={t.quoted} translation={showTr ? (translation?.quotedContent ?? null) : null} />}
          {/* 엔게이지먼트 바 — 실제 X 순서: Reply · Repost · Like · View · Bookmark */}
          <div className="mt-3 flex max-w-[425px] items-center justify-between">
            <span title="답글 (Reply)" className={`${metricBase} hover:text-x-blue`}>
              <ReplyIcon /> {formatCount(t.metrics.replies)}
            </span>
            <span title="리포스트 (Repost)" className={`${metricBase} hover:text-x-green`}>
              <RepostIcon /> {formatCount(t.metrics.retweets)}
            </span>
            <span title="좋아요 (Like)" className={`${metricBase} hover:text-x-pink`}>
              <LikeIcon /> {formatCount(t.metrics.likes)}
            </span>
            <span title="조회수 (View)" className={`${metricBase} hover:text-x-blue`}>
              <ViewIcon /> {formatCount(t.metrics.views)}
            </span>
            <span title="북마크 (Bookmark)" className={`${metricBase} hover:text-x-blue`}>
              <BookmarkIcon /> {formatCount(t.metrics.bookmarks)}
            </span>
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
            {savedByMe
              ? <Button variant="ghost" onClick={() => onUnsave?.(t.tweetId)} data-tour={tourAnchor ? 'col-save' : undefined} className="font-medium text-amber-500">★ 저장됨</Button>
              : <Button variant="ghost" onClick={() => onSave?.(t.tweetId)} data-tour={tourAnchor ? 'col-save' : undefined}>☆ 저장</Button>}
            {dismissedView
              ? <Button variant="ghost" onClick={() => onUndismiss?.(t.tweetId)}>되돌리기</Button>
              : onDismiss && <Button variant="ghost" onClick={() => onDismiss(t.tweetId)} title="벤치마크 무관 — 숨김" className="text-x-muted">✕ 버림</Button>}
          </span>
        } />
        <p className="px-1 text-right text-caption text-x-muted">
          수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}
        </p>
      </div>
    </article>
  );
}
