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
  const c = client ?? makeClient();
  let raw: RawTweet | null;
  try {
    raw = await c.getTweetDetail(tweetId);
  } catch (e) {
    // GetxapiAuthError를 포함해 모든 예외는 error — 인증 실패를 "게시물 없음"으로 격하하지 않는다.
    console.error(`fetchPost(${tweetId}) failed:`, e instanceof GetxapiAuthError ? e.message : e);
    return { kind: 'error' };
  }
  if (raw === null) return { kind: 'unavailable' }; // getTweetDetail의 404/400 → null 관례

  const id = str(raw.id);
  if (!id) return { kind: 'error' }; // 응답은 왔는데 기형 — 삭제 확정이 아니라 판단 불가

  const author = raw.author as Record<string, unknown> | undefined;
  return {
    kind: 'ok',
    post: {
      tweetId: id,
      authorHandle: str(author?.userName),
      text: str(raw.text) ?? '',
      postedAt: toIso(raw.createdAt),
      metrics: {
        views: num(raw.viewCount),
        likes: num(raw.likeCount),
        retweets: num(raw.retweetCount),
        replies: num(raw.replyCount),
        bookmarks: num(raw.bookmarkCount),
        quotes: num(raw.quoteCount),
      },
      raw,
    },
  };
}
