import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { refreshColumn } from './refreshColumn.ts';
import { createColumn, deleteColumn, getColumn } from './columnStore.ts';
import { getColumnTweets } from './tweetStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import type { RawTweet, SearchPage } from './getxapi.ts';

const sql = getSql();
const P = 'test-rc-' + process.pid + '-';

function raw(id: string, views: number): RawTweet {
  return { id: P + id, text: 't' + id, viewCount: views, likeCount: 1, author: { userName: 'u', followers: 3 } };
}
const page = (tweets: RawTweet[], next: string | null): SearchPage => ({ has_more: next !== null, next_cursor: next, tweets });

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql.end();
});

test('search 컬럼: 쿼리 조립 → maxPages 페이지네이션 → 재필터 → 저장 → last_refreshed', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'search', title: P + 'c',
    config: { keywords: ['毛穴'], minFaves: 300, minViews: 500, maxPages: 2 },
  });
  const queries: Array<[string, string | undefined]> = [];
  const fake = {
    searchTweets: async (q: string, cursor?: string) => {
      queries.push([q, cursor]);
      return cursor ? page([raw('c', 100)], null) : page([raw('a', 1000), raw('b', 400)], 'CUR');
    },
    getUserTweets: async () => page([], null),
  };
  try {
    const r = await refreshColumn(sql, fake, col.id);
    assert.equal(queries.length, 2);                       // maxPages=2 준수
    assert.match(queries[0][0], /min_faves:300/);
    assert.equal(queries[1][1], 'CUR');                    // cursor 전달
    assert.deepEqual(r, { fetched: 3, inserted: 1, updated: 0 }); // 재필터로 1000만 통과
    const stored = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.deepEqual(stored.map((t) => t.tweetId), [P + 'a']);
    const c2 = await getColumn(sql, col.id);
    assert.ok(c2!.lastRefreshedAt);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('watchlist 컬럼: userId로 getUserTweets, 재필터 없음', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w', config: { handle: 'u', userId: 'UID9', maxPages: 1 },
  });
  const calls: string[] = [];
  const fake = {
    searchTweets: async () => page([], null),
    getUserTweets: async (userId: string) => { calls.push(userId); return page([raw('w', 10)], 'MORE'); },
  };
  try {
    const r = await refreshColumn(sql, fake, col.id);
    assert.deepEqual(calls, ['UID9']);
    assert.equal(r.inserted, 1); // views 10이어도 저장(재필터는 search 전용)
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('maxPagesOverride가 config.maxPages보다 우선(과거 백필용)', async () => {
  const ws = await createWorkspace(sql, P + 'ws3');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w3', config: { handle: 'u', userId: 'UID3', maxPages: 1 },
  });
  let calls = 0;
  const fake = {
    searchTweets: async () => page([], null),
    getUserTweets: async () => { calls++; return page([raw('o' + calls, 10)], calls < 5 ? 'C' + calls : null); },
  };
  try {
    await refreshColumn(sql, fake, col.id, { maxPagesOverride: 3 });
    assert.equal(calls, 3); // config는 1이지만 override 3 적용
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
