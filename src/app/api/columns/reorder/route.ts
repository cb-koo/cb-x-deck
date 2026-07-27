import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { reorderColumns, ColumnSetMismatch } from '@/lib/columnStore';
import { requireAllowedUser } from '@/lib/authGuard';

export async function PATCH(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const body = await req.json().catch(() => null);
  const workspaceId = body?.workspaceId;
  const ids = body?.ids;
  if (typeof workspaceId !== 'string' || !workspaceId) {
    return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== 'string')) {
    return NextResponse.json({ error: 'ids 필수' }, { status: 400 });
  }
  try {
    return NextResponse.json(await reorderColumns(getSql(), workspaceId, ids));
  } catch (e) {
    // 집합 불일치 = 그 사이 다른 멤버가 컬럼을 추가/삭제함. 클라이언트는 재조회한다.
    if (e instanceof ColumnSetMismatch) {
      return NextResponse.json({ error: '컬럼 목록이 변경되었습니다' }, { status: 409 });
    }
    throw e;
  }
}
