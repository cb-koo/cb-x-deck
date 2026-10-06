'use client';
import type { ReactNode } from 'react';
import type { DeckMedia, DeckQuoted, DeckTweet, StoredTweet } from '@/lib/types';
import type { TaskReply } from '@/lib/campaignStore';
import { kstMonthDayTimeKo } from '@/lib/datetime';
import { MediaGrid } from '@/components/MediaGrid';
import { TweetText } from '@/components/TweetText';
import { QuotedCard } from '@/components/QuotedCard';
import { stripTrailingMediaLink } from '@/lib/tweetText';

// 본 게시물 + 인플 본인 댓글을 X 본인 스레드 모양으로 한 카드에(스펙 2026-10-06-self-replies-design.md §9, koo 10-06 시안 A).
// 글마다 [프로필 사진 | 이름 @핸들 · M월 D일 HH:mm / 본문 / 사진·인용 / 조회 N · 좋아요 N], 사진 아래 세로선이 다음 글 사진까지 이어진다.
// §10(koo 10-06, X 스크린샷 비교): 자르지 않는다 — 본문 전체(줄바꿈·링크), 사진 전부(덱과 같은 MediaGrid 격자), 인용한 글 카드(덱과 같은 QuotedCard),
// 본문 끝 미디어용 t.co는 X처럼 숨긴다. 댓글도 사진·인용이 있으면 같은 방식(데이터는 최신 스냅샷 raw — TaskReply.media·quoted).
// 접지 않는다. 카드 테두리·둥글기·글자 크기는 QuotedCard(본 게시물 카드)와 같다 — 댓글이 붙어도 같은 카드가 길어진 것처럼 보이게.
// 댓글이 없어도 게시된 본 게시물은 이 카드로 그린다(§10 — X처럼 전부). 도움말 줄은 댓글이 있을 때만.
// main: 미리보기를 못 불러왔으면 null — 그땐 PostedBox가 위에 안내 상자를 두고 여기선 댓글 글만 그린다(핸들은 배정된 인플).
export function PostThread({ main, mainStats, replies, fallbackHandle }: {
  main: DeckTweet | null;
  mainStats: { views: number | null; likes: number | null };
  replies: TaskReply[];
  fallbackHandle: string | null;
}) {
  const author = {
    name: main?.authorName ?? null,
    handle: main?.authorHandle ?? fallbackHandle,
    avatar: main?.authorAvatarUrl ?? null,
  };
  const mainUrl = main ? (main.tweetUrl ?? `https://x.com/${main.authorHandle}/status/${main.tweetId}`) : null;
  const rows = replies.length;
  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-x-border-strong text-[15px]">
        {main && mainUrl && (
          // 본 게시물 줄 — 지금 카드처럼 누르면 X 원문(본문 속 링크는 TweetText가 전파를 막는다)
          <div role="link" tabIndex={0} aria-label="X에서 본 게시물 열기"
               onClick={() => window.open(mainUrl, '_blank', 'noopener,noreferrer')}
               onKeyDown={(e) => { if (e.key === 'Enter') window.open(mainUrl, '_blank', 'noopener,noreferrer'); }}
               className="cursor-pointer transition-colors hover:bg-x-hover">
            <ThreadRow author={author} postedAt={main.tweetCreatedAt} first last={rows === 0}
                       stats={mainStats}>
              <ThreadBody text={main.text} media={main.media} quoted={main.quoted as StoredTweet['quoted']} />
            </ThreadRow>
          </div>
        )}
        {replies.map((r, i) => (
          <ThreadRow key={r.tweetId} author={author} postedAt={r.postedAt} first={!main && i === 0} last={i === rows - 1}
                     stats={{ views: r.views, likes: r.likes }} openUrl={r.url}>
            <ThreadBody text={r.text} media={r.media} quoted={r.quoted} />
          </ThreadRow>
        ))}
      </div>
      {rows > 0 && <p className="mt-1.5 text-[14px] text-x-muted">인플이 이어 단 글은 자동으로 찾아요 · 성과 숫자는 첫 글만 세요</p>}
    </div>
  );
}

// 글 하나의 내용 — 본문 전체 + 사진 전부 + 인용한 글(덱 카드와 같은 부품). 본문 끝 미디어·인용용 t.co는 숨긴다(X와 같다).
// 인용 카드는 누르면 인용한 글을 연다 — 본 게시물 줄(누르면 본 게시물)까지 클릭이 올라가 창이 두 개 열리지 않게 여기서 멈춘다.
function ThreadBody({ text, media, quoted }: { text: string; media: DeckMedia[]; quoted: (DeckQuoted & { enriched?: DeckTweet | null }) | null }) {
  const shown = stripTrailingMediaLink(text, { hasMedia: media.length > 0, hasQuoted: quoted !== null });
  return (
    <>
      {shown
        ? <TweetText text={shown} className="mt-0.5 text-x-text" />
        : media.length === 0 && !quoted && <p className="mt-0.5 text-x-muted">(본문 없음)</p>}
      {media.length > 0 && <div className="[&>div]:mt-2"><MediaGrid media={media} /></div>}
      {quoted && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <QuotedCard quoted={quoted} flush />
        </div>
      )}
    </>
  );
}

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('ko-KR'));

function ThreadRow({ author, postedAt, first, last, stats, openUrl, children }: {
  author: { name: string | null; handle: string | null; avatar: string | null };
  postedAt: string | null;
  first: boolean; last: boolean;
  stats: { views: number | null; likes: number | null };
  openUrl?: string;
  children: ReactNode;
}) {
  const time = kstMonthDayTimeKo(postedAt);
  return (
    <div className={`flex gap-3 px-3 ${first ? 'pt-3' : 'pt-1'}`}>
      {/* 사진 칸 — 사진 아래 세로선이 이 글 끝까지 내려가 다음 글 사진 바로 위에서 멈춘다(마지막 글엔 없음) */}
      <div className="flex w-9 shrink-0 flex-col items-center">
        {author.avatar
          // eslint-disable-next-line @next/next/no-img-element -- 외부 프로필 사진(QuotedCard와 같은 관례)
          ? <img src={author.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full" />
          : <div className="h-9 w-9 shrink-0 rounded-full bg-x-border-strong" />}
        {!last && <div aria-hidden className="mt-1 w-0.5 flex-1 rounded-full bg-x-border-strong" />}
      </div>
      <div className="min-w-0 flex-1 pb-3">
        <div className="flex min-w-0 items-center gap-1">
          <span className="flex min-w-0 items-baseline gap-x-1 whitespace-nowrap">
            {author.name && <span className="truncate font-bold text-x-text">{author.name}</span>}
            {author.handle && <span className="truncate text-x-secondary">@{author.handle}</span>}
            {time && <span className="shrink-0 text-x-secondary">· {time}</span>}
          </span>
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noopener noreferrer" aria-label="X에서 이 댓글 열기 (새 창)" title="X에서 열기"
               className="-my-1.5 -mr-1.5 ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-x-blue-text hover:bg-x-surface">↗</a>
          )}
        </div>
        {children}
        <p className="mt-1.5 text-[14px] text-x-secondary">조회 {fmt(stats.views)} · 좋아요 {fmt(stats.likes)}</p>
      </div>
    </div>
  );
}
