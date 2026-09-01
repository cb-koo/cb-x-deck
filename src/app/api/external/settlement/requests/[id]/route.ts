import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { getForExport } from '@/lib/settlementStore';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';

function common(req: Request) {
  const url = new URL(req.url);
  return {
    method: 'GET' as const,
    path: url.pathname,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = common(req);
  if (!bearerAuthorized(req, ENV)) {
    recordExternalCallSafe({ ...c, statusCode: 401, outcome: 'unauthorized' });
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  const row = await getForExport(getSql(), id);
  if (!row) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found' });
    return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  }
  recordExternalCallSafe({ ...c, requestId: id, statusCode: 200, outcome: 'ok' });
  return NextResponse.json({ version: EXTERNAL_API_VERSION, item: toExternalItem(row) }, { headers: NO_STORE });
}
