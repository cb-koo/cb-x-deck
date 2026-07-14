import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { dismiss, undismiss, listDismissed } from './dismissStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
import { upsertTweets } from './tweetStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-dm-' + process.pid + '-';
function tw(id: string): DeckTweet {
  return { tweetId: P + id, authorHandle: 'h', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: '', media: [], quoted: null, metrics: { views: 1, likes: 1, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 },
    tweetUrl: null, tweetCreatedAt: null };
}
after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('dismiss·list·undismiss + 멱등', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const m = await createMember(sql, P + 'm', '#111111');
  await upsertTweets(sql, [tw('a'), tw('b')]);
  try {
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'a', memberId: m.id });
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'a', memberId: m.id }); // 멱등
    assert.deepEqual(await listDismissed(sql, ws.id), [P + 'a']);
    await undismiss(sql, { workspaceId: ws.id, tweetId: P + 'a' });
    assert.deepEqual(await listDismissed(sql, ws.id), []);
    await undismiss(sql, { workspaceId: ws.id, tweetId: P + 'a' }); // 없는 것 복구 무시
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
