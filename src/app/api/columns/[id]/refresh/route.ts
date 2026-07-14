import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { refreshColumn } from '@/lib/refreshColumn';
import { getColumnQuotedIds } from '@/lib/quotedStore';
import { enrichQuoted } from '@/lib/quotedEnrich';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();

  const existing = await getColumn(sql, id);
  if (!existing) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });

  try {
    const client = makeClient();
    const result = await refreshColumn(sql, client, id);
    // 인용 트윗 보강(베스트 에포트) — 실패해도 refresh 자체는 성공으로 응답
    try {
      await enrichQuoted(sql, client, await getColumnQuotedIds(sql, id));
    } catch { /* 다음 새로고침에 자연 재시도 */ }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GetxapiAuthError) {
      return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
