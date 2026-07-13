import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { listWorkspaces, createWorkspace, deleteWorkspace, listMembers, createMember } from './workspaceStore.ts';

const sql = getSql();
const T = 'test-ws-' + process.pid;

after(async () => {
  await sql`delete from workspace where name like ${T + '%'}`;
  await sql`delete from member where name like ${T + '%'}`;
  await sql.end();
});

test('workspace CRUD', async () => {
  const w = await createWorkspace(sql, T);
  assert.equal(w.name, T);
  const all = await listWorkspaces(sql);
  assert.ok(all.some((x) => x.id === w.id));
  await deleteWorkspace(sql, w.id);
  assert.ok(!(await listWorkspaces(sql)).some((x) => x.id === w.id));
});

test('member 생성·목록', async () => {
  const m = await createMember(sql, T + '-m', '#00ba7c');
  assert.equal(m.color, '#00ba7c');
  assert.ok((await listMembers(sql)).some((x) => x.id === m.id));
});

test('마이그레이션 귀속: 기존 컬럼·후보에 workspace/member 채워짐', async () => {
  const [{ c1 }] = await sql`select count(*)::int as c1 from deck_column where workspace_id is null`;
  const [{ c2 }] = await sql`select count(*)::int as c2 from candidate where member_id is null or workspace_id is null`;
  assert.equal(c1, 0);
  assert.equal(c2, 0);
});
