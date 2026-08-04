import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listReferences } from '@/lib/referenceStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 레퍼런스 선택용 보관함 읽기 — scope=all(전 워크스페이스 병합) | scope=<workspaceId>
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'all';
  const tag = url.searchParams.get('tag') ?? undefined;
  const rows = await listReferences(getSql(), {
    scope: scope === 'all' ? 'all' : { workspaceId: scope },
    tag,
  });
  return NextResponse.json(rows);
}
