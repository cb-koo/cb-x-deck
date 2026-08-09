import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listWorkspaces, createWorkspace, listWorkspacesWithMeta } from '@/lib/workspaceStore';

import { requireAllowedUser, requireMember } from '@/lib/authGuard';
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const meta = new URL(req.url).searchParams.get('meta');
  const sql = getSql();
  return NextResponse.json(meta === '1' ? await listWorkspacesWithMeta(sql) : await listWorkspaces(sql));
}

export async function POST(req: Request) {
  // 생성자를 기록하기 위해 멤버까지 해석한다 (저장 API들과 동일 패턴)
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  return NextResponse.json(await createWorkspace(getSql(), name, gate.member.id), { status: 201 });
}
