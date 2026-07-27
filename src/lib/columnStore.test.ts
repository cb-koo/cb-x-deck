import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { listColumns, createColumn, updateColumn, deleteColumn, touchRefreshed, getColumn, reorderColumns, ColumnSetMismatch } from './columnStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';

const sql = getSql();
const T = 'test-cs-' + process.pid;

after(async () => {
  await sql`delete from workspace where name like ${T + '%'}`;
  await sql.end();
});

test('CRUD + 워크스페이스 스코프 + touchRefreshed', async () => {
  const ws1 = await createWorkspace(sql, T + '-w1');
  const ws2 = await createWorkspace(sql, T + '-w2');
  try {
    const c = await createColumn(sql, { workspaceId: ws1.id, kind: 'watchlist', title: T, config: { handle: 'h', userId: '1' } });
    assert.equal(c.workspaceId, ws1.id);
    assert.equal(c.lastRefreshedAt, null);

    const u = await updateColumn(sql, c.id, { title: T + '2' });
    assert.equal(u.title, T + '2');

    await touchRefreshed(sql, c.id);
    const got = await getColumn(sql, c.id);
    assert.ok(got && got.lastRefreshedAt);

    assert.ok((await listColumns(sql, ws1.id)).some((x) => x.id === c.id));
    assert.ok(!(await listColumns(sql, ws2.id)).some((x) => x.id === c.id)); // 다른 워크스페이스에선 안 보임

    await deleteColumn(sql, c.id);
    assert.equal(await getColumn(sql, c.id), null);
  } finally {
    await deleteWorkspace(sql, ws1.id);
    await deleteWorkspace(sql, ws2.id);
  }
});

test('position 자동 증가 + reorderColumns + 집합 불일치 거부', async () => {
  const ws = await createWorkspace(sql, T + '-w3');
  try {
    const mk = (n: string) => createColumn(sql, { workspaceId: ws.id, kind: 'search', title: T + n, config: { keywords: [n] } });
    const a = await mk('-a');
    const b = await mk('-b');
    const c = await mk('-c');
    assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]); // 새 컬럼은 항상 맨 뒤

    const out = await reorderColumns(sql, ws.id, [c.id, a.id, b.id]);
    assert.deepEqual(out.map((x) => x.id), [c.id, a.id, b.id]);
    assert.deepEqual(out.map((x) => x.position), [0, 1, 2]);
    assert.deepEqual((await listColumns(sql, ws.id)).map((x) => x.id), [c.id, a.id, b.id]);

    const d = await mk('-d');
    assert.equal(d.position, 3); // 재정렬 뒤에도 맨 뒤로 붙는다

    // 일부만 보내면 거부 — 그 사이 다른 멤버가 컬럼을 추가/삭제했다는 뜻
    await assert.rejects(() => reorderColumns(sql, ws.id, [c.id, a.id]), ColumnSetMismatch);
    // 중복 id도 거부
    await assert.rejects(() => reorderColumns(sql, ws.id, [c.id, c.id, a.id, b.id]), ColumnSetMismatch);
  } finally {
    await deleteWorkspace(sql, ws.id);
  }
});
