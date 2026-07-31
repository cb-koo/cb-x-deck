import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertTweets, linkColumnTweets, getColumnTweets, getColumnTweetCount, getTweetsByIds, getWorkspaceTableRows, getWorkspaceTableCount, getWorkspaceColumnCounts } from './tweetStore.ts';
import { createColumn, deleteColumn, touchRefreshed, getColumn } from './columnStore.ts';
import { createWorkspace, deleteWorkspace, createMember } from './workspaceStore.ts';
import { TABLE_MAX } from './tableLimits.ts';
import type { DeckTweet } from './types.ts';

const sql = getSql();
const P = 'test-ts-' + process.pid + '-';

function tw(id: string, views: number, metrics: Partial<DeckTweet['metrics']> = {}): DeckTweet {
  return {
    tweetId: P + id, authorHandle: 'tester', authorName: 'T', authorAvatarUrl: null, authorFollowers: 10,
    text: 'hello ' + id, media: [], quoted: null,
    metrics: { views, likes: 1, retweets: 2, replies: 0, quotes: 0, bookmarks: 3, ...metrics },
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

test('getColumnTweets: uuid 형식이 아닌 컬럼 id는 예외 없이 [] 반환 (getColumnTweetCount와 대칭)', async () => {
  const rows = await getColumnTweets(sql, 'no-such-column-id', { sort: 'views' });
  assert.deepEqual(rows, []);
});

test('표 쿼리 — 여러 열에 걸린 트윗은 한 행, 버림 제외, 워크스페이스 격리, 서버 정렬', async () => {
  const ws = await createWorkspace(sql, P + 'ws-tbl');
  const other = await createWorkspace(sql, P + 'ws-other');
  const m = await createMember(sql, P + 'M', '#333333');
  const colA = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'A', config: { keywords: ['a'] } });
  const colB = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'B', config: { keywords: ['b'] } });
  const colX = await createColumn(sql, { workspaceId: other.id, kind: 'search', title: P + 'X', config: { keywords: ['x'] } });
  try {
    // t1은 조회수는 적지만 좋아요는 많다 — views/likes 정렬 순서가 서로 달라지도록 일부러 엇갈리게 잡는다.
    await upsertTweets(sql, [tw('t1', 100, { likes: 500 }), tw('t2', 300, { likes: 10 }), tw('t3', 200), tw('t4', 999)]);
    await linkColumnTweets(sql, colA.id, [P + 't1', P + 't2', P + 't3']);
    await linkColumnTweets(sql, colB.id, [P + 't2']);              // t2는 두 열에 걸림
    await linkColumnTweets(sql, colX.id, [P + 't4']);              // 다른 워크스페이스
    await sql`insert into dismissed_tweet (workspace_id, tweet_id, dismissed_by) values (${ws.id}, ${P + 't3'}, ${m.id})`;

    const rows = await getWorkspaceTableRows(sql, ws.id, { sort: 'views' });
    // t3=버림 제외, t4=다른 워크스페이스 → t2, t1 두 행
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 't2', P + 't1'], '조회수 많은순 + 버림·타 워크스페이스 제외');
    const t2 = rows[0];
    assert.deepEqual([...t2.columnTitles].sort(), [P + 'A', P + 'B'], '두 열에 걸려도 한 행, 열 이름은 모두');
    assert.equal(t2.metrics.views, 300);
    assert.ok(t2.lastFetchedAt, '기준 시각이 실려야 한다 (지표 신선도 표시용)');

    const count = await getWorkspaceTableCount(sql, ws.id);
    assert.equal(count, 2, '중복 병합·버림 제외가 건수에도 반영');

    // 열 칩 필터
    const onlyB = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', columnIds: [colB.id] });
    assert.deepEqual(onlyB.map((r) => r.tweetId), [P + 't2']);
    assert.equal(await getWorkspaceTableCount(sql, ws.id, { columnIds: [colB.id] }), 1);

    // 방향 뒤집기 + 다른 지표로 정렬(likes는 이번에 새로 정렬 가능해진 키)
    const asc = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', dir: 'asc' });
    assert.deepEqual(asc.map((r) => r.tweetId), [P + 't1', P + 't2']);
    const byLikes = await getWorkspaceTableRows(sql, ws.id, { sort: 'likes' });
    // t1(likes=500) > t2(likes=10) — views 정렬([t2,t1])과는 반대 순서라, sort 키가 실제로 likes를
    // 쓰고 있음을 증명한다(views로 새는 버그였다면 [t2, t1]이 나와 이 단언이 깨진다).
    assert.deepEqual(byLikes.map((r) => r.tweetId), [P + 't1', P + 't2'], 'likes 정렬은 views와 다른 순서를 내야 한다');

    // 페이지네이션
    const page = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', limit: 1, offset: 1 });
    assert.deepEqual(page.map((r) => r.tweetId), [P + 't1']);

    // savedBy: candidate + member에서 워크스페이스 범위로 집계 — library_item이 아님을 증명
    const mSaved = await createMember(sql, P + 'Saved', '#444444');
    await sql`insert into candidate (tweet_id, workspace_id, member_id) values (${P + 't1'}, ${ws.id}, ${mSaved.id})`;
    const withSaved = await getWorkspaceTableRows(sql, ws.id, { sort: 'views' });
    const t1Row = withSaved.find((r) => r.tweetId === P + 't1')!;
    const t2Row = withSaved.find((r) => r.tweetId === P + 't2')!;
    assert.deepEqual(t1Row.savedBy.map((mm) => mm.name), [P + 'Saved'], '저장자는 candidate+member에서 워크스페이스 범위로 온다');
    assert.deepEqual(t2Row.savedBy, [], '아무도 저장하지 않은 트윗은 savedBy가 빈 배열');
  } finally {
    await sql`delete from dismissed_tweet where workspace_id = ${ws.id}`;
    await deleteColumn(sql, colA.id); await deleteColumn(sql, colB.id); await deleteColumn(sql, colX.id);
    await deleteWorkspace(sql, ws.id); await deleteWorkspace(sql, other.id);
  }
});

test('표 쿼리 — limit이 실제로 행 수를 제한하고, 상한을 훌쩍 넘겨도 SQL 오류 없이 동작한다', async () => {
  // 주의: TABLE_MAX=5000 경계 자체(5000건 vs 5001건)는 5001행을 실제로 넣지 않는 한
  // 관측할 수 없다 — 그건 이 테스트가 하지 않는다(공유 프로덕션 DB에 5000+행을 심는 비용이 과함).
  // 대신 여기서 실제로 증명하는 것은: (a) limit 파라미터가 진짜로 행 수를 자른다는 것,
  // (b) 상한을 훨씬 웃도는 limit(99999)을 넘겨도 clamp 로직이 SQL 오류 없이 통과하고,
  // 존재하는 행만큼만(=상한 이하) 돌려준다는 것.
  const ws = await createWorkspace(sql, P + 'ws-cap');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'cap', config: { keywords: ['x'] } });
  try {
    await upsertTweets(sql, [tw('cap1', 30), tw('cap2', 20), tw('cap3', 10)]);
    await linkColumnTweets(sql, col.id, [P + 'cap1', P + 'cap2', P + 'cap3']);

    const limited = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', limit: 2 });
    assert.equal(limited.length, 2, 'limit 파라미터가 실제로 행 수를 제한해야 한다(무시되면 3이 나온다)');

    const overCap = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', limit: 99999 });
    assert.equal(overCap.length, 3, '상한을 훌쩍 넘겨 요청해도 SQL 오류 없이, 존재하는 행은 모두 반환된다');
    assert.ok(overCap.length <= TABLE_MAX, `반환 행 수는 상한(${TABLE_MAX})을 넘어서는 안 된다`);
  } finally {
    await deleteColumn(sql, col.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('표 쿼리 — 열 다중선택은 OR, 열 이름은 필터와 무관하게 전체', async () => {
  const ws = await createWorkspace(sql, P + 'ws-f1');
  const colA = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'A', config: { keywords: ['a'] } });
  const colB = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'B', config: { keywords: ['b'] } });
  const colC = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'C', config: { keywords: ['c'] } });
  try {
    await upsertTweets(sql, [tw('f1', 100), tw('f2', 200), tw('f3', 300)]);
    await linkColumnTweets(sql, colA.id, [P + 'f1', P + 'f2']);
    await linkColumnTweets(sql, colB.id, [P + 'f2']);          // f2는 A·B 양쪽
    await linkColumnTweets(sql, colC.id, [P + 'f3']);

    const ab = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', columnIds: [colA.id, colB.id] });
    assert.deepEqual(ab.map((r) => r.tweetId), [P + 'f2', P + 'f1'], 'A 또는 B에 걸린 것 (OR)');

    // A만 골랐어도 f2의 열 이름에는 B가 함께 나와야 한다 — 내보낸 파일이 소속을 축소하면 안 된다
    const onlyA = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', columnIds: [colA.id] });
    const f2 = onlyA.find((r) => r.tweetId === P + 'f2')!;
    assert.deepEqual([...f2.columnTitles].sort(), [P + 'A', P + 'B']);

    assert.equal(await getWorkspaceTableCount(sql, ws.id, { columnIds: [colA.id, colB.id] }), 2);
    assert.equal(await getWorkspaceTableCount(sql, ws.id), 3);
  } finally {
    await deleteColumn(sql, colA.id); await deleteColumn(sql, colB.id); await deleteColumn(sql, colC.id);
    await deleteWorkspace(sql, ws.id);
  }
});

test('표 쿼리 — 조건이 AND로 결합되고 건수도 같은 조건을 쓴다', async () => {
  const ws = await createWorkspace(sql, P + 'ws-f2');
  const col = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'F', config: { keywords: ['x'] } });
  try {
    await upsertTweets(sql, [
      { ...tw('sk1', 500), text: 'スキンケア 良い', authorHandle: 'aaa', authorFollowers: 100 },
      { ...tw('sk2', 900), text: 'スキンケア 悪い', authorHandle: 'bbb', authorFollowers: 5000 },
      { ...tw('sk3', 900), text: '関係ない', authorHandle: 'aaa', authorFollowers: 5000 },
    ]);
    await linkColumnTweets(sql, col.id, [P + 'sk1', P + 'sk2', P + 'sk3']);

    const f = (field: string, op: string, value: string) => ({ id: field, field, op, value } as never);
    // 조회수 600 이상 AND 본문에 スキンケア 포함 → sk2만
    const rows = await getWorkspaceTableRows(sql, ws.id, {
      sort: 'views', filters: [f('views', 'gte', '600'), f('text', 'contains', 'スキンケア')],
    });
    assert.deepEqual(rows.map((r) => r.tweetId), [P + 'sk2']);
    assert.equal(await getWorkspaceTableCount(sql, ws.id, {
      filters: [f('views', 'gte', '600'), f('text', 'contains', 'スキンケア')],
    }), 1, '건수와 행 목록이 같은 조건을 써야 라벨이 실제와 맞는다');

    // 본문 제외
    const exc = await getWorkspaceTableRows(sql, ws.id, { sort: 'views', filters: [f('text', 'notContains', 'スキンケア')] });
    assert.deepEqual(exc.map((r) => r.tweetId), [P + 'sk3']);

    // 계정 같음 + 팔로워 이상
    const acct = await getWorkspaceTableRows(sql, ws.id, {
      sort: 'views', filters: [f('handle', 'is', 'aaa'), f('followers', 'gte', '1000')],
    });
    assert.deepEqual(acct.map((r) => r.tweetId), [P + 'sk3']);

    // 날짜: 픽스처는 2026-07-01 작성 → 이후 포함, 이전 미포함
    assert.equal((await getWorkspaceTableRows(sql, ws.id, { sort: 'views', filters: [f('date', 'after', '2026-07-01')] })).length, 3);
    assert.equal((await getWorkspaceTableRows(sql, ws.id, { sort: 'views', filters: [f('date', 'before', '2026-07-01')] })).length, 0);
  } finally {
    await deleteColumn(sql, col.id); await deleteWorkspace(sql, ws.id);
  }
});

test('표 쿼리 — 열별 건수', async () => {
  const ws = await createWorkspace(sql, P + 'ws-f3');
  const colA = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'CA', config: { keywords: ['a'] } });
  const colB = await createColumn(sql, { workspaceId: ws.id, kind: 'search', title: P + 'CB', config: { keywords: ['b'] } });
  try {
    await upsertTweets(sql, [tw('h1', 10), tw('h2', 20)]);
    await linkColumnTweets(sql, colA.id, [P + 'h1', P + 'h2']);
    await linkColumnTweets(sql, colB.id, [P + 'h1']);
    const counts = await getWorkspaceColumnCounts(sql, ws.id);
    const byId = new Map(counts.map((c) => [c.columnId, c.n]));
    assert.equal(byId.get(colA.id), 2);
    assert.equal(byId.get(colB.id), 1);
  } finally {
    await deleteColumn(sql, colA.id); await deleteColumn(sql, colB.id); await deleteWorkspace(sql, ws.id);
  }
});
