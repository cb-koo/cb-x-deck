'use client';
import { useMemo, type ReactNode } from 'react';
import type { DraftPost } from '@/lib/draftTypes';
import { useSignedMedia } from '@/components/useSignedMedia';
import { Avatar } from '@/components/Avatar';

// 붙은 원고 카드(설계 §7·§7-1). quote가 있으면(인용RT) X 게시 미리보기 모양 — 작성자 줄 → 본문 2줄 → 인용 카드.
// 첫 이미지는 원고 이미지면 비공개 버킷 경로라 useSignedMedia로 서명 URL을 받는다(DraftCard와 같은 방식).
// X 미디어(http 절대 URL)는 훅이 그대로 통과시킨다.
export function DraftSummaryCard({ title, status, preview, image, quote, author, onOpen, onDetach, detachLabel = '떼기' }: {
  title: string; status: string | null; preview: string | null; image: string | null;
  quote?: ReactNode; author?: { name: string | null; handle: string; avatarUrl?: string };
  onOpen: () => void; onDetach: () => void; detachLabel?: string;
}) {
  // 훅은 인자 배열 참조가 바뀌면 다시 계산한다 — 렌더마다 새 배열을 만들지 않게 image로만 묶는다.
  // 인용RT 모양(quote)은 썸네일을 그리지 않으니 서명도 받지 않는다.
  const thumb = quote ? null : image;
  const posts = useMemo<DraftPost[]>(() => (thumb ? [{ text: '', media: [{ type: 'photo', url: thumb, videoUrl: null }] }] : []), [thumb]);
  const { posts: signed, resign } = useSignedMedia(posts);
  const shown = signed[0]?.media[0]?.url || null;   // 서명 대기 중은 '' — 자리를 비워 둔다
  const body = preview ? <p className={`${quote ? 'text-content' : 'text-ui text-x-secondary'} mt-1 line-clamp-2 whitespace-pre-line`}>{preview}</p> : null;
  return (
    <div className="flex gap-3 rounded-lg border border-x-border-strong px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-content font-semibold">
          <span className="min-w-0 truncate" title={title}>{title}</span>
          {status && <span className="shrink-0 rounded-full bg-[#e8f0fe] px-2 py-0.5 text-ui font-medium text-[#1d4ed8]">{status}</span>}
        </p>
        {quote && author ? (
          <div className="mt-2.5 flex gap-2.5">
            <Avatar url={author.avatarUrl} name={author.name || author.handle} size={32} />
            <div className="min-w-0 flex-1">
              {/* 표시 이름이 없으면 @핸들 한 번만(InfluencerSummary와 같은 규칙) */}
              <p className="truncate text-ui">
                {author.name
                  ? <><b className="text-x-text">{author.name}</b> <span className="text-x-secondary">@{author.handle}</span></>
                  : <b className="text-x-text">@{author.handle}</b>}
              </p>
              {body}
              <div className="mt-2">{quote}</div>
            </div>
          </div>
        ) : (
          <>
            {body}
            {quote && <div className="mt-2">{quote}</div>}
          </>
        )}
        <p className="mt-2 flex gap-4 text-ui">
          <button type="button" onClick={onOpen} className="text-x-blue-text hover:underline">열기</button>
          <button type="button" onClick={onDetach} className="text-x-secondary hover:underline">{detachLabel}</button>
        </p>
      </div>
      {shown && (
        // eslint-disable-next-line @next/next/no-img-element -- 서명 URL
        <img src={shown} alt="" onError={() => thumb && resign(thumb)} className="h-[52px] w-[52px] shrink-0 rounded-lg object-cover" />
      )}
    </div>
  );
}
