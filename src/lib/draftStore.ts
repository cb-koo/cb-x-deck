import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';

export interface DraftRow {
  id: string; clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null; dismissedFlags: string[];
  model: string | null; createdAt: string; member: Member | null;
}

type Row = {
  id: string; client_id: string | null; client_name: string | null; procedure_names: string[];
  direction: string; format: DraftFormat; reference_mode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null; dismissed_flags: string[];
  model: string | null; created_at: Date;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

const toRow = (r: Row): DraftRow => ({
  id: r.id, clientId: r.client_id, clientName: r.client_name, procedureNames: r.procedure_names,
  direction: r.direction, format: r.format, referenceMode: r.reference_mode, refs: r.refs,
  content: r.content, edited: r.edited, dismissedFlags: r.dismissed_flags,
  model: r.model, createdAt: r.created_at.toISOString(),
  member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
});

const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.dismissed_flags, d.model, d.created_at,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by`;

export async function insertDraft(sql: postgres.Sql, input: {
  clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; model: string | null; memberId: string | null;
}): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into draft (client_id, client_name, procedure_names, direction, format,
                       reference_mode, refs, content, model, created_by)
    values (${input.clientId}, ${input.clientName}, ${sql.json(input.procedureNames)},
            ${input.direction}, ${input.format}, ${input.referenceMode},
            ${sql.json(input.refs as never)}, ${sql.json(input.content as never)},
            ${input.model}, ${input.memberId})
    returning id`;
  return rows[0].id;
}

export async function listDrafts(
  sql: postgres.Sql, opts: { clientId?: string; limit?: number } = {},
): Promise<DraftRow[]> {
  const where = opts.clientId ? sql`where d.client_id = ${opts.clientId}` : sql``;
  const rows = await sql<Row[]>`
    ${SELECT(sql)} ${where}
    order by d.created_at desc
    limit ${opts.limit ?? 50}`;
  return rows.map(toRow);
}

export async function getDraft(sql: postgres.Sql, id: string): Promise<DraftRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where d.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function updateDraft(
  sql: postgres.Sql, id: string,
  patch: { edited?: DraftContent; dismissedFlags?: string[] },
): Promise<void> {
  await sql`update draft set
      edited = coalesce(${patch.edited ? sql.json(patch.edited as never) : null}, edited),
      dismissed_flags = coalesce(${patch.dismissedFlags ? sql.json(patch.dismissedFlags) : null}, dismissed_flags)
    where id = ${id}`;
}

export async function removeDraft(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from draft where id = ${id}`;
}
