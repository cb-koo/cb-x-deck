import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { deleteWorkspace, listWorkspaces } from '@/lib/workspaceStore';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = getSql();
  const all = await listWorkspaces(sql);
  if (!all.some((w) => w.id === id)) return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다' }, { status: 404 });
  if (all.length <= 1) return NextResponse.json({ error: '마지막 워크스페이스는 삭제할 수 없습니다' }, { status: 409 });
  await deleteWorkspace(sql, id);
  return NextResponse.json({ ok: true });
}
