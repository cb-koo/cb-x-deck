import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { listBudgetPeriods, createBudgetPeriod, updateBudgetPeriod, deleteBudgetPeriod } from './budgetPeriodStore.ts';

const sql = getSql();
const P = 'test-bp-' + process.pid + '-';

after(async () => {
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('createBudgetPeriod — 저장·조회 왕복, 최신 startsOn이 위', async () => {
  const c = await createClient(sql, P + '기간클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 2_500_000 });
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 5_000_000 });
  const rows = await listBudgetPeriods(sql, c.id);
  assert.deepEqual(rows.map((r) => r.startsOn), ['2026-09-01', '2026-08-01']);
  assert.equal(rows[0].amountKrw, 5_000_000);
});

test('createBudgetPeriod — 겹치면 conflict, 인접(빈틈 없이 붙은)은 통과', async () => {
  const c = await createClient(sql, P + '겹침클라');
  await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const overlap = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-15', endsOn: '2026-09-15', amountKrw: 1 });
  assert.equal(overlap.ok, false);
  if (!overlap.ok) assert.deepEqual(overlap.conflict, { startsOn: '2026-08-01', endsOn: '2026-08-31' });

  // 인접(8/31 종료 다음 날인 9/1 시작)은 겹치지 않는다
  const adjacent = await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 1 });
  assert.equal(adjacent.ok, true);

  // 같은 날 하루라도 겹치면 거부 — 8/31에 이미 있는데 8/31~9/5는 겹침
  const sameDay = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-31', endsOn: '2026-09-05', amountKrw: 1 });
  assert.equal(sameDay.ok, false);
});

test('updateBudgetPeriod — 자유 수정(자기 자신은 겹침 체크에서 제외), 없는 id는 null', async () => {
  const c = await createClient(sql, P + '수정클라');
  const a = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  const b = await createBudgetPeriod(sql, c.id, { startsOn: '2026-09-01', endsOn: '2026-09-30', amountKrw: 1 });
  if (!a.ok || !b.ok) throw new Error('setup failed');

  // 자기 자신의 날짜를 그대로 넣어도(자기 자신과 겹침) 통과해야 한다
  const same = await updateBudgetPeriod(sql, a.period.id, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 999 });
  assert.equal(same!.ok, true);

  // 다른 기간(b)과 겹치게 고치면 거부
  const clash = await updateBudgetPeriod(sql, a.period.id, c.id, { startsOn: '2026-08-01', endsOn: '2026-09-15', amountKrw: 1 });
  assert.equal(clash!.ok, false);

  // 없는 id·클라이언트 불일치는 null(404 처리용)
  assert.equal(await updateBudgetPeriod(sql, '00000000-0000-0000-0000-000000000000', c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 }), null);
  const other = await createClient(sql, P + '남의클라');
  assert.equal(await updateBudgetPeriod(sql, a.period.id, other.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 }), null);
});

test('deleteBudgetPeriod — 삭제 후 목록에서 사라짐, 클라이언트 삭제 시 cascade', async () => {
  const c = await createClient(sql, P + '삭제클라');
  const a = await createBudgetPeriod(sql, c.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  if (!a.ok) throw new Error('setup failed');
  await deleteBudgetPeriod(sql, a.period.id, c.id);
  assert.deepEqual(await listBudgetPeriods(sql, c.id), []);

  const c2 = await createClient(sql, P + '캐스케이드클라');
  await createBudgetPeriod(sql, c2.id, { startsOn: '2026-08-01', endsOn: '2026-08-31', amountKrw: 1 });
  await deleteClient(sql, c2.id);
  assert.deepEqual(await listBudgetPeriods(sql, c2.id), []);
});
