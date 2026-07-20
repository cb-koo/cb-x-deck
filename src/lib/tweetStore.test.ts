import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets, linkColumnTweets, getColumnTweets, getColumnTweetCount, getTweetsByIds } from './tweetStore.ts';
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

test('offset 페이지네이션: 앞 페이지를 건너뛰고 이어짐', async () => {
  const ws = await createWorkspace(sql, P + 'ws3');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col3', config: { keywords: ['x'] } });
  try {
    await upsertTweets(sql, [tw('p1', 300), tw('p2', 200), tw('p3', 100)]);
    await linkColumnTweets(sql, col.id, [P + 'p1', P + 'p2', P + 'p3']);
    const all = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.deepEqual(all.map((t) => t.tweetId), [P + 'p1', P + 'p2', P + 'p3']);
    const skipped = await getColumnTweets(sql, col.id, { sort: 'views', offset: 1 });
    assert.deepEqual(skipped.map((t) => t.tweetId), [P + 'p2', P + 'p3']); // 1개 건너뛰고 이어짐(중복·누락 없음)
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

test('quoted 캐시가 있으면 quoted.enriched로 실려 온다', async () => {
  const { upsertQuoted } = await import('./quotedStore.ts');
  const ws = await createWorkspace(sql, P + 'ws-q');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col-q', config: { keywords: ['x'] } });
  try {
    const base = tw('q1', 10);
    base.quoted = { id: P + 'inner', text: 'inner text', userName: '이름', screenName: 'handle9' };
    await upsertTweets(sql, [base]);
    await linkColumnTweets(sql, col.id, [base.tweetId]);

    // 캐시 없음 → enriched 없음(null/undefined)
    const before = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.ok(!before[0].quoted!.enriched);

    // 캐시 저장 → enriched 실림
    await upsertQuoted(sql, P + 'inner', { ...tw('inner', 5), tweetId: P + 'inner' });
    const after = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.equal(after[0].quoted!.enriched!.text, 'hello inner');
    assert.equal(after[0].quoted!.userName, '이름');
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
    await sql`delete from quoted_tweet where id like ${P + '%'}`;
  }
});

test('버림 트윗은 기본 조회에서 제외, dismissed=only면 그것만', async () => {
  const { dismiss } = await import('./dismissStore.ts');
  const ws = await createWorkspace(sql, P + 'ws-dm');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'c', config: { keywords: ['x'] } });
  try {
    await upsertTweets(sql, [tw('d1', 10), tw('d2', 20)]);
    await linkColumnTweets(sql, col.id, [P + 'd1', P + 'd2']);
    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'd1' });
    const shown = await getColumnTweets(sql, col.id, { sort: 'views' });
    assert.deepEqual(shown.map((t) => t.tweetId), [P + 'd2']);
    const only = await getColumnTweets(sql, col.id, { sort: 'views', dismissed: 'only' });
    assert.deepEqual(only.map((t) => t.tweetId), [P + 'd1']);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
    await sql`delete from dismissed_tweet where workspace_id = ${ws.id}`;
  }
});

test('getTweetsByIds: 존재하는 트윗만 DeckTweet로 반환, 빈 입력은 즉시 빈 배열', async () => {
  await upsertTweets(sql, [tw('g1', 10), tw('g2', 20)]);
  const rows = await getTweetsByIds(sql, [P + 'g1', P + 'g2', P + 'ghost']);
  assert.deepEqual(rows.map((t) => t.tweetId).sort(), [P + 'g1', P + 'g2']);
  const g1 = rows.find((t) => t.tweetId === P + 'g1')!;
  assert.equal(g1.authorHandle, 'tester');
  assert.equal(g1.authorFollowers, 10);
  assert.equal(g1.metrics.likes, 1);
  assert.equal(g1.tweetCreatedAt, '2026-07-01T00:00:00.000Z');
  assert.deepEqual(await getTweetsByIds(sql, []), []);
  // 인용 트윗: 캐시 없으면 enriched null로 보존(조인이 행을 깨뜨리지 않음)
  await upsertTweets(sql, [{ ...tw('g3', 30), quoted: { id: 'q-g3', text: 'qt', userName: null, screenName: null } }]);
  const g3 = (await getTweetsByIds(sql, [P + 'g3']))[0] as { quoted: { id: string; enriched?: unknown } | null };
  assert.equal(g3.quoted!.id, 'q-g3');
  assert.equal(g3.quoted!.enriched, null);
});

test('getColumnTweetCount: 전체·dismissed·없는 컬럼', async () => {
  const { dismiss } = await import('./dismissStore.ts');
  const ws = await createWorkspace(sql, P + 'ws-cnt');
  const m = await createMember(sql, P + 'M-cnt', '#111111');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col-cnt', config: { keywords: ['k'] } });
  try {
    await upsertTweets(sql, [tw('cnt-a', 30), tw('cnt-b', 10), tw('cnt-c', 20)]);
    await linkColumnTweets(sql, col.id, [P + 'cnt-a', P + 'cnt-b', P + 'cnt-c']);

    assert.equal(await getColumnTweetCount(sql, col.id), 3);
    assert.equal(await getColumnTweetCount(sql, 'no-such-column-id'), 0);

    await dismiss(sql, { workspaceId: ws.id, tweetId: P + 'cnt-a', memberId: m.id });
    assert.equal(await getColumnTweetCount(sql, col.id), 2);                       // exclude 기본
    assert.equal(await getColumnTweetCount(sql, col.id, { dismissed: 'only' }), 1);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('getColumnTweets: dir asc/desc 정렬 반전', async () => {
  const ws = await createWorkspace(sql, P + 'ws-dir');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'col-dir', config: { keywords: ['k'] } });
  try {
    await upsertTweets(sql, [tw('dir-1', 30), tw('dir-2', 10), tw('dir-3', 20)]);
    await linkColumnTweets(sql, col.id, [P + 'dir-1', P + 'dir-2', P + 'dir-3']);

    const desc = await getColumnTweets(sql, col.id, { sort: 'views' });            // dir 기본 desc
    assert.deepEqual(desc.map((t) => t.metrics.views), [30, 20, 10]);

    const asc = await getColumnTweets(sql, col.id, { sort: 'views', dir: 'asc' });
    assert.deepEqual(asc.map((t) => t.metrics.views), [10, 20, 30]);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});
