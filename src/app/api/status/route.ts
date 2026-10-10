import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { kstToday } from '@/lib/datetime';
import { listStatusRows } from '@/lib/clientStatusStore';
import { parsePeriod } from '@/lib/reportPeriod';

// 클라이언트 현황 — 전체 보기(스펙 2026-10-09 §7). 읽기 전용.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const today = kstToday();
  const period = parsePeriod(new URL(req.url).searchParams.get('period'), today);
  return NextResponse.json(await listStatusRows(getSql(), today, period));
}
