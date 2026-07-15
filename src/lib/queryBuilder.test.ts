import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchQuery, refilterByViews } from './queryBuilder.ts';
import type { DeckTweet } from './types.ts';

test('전체 필터 조합 — 7/6 스윕 골격', () => {
  const q = buildSearchQuery({
    keywords: ['毛穴', 'ニキビ'], minFaves: 300, lang: 'ja',
    sinceDate: '2026-06-22', untilDate: '2026-07-06', imagesOnly: true,
  });
  assert.equal(q, '(毛穴 OR ニキビ) filter:images min_faves:300 lang:ja since:2026-06-22 until:2026-07-06');
});

test('키워드 1개는 괄호 없음, 미설정 필터 생략', () => {
  assert.equal(buildSearchQuery({ keywords: ['レチナール'], imagesOnly: false }), 'レチナール');
});

test('imagesOnly 기본 true', () => {
  assert.equal(buildSearchQuery({ keywords: ['a'] }), 'a filter:images');
});

test('min_retweets/min_replies 출력 + min_faves 다음 순서', () => {
  const q = buildSearchQuery({
    keywords: ['毛穴'], minFaves: 300, minRetweets: 50, minReplies: 10, imagesOnly: false,
  });
  assert.equal(q, '毛穴 min_faves:300 min_retweets:50 min_replies:10');
});

test('회귀: 다중 키워드는 (a OR b)로 괄호 — min_faves가 전체에 적용되도록', () => {
  const q = buildSearchQuery({ keywords: ['美容', 'スキンケア'], minFaves: 300, imagesOnly: false });
  assert.equal(q, '(美容 OR スキンケア) min_faves:300');
  assert.ok(q.startsWith('('), 'OR 그룹은 반드시 괄호로 시작해야 함(실측: 괄호 없으면 min_faves 무력화)');
});

function tw(views: number | null): DeckTweet {
  return {
    tweetId: 't' + Math.abs(views ?? 0), authorHandle: 'h', authorName: null, authorAvatarUrl: null,
    authorFollowers: null, text: '', media: [], quoted: null,
    metrics: { views, likes: null, retweets: null, replies: null, quotes: null, bookmarks: null },
    tweetUrl: null, tweetCreatedAt: null,
  };
}

test('refilterByViews: 하한 미달·null 제외, 미설정이면 통과', () => {
  const list = [tw(100), tw(50000), tw(null)];
  assert.equal(refilterByViews(list, 10000).length, 1);
  assert.equal(refilterByViews(list, null).length, 3);
  assert.equal(refilterByViews(list, undefined).length, 3);
});
