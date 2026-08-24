import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { fetchReportMetrics } from '@/lib/reportApi';
import { getStoredFetchedAt, planSyncTasks, upsertSnapshot } from '@/lib/reportStore';
import { addDays } from '@/lib/reportSeries';
import { kstToday } from '@/lib/datetime';

export const maxDuration = 300; // 크론 실행 여유 (Fluid 기준 플랜 한도 내)

const WINDOW_DAYS = 90;   // 소급 변경(취소·노쇼, 광고비 늦은 입력) 재동기화 창
const CALL_GAP_MS = 1100; // 분당 60회 제한 준수
const DEADLINE_MS = 240_000;

// Vercel Cron은 GET으로 호출하고, CRON_SECRET 환경변수가 있으면 Authorization: Bearer <값>을 실어 보낸다.
// 수동/재개 트리거를 위해 POST도 같은 본문을 그대로 노출한다.
async function handleSync(req: Request): Promise<NextResponse> {
  // CRON_SECRET 미설정이면 전부 거부 — "Bearer undefined" 문자열 비교로 뚫리는 fail-open 방지
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 401 });
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sql = getSql();
  const clinics = await sql<{ clinic_code: string }[]>`select clinic_code from client where clinic_code is not null`;
  const codes = clinics.map((c) => c.clinic_code);
  const today = kstToday();
  const stored = await getStoredFetchedAt(sql, codes, addDays(today, -WINDOW_DAYS));
  const tasks = planSyncTasks({ clinicCodes: codes, todayKst: today, windowDays: WINDOW_DAYS, stored });

  const startedAt = Date.now();
  let attempted = 0, saved = 0;
  const failed: Array<{ task: string; message: string }> = [];
  for (const t of tasks) {
    if (Date.now() - startedAt > DEADLINE_MS) break; // 나머지는 다음 실행이 이어서
    attempted++;
    const r = await fetchReportMetrics({ clinic: t.clinicCode, start: t.start, end: t.end,
      dateBasis: 'both', compare: 'none', groupBy: 'branch' });
    if (r.kind === 'ok') {
      await upsertSnapshot(sql, { clinicCode: t.clinicCode, granularity: t.granularity,
        periodStart: t.start, periodEnd: t.end, payload: r.report.current });
      saved++;
    } else if (r.kind === 'rate_limited') {
      // 1분 쉬고 즉시 데드라인 재확인 — 추가 gap 없이. 이 태스크는 저장 안 됐고 다음 실행이 이어서 한다.
      await new Promise((res) => setTimeout(res, 60_000));
      continue;
    } else {
      failed.push({ task: `${t.clinicCode} ${t.granularity} ${t.start}`, message: r.message });
    }
    await new Promise((res) => setTimeout(res, CALL_GAP_MS));
  }
  return NextResponse.json({ attempted, saved, failed, remaining: tasks.length - attempted });
}

export async function GET(req: Request) {
  return handleSync(req);
}

export async function POST(req: Request) {
  return handleSync(req);
}
