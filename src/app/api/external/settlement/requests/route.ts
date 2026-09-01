import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { decodeCursor, encodeCursor, clampLimit, toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { listForExport } from '@/lib/settlementStore';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';

// 그쪽(정산 프로덕트)이 폴링으로 가져간다 — 사람이 아니라 서버가 부르므로 세션 게이트가 아니라 공유 시크릿.
// 설계: docs/superpowers/specs/2026-08-28-payment-api-design.md §5. 그쪽 문서: docs/api/settlement-external-api.md
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';

function common(req: Request) {
  const url = new URL(req.url);
  return {
    method: 'GET' as const,
    path: url.pathname,
    query: url.search || null,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  };
}

export async function GET(req: Request) {
  const c = common(req);
  if (!bearerAuthorized(req, ENV)) {
    recordExternalCallSafe({ ...c, statusCode: 401, outcome: 'unauthorized' });
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  const url = new URL(req.url);
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) {
    recordExternalCallSafe({ ...c, statusCode: 400, outcome: 'bad-request', detail: 'cursor' });
    return NextResponse.json({ error: 'cursor 값을 해석할 수 없어요 — 응답의 next_cursor를 그대로 보내 주세요', field: 'cursor' }, { status: 400, headers: NO_STORE });
  }
  const limit = clampLimit(url.searchParams.get('limit'));
  const rows = await listForExport(getSql(), cursor, limit);
  const last = rows.at(-1);
  recordExternalCallSafe({ ...c, statusCode: 200, outcome: 'ok', detail: `${rows.length}건` });
  return NextResponse.json({
    version: EXTERNAL_API_VERSION,
    items: rows.map(toExternalItem),
    next_cursor: last ? encodeCursor({ updatedAtUs: last.updatedAtUs, id: last.row.id }) : rawCursor,
    has_more: rows.length === limit,
  }, { headers: NO_STORE });
}
