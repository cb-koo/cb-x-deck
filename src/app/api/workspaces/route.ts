import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listWorkspaces, createWorkspace, listWorkspacesWithMeta } from '@/lib/workspaceStore';

import { requireAllowedUser } from '@/lib/authGuard';
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const meta = new URL(req.url).searchParams.get('meta');
  const sql = getSql();
  return NextResponse.json(meta === '1' ? await listWorkspacesWithMeta(sql) : await listWorkspaces(sql));
}

export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  return NextResponse.json(await createWorkspace(getSql(), name), { status: 201 });
}
