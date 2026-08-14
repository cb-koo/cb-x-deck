'use client';
import { MediaGrid } from '@/components/MediaGrid';
import { formatCount } from '@/lib/format';
import { ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon } from '@/components/XIcons';
import type { ReferenceRow } from '@/lib/referenceStore';

// X 실측 트윗 카드(시안 A)의 내용부 — RefPickerSheet(선택 버튼으로 감쌈)와 RefPreviewModal(맨몸)이 공유한다.
// 카드는 단일 표면: 여기 고치면 두 화면에 함께 반영된다(DraftCard 선례). 선택 체크 원은 시트 전용이라 여기 없다.
// 거의 전부 span인 이유: 시트에서 <button> 안에 들어가기 때문(기존 마크업 그대로 — MediaGrid의 div는 추출 전부터 있던 예외).
export function RefTweetCard({ row: r, translation }: { row: ReferenceRow; translation?: string }) {
  return (
    <>
      {r.authorAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 외부 X 아바타는 next/image 최적화 대상 아님(덱 카드 관례)
        <img src={r.authorAvatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
      ) : (
        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-x-border-strong text-[15px] font-bold text-white">
          {(r.authorName ?? r.authorHandle).slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1 pr-8">
        <span className="block text-[15px] leading-5"><b>{r.authorName ?? r.authorHandle}</b> <span className="text-x-muted">@{r.authorHandle}</span></span>
        <span className="block whitespace-pre-wrap text-[15px] leading-5">{r.text}</span>
        <MediaGrid media={r.media} />
        {/* X 액션 행 자리에 성과 지표 — 덱 카드와 같은 배치(19px 아이콘 + 13px 수치 분산) */}
        <span className="mt-3 flex max-w-[440px] items-center justify-between text-[13px] tabular-nums text-x-muted">
          <span className="flex items-center gap-1.5"><ReplyIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.replies)}</span>
          <span className="flex items-center gap-1.5"><RepostIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.retweets)}</span>
          <span className="flex items-center gap-1.5"><LikeIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.likes)}</span>
          <span className="flex items-center gap-1.5"><ViewIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.views)}</span>
          <span className="flex items-center gap-1.5"><BookmarkIcon className="h-[19px] w-[19px]" /> {formatCount(r.metrics.bookmarks)}</span>
        </span>
        {translation && (
          <span className="mt-2.5 block rounded-xl border border-x-border bg-x-blue/5 px-3 py-2">
            <span className="block text-caption font-bold text-x-blue-text" title="AI 자동 번역입니다 — 원문을 함께 확인하세요">🌐 AI 번역</span>
            <span className="mt-1 block whitespace-pre-wrap text-[15px] leading-5">{translation}</span>
          </span>
        )}
        {/* 회색 = 도구층 밴드: 메모·태그·워크스페이스는 X에 없는 우리 요소라 층을 분리 */}
        <span className="mt-3 block rounded-xl bg-x-surface px-3 py-2.5">
          {r.memos.map((m, i) => (
            <span key={i} className="mb-1.5 block border-l-2 border-x-blue pl-2 text-[13px] leading-[18px] text-x-secondary"><b className="text-x-text">{m.member}</b> {m.text}</span>
          ))}
          <span className="block text-[13px] text-x-muted">
            {r.memos.length === 0 && '메모 없음 — 저장만 되어 있어요 · '}
            {r.tags.map((t) => `#${t}`).join(' ')}{r.tags.length > 0 && ' · '}
            {r.workspaces.length > 1 ? `${r.workspaces.length}곳에 저장됨 · ` : ''}{r.workspaces.map((w) => w.name).join(', ')}
          </span>
        </span>
      </span>
    </>
  );
}
