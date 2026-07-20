import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listWorkspaces, createWorkspace } from '@/lib/workspaceStore';

import { requireAllowedUser } from '@/lib/authGuard';
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listWorkspaces(getSql()));
}

export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  return NextResponse.json(await createWorkspace(getSql(), name), { status: 201 });
}
