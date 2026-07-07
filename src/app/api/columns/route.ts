import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { createColumn, listColumns } from '@/lib/columnStore';
import { makeClient } from '@/lib/getxapi';

export async function GET() {
  return NextResponse.json(await listColumns(getSql()));
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body?.kind || !body?.title || !body?.config) {
    return NextResponse.json({ error: 'kind, title, config 필수' }, { status: 400 });
  }
  const config = { ...body.config };
  if (body.kind === 'watchlist') {
    try {
      const info = await makeClient().getUserInfo(String(config.handle ?? '').replace(/^@/, ''));
      if (!info.id) return NextResponse.json({ error: `계정을 찾을 수 없음: ${config.handle}` }, { status: 404 });
      config.handle = info.userName;
      config.userId = info.id;
    } catch (e) {
      return NextResponse.json({ error: `계정 확인 실패: ${(e as Error).message}` }, { status: 502 });
    }
  }
  const col = await createColumn(getSql(), { kind: body.kind, title: body.title, config, position: body.position });
  return NextResponse.json(col, { status: 201 });
}
