import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  upsertSnapshot, getSnapshots, getStoredFetchedAt, planSyncTasks, taskKey,
  getSummaryCache, putSummaryCache,
} from './reportStore.ts';
import type { ReportBundles, ReportResponse } from './reportApi.ts';

const sql = getSql();
const C = 'trpt' + process.pid;
after(async () => {
  await sql`delete from report_snapshot where clinic_code like ${C + '%'}`;
  await sql`delete from report_summary_cache where clinic_code like ${C + '%'}`;
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

test('date 컬럼이 ISO 문자열로 돌아온다 + getStoredFetchedAt 키 매칭·since 필터', async () => {
  await upsertSnapshot(sql, { clinicCode: C + 'd', granularity: 'day', periodStart: '2026-07-01', periodEnd: '2026-07-01', payload: PAYLOAD });
  const rows = await getSnapshots(sql, C + 'd', 'day', '2026-07-01', '2026-07-01');
  assert.equal(rows[0].periodStart, '2026-07-01');
  assert.equal(rows[0].periodEnd, '2026-07-01');
  const stored = await getStoredFetchedAt(sql, [C + 'd'], '2026-06-01');
  assert.ok(stored.has(taskKey({ clinicCode: C + 'd', granularity: 'day', start: '2026-07-01' })));
  assert.equal((await getStoredFetchedAt(sql, [C + 'd'], '2026-08-01')).size, 0);
});

test('요약 캐시 — 왕복 + upsert 갱신 + TTL 판정은 호출부 몫(fetched_at 그대로 반환)', async () => {
  const cc = C + 's';
  const report = { meta: { clinic: { name: 'Test' }, period: { start: '2026-07-01', end: '2026-07-31', days: 31 },
    generated_at: '2026-08-01T00:00:00Z' }, current: {} } as ReportResponse;
  assert.equal(await getSummaryCache(sql, cc, '2026-07-01', '2026-07-31'), null); // 미저장

  await putSummaryCache(sql, { clinicCode: cc, periodStart: '2026-07-01', periodEnd: '2026-07-31', payload: report });
  const first = await getSummaryCache(sql, cc, '2026-07-01', '2026-07-31');
  assert.ok(first);
  assert.equal(first!.payload.meta.clinic.name, 'Test');
  const fetchedAtMs = new Date(first!.fetchedAt).getTime();
  assert.ok(Date.now() - fetchedAtMs < 5000); // 방금 저장 — TTL(10분) 안

  // fetched_at을 11분 전으로 되돌려 만료 상태를 재현 — 만료 판정은 route.ts(호출부)가 now()와 비교해서 하므로,
  // getSummaryCache 자신은 필터링 없이 그대로 돌려줘야 이 시나리오를 테스트로 확인할 수 있다.
  await sql`update report_summary_cache set fetched_at = now() - interval '11 minutes'
    where clinic_code = ${cc} and period_start = '2026-07-01' and period_end = '2026-07-31'`;
  const stale = await getSummaryCache(sql, cc, '2026-07-01', '2026-07-31');
  assert.ok(Date.now() - new Date(stale!.fetchedAt).getTime() >= 10 * 60 * 1000); // TTL 초과 — 호출부가 만료로 판단할 값

  // 재조회(upsert)하면 같은 키가 갱신된다 — 새 행이 생기지 않음.
  const updated = { ...report, meta: { ...report.meta, generated_at: '2026-08-02T00:00:00Z' } };
  await putSummaryCache(sql, { clinicCode: cc, periodStart: '2026-07-01', periodEnd: '2026-07-31', payload: updated });
  const rows = await sql`select count(*)::int as n from report_summary_cache where clinic_code = ${cc}`;
  assert.equal(rows[0].n, 1);
  const fresh = await getSummaryCache(sql, cc, '2026-07-01', '2026-07-31');
  assert.equal(fresh!.payload.meta.generated_at, '2026-08-02T00:00:00Z');
  assert.ok(Date.now() - new Date(fresh!.fetchedAt).getTime() < 5000); // upsert가 fetched_at도 갱신
});
