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

const MEMBER_COLORS = ['#1d9bf0', '#00ba7c', '#f91880', '#7856ff', '#ff7a00', '#ffd400'];

type ResolveUser = { email?: string | null; user_metadata?: Record<string, unknown> | null };

export async function resolveMember(sql: postgres.Sql, user: ResolveUser): Promise<Member> {
  const email = (user.email ?? '').trim().toLowerCase();
  if (!email) throw new Error('이메일 없는 사용자');
  const found = await sql<Member[]>`select id, name, color from member where email = ${email}`;
  if (found[0]) return found[0];
  const meta = user.user_metadata ?? {};
  const rawName =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    email.split('@')[0];
  const name = String(rawName).trim() || email.split('@')[0];
  const color = MEMBER_COLORS[Math.abs(hashStr(email)) % MEMBER_COLORS.length];
  const inserted = await sql<Member[]>`
    insert into member (name, color, email) values (${name}, ${color}, ${email})
    on conflict (email) where email is not null do update set email = excluded.email
    returning id, name, color`;
  return inserted[0];
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
