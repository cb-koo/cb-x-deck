'use client';
import type { StoredTweet } from '@/lib/types';
import { formatCount, formatDate } from '@/lib/format';
import { MediaGrid } from './MediaGrid';
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

// X 라이트 모드 팔레트: 본문 #0f1419 / 보조 #536471 / 경계 #eff3f4
// hover: Reply·View·Bookmark #1d9bf0, Repost #00ba7c, Like #f91880
const metricBase = 'group flex items-center gap-1 text-[13px] text-[#536471] transition-colors';

export function TweetCard({ tweet: t, meId, onSave, onUnsave }: TweetCardProps) {
  const savedByMe = !!meId && t.savedBy.some((m) => m.id === meId);
  return (
    <article
      className="border-b border-[#eff3f4] bg-white px-4 py-3 text-[15px] leading-5 text-[#0f1419] [font-family:-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif]"
    >
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.authorAvatarUrl
          ? <img src={t.authorAvatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
          : <div className="h-10 w-10 shrink-0 rounded-full bg-[#cfd9de]" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1">
            {t.isNew && (
              <span className="rounded bg-[#1d9bf0] px-1 text-[10px] font-bold leading-4 text-white"
                    title="직전 새로고침 이후 새로 들어온 트윗">NEW</span>
            )}
            <span className="truncate text-[15px] font-bold text-[#0f1419]">{t.authorName ?? t.authorHandle}</span>
            <span className="truncate text-[15px] text-[#536471]">@{t.authorHandle}</span>
            <span className="text-[15px] text-[#536471]">· {timeAgo(t.tweetCreatedAt)}</span>
            {t.authorFollowers !== null && (
              <span className="ml-auto rounded bg-[#eff3f4] px-1 text-xs text-[#536471]">
                팔로워 {formatCount(t.authorFollowers)}
              </span>
            )}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{t.text}</p>
          <MediaGrid media={t.media} />
          {t.quoted && (
            <div className="mt-3 rounded-2xl border border-[#cfd9de] px-3 py-2 text-[15px]">
              {t.quoted.userName && <span className="font-bold text-[#0f1419]">@{t.quoted.userName} </span>}
              <span className="whitespace-pre-wrap text-[#0f1419]">{t.quoted.text}</span>
            </div>
          )}
          {/* 엔게이지먼트 바 — 실제 X 순서: Reply · Repost · Like · View · Bookmark */}
          <div className="mt-3 flex max-w-[425px] items-center justify-between">
            <span title="답글 (Reply)" className={`${metricBase} hover:text-[#1d9bf0]`}>
              <ReplyIcon /> {formatCount(t.metrics.replies)}
            </span>
            <span title="리포스트 (Repost)" className={`${metricBase} hover:text-[#00ba7c]`}>
              <RepostIcon /> {formatCount(t.metrics.retweets)}
            </span>
            <span title="좋아요 (Like)" className={`${metricBase} hover:text-[#f91880]`}>
              <LikeIcon /> {formatCount(t.metrics.likes)}
            </span>
            <span title="조회수 (View)" className={`${metricBase} hover:text-[#1d9bf0]`}>
              <ViewIcon /> {formatCount(t.metrics.views)}
            </span>
            <span title="북마크 (Bookmark)" className={`${metricBase} hover:text-[#1d9bf0]`}>
              <BookmarkIcon /> {formatCount(t.metrics.bookmarks)}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-[#8b98a5]">
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
              {t.tweetUrl && <a href={t.tweetUrl} target="_blank" className="rounded px-1.5 py-0.5 hover:bg-[#eff3f4]">원문↗</a>}
              {savedByMe
                ? <button onClick={() => onUnsave?.(t.tweetId)} className="rounded px-1.5 py-0.5 text-amber-500 hover:bg-[#eff3f4]">★ 저장됨</button>
                : <button onClick={() => onSave?.(t.tweetId)} className="rounded px-1.5 py-0.5 hover:bg-[#eff3f4]">☆ 저장</button>}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
