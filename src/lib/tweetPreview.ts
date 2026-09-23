// 링크로 게시물 한 건 보기(설계 §7-1) — 인용 대상 미리보기와 원고 생성(generate.ts의 loadQuoteTarget)이
// 같은 규칙을 쓴다: 캐시를 먼저 보고, 없거나 본문이 비었을 때만 X 상세를 한 번 부른 뒤 캐시에 저장한다
// (보관함 항목은 만들지 않는다 — upsert는 캐시 갱신일 뿐).
// 게시물 id는 링크 그대로 쓴다 — 리포스트 링크를 원본으로 바꿔 보여주면 미리보기와 원고 생성(id 그대로
// 대조하는 loadQuoteTarget)이 서로 다른 게시물을 가리키게 된다.
import type postgres from 'postgres';
import type { DeckTweet, DeckQuoted } from './types.ts';
import { parseTweetLink } from './tweetLink.ts';
import { getTweetsByIds, upsertTweets } from './tweetStore.ts';
import { makeClient, type GetxapiClient } from './getxapi.ts';
import { mapRawTweet } from './mappers.ts';

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

export async function fetchTweetCached(
  sql: postgres.Sql, tweetId: string, client: Pick<GetxapiClient, 'getTweetDetail'>,
): Promise<TweetPreview> {
  const cached = (await getTweetsByIds(sql, [tweetId]))[0] ?? null;
  if (cached && cached.text.trim()) return { kind: 'ok', tweet: cached };
  const raw = await client.getTweetDetail(tweetId); // 실패(throw)는 부르는 쪽이 문구를 정한다
  if (!raw) return { kind: 'unavailable' }; // 삭제·비공개
  if (raw.retweeted_tweet) return { kind: 'repost' }; // 순수 리트윗 — 원문이 아니다
  const mapped = mapRawTweet(raw);
  if (!mapped || !mapped.text.trim()) return { kind: 'noText' };
  if (mapped.tweetId !== tweetId) return { kind: 'mismatch' };
  await upsertTweets(sql, [mapped]);
  return { kind: 'ok', tweet: mapped };
}

export async function loadTweetPreview(
  sql: postgres.Sql, url: string, client?: Pick<GetxapiClient, 'getTweetDetail'>,
): Promise<TweetPreview> {
  const p = parseTweetLink(url);
  if (!p.ok) return { kind: 'badLink' };
  return fetchTweetCached(sql, p.tweetId, client ?? makeClient());
}

// 보관함의 인용 카드(QuotedCard)는 DeckQuoted + enriched를 받는다 — 캐시의 DeckTweet을 그 모양으로 옮긴다.
export function quotedFromTweet(t: DeckTweet): DeckQuoted & { enriched: DeckTweet } {
  return { id: t.tweetId, text: t.text, userName: t.authorName, screenName: t.authorHandle, enriched: t };
}
