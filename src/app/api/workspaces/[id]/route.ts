import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { renameWorkspace } from '@/lib/workspaceStore';

import { requireAllowedUser } from '@/lib/authGuard';
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await params;
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  const renamed = await renameWorkspace(getSql(), id, name);
  if (!renamed) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다' }, { status: 404 });
  return NextResponse.json(renamed);
}
