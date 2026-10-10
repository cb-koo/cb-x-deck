import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { loadClientStatus } from '@/lib/clientStatusStore';
import { parsePeriod } from '@/lib/reportPeriod';

const NOT_FOUND = () => NextResponse.json({ error: '리포트가 연결된 클라이언트가 아니에요' }, { status: 404 });

// 클라이언트 현황 — 상세(스펙 2026-10-09 §7). 읽기 전용.
export async function GET(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { clientId } = await ctx.params;
  if (!isUuidLike(clientId)) return NOT_FOUND();
  const today = kstToday();
  const s = await loadClientStatus(getSql(), clientId, today, parsePeriod(new URL(req.url).searchParams.get('period'), today));
  return s ? NextResponse.json(s) : NOT_FOUND();
}
