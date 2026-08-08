import type postgres from 'postgres';
import { getUsageSql } from './db.ts';
import { rowCostUsd } from './usagePricing.ts';
import { featureLabel, apiLabel } from './usageFeatures.ts';
import { kstDayRange } from './datetime.ts';

export interface UsageEvent {
  api: string;
  operation: string;
  ok?: boolean;
  httpStatus?: number | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  units?: number;
}

export interface AggRow {
  api: string;
  operation: string;
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

let warnedRecordFailure = false;

// 기록은 실제 API 동작을 막지 않는다: await 하지 않고, 실패는 삼키며, PGHOST 없으면 no-op.
// 부하 시 즉시(재배포 없이) 끌 수 있는 킬스위치: USAGE_RECORDING=off.
export function recordUsageSafe(ev: UsageEvent): void {
  if (!process.env.PGHOST) return;
  if (process.env.USAGE_RECORDING === 'off') return;
  void (async () => {
    try {
      const sql = getUsageSql();
      await sql`
        insert into api_usage (api, operation, ok, http_status, model, input_tokens, output_tokens, units)
        values (${ev.api}, ${ev.operation}, ${ev.ok ?? true}, ${ev.httpStatus ?? null}, ${ev.model ?? null},
                ${ev.inputTokens ?? null}, ${ev.outputTokens ?? null}, ${ev.units ?? 1})`;
    } catch (e) {
      if (!warnedRecordFailure) {
        warnedRecordFailure = true;
        console.warn('[api_usage] 사용량 기록 실패(이후 동일 오류는 생략) — 마이그레이션 009 미적용 여부 확인:', (e as Error).message);
      }
    }
  })();
}

export async function rawAggregate(sql: postgres.Sql, from: Date, to: Date): Promise<AggRow[]> {
  const rows = await sql<Array<{ api: string; operation: string; model: string | null; calls: number; input_tokens: number; output_tokens: number }>>`
    select api, operation, model,
           count(*)::int as calls,
           coalesce(sum(input_tokens), 0)::float8 as input_tokens,
           coalesce(sum(output_tokens), 0)::float8 as output_tokens
      from api_usage
     where ok = true and created_at >= ${from} and created_at < ${to}
     group by api, operation, model`;
  return rows.map((r) => ({
    api: r.api, operation: r.operation, model: r.model,
    calls: r.calls, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
  }));
}

export async function dailyAggregate(sql: postgres.Sql, from: Date, to: Date): Promise<Array<AggRow & { day: string }>> {
  const rows = await sql<Array<{ day: string; api: string; model: string | null; calls: number; input_tokens: number; output_tokens: number }>>`
    -- Asia/Seoul: 이 화면의 다른 값들과 같은 기준. 예전엔 Asia/Tokyo였는데 오프셋이 같아
    -- 출력은 동일했지만, 기간 경계(usage/page.tsx)가 KST로 바뀌면서 이름이 어긋나 보인다.
    select to_char(date_trunc('day', created_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as day,
           api, model,
           count(*)::int as calls,
           coalesce(sum(input_tokens), 0)::float8 as input_tokens,
           coalesce(sum(output_tokens), 0)::float8 as output_tokens
      from api_usage
     where ok = true and created_at >= ${from} and created_at < ${to}
     group by day, api, model
     order by day`;
  return rows.map((r) => ({
    day: r.day, api: r.api, operation: '', model: r.model,
    calls: r.calls, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
  }));
}

// --- 순수 reshape (DB 불필요, 단위테스트 대상) ---

export function summarizeByApi(rows: AggRow[]) {
  const m = new Map<string, { api: string; label: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const r of rows) {
    const e = m.get(r.api) ?? { api: r.api, label: apiLabel(r.api), calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    e.calls += r.calls;
    e.inputTokens += r.inputTokens;
    e.outputTokens += r.outputTokens;
    e.costUsd += rowCostUsd(r);
    m.set(r.api, e);
  }
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function summarizeByFeature(rows: AggRow[]) {
  const m = new Map<string, { feature: string; calls: number; costUsd: number }>();
  for (const r of rows) {
    const f = featureLabel(r.operation);
    const e = m.get(f) ?? { feature: f, calls: 0, costUsd: 0 };
    e.calls += r.calls;
    e.costUsd += rowCostUsd(r);
    m.set(f, e);
  }
  return [...m.values()].sort((a, b) => b.costUsd - a.costUsd);
}

// range를 주면 그 기간의 한국 달력일을 빠짐없이 채운다(zero-fill) — 기록 없는 날도
// costUsd: 0인 자리를 갖게 되어, "최근 7일" 라벨인데 막대가 5개만 뜨는 어긋남이 없어진다.
// range를 안 주면 예전처럼 rows에 있는 날만(기록이 있는 날만) 나온다.
export function summarizeByDay(rows: Array<AggRow & { day: string }>, range?: { from: Date; to: Date }) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + rowCostUsd(r));
  const days = range ? kstDayRange(range.from, range.to) : [...m.keys()].sort((a, b) => a.localeCompare(b));
  return days.map((day) => ({ day, costUsd: m.get(day) ?? 0 }));
}

export function totalCostUsd(rows: AggRow[]): number {
  return rows.reduce((s, r) => s + rowCostUsd(r), 0);
}
