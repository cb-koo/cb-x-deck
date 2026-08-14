// 추적 게시물의 지표 수집기 — 트윗 ID 하나를 물으면 셋 중 하나로 답한다(ok/unavailable/error).
// 이 파일이 수집 출처(지금은 getxapi)를 격리한다: 나중에 X 공식 API 등으로 갈아끼워도
// 라우트·스토어·화면은 이 규격만 본다. (스펙: docs/superpowers/specs/2026-08-14-contents-tracking-design.md)

import type { RawTweet, GetxapiClient } from './getxapi.ts';
import { makeClient, GetxapiAuthError } from './getxapi.ts';

// 지표 6종 — 전부 null 허용: 수집 출처가 일부 지표를 안 주는 경우를 흡수한다.
export interface PostMetrics {
  views: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  bookmarks: number | null;
  quotes: number | null;
}

// mappers.ts의 num/str과 동일 방식이지만 이 파일만을 위해 다시 둔다 — mapRawTweet은
// 리트윗 제외·핸들 필수 같은 덱 정책이 섞여 있어 통째로 재사용하면 안 된다.
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function toIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v); // 레거시 "Mon Jul 06 ..." 포맷도 파싱됨(mappers.ts와 동일 관례)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export interface FetchedPost {
  tweetId: string;
  authorHandle: string | null;
  text: string;
  postedAt: string | null; // ISO
  metrics: PostMetrics;
  raw: RawTweet;
}

export type FetchPostResult =
  | { kind: 'ok'; post: FetchedPost }
  | { kind: 'unavailable' } // X가 명시적으로 "없음"(404/400) — 삭제·비공개·정지
  | { kind: 'error' }; // 통신 실패·5xx 소진 — 판단 불가, 아무것도 저장하지 말 것

// 트윗 하나의 최신 지표를 수집한다. unavailable과 error를 절대 섞지 않는 것이 핵심:
// unavailable은 "삭제/비공개로 확정"이라 트래킹을 멈춰도 되고, error는 "몰라서" 못 멈춘다.
export async function fetchPost(tweetId: string, client?: GetxapiClient): Promise<FetchPostResult> {
  let raw: RawTweet | null;
  try {
    const c = client ?? makeClient(); // makeClient()도 try 안 — 키 누락 같은 생성 실패도 error로 보고한다(api/influencers/route.ts와 동일 계약)
    raw = await c.getTweetDetail(tweetId);
  } catch (e) {
    // GetxapiAuthError를 포함해 모든 예외는 error — 인증 실패를 "게시물 없음"으로 격하하지 않는다.
    console.error(`fetchPost(${tweetId}) failed:`, e instanceof GetxapiAuthError ? e.message : e);
    return { kind: 'error' };
  }
  if (raw === null) return { kind: 'unavailable' }; // getTweetDetail의 404/400 → null 관례

  // 리포스트 링크는 원본으로 — addByLink.ts의 확립된 정책(mappers.ts의 순수 RT 배제와 일관)과 동일하게,
  // 여기서도 raw가 리포스트 래퍼면 원본 트윗으로 갈아탄다. tweetId가 요청한 값과 달라질 수 있는데,
  // 그 흡수는 addTrackedPost의 유니크 제약 폴백("이미 추적 중이에요")이 이미 처리한다.
  const t = (raw.retweeted_tweet as RawTweet | undefined) ?? raw;

  const id = str(t.id);
  if (!id) return { kind: 'error' }; // 응답은 왔는데 기형 — 삭제 확정이 아니라 판단 불가

  const author = t.author as Record<string, unknown> | undefined;
  return {
    kind: 'ok',
    post: {
      tweetId: id,
      authorHandle: str(author?.userName),
      text: str(t.text) ?? '',
      postedAt: toIso(t.createdAt),
      metrics: {
        views: num(t.viewCount),
        likes: num(t.likeCount),
        retweets: num(t.retweetCount),
        replies: num(t.replyCount),
        bookmarks: num(t.bookmarkCount),
        quotes: num(t.quoteCount),
      },
      raw: t, // 저장 payload는 실제 지표를 낸 트윗(t)과 일치시킨다 — 래퍼(raw)를 저장하면 나중에 봤을 때 지표와 안 맞는다
    },
  };
}
