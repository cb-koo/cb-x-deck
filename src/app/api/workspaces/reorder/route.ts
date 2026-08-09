import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { reorderWorkspaces, WorkspaceSetMismatch } from '@/lib/workspaceStore';
import { requireAllowedUser } from '@/lib/authGuard';

export async function PATCH(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const body = await req.json().catch(() => null);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string')) {
    return NextResponse.json({ error: 'ids 필수' }, { status: 400 });
  }
  try {
    return NextResponse.json(await reorderWorkspaces(getSql(), ids));
  } catch (e) {
    if (e instanceof WorkspaceSetMismatch) {
      return NextResponse.json({ error: '워크스페이스 목록이 변경되었습니다' }, { status: 409 });
    }
    throw e;
  }
}
