import type postgres from 'postgres';
import type { Member, Workspace, WorkspaceMeta } from './types.ts';

export async function listWorkspaces(sql: postgres.Sql): Promise<Workspace[]> {
  const rows = await sql<Array<{ id: string; name: string; position: number }>>`
    select id, name, position from workspace order by position, created_at`;
  return rows;
}

// 관리 페이지용: 워크스페이스별 컬럼 수·저장 후보 수·최근 활동을 한 번에 (N+1 금지).
export async function listWorkspacesWithMeta(sql: postgres.Sql): Promise<WorkspaceMeta[]> {
  const rows = await sql<Array<{
    id: string; name: string; position: number;
    column_count: number; candidate_count: number; last_activity_at: string;
    last_candidate_at: string | null; last_candidate_member: string | null;
    created_by_name: string | null;
  }>>`
    select w.id, w.name, w.position,
      (select count(*)::int from deck_column c where c.workspace_id = w.id) as column_count,
      (select count(*)::int from candidate ca where ca.workspace_id = w.id) as candidate_count,
      greatest(
        w.created_at,
        coalesce((select max(c.created_at) from deck_column c where c.workspace_id = w.id), w.created_at),
        coalesce((select max(ca.saved_at) from candidate ca where ca.workspace_id = w.id), w.created_at)
      ) as last_activity_at,
      (select ca.saved_at from candidate ca where ca.workspace_id = w.id
        order by ca.saved_at desc limit 1) as last_candidate_at,
      (select m.name from candidate ca join member m on m.id = ca.member_id
        where ca.workspace_id = w.id order by ca.saved_at desc limit 1) as last_candidate_member,
      (select m.name from member m where m.id = w.created_by) as created_by_name
    from workspace w
    order by w.position, w.created_at`;
  return rows.map((r) => {
    const lastActivityAt = new Date(r.last_activity_at).toISOString();
    // 저장(후보 담기)에만 멤버가 기록된다 — 최근 활동이 그 저장일 때만 멤버를 붙이고,
    // 컬럼 생성 등 멤버를 모르는 활동이 최신이면 null (원칙 4: 모르는 값은 표시하지 않는다).
    const lastCandidateAt = r.last_candidate_at ? new Date(r.last_candidate_at).toISOString() : null;
    return {
      id: r.id, name: r.name, position: r.position,
      columnCount: r.column_count, candidateCount: r.candidate_count,
      lastActivityAt,
      lastActivityMemberName: lastCandidateAt === lastActivityAt ? r.last_candidate_member : null,
      createdByName: r.created_by_name,
    };
  });
}

export async function createWorkspace(sql: postgres.Sql, name: string, createdBy?: string | null): Promise<Workspace> {
  const [row] = await sql<Array<{ id: string; name: string; position: number }>>`
    insert into workspace (name, position, created_by)
    values (${name.trim()}, (select coalesce(max(position) + 1, 0) from workspace), ${createdBy ?? null})
    returning id, name, position`;
  return row;
}

export async function deleteWorkspace(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from workspace where id = ${id}`;
}

export async function renameWorkspace(sql: postgres.Sql, id: string, name: string): Promise<Workspace | null> {
  const [row] = await sql<Array<{ id: string; name: string; position: number }>>`
    update workspace set name = ${name.trim()} where id = ${id} returning id, name, position`;
  return row ?? null;
}

export class WorkspaceSetMismatch extends Error {
  constructor() {
    super('워크스페이스 목록이 변경되었습니다');
    this.name = 'WorkspaceSetMismatch';
  }
}

// 전체 순서를 한 번에 재부여한다. 전달된 id 집합이 현재 집합과 다르면(그 사이 다른
// 팀원이 추가/삭제) 엉뚱한 덮어쓰기가 되므로 throw — 클라이언트는 재조회한다.
// columnStore.reorderColumns와 동일 패턴(전역이라 workspaceId 필터만 없음).
export async function reorderWorkspaces(sql: postgres.Sql, ids: string[]): Promise<Workspace[]> {
  return (await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`select id from workspace for update`;
    const current = new Set(rows.map((r) => r.id));
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.length !== current.size || ids.some((id) => !current.has(id))) {
      throw new WorkspaceSetMismatch();
    }
    for (const [i, id] of ids.entries()) {
      await tx`update workspace set position = ${i} where id = ${id}`;
    }
    return await tx<Array<{ id: string; name: string; position: number }>>`
      select id, name, position from workspace order by position, created_at`;
  })) as Workspace[];
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
