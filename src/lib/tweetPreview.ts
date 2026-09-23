// 링크로 게시물 한 건 보기(설계 §7-1) — 인용 대상 미리보기와 원고 생성(generate.ts의 loadQuoteTarget)이
// 같은 규칙을 쓴다: 캐시를 먼저 보고, 없거나 본문이 비었을 때만 X 상세를 한 번 부른 뒤 캐시에 저장한다
// (보관함 항목은 만들지 않는다 — upsert는 캐시 갱신일 뿐).
// 게시물 id는 링크 그대로 쓴다 — 리포스트 링크를 원본으로 바꿔 보여주면 미리보기와 원고 생성(id 그대로
// 대조하는 loadQuoteTarget)이 서로 다른 게시물을 가리키게 된다.
import type postgres from 'postgres';
import type { TweetPreview } from './tweetPreviewShape.ts';
import { parseTweetLink } from './tweetLink.ts';
import { getTweetsByIds, upsertTweets } from './tweetStore.ts';
import { makeClient, type GetxapiClient } from './getxapi.ts';
import { mapRawTweet } from './mappers.ts';

// 화면(클라이언트 번들)이 쓰는 모양·변환은 서버 import가 없는 tweetPreviewShape.ts에 둔다 — 여기서 다시 내보내
// 서버 호출부·테스트는 그대로 이 파일을 쓴다.
export { quotedFromTweet, type TweetPreview } from './tweetPreviewShape.ts';

// X 상세 조회(getTweetDetail)만 실패해도 던지는 전용 오류 — 그 앞뒤의 DB 읽기·upsert 실패와 섞이면
// 안 된다. 이 오류만 "확인하지 못했어요 — 잠시 후 다시 시도해 주세요" 문구로 잡히고, DB 오류 등 그 밖의
// 예외는 그대로 위로 전파돼(500) 조용히 400으로 둔갑하지 않는다.
export class TweetFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TweetFetchError';
  }
}

type DetailClient = Pick<GetxapiClient, 'getTweetDetail'>;

// client는 객체 또는 만드는 함수 — 캐시 적중이면 X 클라이언트를 만들지 않는다(makeClient는 키를 읽는다).
// 만드는 것도 try 안에서 한다: 키 누락 같은 생성 실패도 X 조회 실패(TweetFetchError)로 본다(옛 loadQuoteTarget과 같다).
export async function fetchTweetCached(
  sql: postgres.Sql, tweetId: string, client: DetailClient | (() => DetailClient),
): Promise<TweetPreview> {
  const cached = (await getTweetsByIds(sql, [tweetId]))[0] ?? null;
  if (cached && cached.text.trim()) return { kind: 'ok', tweet: cached };
  let raw;
  try { raw = await (typeof client === 'function' ? client() : client).getTweetDetail(tweetId); }
  catch (e) { throw new TweetFetchError('getTweetDetail failed', { cause: e }); }
  if (!raw) return { kind: 'unavailable' }; // 삭제·비공개
  if (raw.retweeted_tweet) return { kind: 'repost' }; // 순수 리트윗 — 원문이 아니다
  const mapped = mapRawTweet(raw);
  if (!mapped || !mapped.text.trim()) return { kind: 'noText' };
  if (mapped.tweetId !== tweetId) return { kind: 'mismatch' };
  await upsertTweets(sql, [mapped]);
  return { kind: 'ok', tweet: mapped };
}

export async function loadTweetPreview(
  sql: postgres.Sql, url: string, client?: DetailClient,
): Promise<TweetPreview> {
  const p = parseTweetLink(url);
  if (!p.ok) return { kind: 'badLink' };
  return fetchTweetCached(sql, p.tweetId, client ?? makeClient);
}
