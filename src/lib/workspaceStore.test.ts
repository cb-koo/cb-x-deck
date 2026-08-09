import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { listWorkspaces, createWorkspace, deleteWorkspace, renameWorkspace, listMembers, createMember, resolveMember } from './workspaceStore.ts';

const sql = getSql();
const T = 'test-ws-' + process.pid;
const P = 'test-rm-' + process.pid + '-';

after(async () => {
  await sql`delete from workspace where name like ${T + '%'}`;
  await sql`delete from member where name like ${T + '%'} or name like ${P + '%'}`;
  await sql`delete from member where email like ${P + '%'}`;
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

test('createWorkspace: 새 워크스페이스는 목록 맨 뒤 position을 받는다', async () => {
  const a = await createWorkspace(sql, T + '-pos-a');
  const b = await createWorkspace(sql, T + '-pos-b');
  assert.ok(b.position > a.position, `b(${b.position})는 a(${a.position})보다 뒤여야 한다`);
  const all = await listWorkspaces(sql);
  const ia = all.findIndex((w) => w.id === a.id);
  const ib = all.findIndex((w) => w.id === b.id);
  assert.ok(ib > ia);
  await deleteWorkspace(sql, a.id);
  await deleteWorkspace(sql, b.id);
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

test('resolveMember: 신규 생성 + 재조회 반환 + 이름 폴백', async () => {
  const email = P + 'a@x.com';
  const u1 = { email, user_metadata: { full_name: P + 'Alice' } };
  const m1 = await resolveMember(sql, u1);
  assert.equal(m1.name, P + 'Alice');
  // 재조회는 같은 멤버(중복 생성 안 함)
  const m2 = await resolveMember(sql, u1);
  assert.equal(m2.id, m1.id);
  // 이름 없으면 이메일 앞부분 폴백
  const email2 = P + 'bob@x.com';
  const m3 = await resolveMember(sql, { email: email2, user_metadata: {} });
  assert.equal(m3.name, P + 'bob');
});

test('renameWorkspace: 이름 변경 + 미존재 null', async () => {
  const w = await createWorkspace(sql, T + '-rn');
  const renamed = await renameWorkspace(sql, w.id, T + '-rn-신규');
  assert.equal(renamed?.name, T + '-rn-신규');
  assert.equal(renamed?.id, w.id);
  const missing = await renameWorkspace(sql, '00000000-0000-0000-0000-000000000000', 'x');
  assert.equal(missing, null);
  await deleteWorkspace(sql, w.id);
});
