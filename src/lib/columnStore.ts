import type postgres from 'postgres';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from './types.ts';

type Row = { id: string; kind: ColumnKind; title: string; position: number; config: ColumnRow['config']; last_refreshed_at: Date | null };

function toColumn(r: Row): ColumnRow {
  return { id: r.id, kind: r.kind, title: r.title, position: r.position, config: r.config, lastRefreshedAt: r.last_refreshed_at ? r.last_refreshed_at.toISOString() : null };
}

export async function listColumns(sql: postgres.Sql): Promise<ColumnRow[]> {
  const rows = await sql<Row[]>`select id, kind, title, position, config, last_refreshed_at from deck_column order by position, created_at`;
  return rows.map(toColumn);
}

export async function getColumn(sql: postgres.Sql, id: string): Promise<ColumnRow | null> {
  const rows = await sql<Row[]>`select id, kind, title, position, config, last_refreshed_at from deck_column where id = ${id}`;
  return rows[0] ? toColumn(rows[0]) : null;
}

export async function createColumn(
  sql: postgres.Sql,
  input: { kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig; position?: number },
): Promise<ColumnRow> {
  const [row] = await sql<Row[]>`
    insert into deck_column (kind, title, position, config)
    values (${input.kind}, ${input.title}, ${input.position ?? 0}, ${sql.json(input.config as never)})
    returning id, kind, title, position, config, last_refreshed_at`;
  return toColumn(row);
}

export async function updateColumn(
  sql: postgres.Sql,
  id: string,
  patch: { title?: string; config?: SearchConfig | WatchlistConfig; position?: number },
): Promise<ColumnRow> {
  const [row] = await sql<Row[]>`
    update deck_column set
      title = coalesce(${patch.title ?? null}, title),
      config = coalesce(${patch.config ? sql.json(patch.config as never) : null}, config),
      position = coalesce(${patch.position ?? null}, position)
    where id = ${id}
    returning id, kind, title, position, config, last_refreshed_at`;
  if (!row) throw new Error(`column not found: ${id}`);
  return toColumn(row);
}

export async function deleteColumn(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from deck_column where id = ${id}`;
}

export async function touchRefreshed(sql: postgres.Sql, id: string): Promise<void> {
  await sql`update deck_column set last_refreshed_at = now() where id = ${id}`;
}
