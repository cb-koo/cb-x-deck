import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { missingQuotedIds, upsertQuoted, getQuotedMap } from './quotedStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-qs-' + process.pid + '-';

function qt(id: string): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'quoter', authorName: '인용작성자', authorAvatarUrl: 'https://a/b.jpg',
    authorFollowers: 5, text: 'quoted body', media: [{ type: 'photo', url: 'https://m/1.jpg', videoUrl: null }],
    quoted: null, metrics: { views: 1, likes: 1, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 },
    tweetUrl: 'https://x.com/quoter/status/' + P + id, tweetCreatedAt: '2026-07-05T00:00:00.000Z',
  };
}

after(async () => {
  await sql`delete from quoted_tweet where id like ${P + '%'}`;
  await sql.end();
});

test('missingQuotedIds: 캐시에 없는 것만, 입력 중복 제거', async () => {
  await upsertQuoted(sql, P + 'has', qt('has'));
  const missing = await missingQuotedIds(sql, [P + 'has', P + 'no1', P + 'no1', P + 'no2']);
  assert.deepEqual(missing.sort(), [P + 'no1', P + 'no2']);
});

test('upsertQuoted: 멱등 + null이면 tombstone(missing) → 재조회 대상에서 빠지고 map에도 안 실림', async () => {
  await upsertQuoted(sql, P + 'gone', null);
  await upsertQuoted(sql, P + 'gone', null); // 멱등
  assert.deepEqual(await missingQuotedIds(sql, [P + 'gone']), []);
  const map = await getQuotedMap(sql, [P + 'gone']);
  assert.deepEqual(map, {});
});

test('getQuotedMap: ok건만 DeckTweet로 반환', async () => {
  await upsertQuoted(sql, P + 'ok1', qt('ok1'));
  const map = await getQuotedMap(sql, [P + 'ok1', P + 'unknown']);
  assert.deepEqual(Object.keys(map), [P + 'ok1']);
  assert.equal(map[P + 'ok1'].authorName, '인용작성자');
  assert.equal(map[P + 'ok1'].media.length, 1);
});

test('빈 입력은 빈 결과 (SQL 오류 없이)', async () => {
  assert.deepEqual(await missingQuotedIds(sql, []), []);
  assert.deepEqual(await getQuotedMap(sql, []), {});
});
