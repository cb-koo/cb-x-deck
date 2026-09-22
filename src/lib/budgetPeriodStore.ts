// 클라이언트 예산 기간 저장소 — 겹침은 DB exclusion constraint(058)가 막고, 이 파일은 사용자에게 보여줄
// 겹치는 기간 정보를 사전 조회해 사람이 읽을 오류로 바꾼다(레이스는 constraint가 최종 방어, 스펙 §7).
import type postgres from 'postgres';
import type { BudgetPeriod, BudgetPeriodInput } from './clientBudget.ts';

type Row = { id: string; starts_on: string; ends_on: string; amount_krw: number };
const toPeriod = (r: Row): BudgetPeriod => ({ id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, amountKrw: r.amount_krw });
const COLS = (sql: postgres.Sql) => sql`
  id, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on, amount_krw`;

export async function listBudgetPeriods(sql: postgres.Sql, clientId: string): Promise<BudgetPeriod[]> {
  const rows = await sql<Row[]>`
    select ${COLS(sql)} from client_budget_period where client_id = ${clientId} order by starts_on desc`;
  return rows.map(toPeriod);
}

export type BudgetPeriodResult =
  | { ok: true; period: BudgetPeriod }
  | { ok: false; conflict: { startsOn: string; endsOn: string } };

async function findOverlap(
  sql: postgres.Sql, clientId: string, startsOn: string, endsOn: string, excludeId?: string,
): Promise<{ startsOn: string; endsOn: string } | null> {
  const rows = await sql<Array<{ starts_on: string; ends_on: string }>>`
    select to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from client_budget_period
     where client_id = ${clientId}
       and daterange(starts_on, ends_on, '[]') && daterange(${startsOn}::date, ${endsOn}::date, '[]')
       ${excludeId ? sql`and id <> ${excludeId}` : sql``}
     limit 1`;
  // postgres.js는 컬럼명을 camelCase로 바꿔주지 않는다(db.ts에 그런 transform 설정이 없다) — 그대로 두면
  // 런타임 키가 starts_on/ends_on이라 이 함수의 선언한 반환 타입(startsOn/endsOn)과 어긋난다(tsc TS2739로 확인).
  return rows.length ? { startsOn: rows[0].starts_on, endsOn: rows[0].ends_on } : null;
}

export async function createBudgetPeriod(
  sql: postgres.Sql, clientId: string, input: BudgetPeriodInput,
): Promise<BudgetPeriodResult> {
  const conflict = await findOverlap(sql, clientId, input.startsOn, input.endsOn);
  if (conflict) return { ok: false, conflict };
  try {
    const rows = await sql<Row[]>`
      insert into client_budget_period (client_id, starts_on, ends_on, amount_krw)
      values (${clientId}, ${input.startsOn}::date, ${input.endsOn}::date, ${input.amountKrw})
      returning ${COLS(sql)}`;
    return { ok: true, period: toPeriod(rows[0]) };
  } catch (e) {
    if ((e as { code?: string }).code === '23P01') {   // exclusion_violation — 동시 요청 레이스
      const raced = await findOverlap(sql, clientId, input.startsOn, input.endsOn);
      return { ok: false, conflict: raced ?? { startsOn: input.startsOn, endsOn: input.endsOn } };
    }
    throw e;
  }
}

export async function updateBudgetPeriod(
  sql: postgres.Sql, id: string, clientId: string, input: BudgetPeriodInput,
): Promise<BudgetPeriodResult | null> {
  // 존재 확인이 겹침 확인보다 먼저다 — 순서를 바꾸면 없는 id를(클라이언트는 맞는) 다른 기간과 겹치는
  // 날짜로 "수정"하려 할 때 겹침이 존재 여부보다 먼저 걸려 null 대신 conflict가 나간다(404가 아니게 된다).
  const exists = await sql`select 1 from client_budget_period where id = ${id} and client_id = ${clientId}`;
  if (exists.length === 0) return null;
  const conflict = await findOverlap(sql, clientId, input.startsOn, input.endsOn, id);
  if (conflict) return { ok: false, conflict };
  try {
    const rows = await sql<Row[]>`
      update client_budget_period set
        starts_on = ${input.startsOn}::date, ends_on = ${input.endsOn}::date,
        amount_krw = ${input.amountKrw}, updated_at = now()
      where id = ${id} and client_id = ${clientId}
      returning ${COLS(sql)}`;
    return rows.length ? { ok: true, period: toPeriod(rows[0]) } : null;
  } catch (e) {
    if ((e as { code?: string }).code === '23P01') {
      const raced = await findOverlap(sql, clientId, input.startsOn, input.endsOn, id);
      return { ok: false, conflict: raced ?? { startsOn: input.startsOn, endsOn: input.endsOn } };
    }
    throw e;
  }
}

export async function deleteBudgetPeriod(sql: postgres.Sql, id: string, clientId: string): Promise<void> {
  await sql`delete from client_budget_period where id = ${id} and client_id = ${clientId}`;
}
