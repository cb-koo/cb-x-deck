import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { toExternalItem } from '@/lib/settlementExternal';
import { parsePaymentInfoCorrection } from '@/lib/settlementPaymentCorrection';
import { applyPaymentMethodCorrection, getForExport } from '@/lib/settlementStore';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';

// 그쪽(정산 프로덕트)이 이번 지급 건의 수취 정보를 정정했을 때의 회신 수신(계약 §6-1, 그쪽 2026-09-21 요청).
// 규칙 판정은 스토어(applyPaymentMethodCorrection), 여기는 HTTP 매핑만 — 상태 POST 라우트와 같은 구조.
// 200 응답에는 다른 200과 달리 version을 넣지 않는다 — 그쪽 파서가 { applied, correction_id, request } 세 키만 엄격히 받는다(계약 §8).
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';
const CONFLICT_MESSAGE = {
  'request-cancelled': '이 요청은 취소됐어요 — 다시 가져가 확인해 주세요',
  'paid-locked': '이미 지급 완료된 요청이에요 — 지급 뒤 정정은 사람이 협의해요',
  'revision-mismatch': '이 요청은 그 사이 고쳐졌어요 — 최신 내용으로 다시 확인해 주세요',
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
  const parsed = parsePaymentInfoCorrection(body);
  if (!parsed.ok) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 400, outcome: 'bad-request', detail: parsed.field, body: raw });
    return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400, headers: NO_STORE });
  }
  const sql = getSql();
  const r = await applyPaymentMethodCorrection(sql, id, parsed.correction);
  if (r === 'not-found') {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found', body: raw });
    return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  }
  if (r.kind === 'invalid') {
    // 수단 종류에 맞지 않는 항목 등 — 행을 읽어야 알 수 있는 검증이라 요청을 찾은 뒤에 400이 난다(계약 §6-1 규칙 2-1).
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 400, outcome: 'bad-request', detail: r.field, body: raw });
    return NextResponse.json({ error: r.error, field: r.field }, { status: 400, headers: NO_STORE });
  }
  const exp = await getForExport(sql, id);
  const item = exp ? toExternalItem(exp, new URL(req.url).origin) : null;
  if (r.kind === 'conflict') {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 409, outcome: 'conflict', detail: r.code, body: raw });
    return NextResponse.json({ error: CONFLICT_MESSAGE[r.code], code: r.code, request: item }, { status: 409, headers: NO_STORE });
  }
  recordExternalCallSafe({ ...c, requestId: id, statusCode: 200, outcome: 'applied', detail: r.kind === 'replayed' ? 'replayed' : null, body: raw });
  return NextResponse.json({ applied: true, correction_id: r.correctionId, request: item }, { headers: NO_STORE });
}
