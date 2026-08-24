import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { upsertSnapshot, getSnapshots, planSyncTasks, taskKey } from './reportStore.ts';
import type { ReportBundles } from './reportApi.ts';

const sql = getSql();
const C = 'trpt' + process.pid;
after(async () => {
  await sql`delete from report_snapshot where clinic_code like ${C + '%'}`;
  await sql.end();
});

const PAYLOAD = { funnel: { active_customers: 1, new_customers: 0, consulted_customers: 0,
  reservers: { by_line_id: 0, by_name: 0 }, visitors: { by_line_id: 0, by_name: 0 } } } as ReportBundles;

test('upsert 멱등 + 겹침 조회 + fetched_at 갱신', async () => {
  await upsertSnapshot(sql, { clinicCode: C, granularity: 'day', periodStart: '2026-07-01', periodEnd: '2026-07-01', payload: PAYLOAD });
  const first = (await getSnapshots(sql, C, 'day', '2026-07-01', '2026-07-02'))[0];
  await upsertSnapshot(sql, { clinicCode: C, granularity: 'day', periodStart: '2026-07-01', periodEnd: '2026-07-01', payload: PAYLOAD });
  const rows = await getSnapshots(sql, C, 'day', '2026-06-25', '2026-07-05');
  assert.equal(rows.length, 1); // 중복 없이 갱신
  assert.ok(rows[0].fetchedAt >= first.fetchedAt);
  assert.equal(rows[0].payload.funnel!.active_customers, 1);
  assert.equal((await getSnapshots(sql, C, 'week', '2026-07-01', '2026-07-31')).length, 0); // 단위 분리
});

test('planSyncTasks — 미수집 최신 우선, 그다음 오래 안 본 순, 닫힌 주·월 포함', () => {
  const stored = new Map<string, string>([
    [taskKey({ clinicCode: 'a', granularity: 'day', start: '2026-08-23' }), '2026-08-24T00:00:00Z'],
    [taskKey({ clinicCode: 'a', granularity: 'day', start: '2026-08-22' }), '2026-08-22T00:00:00Z'],
  ]);
  const tasks = planSyncTasks({ clinicCodes: ['a'], todayKst: '2026-08-24', windowDays: 3, stored });
  // 후보 day: 8/21·8/22·8/23. 미수집은 8/21뿐 → 맨 앞.
  assert.equal(tasks[0].start, '2026-08-21');
  assert.equal(tasks[0].granularity, 'day');
  // 수집된 것 중에선 fetched_at 오래된 8/22가 8/23보다 앞.
  const idx22 = tasks.findIndex((t) => t.granularity === 'day' && t.start === '2026-08-22');
  const idx23 = tasks.findIndex((t) => t.granularity === 'day' && t.start === '2026-08-23');
  assert.ok(idx22 < idx23);
  // 창과 겹치는 닫힌 주(8/17~8/23)와 닫히지 않은 8월 월간은 포함/제외.
  assert.ok(tasks.some((t) => t.granularity === 'week' && t.start === '2026-08-17'));
  assert.ok(!tasks.some((t) => t.granularity === 'month' && t.start === '2026-08-01'));
});

test('planSyncTasks — 클리닉 여러 개면 같은 우선순위끼리 교차 배치', () => {
  const tasks = planSyncTasks({ clinicCodes: ['a', 'b'], todayKst: '2026-08-24', windowDays: 2, stored: new Map() });
  const firstTwo = tasks.slice(0, 2).map((t) => t.clinicCode).sort();
  assert.deepEqual(firstTwo, ['a', 'b']); // 한 클리닉이 예산을 독식하지 않게
});
