import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { listColumns, createColumn, updateColumn, deleteColumn, touchRefreshed, getColumn } from './columnStore.ts';

const sql = getSql();
const T = 'test-cs-' + process.pid;

after(async () => {
  await sql`delete from deck_column where title like ${T + '%'}`;
  await sql.end();
});

test('CRUD + touchRefreshed', async () => {
  const c = await createColumn(sql, { kind: 'watchlist', title: T, config: { handle: 'h', userId: '1' } });
  assert.equal(c.kind, 'watchlist');
  assert.equal(c.lastRefreshedAt, null);

  const u = await updateColumn(sql, c.id, { title: T + '2' });
  assert.equal(u.title, T + '2');

  await touchRefreshed(sql, c.id);
  const got = await getColumn(sql, c.id);
  assert.ok(got && got.lastRefreshedAt);

  const all = await listColumns(sql);
  assert.ok(all.some((x) => x.id === c.id));

  await deleteColumn(sql, c.id);
  assert.equal(await getColumn(sql, c.id), null);
});
