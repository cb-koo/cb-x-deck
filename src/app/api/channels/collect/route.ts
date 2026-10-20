import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { collectAll } from '@/lib/ownedChannelCollect';

// X 업로드 현황 자동 수집(스펙 2026-10-20 §4-1) — 운영 DB의 예약 실행(pg_cron + pg_net)이 매일 07:00(한국)에 부른다.
// 설정은 scripts/owned-channels-cron.sql. 남은 계정(시간 초과)은 다음 실행이 잇는다 — 오래 안 받은 계정부터 돈다.
export const maxDuration = 60;

const DEADLINE_MS = 45_000;

async function handle(req: Request): Promise<NextResponse> {
  // 시크릿 미설정이면 전부 거부 — "Bearer undefined" 비교로 뚫리는 fail-open 방지(auto-measure와 같은 계약 — 예약 실행 비밀키도 같은 것을 쓴다)
  const secret = process.env.MEASURE_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'MEASURE_CRON_SECRET not configured' }, { status: 401 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const r = await collectAll(getSql(), makeClient({ maxRetries: 1, usagePrefix: 'channels' }), { deadlineAt: Date.now() + DEADLINE_MS });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    throw e;
  }
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
