import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getSql } from '@/lib/db';
import { collectMarket, clinicSalesFromEnv, makeDongLocator } from '@/lib/marketClinicStore';

// 클리닉 지도 자동 수집(스펙 2026-10-17 §3-4) — DB 예약 실행(pg_cron + pg_net, scripts/market-map-cron.sql)이 매달 부른다.
// clinic-sales에서 진료과 × 달을 받아 저장하고 화면 완성본을 다시 만든다. 성과 자동 측정과 같은 시크릿(Vault 'measure_cron_secret').
// 행정경계는 화면이 쓰는 public/market-map/dong.geojson을 그대로 읽는다(next.config의 outputFileTracingIncludes로 함수에 담긴다).
export const maxDuration = 300;

async function handle(req: Request): Promise<NextResponse> {
  // 시크릿 미설정이면 전부 거부 — "Bearer undefined" 비교로 뚫리는 fail-open 방지(auto-measure와 같은 계약)
  const secret = process.env.MEASURE_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'MEASURE_CRON_SECRET not configured' }, { status: 401 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const geo = JSON.parse(await readFile(path.join(process.cwd(), 'public/market-map/dong.geojson'), 'utf8'));
  const r = await collectMarket(getSql(), clinicSalesFromEnv(), makeDongLocator(geo));
  return NextResponse.json(r);
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
