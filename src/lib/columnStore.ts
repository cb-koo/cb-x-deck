import type postgres from 'postgres';
import type { ColumnKind, ColumnRow, SearchConfig, WatchlistConfig } from './types.ts';

type Row = { id: string; workspace_id: string; kind: ColumnKind; title: string; position: number; config: ColumnRow['config']; last_refreshed_at: Date | null };

function toColumn(r: Row): ColumnRow {
  return { id: r.id, workspaceId: r.workspace_id, kind: r.kind, title: r.title, position: r.position, config: r.config, lastRefreshedAt: r.last_refreshed_at ? r.last_refreshed_at.toISOString() : null };
}

const COLS = 'id, workspace_id, kind, title, position, config, last_refreshed_at';

export async function listColumns(sql: postgres.Sql, workspaceId: string): Promise<ColumnRow[]> {
  const rows = await sql.unsafe<Row[]>(`select ${COLS} from deck_column where workspace_id = $1 order by position, created_at`, [workspaceId]);
  return rows.map(toColumn);
}

export async function getColumn(sql: postgres.Sql, id: string): Promise<ColumnRow | null> {
  const rows = await sql.unsafe<Row[]>(`select ${COLS} from deck_column where id = $1`, [id]);
  return rows[0] ? toColumn(rows[0]) : null;
}

export async function createColumn(
  sql: postgres.Sql,
  input: { workspaceId: string; kind: ColumnKind; title: string; config: SearchConfig | WatchlistConfig },
): Promise<ColumnRow> {
  // position은 서버가 정한다. 클라이언트가 보내면 두 명이 동시에 만들 때 번호가 겹친다.
  // 새 컬럼은 항상 맨 뒤 — "새 건 오른쪽 끝"이라는 화면 규칙과 같은 규칙이다.
  const [row] = await sql<Row[]>`
    insert into deck_column (workspace_id, kind, title, position, config)
    values (
      ${input.workspaceId}, ${input.kind}, ${input.title},
      (select coalesce(max(position) + 1, 0) from deck_column where workspace_id = ${input.workspaceId}),
      ${sql.json(input.config as never)}
    )
    returning id, workspace_id, kind, title, position, config, last_refreshed_at`;
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
    returning id, workspace_id, kind, title, position, config, last_refreshed_at`;
  if (!row) throw new Error(`column not found: ${id}`);
  return toColumn(row);
}

export async function deleteColumn(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from deck_column where id = ${id}`;
}

export async function touchRefreshed(sql: postgres.Sql, id: string): Promise<void> {
  // 직전 새로고침 시각을 prev로 밀어두면 NEW 판정(first_appeared_at > prev)이 서버 데이터만으로 성립
  await sql`update deck_column set prev_refreshed_at = last_refreshed_at, last_refreshed_at = now() where id = ${id}`;
}

/** 재정렬 요청의 id 집합이 서버의 현재 컬럼 집합과 다를 때. 호출자는 재조회해야 한다. */
export class ColumnSetMismatch extends Error {
  constructor() {
    super('컬럼 목록이 변경되었습니다');
    this.name = 'ColumnSetMismatch';
  }
}

/**
 * 전체 순서를 한 번에 확정한다. ids는 그 워크스페이스의 현재 컬럼 **전부**여야 하며
 * 중복이 없어야 한다. 하나만 보내고 서버가 나머지를 미루는 방식은 결국 서버가
 * 재계산해야 해서 이득이 없고 어긋날 여지만 는다.
 * 동시 재정렬은 `for update`로 직렬화된다(마지막 저장이 이긴다).
 */
export async function reorderColumns(
  sql: postgres.Sql,
  workspaceId: string,
  ids: string[],
): Promise<ColumnRow[]> {
  return (await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      select id from deck_column where workspace_id = ${workspaceId} for update`;
    const current = new Set(rows.map((r) => r.id));
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.length !== current.size || ids.some((id) => !current.has(id))) {
      throw new ColumnSetMismatch();
    }
    for (const [i, id] of ids.entries()) {
      await tx`update deck_column set position = ${i} where id = ${id}`;
    }
    const out = await tx.unsafe<Row[]>(
      `select ${COLS} from deck_column where workspace_id = $1 order by position, created_at`,
      [workspaceId],
    );
    return out.map(toColumn);
  })) as ColumnRow[];
}
