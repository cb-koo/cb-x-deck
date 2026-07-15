import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { saveAnalysis, addAssignments, getAnalysis, listAnalysisTweets, pruneStaleAssignments } from './pillarStore.ts';
import { createColumn, deleteColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { upsertTweets, linkColumnTweets } from './tweetStore.ts';
import { dismiss } from './dismissStore.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-ps-' + process.pid + '-';

function tw(id: string, likes: number, opts?: { quoted?: boolean; createdAt?: string }): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'h', authorName: null, authorAvatarUrl: null, authorFollowers: null,
    text: '본문' + id, media: [],
    quoted: opts?.quoted ? { id: 'q' + id, text: 'qt', userName: null, screenName: null } : null,
    metrics: { views: 1, likes, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 },
    tweetUrl: null, tweetCreatedAt: opts?.createdAt ?? '2026-07-01T00:00:00.000Z',
  };
}

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql.end();
});

test('saveAnalysis→getAnalysis→listAnalysisTweets: 저장·배정·최신순·isQuote·likes', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w', config: { handle: 'h', userId: 'U1' },
  });
  try {
    await upsertTweets(sql, [
      tw('a', 100, { createdAt: '2026-07-03T00:00:00.000Z' }),
      tw('b', 50, { quoted: true, createdAt: '2026-07-02T00:00:00.000Z' }),
      tw('c', 10, { createdAt: '2026-07-01T00:00:00.000Z' }),
    ]);
    await linkColumnTweets(sql, col.id, [P + 'a', P + 'b', P + 'c']);

    assert.equal(await getAnalysis(sql, col.id), null);
    await saveAnalysis(sql, {
      columnId: col.id, topics: [{ id: 't1', label: '성분' }, { id: 't2', label: '시술' }],
      sampleSize: 3, model: 'test-model',
      assignments: [{ tweetId: P + 'a', topicId: 't1' }, { tweetId: P + 'b', topicId: 't2' }],
    });

    const a = await getAnalysis(sql, col.id);
    assert.equal(a!.sampleSize, 3);
    assert.deepEqual(a!.topics.map((t) => t.id), ['t1', 't2']);
    assert.ok(a!.analyzedAt);

    const rows = await listAnalysisTweets(sql, col.id);
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 'a', P + 'b', P + 'c']); // 최신순
    assert.deepEqual(rows.map((r) => r.topicId), ['t1', 't2', null]);          // c는 미분류
    assert.deepEqual(rows.map((r) => r.likes), [100, 50, 10]);
    assert.deepEqual(rows.map((r) => r.isQuote), [false, true, false]);

    const un = await listAnalysisTweets(sql, col.id, { onlyUnassigned: true });
    assert.deepEqual(un.map((r) => r.tweetId), [P + 'c']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('saveAnalysis 재실행 = 스냅샷·배정 통째 교체', async () => {
  const ws = await createWorkspace(sql, P + 'ws2');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w2', config: { handle: 'h', userId: 'U2' },
  });
  try {
    await upsertTweets(sql, [tw('d', 1), tw('e', 2)]);
    await linkColumnTweets(sql, col.id, [P + 'd', P + 'e']);
    await saveAnalysis(sql, {
      columnId: col.id, topics: [{ id: 'old', label: '옛주제' }], sampleSize: 2, model: null,
      assignments: [{ tweetId: P + 'd', topicId: 'old' }, { tweetId: P + 'e', topicId: 'old' }],
    });
    await saveAnalysis(sql, {
      columnId: col.id, topics: [{ id: 'new', label: '새주제' }], sampleSize: 2, model: null,
      assignments: [{ tweetId: P + 'd', topicId: 'new' }],
    });
    const a = await getAnalysis(sql, col.id);
    assert.deepEqual(a!.topics, [{ id: 'new', label: '새주제' }]);
    const rows = await listAnalysisTweets(sql, col.id);
    assert.deepEqual(rows.map((r) => r.topicId).sort(), ['new', null]); // old 배정 잔존 없음
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('addAssignments 멱등 + 버림 트윗은 분석 목록에서 제외', async () => {
  const ws = await createWorkspace(sql, P + 'ws3');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w3', config: { handle: 'h', userId: 'U3' },
  });
  try {
    await upsertTweets(sql, [tw('f', 1), tw('g', 2)]);
    await linkColumnTweets(sql, col.id, [P + 'f', P + 'g']);
    await saveAnalysis(sql, { columnId: col.id, topics: [{ id: 't1', label: 'ㅌ' }], sampleSize: 2, model: null, assignments: [] });
    await addAssignments(sql, col.id, [{ tweetId: P + 'f', topicId: 't1' }]);
    await addAssignments(sql, col.id, [{ tweetId: P + 'f', topicId: 't1' }]); // 멱등
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'g' });
    const rows = await listAnalysisTweets(sql, col.id);
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 'f']); // g는 버림으로 제외
    assert.equal(rows[0].topicId, 't1');
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('pruneStaleAssignments: 스냅샷에 없는 topic_id 배정 삭제 → 미분류로 복귀', async () => {
  const ws = await createWorkspace(sql, P + 'ws4');
  const col = await createColumn(sql, {
    workspaceId: ws.id, kind: 'watchlist', title: P + 'w4', config: { handle: 'h', userId: 'U4' },
  });
  try {
    await upsertTweets(sql, [tw('h', 1), tw('i', 2)]);
    await linkColumnTweets(sql, col.id, [P + 'h', P + 'i']);
    await saveAnalysis(sql, { columnId: col.id, topics: [{ id: 't1', label: 'ㅌ' }], sampleSize: 2, model: null, assignments: [] });
    await addAssignments(sql, col.id, [{ tweetId: P + 'h', topicId: 't1' }]);
    // 레이스 재현: 현재 스냅샷(t1)에 없는 topic_id로 직접 삽입
    await sql`insert into tweet_topic (column_id, tweet_id, topic_id) values (${col.id}, ${P + 'i'}, 'stale-topic')`;

    const before = await listAnalysisTweets(sql, col.id, { onlyUnassigned: true });
    assert.deepEqual(before.map((r) => r.tweetId), []); // stale 배정 때문에 '분류됨'으로 잡혀 실종 상태

    const deleted = await pruneStaleAssignments(sql, col.id, ['t1']);
    assert.equal(deleted, 1);

    const after = await listAnalysisTweets(sql, col.id, { onlyUnassigned: true });
    assert.deepEqual(after.map((r) => r.tweetId), [P + 'i']); // 미분류로 복귀 → 재분류 대상
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
