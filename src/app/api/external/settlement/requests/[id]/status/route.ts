import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { parseStatusUpdate, toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { applyExternalStatus, getForExport } from '@/lib/settlementStore';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';

// 그쪽 처리 상태·실지급액 수신(스펙 §6). 규칙 판정은 스토어(applyExternalStatus), 여기는 HTTP 매핑만.
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';
const CONFLICT_MESSAGE = {
  'request-cancelled': '이 요청은 취소됐어요 — 다시 가져가 확인해 주세요',
  'paid-locked': '이미 지급 완료된 요청이에요',
} as const;

function common(req: Request) {
  const url = new URL(req.url);
  return {
    method: 'POST' as const,
    path: url.pathname,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = common(req);
  if (!bearerAuthorized(req, ENV)) {
    recordExternalCallSafe({ ...c, statusCode: 401, outcome: 'unauthorized' });
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  const raw = await req.text().catch(() => '');
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const parsed = parseStatusUpdate(body);
  if (!parsed.ok) {
    const bodyStatus = body != null && typeof body === 'object' && typeof (body as { status?: unknown }).status === 'string'
      ? (body as { status: string }).status
      : null;
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 400, outcome: 'bad-request', detail: parsed.field, sentStatus: bodyStatus, body: raw });
    return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400, headers: NO_STORE });
  }
  const sql = getSql();
  const r = await applyExternalStatus(sql, id, parsed.update);
  if (r === 'not-found') {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found', sentStatus: parsed.update.status, body: raw });
    return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  }
  const exp = await getForExport(sql, id);
  const item = exp ? toExternalItem(exp) : null;
  if (r.kind === 'conflict') {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 409, outcome: 'conflict', detail: r.code, sentStatus: parsed.update.status, body: raw });
    return NextResponse.json({ error: CONFLICT_MESSAGE[r.code], code: r.code, request: item }, { status: 409, headers: NO_STORE });
  }
  recordExternalCallSafe({ ...c, requestId: id, statusCode: 200, outcome: r.kind === 'applied' ? 'applied' : 'stale', sentStatus: parsed.update.status, body: raw });
  return NextResponse.json({ version: EXTERNAL_API_VERSION, applied: r.kind === 'applied', reason: r.kind === 'stale' ? 'stale' : undefined, request: item }, { headers: NO_STORE });
}
