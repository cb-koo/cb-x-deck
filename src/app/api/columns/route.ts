import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { createColumn, listColumns } from '@/lib/columnStore';
import { makeClient } from '@/lib/getxapi';
import { handleParseMessage, parseXHandle } from '@/lib/xHandle';

import { requireAllowedUser } from '@/lib/authGuard';
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
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
    // 형식 검증을 먼저 — getUserInfo는 비용 유발 호출이다.
    const parsed = parseXHandle(String(config.handle ?? ''));
    if (!parsed.ok) return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });
    try {
      const info = await makeClient().getUserInfo(parsed.handle);
      if (!info.id) return NextResponse.json({ error: `계정을 찾을 수 없음: @${parsed.handle}` }, { status: 404 });
      config.handle = info.userName;
      config.userId = info.id;
    } catch (e) {
      return NextResponse.json({ error: `계정 확인 실패: ${(e as Error).message}` }, { status: 502 });
    }
  }
  const col = await createColumn(getSql(), { workspaceId, kind: body.kind, title: body.title, config });
  return NextResponse.json(col, { status: 201 });
}
