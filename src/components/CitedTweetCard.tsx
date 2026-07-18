'use client';
import type { BriefingCitation } from '@/lib/briefingTypes';
import { formatCount } from '@/lib/format';
import { TweetText } from './TweetText';
import { MediaGrid } from './MediaGrid';
import { QuotedCard } from './QuotedCard';
import { ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon } from './XIcons';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const metricBase = 'flex items-center gap-1 text-[13px] text-x-secondary';

// 브리핑 근거 트윗 — TweetCard와 같은 X 트윗 마크업의 읽기 전용 축약판(저장/버림/확장 액션 없음).
// 본문의 [n] 칩이 id="cite-{n}"으로 스크롤해 온다.
export function CitedTweetCard({ c }: { c: BriefingCitation }) {
  const t = c.tweet;
  if (!t) {
    // 스냅샷 없는 구버전 데이터 폴백 — 최소 정보만
    return (
      <div id={`cite-${c.n}`} className="border-b border-x-border px-4 py-2 text-[13px] text-x-secondary">
        <span className="mr-1 font-bold text-x-blue">{c.n}</span>
        ♥{formatCount(c.likes)} {c.text.replace(/\s+/g, ' ').slice(0, 140)}
        {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-x-blue hover:underline">원문</a>}
      </div>
    );
  }
  const profileUrl = `https://x.com/${t.authorHandle}`;
  return (
    <article id={`cite-${c.n}`} className="border-b border-x-border bg-white px-4 py-3 text-[15px] leading-5 text-x-text">
      <div className="flex gap-2">
        <span className="w-5 shrink-0 pt-2.5 text-right text-[13px] font-bold text-x-blue" title="본문 인용 번호">{c.n}</span>
        <a href={profileUrl} target="_blank" rel="noopener" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.authorAvatarUrl
            ? <img src={t.authorAvatarUrl} alt="" className="h-10 w-10 rounded-full" />
            : <div className="h-10 w-10 rounded-full bg-x-border-strong" />}
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1">
            {c.flags.length > 0 && (
              <span title={`薬機法 리스크 용어: ${c.flags.join(', ')} (표식일 뿐, 차단 아님)`}
                    className="rounded bg-amber-100 px-1 text-[10px] font-bold leading-4 text-amber-700">⚠️ 薬機法</span>
            )}
            <a href={profileUrl} target="_blank" rel="noopener" className="flex min-w-0 items-baseline gap-x-1">
              <span className="truncate font-bold text-x-text hover:underline">{t.authorName ?? t.authorHandle}</span>
              <span className="truncate text-x-secondary">@{t.authorHandle}</span>
            </a>
            {t.tweetUrl
              ? <a href={t.tweetUrl} target="_blank" rel="noopener"
                   className="text-x-secondary hover:underline">· {fmtDate(t.tweetCreatedAt)}</a>
              : <span className="text-x-secondary">· {fmtDate(t.tweetCreatedAt)}</span>}
          </div>
          <TweetText text={t.text} className="mt-0.5" />
          <MediaGrid media={t.media} />
          {t.quoted && <QuotedCard quoted={t.quoted} />}
          <div className="mt-3 flex max-w-[425px] items-center justify-between">
            <span title="답글 (Reply)" className={metricBase}><ReplyIcon /> {formatCount(t.metrics.replies)}</span>
            <span title="리포스트 (Repost)" className={metricBase}><RepostIcon /> {formatCount(t.metrics.retweets)}</span>
            <span title="좋아요 (Like)" className={metricBase}><LikeIcon /> {formatCount(t.metrics.likes)}</span>
            <span title="조회수 (View)" className={metricBase}><ViewIcon /> {formatCount(t.metrics.views)}</span>
            <span title="북마크 (Bookmark)" className={metricBase}><BookmarkIcon /> {formatCount(t.metrics.bookmarks)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
