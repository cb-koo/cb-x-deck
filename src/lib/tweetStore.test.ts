import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets, linkColumnTweets, getColumnTweets, markSeen, markAllSeen } from './tweetStore.ts';
import { createColumn, deleteColumn } from './columnStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-ts-' + process.pid + '-';

function tw(id: string, views: number): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'tester', authorName: 'T', authorAvatarUrl: null, authorFollowers: 10,
    text: 'hello ' + id, media: [], quoted: null,
    metrics: { views, likes: 1, retweets: 2, replies: 0, quotes: 0, bookmarks: 3 },
    tweetUrl: null, tweetCreatedAt: new Date('2026-07-01T00:00:00Z').toISOString(),
  };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql.end();
});

test('upsert → 재upsert: first_seen/seen 보존, 지표·last_fetched 갱신', async () => {
  const col = await createColumn(sql, { kind: 'search', title: P + 'col', config: { keywords: ['x'] } });
  try {
    const r1 = await upsertTweets(sql, [tw('a', 100), tw('b', 200)]);
    assert.deepEqual(r1, { inserted: 2, updated: 0 });
    await linkColumnTweets(sql, col.id, [P + 'a', P + 'b']);
    await markSeen(sql, P + 'a');
    const [{ first_seen_at: fs1 }] = await sql`select first_seen_at from tweet where tweet_id = ${P + 'a'}`;

    const r2 = await upsertTweets(sql, [tw('a', 999)]);
    assert.deepEqual(r2, { inserted: 0, updated: 1 });
    const [row] = await sql`select first_seen_at, seen_at, metrics from tweet where tweet_id = ${P + 'a'}`;
    assert.equal(String(row.first_seen_at), String(fs1)); // 보존
    assert.ok(row.seen_at);                                // 보존
    assert.equal(row.metrics.views, 999);                  // 갱신

    const all = await getColumnTweets(sql, col.id, { sort: 'views', mode: 'all' });
    assert.deepEqual(all.map((t) => t.tweetId), [P + 'a', P + 'b']); // views 999 > 200
    assert.equal(all[0].seenAt !== null, true);
    const unseen = await getColumnTweets(sql, col.id, { sort: 'views', mode: 'new' });
    assert.deepEqual(unseen.map((t) => t.tweetId), [P + 'b']);

    const n = await markAllSeen(sql, col.id);
    assert.equal(n, 1); // b만 미열람이었음
  } finally {
    await deleteColumn(sql, col.id);
  }
});

test('정렬: date는 tweet_created_at desc', async () => {
  const col = await createColumn(sql, { kind: 'search', title: P + 'col2', config: { keywords: ['x'] } });
  try {
    const older = { ...tw('c', 5), tweetCreatedAt: new Date('2026-06-01T00:00:00Z').toISOString() };
    const newer = { ...tw('d', 1), tweetCreatedAt: new Date('2026-07-05T00:00:00Z').toISOString() };
    await upsertTweets(sql, [older, newer]);
    await linkColumnTweets(sql, col.id, [P + 'c', P + 'd']);
    const byDate = await getColumnTweets(sql, col.id, { sort: 'date', mode: 'all' });
    assert.deepEqual(byDate.map((t) => t.tweetId), [P + 'd', P + 'c']);
  } finally {
    await deleteColumn(sql, col.id);
  }
});
