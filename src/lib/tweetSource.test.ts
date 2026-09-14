import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRawAnalysisTweet, makeGetxapiTweetSource, type FetchOpts } from './tweetSource.ts';
import type { RawTweet, SearchPage } from './getxapi.ts';

const raw = (over: Record<string, unknown>): RawTweet => ({
  id: 't', text: '本文', createdAt: '2026-08-20T00:00:00.000Z', viewCount: 1, likeCount: 1, media: [], ...over,
});
const page = (tweets: RawTweet[], more: boolean): SearchPage => ({ tweets, has_more: more, next_cursor: more ? 'c' : null });
const src = (pages: SearchPage[], now = () => 0) => {
  let i = 0;
  return { source: makeGetxapiTweetSource({ getUserTweets: async () => pages[i++] }, now), calls: () => i };
};
const OPTS: FetchOpts = {
  activitySince: '2026-08-01T00:00:00.000Z', directTarget: 2,
  lookbackSince: '2026-03-01T00:00:00.000Z', maxPages: 10, maxTweets: 100,
};

test('mapRawAnalysisTweet: RT는 rtText에 원문(retweeted_tweet.text 우선)', () => {
  const t = mapRawAnalysisTweet(raw({ id: 'r', retweeted_tweet: { id: 'o', text: '原文' }, text: 'RT @o: 原…' }))!;
  assert.equal(t.kind, 'retweet');
  assert.equal(t.rtText, '原文');
  assert.equal(mapRawAnalysisTweet(raw({}))!.rtText, undefined);
  assert.equal(mapRawAnalysisTweet(raw({ id: undefined })), null);
  assert.equal(mapRawAnalysisTweet(raw({ createdAt: undefined })), null);
  const bare = mapRawAnalysisTweet(raw({ viewCount: undefined, likeCount: undefined }))!;
  assert.deepEqual([bare.views, bare.likes], [null, null]);
  assert.equal(mapRawAnalysisTweet(raw({ media: [{ url: 'x' }] }))!.hasMedia, true);
  assert.equal(mapRawAnalysisTweet(raw({ quoted_tweet: { id: 'q' } }))!.kind, 'quote');
});

test('정상 종료: activitySince를 지났고 직접 글 목표를 채우면 더 안 넘긴다', async () => {
  const { source, calls } = src([
    page([raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }), raw({ id: 'b', createdAt: '2026-07-30T00:00:00.000Z' })], true),
    page([raw({ id: 'never' })], false),
  ]);
  const r = await source.fetchRecent('u', OPTS);          // 직접 2건(a,b) 확보 + b가 activitySince 이전
  assert.deepEqual(r.tweets.map((t) => t.id), ['a', 'b']);
  assert.equal(r.reachedActivitySince, true);
  assert.equal(r.directCount, 2);
  assert.equal(r.truncated, false);
  assert.equal(calls(), 1);
});

test('activitySince를 지났어도 직접 글이 부족하면 lookbackSince까지 계속 넘긴다', async () => {
  const { source, calls } = src([
    page([raw({ id: 'rt1', retweeted_tweet: { text: 'o' }, createdAt: '2026-07-20T00:00:00.000Z' })], true),
    page([raw({ id: 'd1', createdAt: '2026-06-01T00:00:00.000Z' }), raw({ id: 'd2', createdAt: '2026-05-01T00:00:00.000Z' })], true),
    page([raw({ id: 'never' })], false),
  ]);
  const r = await source.fetchRecent('u', OPTS);
  assert.deepEqual(r.tweets.map((t) => t.id), ['rt1', 'd1', 'd2']);
  assert.equal(r.directCount, 2);
  assert.equal(calls(), 2);
});

test('lookbackSince보다 오래된 트윗은 담지 않고 종료', async () => {
  const { source } = src([page([raw({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })], true), page([raw({ id: 'x' })], false)]);
  const r = await source.fetchRecent('u', OPTS);
  assert.deepEqual(r.tweets, []);
  assert.equal(r.truncated, false);
});

test('상한 종료: maxPages', async () => {
  const pages = Array.from({ length: 5 }, (_, i) => page([raw({ id: `p${i}`, retweeted_tweet: { text: 'o' } })], true));
  const { source } = src(pages);
  const r = await source.fetchRecent('u', { ...OPTS, maxPages: 3 });
  assert.equal(r.pagesUsed, 3);
  assert.equal(r.truncated, true);
  assert.equal(r.reachedActivitySince, false);
});

test('상한 종료: maxTweets', async () => {
  const { source } = src([page([raw({ id: '1' }), raw({ id: '2' }), raw({ id: '3' })], true), page([raw({ id: '4' })], false)]);
  const r = await source.fetchRecent('u', { ...OPTS, maxTweets: 2 });
  assert.equal(r.tweets.length, 2);
  assert.equal(r.truncated, true);
});

test('상한 종료: deadlineAt', async () => {
  let t = 0;
  const { source } = src([page([raw({ id: '1' })], true), page([raw({ id: '2' })], true), page([raw({ id: '3' })], false)], () => (t += 100));
  const r = await source.fetchRecent('u', { ...OPTS, deadlineAt: 150 });   // 1페이지 후 now=100<150 계속, 2페이지 후 200≥150 중단
  assert.equal(r.pagesUsed, 2);
  assert.equal(r.truncated, true);
});

test('계정 소진(has_more=false)은 상한이 아니다', async () => {
  const { source } = src([page([raw({ id: '1', createdAt: '2026-08-20T00:00:00.000Z' })], false)]);
  const r = await source.fetchRecent('u', OPTS);
  assert.equal(r.truncated, false);
  assert.equal(r.reachedActivitySince, false);  // 28일 전까지 못 갔지만 상한 아님
});

test('고정글은 시간순 판정에서만 빼고 수집엔 포함, 중복 제거', async () => {
  const { source, calls } = src([
    page([raw({ id: 'pin', isPinned: true, createdAt: '2026-05-05T00:00:00.000Z' }), raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }), raw({ id: 'b', createdAt: '2026-07-30T00:00:00.000Z' })], true),
    page([raw({ id: 'pin', createdAt: '2026-05-05T00:00:00.000Z' })], false),
  ]);
  const r = await source.fetchRecent('u', { ...OPTS, directTarget: 10 });
  assert.deepEqual([...r.tweets.map((t) => t.id)].sort(), ['a', 'b', 'pin']);   // pin 1번만
  assert.ok(calls() >= 1);
});

test('lookbackSince 밖 고정글은 수집에서 빠진다(의도)', async () => {
  const { source } = src([
    page([
      raw({ id: 'pin', isPinned: true, createdAt: '2026-01-01T00:00:00.000Z' }),   // lookbackSince(2026-03-01)보다 오래됨
      raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }),
      raw({ id: 'b', createdAt: '2026-07-30T00:00:00.000Z' }),
    ], false),
  ]);
  const r = await source.fetchRecent('u', { ...OPTS, directTarget: 10 });
  assert.deepEqual(r.tweets.map((t) => t.id), ['a', 'b']);
});

test('소진이 maxPages번째 페이지에서 일어나면 truncated 오보 아님', async () => {
  const { source } = src([
    page([raw({ id: '1', retweeted_tweet: { text: 'o' } })], true),
    page([raw({ id: '2', retweeted_tweet: { text: 'o' } })], true),
    page([raw({ id: '3', retweeted_tweet: { text: 'o' } })], false),   // directTarget 미달인 채로 3페이지째 소진
  ]);
  const r = await source.fetchRecent('u', { ...OPTS, maxPages: 3 });
  assert.equal(r.pagesUsed, 3);
  assert.equal(r.truncated, false);
});

test('maxPages 마지막 페이지에서 done()도 충족되면 truncated=false', async () => {
  const { source } = src([
    page([raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }), raw({ id: 'b', createdAt: '2026-07-30T00:00:00.000Z' })], true),
  ]);
  const r = await source.fetchRecent('u', { ...OPTS, maxPages: 1 });
  assert.equal(r.pagesUsed, 1);
  assert.equal(r.directCount, 2);
  assert.equal(r.truncated, false);
});

test('maxTweets에 정확히 도달했고 그 항목이 마지막이며 더 없으면(has_more=false) 상한이 아니다', async () => {
  const { source } = src([page([raw({ id: '1' }), raw({ id: '2' })], false)]);
  const r = await source.fetchRecent('u', { ...OPTS, maxTweets: 2 });
  assert.equal(r.tweets.length, 2);
  assert.equal(r.truncated, false);   // 잘린 게 없다 — 상한 캡션을 띄우면 거짓말
});
