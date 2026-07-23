'use client';
import type { DeckQuoted, DeckTweet } from '@/lib/types';
import { MediaGrid } from './MediaGrid';
import { TweetText } from './TweetText';

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 실제 X 인용 카드 레이아웃: 아바타+이름+@핸들+날짜 헤더 → 본문 → 미디어.
// 박스 전체 클릭 = 인용 원문 (중첩 <a> 회피를 위해 div onClick — 내부 링크는 TweetText가 전파 차단)
export function QuotedCard({ quoted, translation }: { quoted: DeckQuoted & { enriched?: DeckTweet | null }; translation?: string | null }) {
  const e = quoted.enriched ?? null;
  const handle = e?.authorHandle ?? quoted.screenName;
  const name = e?.authorName ?? quoted.userName;
  const url = e?.tweetUrl ?? (handle ? `https://x.com/${handle}/status/${quoted.id}` : null);

  return (
    <div
      role={url ? 'link' : undefined}
      onClick={url ? () => window.open(url, '_blank', 'noopener') : undefined}
      className={`mt-3 overflow-hidden rounded-2xl border border-x-border-strong text-[15px] ${url ? 'cursor-pointer transition-colors hover:bg-x-hover' : ''}`}
    >
      <div className="px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {e?.authorAvatarUrl
            ? <img src={e.authorAvatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />
            : <div className="h-5 w-5 shrink-0 rounded-full bg-x-border-strong" />}
          <span className="flex min-w-0 items-baseline gap-x-1">
            {name && <span className="truncate font-bold text-x-text">{name}</span>}
            {handle && <span className="truncate text-x-secondary">@{handle}</span>}
            {e?.tweetCreatedAt && <span className="shrink-0 text-x-secondary">· {shortDate(e.tweetCreatedAt)}</span>}
          </span>
        </div>
        <TweetText text={e?.text ?? quoted.text} className="mt-1 text-x-text" />
        {translation && (
          <div className="mt-1 border-t border-x-border pt-1">
            <span className="text-[10px] font-bold text-x-blue" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
            <TweetText text={translation} className="text-x-text" />
          </div>
        )}
      </div>
      {e && e.media.length > 0 && (
        <div className="px-3 pb-3 [&>div]:mt-0">
          <MediaGrid media={e.media} />
        </div>
      )}
    </div>
  );
}
