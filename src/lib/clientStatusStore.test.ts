import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { saveReview, loadClientStatus } from './clientStatusStore.ts';

const sql = getSql();
const P = 'tcs' + process.pid;

after(async () => {
  await sql`delete from client where name like ${P + '%'}`; // 판정 기록은 cascade
  await sql.end();
});

test('판정 기록: 같은 주는 덮어쓰고, 리포트 연결 전 클라이언트는 현황이 없다', async () => {
  const c = await createClient(sql, P + 'c');
  const a = await saveReview(sql, { clientId: c.id, weekStart: '2026-09-28', verdict: 'keep', suggested: 'keep', memo: '첫 메모', by: null });
  assert.equal(a.verdict, 'keep');
  const b = await saveReview(sql, { clientId: c.id, weekStart: '2026-09-28', verdict: 'adjust', suggested: 'keep', memo: '바꿈', by: null });
  assert.equal(b.verdict, 'adjust');
  assert.equal(b.suggested, 'keep');
  const n = await sql`select count(*)::int as n from client_weekly_review where client_id = ${c.id}`;
  assert.equal(n[0].n, 1);
  assert.equal(await loadClientStatus(sql, c.id, '2026-10-09'), null);
});
