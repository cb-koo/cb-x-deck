import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { refreshColumn } from '@/lib/refreshColumn';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();

  const existing = await getColumn(sql, id);
  if (!existing) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });

  try {
    return NextResponse.json(await refreshColumn(sql, makeClient(), id));
  } catch (e) {
    if (e instanceof GetxapiAuthError) {
      return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
