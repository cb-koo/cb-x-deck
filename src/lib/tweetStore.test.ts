import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets, linkColumnTweets, getColumnTweets } from './tweetStore.ts';
import { createColumn, deleteColumn, touchRefreshed, getColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
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
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('upsert 재조회 보존 + NEW 배지 판정 + savedBy 집계', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const mA = await createMember(sql, P + 'A', '#111111');
  const mB = await createMember(sql, P + 'B', '#222222');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col', config: { keywords: ['x'] } });
  try {
    // 첫 새로고침 시나리오: 트윗 유입 → touchRefreshed (prev=null → NEW 없음)
    const r1 = await upsertTweets(sql, [tw('a', 100), tw('b', 200)]);
    assert.deepEqual(r1, { inserted: 2, updated: 0 });
    await linkColumnTweets(sql, col.id, [P + 'a', P + 'b']);
    await touchRefreshed(sql, col.id);
    const first = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.deepEqual(first.map((t) => t.isNew), [false, false]); // 첫 새로고침: 전부 신규 = 배지 무의미 → false

    // upsert 보존 검증
    const [{ first_seen_at: fs1 }] = await sql`select first_seen_at from tweet where tweet_id = ${P + 'a'}`;
    const r2 = await upsertTweets(sql, [tw('a', 999)]);
    assert.deepEqual(r2, { inserted: 0, updated: 1 });
    const [row] = await sql`select first_seen_at, metrics from tweet where tweet_id = ${P + 'a'}`;
    assert.equal(String(row.first_seen_at), String(fs1)); // first_seen 보존
    assert.equal(row.metrics.views, 999);                  // 지표 갱신

    // 두 번째 새로고침 시나리오: 새 트윗 c 유입 → c만 NEW
    await touchRefreshed(sql, col.id); // prev ← 직전 시각
    await upsertTweets(sql, [tw('c', 50)]);
    await linkColumnTweets(sql, col.id, [P + 'c']);
    const second = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.deepEqual(
      second.map((t) => [t.tweetId, t.isNew]),
      [[P + 'a', false], [P + 'b', false], [P + 'c', true]], // 기존 a·b는 유지, 신규 c만 배지
    );

    // prev/last 시각이 실제로 밀리는지
    const got = await getColumn(sql, col.id);
    assert.ok(got && got.lastRefreshedAt);

    // savedBy: A·B가 같은 트윗을 각자 저장 → 두 명 집계 (멤버 추적과 무관하게 유지되는 기능)
    await sql`insert into candidate (tweet_id, workspace_id, member_id) values (${P + 'a'}, ${ws.id}, ${mA.id})`;
    await sql`insert into candidate (tweet_id, workspace_id, member_id) values (${P + 'a'}, ${ws.id}, ${mB.id})`;
    const withSaved = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.deepEqual(withSaved[0].savedBy.map((m) => m.name).sort(), [P + 'A', P + 'B']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('정렬: date는 tweet_created_at desc', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col2', config: { keywords: ['x'] } });
  try {
    const older = { ...tw('c', 5), tweetCreatedAt: new Date('2026-06-01T00:00:00Z').toISOString() };
    const newer = { ...tw('d', 1), tweetCreatedAt: new Date('2026-07-05T00:00:00Z').toISOString() };
    await upsertTweets(sql, [older, newer]);
    await linkColumnTweets(sql, col.id, [P + 'c', P + 'd']);
    const byDate = await getColumnTweets(sql, col.id, { sort: 'date' });
    assert.deepEqual(byDate.map((t) => t.tweetId), [P + 'd', P + 'c']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
