import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { saveScout, removeScout, listScouts, listScoutHandles } from './scoutStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
import { upsertTweets } from './tweetStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-sa-' + process.pid + '-';
function tw(id: string): DeckTweet {
  return { tweetId: P + id, authorHandle: 'h', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: '', media: [], quoted: null, metrics: { views: 1, likes: 1, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 },
    tweetUrl: 'https://x.com/h/status/' + P + id, tweetCreatedAt: null };
}
after(async () => {
  await sql`delete from scout_account where workspace_id in (select id from workspace where name like ${P + '%'})`;
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('save→list: 필드·member·sourceTweetUrl 조인 확인', async () => {
  const ws = await createWorkspace(sql, P + 'ws1');
  const m = await createMember(sql, P + 'm1', '#111111');
  await upsertTweets(sql, [tw('a')]);
  try {
    await saveScout(sql, {
      workspaceId: ws.id, handle: 'alice', name: 'Alice', avatarUrl: 'https://a/av.png', bio: 'hi',
      followers: 1000, verified: true, sourceTweetId: P + 'a', memberId: m.id,
    });
    const rows = await listScouts(sql, ws.id);
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.handle, 'alice');
    assert.equal(r.name, 'Alice');
    assert.equal(r.avatarUrl, 'https://a/av.png');
    assert.equal(r.bio, 'hi');
    assert.equal(r.followers, 1000);
    assert.equal(r.verified, true);
    assert.equal(r.sourceTweetId, P + 'a');
    assert.equal(r.sourceTweetUrl, 'https://x.com/h/status/' + P + 'a');
    assert.ok(r.member);
    assert.equal(r.member?.id, m.id);
    assert.equal(r.member?.name, P + 'm1');
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});

test('재저장 upsert: 프로필 갱신, saved_at·최초 저장자 유지', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const m1 = await createMember(sql, P + 'm2a', '#222222');
  const m2 = await createMember(sql, P + 'm2b', '#333333');
  try {
    await saveScout(sql, { workspaceId: ws.id, handle: 'bob', name: 'Bob', followers: 10, memberId: m1.id });
    const first = (await listScouts(sql, ws.id))[0];
    // 다른 멤버가 재저장 시도 — 프로필만 갱신, 최초 저장자·시각 유지
    await saveScout(sql, { workspaceId: ws.id, handle: 'bob', name: 'Bobby', followers: 20, verified: true, memberId: m2.id });
    const rows = await listScouts(sql, ws.id);
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.name, 'Bobby');
    assert.equal(r.followers, 20);
    assert.equal(r.verified, true);
    assert.equal(r.member?.id, m1.id, '최초 저장자 유지');
    assert.equal(r.savedAt, first.savedAt, 'saved_at 유지');
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});

test('remove 멱등', async () => {
  const ws = await createWorkspace(sql, P + 'ws3');
  try {
    await saveScout(sql, { workspaceId: ws.id, handle: 'carol' });
    assert.equal((await listScouts(sql, ws.id)).length, 1);
    await removeScout(sql, { workspaceId: ws.id, handle: 'carol' });
    assert.equal((await listScouts(sql, ws.id)).length, 0);
    await removeScout(sql, { workspaceId: ws.id, handle: 'carol' }); // 없는 것 재삭제 무시
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});

test('listScoutHandles: 경량 핸들 목록', async () => {
  const ws = await createWorkspace(sql, P + 'ws4');
  try {
    await saveScout(sql, { workspaceId: ws.id, handle: 'dave' });
    await saveScout(sql, { workspaceId: ws.id, handle: 'erin' });
    const handles = await listScoutHandles(sql, ws.id);
    assert.deepEqual([...handles].sort(), ['dave', 'erin']);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});

test('존재하지 않는 sourceTweetId → FK 위반 없이 null로 저장', async () => {
  const ws = await createWorkspace(sql, P + 'ws5');
  try {
    await saveScout(sql, { workspaceId: ws.id, handle: 'frank', sourceTweetId: P + 'nonexistent' });
    const r = (await listScouts(sql, ws.id))[0];
    assert.equal(r.sourceTweetId, null);
    assert.equal(r.sourceTweetUrl, null);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});

test('워크스페이스 격리', async () => {
  const wsA = await createWorkspace(sql, P + 'wsA');
  const wsB = await createWorkspace(sql, P + 'wsB');
  try {
    await saveScout(sql, { workspaceId: wsA.id, handle: 'grace' });
    assert.equal((await listScouts(sql, wsA.id)).length, 1);
    assert.equal((await listScouts(sql, wsB.id)).length, 0);
  } finally {
    await deleteWorkspace(sql, wsA.id);
    await deleteWorkspace(sql, wsB.id);
  }
});
