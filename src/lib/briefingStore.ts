import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { BriefingContent } from './briefingTypes.ts';

export interface BriefingListRow {
  id: string; columnId: string; columnTitle: string;
  periodFrom: string; periodTo: string; sampleSize: number;
  createdAt: string; member: Member | null;
}
export interface BriefingRow extends BriefingListRow { content: BriefingContent; model: string | null }

type Row = {
  id: string; column_id: string; column_title: string;
  period_from: string; period_to: string; sample_size: number;
  created_at: Date; content?: BriefingContent; model?: string | null;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

function toListRow(r: Row): BriefingListRow {
  return {
    id: r.id, columnId: r.column_id, columnTitle: r.column_title,
    periodFrom: r.period_from, periodTo: r.period_to, sampleSize: r.sample_size,
    createdAt: r.created_at.toISOString(),
    member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  };
}

export async function saveBriefing(sql: postgres.Sql, input: {
  workspaceId: string; columnId: string; periodFrom: string; periodTo: string;
  sampleSize: number; content: BriefingContent; model: string | null; memberId: string | null;
}): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into briefing (workspace_id, column_id, period_from, period_to, sample_size, content, model, created_by)
    values (${input.workspaceId}, ${input.columnId}, ${input.periodFrom}, ${input.periodTo},
            ${input.sampleSize}, ${sql.json(input.content as never)}, ${input.model}, ${input.memberId})
    returning id`;
  return rows[0].id;
}

export async function listBriefings(sql: postgres.Sql, workspaceId: string): Promise<BriefingListRow[]> {
  const rows = await sql<Row[]>`
    select b.id, b.column_id, c.title as column_title,
           to_char(b.period_from, 'YYYY-MM-DD') as period_from, to_char(b.period_to, 'YYYY-MM-DD') as period_to,
           b.sample_size, b.created_at,
           m.id as member_id, m.name as member_name, m.color as member_color
      from briefing b
      join deck_column c on c.id = b.column_id
      left join member m on m.id = b.created_by
     where b.workspace_id = ${workspaceId}
     order by b.created_at desc`;
  return rows.map(toListRow);
}

export async function getBriefing(sql: postgres.Sql, id: string): Promise<BriefingRow | null> {
  const rows = await sql<Row[]>`
    select b.id, b.column_id, c.title as column_title,
           to_char(b.period_from, 'YYYY-MM-DD') as period_from, to_char(b.period_to, 'YYYY-MM-DD') as period_to,
           b.sample_size, b.created_at, b.content, b.model,
           m.id as member_id, m.name as member_name, m.color as member_color
      from briefing b
      join deck_column c on c.id = b.column_id
      left join member m on m.id = b.created_by
     where b.id = ${id}`;
  if (rows.length === 0) return null;
  return { ...toListRow(rows[0]), content: rows[0].content as BriefingContent, model: rows[0].model ?? null };
}

export async function removeBriefing(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from briefing where id = ${id}`;
}
