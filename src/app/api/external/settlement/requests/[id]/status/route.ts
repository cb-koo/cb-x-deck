import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { parseStatusUpdate, toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { applyExternalStatus, getForExport } from '@/lib/settlementStore';

// 그쪽 처리 상태·실지급액 수신(스펙 §6). 규칙 판정은 스토어(applyExternalStatus), 여기는 HTTP 매핑만.
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';
const CONFLICT_MESSAGE = {
  'request-cancelled': '이 요청은 취소됐어요 — 다시 가져가 확인해 주세요',
  'paid-locked': '이미 지급 완료된 요청이에요',
} as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!bearerAuthorized(req, ENV)) return new NextResponse(null, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = parseStatusUpdate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400, headers: NO_STORE });
  const sql = getSql();
  const r = await applyExternalStatus(sql, id, parsed.update);
  if (r === 'not-found') return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  const exp = await getForExport(sql, id);
  const item = exp ? toExternalItem(exp) : null;
  if (r.kind === 'conflict') return NextResponse.json({ error: CONFLICT_MESSAGE[r.code], code: r.code, request: item }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ version: EXTERNAL_API_VERSION, applied: r.kind === 'applied', reason: r.kind === 'stale' ? 'stale' : undefined, request: item }, { headers: NO_STORE });
}
