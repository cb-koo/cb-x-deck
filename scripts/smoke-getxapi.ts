// 実ホール スモーク: 契約検証 + フィクスチャ収集. 費用 ~$0.003 (3コール).
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeClient } from '../src/lib/getxapi.ts';

(async () => {
  const c = makeClient();
  mkdirSync('fixtures', { recursive: true });

  const search = await c.searchTweets('毛穴 filter:images min_faves:500 lang:ja');
  writeFileSync('fixtures/search-response.json', JSON.stringify(search, null, 2));
  const t0 = search.tweets[0] as Record<string, unknown>;
  const author = t0?.author as Record<string, unknown> | undefined;
  console.log('[search] tweets:', search.tweets.length, 'has_more:', search.has_more);
  console.log('[search] 検証 — viewCount:', t0?.viewCount, '/ bookmarkCount:', t0?.bookmarkCount,
    '/ media:', Array.isArray(t0?.media) ? (t0.media as unknown[]).length : 'MISSING',
    '/ author.followers:', author?.followers);
  const withQuote = search.tweets.find((t) => (t as Record<string, unknown>).quoted_tweet);
  console.log('[search] quoted_tweet 축약형 확인:', withQuote ? JSON.stringify((withQuote as Record<string, unknown>).quoted_tweet).slice(0, 200) : '이번 페이지에 인용 없음');

  const info = await c.getUserInfo('hadakan__');
  writeFileSync('fixtures/user-info-response.json', JSON.stringify(info, null, 2));
  console.log('[userInfo]', info.userName, info.id, 'followers:', info.followers);

  const feed = await c.getUserTweets(info.id);
  writeFileSync('fixtures/user-tweets-response.json', JSON.stringify(feed, null, 2));
  const f0 = feed.tweets[0] as Record<string, unknown>;
  console.log('[userTweets] tweets:', feed.tweets.length, '/ 첫 트윗 viewCount:', f0?.viewCount, 'media:', Array.isArray(f0?.media));
})();
