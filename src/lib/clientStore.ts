import type postgres from 'postgres';
import { budgetOverridesOf, type BudgetClient } from './clientBudget.ts';

export interface ClientRow {
  id: string; name: string; info: string; bannedPhrases: string[]; position: number; updatedAt: string;
  landingUrl: string; nameEn: string;
  monthlyBudget: number | null;              // 기본 월 예산(원). null = 미설정 (스펙 2026-08-27 §3)
  budgetOverrides: Record<string, number>;   // {"YYYY-MM": 원} 예외 달만
  clinicCode: string | null;                 // 리포트 페이지 연결용 클리닉 코드(외부 리포트 API의 clinic_code). null = 연결 안 함
}
export interface ProcedureRow {
  id: string; clientId: string; name: string; description: string;
  effectPhrases: string; bannedPhrases: string[]; position: number;
}

type CRow = {
  id: string; name: string; info: string; banned_phrases: string[]; position: number; updated_at: Date;
  landing_url: string; name_en: string; monthly_budget: number | null; budget_overrides: unknown; clinic_code: string | null;
};
type PRow = { id: string; client_id: string; name: string; description: string; effect_phrases: string; banned_phrases: string[]; position: number };

// updated_at이 Date로 해석되지 않으면 toISOString()이 RangeError를 던진다. 그러면 그 한 값 때문에
// listClients 전체가 터지고, /api/clients가 500이 되고, /generate의 초기 Promise.all이 통째로 실패해
// "목록을 불러오지 못했어요"만 남는다 — 초안이 한 건도 안 보인다(2026-08-12 로컬에서 간헐 관측).
// 화면에 '3일 전 수정'을 적기 위한 파생값 하나가 목록 전체를 못 쓰게 만들 이유가 없다.
// 왜 그 값이 간헐적으로 깨지는지는 아직 못 밝혔다 — 원인과 별개로 여기서 무너지지는 않게 한다.
function toIsoOrEmpty(v: Date | string): string {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

const toClient = (r: CRow): ClientRow =>
  ({ id: r.id, name: r.name, info: r.info, bannedPhrases: r.banned_phrases, position: r.position,
     updatedAt: toIsoOrEmpty(r.updated_at), landingUrl: r.landing_url, nameEn: r.name_en,
     monthlyBudget: r.monthly_budget, budgetOverrides: budgetOverridesOf(r.budget_overrides), clinicCode: r.clinic_code });
const toProcedure = (r: PRow): ProcedureRow =>
  ({ id: r.id, clientId: r.client_id, name: r.name, description: r.description,
     effectPhrases: r.effect_phrases, bannedPhrases: r.banned_phrases, position: r.position });

// 세 조회가 같은 컬럼을 읽는다 — 한 곳만 컬럼을 빠뜨리면 그 경로에서만 undefined가 나온다
const CLIENT_COLS = (sql: postgres.Sql) => sql`
  id, name, info, banned_phrases, position, updated_at, landing_url, name_en, monthly_budget, budget_overrides, clinic_code`;

export async function createClient(sql: postgres.Sql, name: string): Promise<ClientRow> {
  const rows = await sql<CRow[]>`
    insert into client (name) values (${name})
    returning ${CLIENT_COLS(sql)}`;
  return toClient(rows[0]);
}

export async function listClients(sql: postgres.Sql): Promise<ClientRow[]> {
  const rows = await sql<CRow[]>`
    select ${CLIENT_COLS(sql)} from client order by position, created_at`;
  return rows.map(toClient);
}

export async function getClientWithProcedures(
  sql: postgres.Sql, id: string,
): Promise<{ client: ClientRow; procedures: ProcedureRow[] } | null> {
  const rows = await sql<CRow[]>`
    select ${CLIENT_COLS(sql)} from client where id = ${id}`;
  if (rows.length === 0) return null;
  const procs = await sql<PRow[]>`
    select id, client_id, name, description, effect_phrases, banned_phrases, position
      from client_procedure where client_id = ${id} order by position, created_at`;
  return { client: toClient(rows[0]), procedures: procs.map(toProcedure) };
}

export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; monthlyBudget?: number | null; clinicCode?: string | null },
): Promise<void> {
  await sql`update client set
      name = coalesce(${patch.name ?? null}, name),
      info = coalesce(${patch.info ?? null}, info),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases),
      landing_url = coalesce(${patch.landingUrl ?? null}, landing_url),
      name_en = coalesce(${patch.nameEn ?? null}, name_en),
      -- coalesce는 "null이면 유지"라 예산 지움을 표현할 수 없다 — undefined=유지 · null=지움 · 숫자=설정 (draftStore.influencer_handle 규칙)
      monthly_budget = case when ${patch.monthlyBudget !== undefined} then ${patch.monthlyBudget ?? null}::int else monthly_budget end,
      updated_at = now()
    where id = ${id}`;
  // clinic_code는 "null로 되돌리기"를 표현해야 해서 coalesce 패턴을 못 쓴다 — undefined(미지정)일 때만 건드리지 않는다.
  if (patch.clinicCode !== undefined) {
    await sql`update client set clinic_code = ${patch.clinicCode} where id = ${id}`;
  }
}

// 예외 달 설정/삭제 — 한 문장의 jsonb 연산이라 두 사람이 다른 달을 동시에 고쳐도 서로 덮지 않는다.
// null = 그 달 예외 삭제(기본값으로 돌아감). 없는 달을 지워도 오류 없음.
export async function setBudgetOverride(sql: postgres.Sql, id: string, month: string, amount: number | null): Promise<void> {
  if (amount === null) {
    await sql`update client set budget_overrides = budget_overrides - ${month}::text, updated_at = now() where id = ${id}`;
  } else {
    await sql`update client set budget_overrides = budget_overrides || jsonb_build_object(${month}::text, ${amount}::int),
                                updated_at = now() where id = ${id}`;
  }
}

// 캠페인 상세가 쓰는 가벼운 조회 — 시술까지 끌어오지 않는다
export async function getClientBudget(sql: postgres.Sql, id: string): Promise<BudgetClient | null> {
  const rows = await sql<Array<{ monthly_budget: number | null; budget_overrides: unknown }>>`
    select monthly_budget, budget_overrides from client where id = ${id}`;
  if (rows.length === 0) return null;
  return { monthlyBudget: rows[0].monthly_budget, budgetOverrides: budgetOverridesOf(rows[0].budget_overrides) };
}

export async function deleteClient(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from client where id = ${id}`;
}

export async function createProcedure(
  sql: postgres.Sql, clientId: string,
  input: { name: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] },
): Promise<ProcedureRow> {
  // 시술 변경은 부모 클라이언트의 "마지막 수정"에 포함된다 (카드 표기가 클라이언트 단위)
  const rows = await sql<PRow[]>`
    with p as (
      insert into client_procedure (client_id, name, description, effect_phrases, banned_phrases)
      values (${clientId}, ${input.name}, ${input.description ?? ''}, ${input.effectPhrases ?? ''},
              ${sql.json(input.bannedPhrases ?? [])})
      returning id, client_id, name, description, effect_phrases, banned_phrases, position
    ), touch as (
      update client set updated_at = now() where id = ${clientId}
    )
    select * from p`;
  return toProcedure(rows[0]);
}

export async function updateProcedure(
  sql: postgres.Sql, id: string,
  patch: { name?: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] },
): Promise<void> {
  await sql`with p as (
      update client_procedure set
        name = coalesce(${patch.name ?? null}, name),
        description = coalesce(${patch.description ?? null}, description),
        effect_phrases = coalesce(${patch.effectPhrases ?? null}, effect_phrases),
        banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases)
      where id = ${id}
      returning client_id
    )
    update client set updated_at = now() where id in (select client_id from p)`;
}

export async function deleteProcedure(sql: postgres.Sql, id: string): Promise<void> {
  await sql`with p as (
      delete from client_procedure where id = ${id} returning client_id
    )
    update client set updated_at = now() where id in (select client_id from p)`;
}
