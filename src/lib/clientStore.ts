import type postgres from 'postgres';

export interface ClientRow { id: string; name: string; info: string; bannedPhrases: string[]; position: number }
export interface ProcedureRow {
  id: string; clientId: string; name: string; description: string;
  effectPhrases: string; bannedPhrases: string[]; position: number;
}

type CRow = { id: string; name: string; info: string; banned_phrases: string[]; position: number };
type PRow = { id: string; client_id: string; name: string; description: string; effect_phrases: string; banned_phrases: string[]; position: number };

const toClient = (r: CRow): ClientRow =>
  ({ id: r.id, name: r.name, info: r.info, bannedPhrases: r.banned_phrases, position: r.position });
const toProcedure = (r: PRow): ProcedureRow =>
  ({ id: r.id, clientId: r.client_id, name: r.name, description: r.description,
     effectPhrases: r.effect_phrases, bannedPhrases: r.banned_phrases, position: r.position });

export async function createClient(sql: postgres.Sql, name: string): Promise<ClientRow> {
  const rows = await sql<CRow[]>`
    insert into client (name) values (${name})
    returning id, name, info, banned_phrases, position`;
  return toClient(rows[0]);
}

export async function listClients(sql: postgres.Sql): Promise<ClientRow[]> {
  const rows = await sql<CRow[]>`
    select id, name, info, banned_phrases, position from client order by position, created_at`;
  return rows.map(toClient);
}

export async function getClientWithProcedures(
  sql: postgres.Sql, id: string,
): Promise<{ client: ClientRow; procedures: ProcedureRow[] } | null> {
  const rows = await sql<CRow[]>`
    select id, name, info, banned_phrases, position from client where id = ${id}`;
  if (rows.length === 0) return null;
  const procs = await sql<PRow[]>`
    select id, client_id, name, description, effect_phrases, banned_phrases, position
      from client_procedure where client_id = ${id} order by position, created_at`;
  return { client: toClient(rows[0]), procedures: procs.map(toProcedure) };
}

export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[] },
): Promise<void> {
  await sql`update client set
      name = coalesce(${patch.name ?? null}, name),
      info = coalesce(${patch.info ?? null}, info),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases)
    where id = ${id}`;
}

export async function deleteClient(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from client where id = ${id}`;
}

export async function createProcedure(
  sql: postgres.Sql, clientId: string,
  input: { name: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] },
): Promise<ProcedureRow> {
  const rows = await sql<PRow[]>`
    insert into client_procedure (client_id, name, description, effect_phrases, banned_phrases)
    values (${clientId}, ${input.name}, ${input.description ?? ''}, ${input.effectPhrases ?? ''},
            ${sql.json(input.bannedPhrases ?? [])})
    returning id, client_id, name, description, effect_phrases, banned_phrases, position`;
  return toProcedure(rows[0]);
}

export async function updateProcedure(
  sql: postgres.Sql, id: string,
  patch: { name?: string; description?: string; effectPhrases?: string; bannedPhrases?: string[] },
): Promise<void> {
  await sql`update client_procedure set
      name = coalesce(${patch.name ?? null}, name),
      description = coalesce(${patch.description ?? null}, description),
      effect_phrases = coalesce(${patch.effectPhrases ?? null}, effect_phrases),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases)
    where id = ${id}`;
}

export async function deleteProcedure(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from client_procedure where id = ${id}`;
}
