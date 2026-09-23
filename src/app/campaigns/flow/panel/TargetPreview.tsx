import { QuotedCard } from '@/components/QuotedCard';
import { quotedFromTweet, type TweetPreview } from '@/lib/tweetPreviewShape';
import type { TargetPreviewState } from '@/lib/targetPreviewView';

// 대상 게시물 카드(설계 §7-1) — lines: 원고 카드 안(인용 미리보기)은 2줄·이미지 없음, 대상 칸 단독은 3줄 + 첫 이미지.
// 안내 문구: 순수 리포스트 링크만 "리포스트 링크예요 — …"(tweetPreviewShape.ts의 noText 주석), 그 밖의 ok 아님·조회 실패는 모두
// "게시물을 불러올 수 없어요" + 원래 링크.
export function TargetPreview({ state, preview, loading, failed, lines }: {
  state: TargetPreviewState; preview: TweetPreview | null; loading: boolean; failed: boolean; lines: 2 | 3;
}) {
  const box = 'rounded-2xl border border-dashed border-x-border-strong px-3.5 py-3 text-center text-ui text-x-secondary';
  if (state.kind === 'none') return null;
  if (state.kind === 'pending') return <div className={box}>게시되면 여기에 보여요</div>;
  if (state.kind === 'cancelled') return <div className={box}>대상 작업이 취소됐어요</div>;
  if (loading) return <div className={box}>게시물 불러오는 중…</div>;
  if (failed || !preview || preview.kind !== 'ok') {
    const msg = preview?.kind === 'repost' ? '리포스트 링크예요 — 원본 게시물 링크로 바꿔 주세요' : '게시물을 불러올 수 없어요';
    return (
      <div className={box}>
        {msg}<br />
        <a href={state.url} target="_blank" rel="noreferrer" className="break-all text-x-blue-text hover:underline">{state.url.replace(/^https?:\/\//, '')} ↗</a>
      </div>
    );
  }
  return <QuotedCard quoted={quotedFromTweet(preview.tweet)} lines={lines} firstImageOnly={lines === 3} hideMedia={lines === 2} flush />;
}
