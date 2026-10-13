import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { runAutoSend } from '@/lib/settlementAutoStore';

// 정산 요청 자동 전송(스펙 2026-10-12 §6) — DB 예약 실행(pg_cron + pg_net, scripts/settlement-auto-send-cron.sql)이 5분마다 부른다.
// 보낼지 말지는 runAutoSend가 정한다(이번 주 월요일 07:00 전에 확인된 것만) — 5분마다 불러도 평일엔 고친 건 말고는 할 일이 없다.
// 성과 자동 측정과 같은 시크릿을 쓴다(예약 실행 비밀을 하나로 관리, Vault 'measure_cron_secret').
export const maxDuration = 60;

async function handle(req: Request): Promise<NextResponse> {
  // 시크릿 미설정이면 전부 거부 — "Bearer undefined" 비교로 뚫리는 fail-open 방지(auto-measure와 같은 계약)
  const secret = process.env.MEASURE_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'MEASURE_CRON_SECRET not configured' }, { status: 401 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const r = await runAutoSend(getSql(), new Date(), { deadlineMs: 45_000 });
  return NextResponse.json(r);
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
