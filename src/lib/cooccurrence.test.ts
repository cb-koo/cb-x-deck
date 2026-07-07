import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashtagCooccurrence } from './cooccurrence.ts';
import type { DeckTweet } from './types.ts';

function tw(text: string): DeckTweet {
  return {
    tweetId: 'x', authorHandle: 'h', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text, media: [], quoted: null,
    metrics: { views: null, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    tweetUrl: null, tweetCreatedAt: null,
  };
}

test('해시태그 빈도 집계(전각 ＃ 포함), 검색 키워드 제외, 빈도순', () => {
  const tweets = [tw('#スキンケア 最高 #毛穴'), tw('＃スキンケア と #レチノール'), tw('#レチノール')];
  const out = hashtagCooccurrence(tweets, ['毛穴']);
  assert.deepEqual(out, [
    { tag: 'スキンケア', count: 2 },
    { tag: 'レチノール', count: 2 },
  ]);
});

test('해시태그 없으면 빈 배열', () => {
  assert.deepEqual(hashtagCooccurrence([tw('タグなし')], []), []);
});
