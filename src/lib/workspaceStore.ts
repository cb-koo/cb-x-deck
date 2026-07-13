import type postgres from 'postgres';
import type { Member, Workspace } from './types.ts';

export async function listWorkspaces(sql: postgres.Sql): Promise<Workspace[]> {
  const rows = await sql<Array<{ id: string; name: string; position: number }>>`
    select id, name, position from workspace order by position, created_at`;
  return rows;
}

export async function createWorkspace(sql: postgres.Sql, name: string): Promise<Workspace> {
  const [row] = await sql<Array<{ id: string; name: string; position: number }>>`
    insert into workspace (name) values (${name.trim()}) returning id, name, position`;
  return row;
}

export async function deleteWorkspace(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from workspace where id = ${id}`;
}

export async function listMembers(sql: postgres.Sql): Promise<Member[]> {
  const rows = await sql<Array<{ id: string; name: string; color: string }>>`
    select id, name, color from member order by created_at`;
  return rows;
}

export async function createMember(sql: postgres.Sql, name: string, color: string): Promise<Member> {
  const [row] = await sql<Array<{ id: string; name: string; color: string }>>`
    insert into member (name, color) values (${name.trim()}, ${color}) returning id, name, color`;
  return row;
}
