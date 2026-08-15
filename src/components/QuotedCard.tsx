'use client';
import { useState } from 'react';
import type { DeckQuoted, DeckTweet } from '@/lib/types';
import { kstMonthDayKo } from '@/lib/datetime';
import { MediaGrid } from './MediaGrid';
import { TweetText } from './TweetText';

// 실제 X 인용 카드 레이아웃: 아바타+이름+@핸들+날짜 헤더 → 본문 → 미디어.
// 박스 전체 클릭 = 인용 원문 (중첩 <a> 회피를 위해 div onClick — 내부 링크는 TweetText가 전파 차단)
// collapsible(보관함 밀도 모드): 접힘=본문 2줄+클릭하면 펼침(첫 클릭이 안전), 펼침=클릭이 원문 열기(기존 동작 복원)+별도 접기
export function QuotedCard({ quoted, translation, collapsible = false }: { quoted: DeckQuoted & { enriched?: DeckTweet | null }; translation?: string | null; collapsible?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = collapsible && !expanded;
  const e = quoted.enriched ?? null;
  const handle = e?.authorHandle ?? quoted.screenName;
  const name = e?.authorName ?? quoted.userName;
  const url = e?.tweetUrl ?? (handle ? `https://x.com/${handle}/status/${quoted.id}` : null);

  return (
    <div
      role={collapsed ? 'button' : url ? 'link' : undefined}
      onClick={collapsed ? () => setExpanded(true) : url ? () => window.open(url, '_blank', 'noopener') : undefined}
      className={`mt-3 overflow-hidden rounded-2xl border border-x-border-strong text-[15px] ${collapsed || url ? 'cursor-pointer transition-colors hover:bg-x-hover' : ''}`}
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
            {e?.tweetCreatedAt && <span className="shrink-0 text-x-secondary">· {kstMonthDayKo(e.tweetCreatedAt)}</span>}
          </span>
        </div>
        <TweetText text={e?.text ?? quoted.text} className={`mt-1 text-x-text ${collapsed ? 'line-clamp-2' : ''}`} />
        {collapsed ? (
          <p className="mt-1 text-caption text-x-blue-text">▾ 눌러서 펼치기</p>
        ) : (
          <>
            {translation && (
              <div className="mt-1 border-t border-x-border pt-1">
                <span className="text-[10px] font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
                <TweetText text={translation} className="text-x-text" />
              </div>
            )}
            {collapsible && (
              <button onClick={(ev) => { ev.stopPropagation(); setExpanded(false); }}
                      className="mt-1 text-caption text-x-muted hover:text-x-blue-text">▴ 접기</button>
            )}
          </>
        )}
      </div>
      {!collapsed && e && e.media.length > 0 && (
        <div className="px-3 pb-3 [&>div]:mt-0">
          <MediaGrid media={e.media} />
        </div>
      )}
    </div>
  );
}
