'use client';
import type { StoredTweet } from '@/lib/types';
import { formatCount, formatDate } from '@/lib/format';
import { MediaGrid } from './MediaGrid';
import { QuotedCard } from './QuotedCard';
import { TweetText } from './TweetText';
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
}

// hover: Reply·View·Bookmark 파랑, Repost 초록, Like 핑크 (실제 X 동작)
const metricBase = 'group flex items-center gap-1 text-[13px] text-x-secondary transition-colors';

export function TweetCard({ tweet: t, meId, onSave, onUnsave }: TweetCardProps) {
  const savedByMe = !!meId && t.savedBy.some((m) => m.id === meId);
  const profileUrl = `https://x.com/${t.authorHandle}`;
  return (
    <article className="border-b border-x-border bg-white px-4 py-3 text-[15px] leading-5 text-x-text transition-colors hover:bg-x-hover">
      <div className="flex gap-3">
        <a href={profileUrl} target="_blank" rel="noopener" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.authorAvatarUrl
            ? <img src={t.authorAvatarUrl} alt="" className="h-10 w-10 rounded-full" />
            : <div className="h-10 w-10 rounded-full bg-x-border-strong" />}
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1">
            {t.isNew && (
              <span className="rounded bg-x-blue px-1 text-[10px] font-bold leading-4 text-white"
                    title="직전 새로고침 이후 새로 들어온 트윗">NEW</span>
            )}
            <a href={profileUrl} target="_blank" rel="noopener" className="flex min-w-0 items-baseline gap-x-1">
              <span className="truncate text-[15px] font-bold text-x-text hover:underline">{t.authorName ?? t.authorHandle}</span>
              <span className="truncate text-[15px] text-x-secondary">@{t.authorHandle}</span>
            </a>
            {t.tweetUrl
              ? <a href={t.tweetUrl} target="_blank" rel="noopener"
                   className="text-[15px] text-x-secondary hover:underline">· {timeAgo(t.tweetCreatedAt)}</a>
              : <span className="text-[15px] text-x-secondary">· {timeAgo(t.tweetCreatedAt)}</span>}
            {t.authorFollowers !== null && (
              <span className="ml-auto rounded bg-x-border px-1 text-xs text-x-secondary">
                팔로워 {formatCount(t.authorFollowers)}
              </span>
            )}
          </div>
          <TweetText text={t.text} className="mt-0.5" />
          <MediaGrid media={t.media} />
          {t.quoted && <QuotedCard quoted={t.quoted} />}
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
          <div className="mt-2 flex items-center gap-2 text-xs text-x-muted">
            <span>수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}</span>
            <span className="flex items-center gap-0.5">
              {t.savedBy.map((m) => (
                <span key={m.id} title={`${m.name} 저장`}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ backgroundColor: m.color }}>
                  {m.name.slice(0, 1)}
                </span>
              ))}
            </span>
            <span className="ml-auto flex gap-1">
              {savedByMe
                ? <button onClick={() => onUnsave?.(t.tweetId)} className="rounded px-1.5 py-0.5 text-amber-500 hover:bg-x-border">★ 저장됨</button>
                : <button onClick={() => onSave?.(t.tweetId)} className="rounded px-1.5 py-0.5 hover:bg-x-border">☆ 저장</button>}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
