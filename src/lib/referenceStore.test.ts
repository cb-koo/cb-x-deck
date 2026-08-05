import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { listReferences, getReferencesByIds } from './referenceStore.ts';

const sql = getSql();
const P = 'test-ref-' + process.pid + '-';
const T1 = P + 'tw1';
const T2 = P + 'tw2';

after(async () => {
  await sql`delete from tweet where tweet_id like ${P + '%'}`;   // candidate·library_item cascade
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql`delete from tag where name like ${P + '%'}`;
  await sql.end();
});

test('전역 병합: 같은 트윗은 1행 + 메모 전부 + 출처 워크스페이스, 메모 우선 정렬', async () => {
  const wsA = await createWorkspace(sql, P + 'wsA');
  const wsB = await createWorkspace(sql, P + 'wsB');
  const [m] = await sql<Array<{ id: string }>>`
    insert into member (name) values (${P + 'm'}) returning id`;
  await sql`insert into tweet (tweet_id, author_handle, text, metrics)
            values (${T1}, 'mika', '正直迷ってた', ${sql.json({ likes: 10 })}),
                   (${T2}, 'rina', 'メモなしツイート', ${sql.json({})})`;
  // T1은 두 워크스페이스에, T2는 A에만
  await sql`insert into library_item (workspace_id, tweet_id) values
            (${wsA.id}, ${T1}), (${wsB.id}, ${T1}), (${wsA.id}, ${T2})`;
  // 메모는 wsA·wsB 각 1건 (T1), T2는 저장만
  const [c1] = await sql<Array<{ id: string }>>`
    insert into candidate (tweet_id, workspace_id, member_id, memo)
    values (${T1}, ${wsA.id}, ${m.id}, '앵글이 신선') returning id`;
  await sql`insert into candidate (tweet_id, workspace_id, member_id, memo)
            values (${T1}, ${wsB.id}, ${m.id}, '형식 재사용')`;
  const [tg] = await sql<Array<{ id: string }>>`
    insert into tag (name) values (${P + '형식'}) returning id`;
  await sql`insert into candidate_tag (candidate_id, tag_id) values (${c1.id}, ${tg.id})`;

  try {
    const all = (await listReferences(sql, { scope: 'all' })).filter((r) => r.tweetId.startsWith(P));
    assert.equal(all.length, 2);
    assert.equal(all[0].tweetId, T1);                      // 메모 있는 것 우선
    assert.equal(all[0].memos.length, 2);                  // 두 워크스페이스 메모 병합
    assert.equal(all[0].workspaces.length, 2);
    assert.equal(all[0].likes, 10);
    assert.ok(all[0].tags.includes(P + '형식'));
    assert.equal(all[1].tweetId, T2);
    assert.equal(all[1].memos.length, 0);

    // 워크스페이스 스코프: wsB에는 T1만, 메모는 wsB 것만
    const scoped = (await listReferences(sql, { scope: { workspaceId: wsB.id } }))
      .filter((r) => r.tweetId.startsWith(P));
    assert.equal(scoped.length, 1);
    assert.deepEqual(scoped[0].memos.map((x) => x.text), ['형식 재사용']);

    // 태그 필터
    const tagged = (await listReferences(sql, { scope: 'all', tag: P + '형식' }))
      .filter((r) => r.tweetId.startsWith(P));
    assert.deepEqual(tagged.map((r) => r.tweetId), [T1]);

    // getReferencesByIds
    const byIds = await getReferencesByIds(sql, [T1]);
    assert.equal(byIds.length, 1);
    assert.equal(byIds[0].memos.length, 2);
  } finally {
    await deleteWorkspace(sql, wsA.id);
    await deleteWorkspace(sql, wsB.id);
  }
});
