// 링크로 게시물 한 건 보기(설계 §7-1)의 결과 모양과 화면용 변환 — 서버 import(DB·getxapi)가 없는 순수 모듈.
// 클라이언트 컴포넌트('use client')는 이 파일만 import한다. tweetPreview.ts를 값으로 import하면 postgres까지
// 클라이언트 번들에 끌려 들어가 빌드가 깨진다. 서버 쪽은 tweetPreview.ts가 다시 내보낸다.
import type { DeckTweet, DeckQuoted } from './types.ts';

// mismatch: 캐시 미스라 다시 부른 X 상세가 요청한 tweetId와 다른 게시물을 돌려준 경우.
// (원고 생성 쪽의 기존 문구 "게시물이 바뀌었어요 — 대상 링크를 다시 확인해 주세요"를 보존하려고 따로 둔다.)
// noText: 리트윗은 아니지만 매핑에 실패했거나 본문이 비어 보여줄 내용이 없는 경우. repost와는 미리보기
// 화면의 안내 문구가 다르다(§7-1 "리포스트 링크예요 — 원본 게시물 링크로 바꿔 주세요"는 순수 리트윗 전용,
// 본문이 없는 경우에 같은 문구를 쓰면 존재하지 않는 원본을 찾으라는 셈이 된다) — 그래서 따로 둔다.
export type TweetPreview =
  | { kind: 'ok'; tweet: DeckTweet }
  | { kind: 'repost' }
  | { kind: 'noText' }
  | { kind: 'unavailable' }
  | { kind: 'mismatch' }
  | { kind: 'badLink' };

// 보관함의 인용 카드(QuotedCard)는 DeckQuoted + enriched를 받는다 — 캐시의 DeckTweet을 그 모양으로 옮긴다.
export function quotedFromTweet(t: DeckTweet): DeckQuoted & { enriched: DeckTweet } {
  return { id: t.tweetId, text: t.text, userName: t.authorName, screenName: t.authorHandle, enriched: t };
}
