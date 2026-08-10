import type postgres from 'postgres';
import type { GetxapiClient, RawTweet } from './getxapi.ts';
import { mapRawTweet } from './mappers.ts';
import { upsertTweets } from './tweetStore.ts';
import { enrichQuoted } from './quotedEnrich.ts';
import { ensureLibraryItem, saveCandidate, setMemo } from './candidateStore.ts';
import { parseTweetLink, type TweetLinkParseReason } from './tweetLink.ts';

// 링크로 트윗 추가 — 덱 수집을 거치지 않고 보관함에 직접 넣는 유일한 경로 (스펙 2026-08-10).
// 저장은 기존 ☆ 저장과 같은 순서(ensureLibraryItem → saveCandidate)라 보관함·레퍼런스 화면에 그대로 잡힌다.
export type AddByLinkResult =
  | { ok: true; tweetId: string; alreadyInLibrary: boolean }
  | { ok: false; error: 'parse'; reason: TweetLinkParseReason }
  | { ok: false; error: 'notFound' };

export async function addTweetByLink(
  sql: postgres.Sql,
  client: Pick<GetxapiClient, 'getTweetDetail'>,
  input: { url: string; workspaceId: string; memberId: string; memo?: string },
): Promise<AddByLinkResult> {
  const parsed = parseTweetLink(input.url);
  if (!parsed.ok) return { ok: false, error: 'parse', reason: parsed.reason };

  const raw = await client.getTweetDetail(parsed.tweetId); // 삭제·비공개는 null (getxapi.ts)
  if (!raw) return { ok: false, error: 'notFound' };
  // 리포스트 링크는 원본으로 — mapRawTweet이 순수 RT를 버리는 정책(mappers.ts)과 일관
  const effective = (raw.retweeted_tweet as RawTweet | undefined) ?? raw;
  const tweet = mapRawTweet(effective);
  if (!tweet) return { ok: false, error: 'notFound' };

  await upsertTweets(sql, [tweet]); // 이미 있으면 최신 지표로 갱신
  if (tweet.quoted) await enrichQuoted(sql, client, [tweet.quoted.id], { cap: 1 }); // 베스트 에포트(내부에서 실패 삼킴)

  const dup = await sql`select 1 from library_item where workspace_id = ${input.workspaceId} and tweet_id = ${tweet.tweetId}`;
  await ensureLibraryItem(sql, { workspaceId: input.workspaceId, tweetId: tweet.tweetId, addedBy: input.memberId });
  const cand = await saveCandidate(sql, {
    tweetId: tweet.tweetId, workspaceId: input.workspaceId, memberId: input.memberId, sourceColumnId: null,
  });
  const memo = input.memo?.trim();
  if (memo) await setMemo(sql, cand.id, memo, input.memberId);
  return { ok: true, tweetId: tweet.tweetId, alreadyInLibrary: dup.count > 0 };
}
