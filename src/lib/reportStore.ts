import type postgres from 'postgres';
import type { ReportBundles, ReportUnit } from './reportApi.ts';
import { addDays, bucketRanges } from './reportSeries.ts';

export interface SnapshotRow {
  clinicCode: string; granularity: ReportUnit; periodStart: string; periodEnd: string;
  payload: ReportBundles; fetchedAt: string;
}
type SRow = { clinic_code: string; granularity: ReportUnit; period_start: string; period_end: string; payload: ReportBundles; fetched_at: Date };
const toRow = (r: SRow): SnapshotRow => ({
  clinicCode: r.clinic_code, granularity: r.granularity,
  periodStart: String(r.period_start).slice(0, 10), periodEnd: String(r.period_end).slice(0, 10),
  payload: r.payload, fetchedAt: new Date(r.fetched_at).toISOString(),
});

export async function upsertSnapshot(sql: postgres.Sql, row: Omit<SnapshotRow, 'fetchedAt'>): Promise<void> {
  await sql`insert into report_snapshot (clinic_code, granularity, period_start, period_end, payload, fetched_at)
    values (${row.clinicCode}, ${row.granularity}, ${row.periodStart}, ${row.periodEnd}, ${sql.json(row.payload as never)}, now())
    on conflict (clinic_code, granularity, period_start)
    do update set period_end = excluded.period_end, payload = excluded.payload, fetched_at = now()`;
}

export async function getSnapshots(
  sql: postgres.Sql, clinicCode: string, granularity: ReportUnit, start: string, end: string,
): Promise<SnapshotRow[]> {
  const rows = await sql<SRow[]>`select clinic_code, granularity, period_start, period_end, payload, fetched_at
    from report_snapshot
    where clinic_code = ${clinicCode} and granularity = ${granularity}
      and period_end >= ${start} and period_start <= ${end}
    order by period_start`;
  return rows.map(toRow);
}

export interface SyncTask { clinicCode: string; granularity: ReportUnit; start: string; end: string }
export const taskKey = (t: { clinicCode: string; granularity: ReportUnit; start: string }) =>
  `${t.clinicCode}|${t.granularity}|${t.start}`;

export async function getStoredFetchedAt(
  sql: postgres.Sql, clinicCodes: string[], since: string,
): Promise<Map<string, string>> {
  if (clinicCodes.length === 0) return new Map();
  const rows = await sql<{ clinic_code: string; granularity: ReportUnit; period_start: string; fetched_at: Date }[]>`
    select clinic_code, granularity, period_start, fetched_at from report_snapshot
    where clinic_code = any(${clinicCodes}) and period_end >= ${since}`;
  return new Map(rows.map((r) => [
    taskKey({ clinicCode: r.clinic_code, granularity: r.granularity, start: String(r.period_start).slice(0, 10) }),
    new Date(r.fetched_at).toISOString(),
  ]));
}

// 크론 한 번의 할 일 목록. 우선순위: 미수집(최신 날짜 먼저) → 수집됐지만 오래 안 본 순.
// 3차 키는 클리닉 인덱스(라운드로빈) — 한 클리닉이 앞자리를 독식하지 않게 날짜별로 클리닉을 교차 배치한다.
// 소급 변경(취소·노쇼 상태, 광고비 늦은 입력) 때문에 창 안은 반복 재동기화한다.
export function planSyncTasks(opts: {
  clinicCodes: string[]; todayKst: string; windowDays: number; stored: Map<string, string>;
}): SyncTask[] {
  const { clinicCodes, todayKst, windowDays, stored } = opts;
  const winStart = addDays(todayKst, -windowDays);
  const yesterday = addDays(todayKst, -1);
  if (yesterday < winStart || clinicCodes.length === 0) return [];
  const candidates: SyncTask[] = [];
  for (const clinicCode of clinicCodes) {
    for (const b of bucketRanges(winStart, yesterday, 'day'))
      candidates.push({ clinicCode, granularity: 'day', start: b.start, end: b.end });
    for (const g of ['week', 'month'] as const)
      for (const b of bucketRanges(winStart, yesterday, g))
        if (b.end < todayKst) candidates.push({ clinicCode, granularity: g, start: b.start, end: b.end });
  }
  const revDate = (d: string) => String(99999999 - Number(d.replaceAll('-', '')));
  const clinicIdx = new Map(clinicCodes.map((c, i) => [c, i]));
  const rank = (t: SyncTask): [number, string] => {
    const f = stored.get(taskKey(t));
    // 미수집: 0순위, 최신 먼저(역순 문자열). 수집됨: 1순위, fetched_at 오래된 순.
    return f === undefined ? [0, revDate(t.start)] : [1, f];
  };
  return candidates
    .map((t) => ({ t, r: rank(t) }))
    .sort((a, b) => (a.r[0] - b.r[0]) || a.r[1].localeCompare(b.r[1]) || (clinicIdx.get(a.t.clinicCode)! - clinicIdx.get(b.t.clinicCode)!))
    .map((x) => x.t);
}
