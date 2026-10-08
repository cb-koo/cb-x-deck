import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { fetchPost } from '@/lib/postMetrics';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { appendSnapshot, markUnavailable } from '@/lib/trackingStore';
import { listDueMeasurements } from '@/lib/autoMeasureStore';

// 콘텐츠 성과 자동 측정(2026-10-08) — 운영 DB의 예약 실행(pg_cron + pg_net)이 5분마다 부른다.
// Vercel 무료 크론은 하루 1회라 15분·30분 시점을 잴 수 없어 타이머를 DB에 둔다.
// 일정 판단은 lib/autoMeasure(게시 시각 기준, 두 배씩 → 하루 한 번 → 7일에서 멈춤).
// 한 번에 최대 BATCH건 — 남은 건 5분 뒤 다음 실행이 잇는다. 개별 실패는 건너뛴다(틀린 기록보다 빈 기록).
export const maxDuration = 60;

const BATCH = 30;
const DEADLINE_MS = 45_000;

async function handle(req: Request): Promise<NextResponse> {
  // 시크릿 미설정이면 전부 거부 — "Bearer undefined" 비교로 뚫리는 fail-open 방지(reports/sync와 같은 계약)
  const secret = process.env.MEASURE_CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'MEASURE_CRON_SECRET not configured' }, { status: 401 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sql = getSql();
  const due = await listDueMeasurements(sql, new Date(), BATCH);
  if (due.length === 0) return NextResponse.json({ due: 0, saved: 0, unavailable: 0, failed: 0 });

  let client;
  try {
    client = makeClient({ maxRetries: 1 });
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    throw e;
  }

  const startedAt = Date.now();
  let saved = 0, unavailable = 0, failed = 0;
  for (const d of due) {
    if (Date.now() - startedAt > DEADLINE_MS) break;
    const r = await fetchPost(d.tweetId, client);
    if (r.kind === 'ok') { await appendSnapshot(sql, d.trackedPostId, r.post.metrics, r.post.raw); saved++; }
    else if (r.kind === 'unavailable') { await markUnavailable(sql, d.trackedPostId); unavailable++; }
    else failed++;
  }
  return NextResponse.json({ due: due.length, saved, unavailable, failed });
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
