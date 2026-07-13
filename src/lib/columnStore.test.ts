import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { listColumns, createColumn, updateColumn, deleteColumn, touchRefreshed, getColumn } from './columnStore.ts';
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
