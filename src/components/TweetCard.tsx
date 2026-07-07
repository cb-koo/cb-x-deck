'use client';
import type { StoredTweet } from '@/lib/types';
import { formatCount, formatDate } from '@/lib/format';
import { MediaGrid } from './MediaGrid';

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
  onSave?: (tweetId: string) => void;
  onUnsave?: (tweetId: string) => void;
  onMarkSeen?: (tweetId: string) => void;
}

export function TweetCard({ tweet: t, onSave, onUnsave, onMarkSeen }: TweetCardProps) {
  return (
    <article className={`border-b border-gray-200 px-3 py-3 text-[15px] leading-normal dark:border-gray-800 ${t.seenAt ? 'opacity-55' : ''}`}>
      <div className="flex gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.authorAvatarUrl
          ? <img src={t.authorAvatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
          : <div className="h-10 w-10 shrink-0 rounded-full bg-gray-300" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1 text-sm">
            <span className="truncate font-bold">{t.authorName ?? t.authorHandle}</span>
            <span className="truncate text-gray-500">@{t.authorHandle}</span>
            <span className="text-gray-500">· {timeAgo(t.tweetCreatedAt)}</span>
            {t.authorFollowers !== null && (
              <span className="ml-auto rounded bg-gray-100 px-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                팔로워 {formatCount(t.authorFollowers)}
              </span>
            )}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{t.text}</p>
          <MediaGrid media={t.media} />
          {t.quoted && (
            <div className="mt-2 rounded-xl border border-gray-200 p-2 text-sm dark:border-gray-700">
              {t.quoted.userName && <span className="font-bold">@{t.quoted.userName} </span>}
              <span className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{t.quoted.text}</span>
            </div>
          )}
          <div className="mt-2 flex gap-4 text-xs text-gray-500">
            <span>💬 {formatCount(t.metrics.replies)}</span>
            <span>🔁 {formatCount(t.metrics.retweets)}</span>
            <span>❤️ {formatCount(t.metrics.likes)}</span>
            <span>👁 {formatCount(t.metrics.views)}</span>
            <span>🔖 {formatCount(t.metrics.bookmarks)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <span>수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}</span>
            <span className="ml-auto flex gap-1">
              {t.tweetUrl && <a href={t.tweetUrl} target="_blank" className="rounded px-1.5 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800">원문↗</a>}
              {!t.seenAt && onMarkSeen && (
                <button onClick={() => onMarkSeen(t.tweetId)} className="rounded px-1.5 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800">✓ 읽음</button>
              )}
              {t.isCandidate
                ? <button onClick={() => onUnsave?.(t.tweetId)} className="rounded px-1.5 py-0.5 text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-800">★ 저장됨</button>
                : <button onClick={() => onSave?.(t.tweetId)} className="rounded px-1.5 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800">☆ 저장</button>}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
