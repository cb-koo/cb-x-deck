import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { getForExport } from '@/lib/settlementStore';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!bearerAuthorized(req, ENV)) return new NextResponse(null, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const row = await getForExport(getSql(), id);
  if (!row) return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ version: EXTERNAL_API_VERSION, item: toExternalItem(row) }, { headers: NO_STORE });
}
