import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRawAnalysisTweet, makeGetxapiTweetSource } from './tweetSource.ts';
import type { RawTweet, SearchPage } from './getxapi.ts';

const raw = (over: Record<string, unknown>): RawTweet => ({
  id: 't1', text: '本文', createdAt: '2026-08-20T00:00:00.000Z',
  viewCount: 100, likeCount: 10, media: [], ...over,
});

test('mapRawAnalysisTweet: 순수 RT를 버리지 않고 kind로 구분한다(mapRawTweet과 다른 점)', () => {
  assert.equal(mapRawAnalysisTweet(raw({}))!.kind, 'original');
  assert.equal(mapRawAnalysisTweet(raw({ retweeted_tweet: { id: 'x' } }))!.kind, 'retweet');
  assert.equal(mapRawAnalysisTweet(raw({ quoted_tweet: { id: 'x' } }))!.kind, 'quote');
});

test('mapRawAnalysisTweet: 지표 없음은 null, 미디어 유무, 필수값 없으면 null', () => {
  const t = mapRawAnalysisTweet(raw({ viewCount: undefined, likeCount: undefined, media: [{ url: 'u' }] }))!;
  assert.equal(t.views, null);
  assert.equal(t.likes, null);
  assert.equal(t.hasMedia, true);
  assert.equal(mapRawAnalysisTweet(raw({ id: undefined })), null);
  assert.equal(mapRawAnalysisTweet(raw({ createdAt: undefined })), null);
});

test('fetchRecent: since보다 오래된 트윗을 만나면 그 페이지에서 중단·잘라낸다', async () => {
  const pages: SearchPage[] = [
    { tweets: [raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' }),
               raw({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })],
      has_more: true, next_cursor: 'c1' },
    { tweets: [raw({ id: 'never' })], has_more: false, next_cursor: null },
  ];
  let calls = 0;
  const source = makeGetxapiTweetSource({ getUserTweets: async () => pages[calls++] });
  const r = await source.fetchRecent('u1', { maxCount: 100, since: '2026-05-24T00:00:00.000Z' });
  assert.deepEqual(r.tweets.map((t) => t.id), ['a']);
  assert.equal(calls, 1);                 // 2페이지는 부르지 않는다
  assert.equal(r.truncatedByCount, false);
});

test('fetchRecent: 오래된 고정글이 첫 페이지 맨 앞에 있어도 수집을 멈추지 않는다', async () => {
  // getxapi는 isPinned 글을 최신순과 무관하게 1페이지 맨 앞에 끼워 준다(실호출 확인).
  const pages: SearchPage[] = [
    { tweets: [raw({ id: 'pinned', createdAt: '2024-01-01T00:00:00.000Z', isPinned: true }),
               raw({ id: 'a', createdAt: '2026-08-20T00:00:00.000Z' })],
      has_more: true, next_cursor: 'c1' },
    { tweets: [raw({ id: 'b', createdAt: '2026-08-19T00:00:00.000Z' })], has_more: false, next_cursor: null },
  ];
  let calls = 0;
  const source = makeGetxapiTweetSource({ getUserTweets: async () => pages[calls++] });
  const r = await source.fetchRecent('u1', { maxCount: 100, since: '2026-05-24T00:00:00.000Z' });
  assert.deepEqual(r.tweets.map((t) => t.id), ['a', 'b']);   // 고정글은 빠지고 2페이지까지 이어진다
  assert.equal(calls, 2);
});

test('fetchRecent: maxCount에서 중단하고 truncatedByCount=true', async () => {
  const page = (ids: string[], more: boolean): SearchPage => ({
    tweets: ids.map((id) => raw({ id })), has_more: more, next_cursor: more ? 'c' : null,
  });
  const pages = [page(['1', '2'], true), page(['3', '4'], true), page(['5'], false)];
  let calls = 0;
  const source = makeGetxapiTweetSource({ getUserTweets: async () => pages[calls++] });
  const r = await source.fetchRecent('u1', { maxCount: 3, since: '2026-05-24T00:00:00.000Z' });
  assert.deepEqual(r.tweets.map((t) => t.id), ['1', '2', '3']);
  assert.equal(r.truncatedByCount, true);
});
