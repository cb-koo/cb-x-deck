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
  assert.equal(a.snapshot, null);
  const snap = { newInflow: 28, days: 3, reservers4: 31, revenue4: 40_000_000, roas4: 27.7, lostRate: 0.41, checks: [{ stage: 'conversion' as const, text: '미예약 41%' }], reason: '평소 범위예요' };
  const b = await saveReview(sql, { clientId: c.id, weekStart: '2026-09-28', weekEnd: '2026-09-30', verdict: 'adjust', suggested: 'keep', memo: '바꿈', by: null, snapshot: snap });
  assert.deepEqual(b.snapshot, snap);   // 확정 당시 숫자가 그대로 돌아온다
  assert.equal(b.verdict, 'adjust');
  assert.equal(b.suggested, 'keep');
  const n = await sql`select count(*)::int as n from client_weekly_review where client_id = ${c.id}`;
  assert.equal(n[0].n, 1);
  assert.equal(await loadClientStatus(sql, c.id, '2026-10-09'), null);
});

test('월 방향 기록: 같은 달은 덮어쓰고 당시 숫자를 남긴다', async () => {
  const { saveMonthReview } = await import('./clientMonthStore.ts');
  const c = await createClient(sql, P + 'm');
  const snap = { newInflow: 158, revenue: 33_467_000, roas: 18, budgetUsed: 0.76, weekVerdicts: { keep: 3, adjust: 1 } };
  await saveMonthReview(sql, { clientId: c.id, monthStart: '2026-09-01', direction: 'keep', memo: '', by: null, snapshot: snap });
  const b = await saveMonthReview(sql, { clientId: c.id, monthStart: '2026-09-01', direction: 'expand', memo: '11월 증액', by: null, snapshot: snap });
  assert.equal(b.direction, 'expand');
  assert.deepEqual(b.snapshot, snap);
  const n = await sql`select count(*)::int as n from client_monthly_review where client_id = ${c.id}`;
  assert.equal(n[0].n, 1);
});
