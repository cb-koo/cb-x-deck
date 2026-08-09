import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { createColumn, listColumns } from '@/lib/columnStore';
import { makeClient } from '@/lib/getxapi';
import { resolveWatchlistAccount } from '@/lib/watchlistAccount';

import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  if (!isUuidLike(workspaceId)) return NextResponse.json({ error: 'workspaceId 형식이 올바르지 않습니다' }, { status: 400 });
  return NextResponse.json(await listColumns(getSql(), workspaceId));
}

export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const body = await req.json();
  if (!body?.kind || !body?.title || !body?.config) {
    return NextResponse.json({ error: 'kind, title, config 필수' }, { status: 400 });
  }
  if (body.kind !== 'search' && body.kind !== 'watchlist') {
    return NextResponse.json({ error: 'kind은 search 또는 watchlist이어야 함' }, { status: 400 });
  }
  const { workspaceId } = body;
  if (typeof workspaceId !== 'string' || !workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  const config = { ...body.config };
  if (body.kind === 'watchlist') {
    // 신규 생성이라 기존 계정이 없다 → 항상 조회한다(형식이 틀리면 조회 전에 끊긴다).
    const acc = await resolveWatchlistAccount(String(config.handle ?? ''), (h) => makeClient().getUserInfo(h));
    if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });
    config.handle = acc.handle;
    config.userId = acc.userId;
  }
  const col = await createColumn(getSql(), { workspaceId, kind: body.kind, title: body.title, config });
  return NextResponse.json(col, { status: 201 });
}
