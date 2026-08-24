import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { fetchReportMetrics } from '@/lib/reportApi';
import { isCalendarMonth } from '@/lib/reportSeries';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const clientId = p.get('clientId') ?? '';
  const start = p.get('start') ?? '', end = p.get('end') ?? '';
  if (!DATE.test(start) || !DATE.test(end) || start > end)
    return NextResponse.json({ error: '기간이 올바르지 않아요 (YYYY-MM-DD, 시작 ≤ 끝)' }, { status: 400 });

  const sql = getSql();
  const rows = await sql<{ clinic_code: string | null }[]>`select clinic_code from client where id = ${clientId}`;
  if (!rows[0]?.clinic_code)
    return NextResponse.json({ error: '이 클라이언트는 아직 리포트가 연결되지 않았어요' }, { status: 404 });

  const r = await fetchReportMetrics({
    clinic: rows[0].clinic_code, start, end, dateBasis: 'both',
    compare: isCalendarMonth(start, end) ? 'calendar' : 'period', groupBy: 'branch',
  });
  if (r.kind === 'rate_limited')
    return NextResponse.json({ error: '잠시 조회가 많아요 — 1분 뒤 다시 시도해 주세요' }, { status: 503 });
  if (r.kind === 'error') return NextResponse.json({ error: r.message }, { status: 502 });
  return NextResponse.json({ report: r.report });
}
