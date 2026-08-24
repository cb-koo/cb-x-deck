import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { fetchReportMetrics, type ReportUnit } from '@/lib/reportApi';
import { bucketRanges, recommendUnit, toSeriesPoint } from '@/lib/reportSeries';
import { getSnapshots } from '@/lib/reportStore';
import { kstToday } from '@/lib/datetime';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNITS: ReportUnit[] = ['day', 'week', 'month'];

export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const clientId = p.get('clientId') ?? '';
  const start = p.get('start') ?? '', end = p.get('end') ?? '';
  if (!DATE.test(start) || !DATE.test(end) || start > end)
    return NextResponse.json({ error: '기간이 올바르지 않아요 (YYYY-MM-DD, 시작 ≤ 끝)' }, { status: 400 });
  const unit = (UNITS as string[]).includes(p.get('unit') ?? '') ? (p.get('unit') as ReportUnit) : recommendUnit(start, end);
  const buckets = bucketRanges(start, end, unit);
  if (buckets.length > 120)
    return NextResponse.json({ error: '구간이 너무 잘게 나뉘어요 — 기간을 줄이거나 단위를 키워 주세요 (최대 120칸)' }, { status: 400 });

  const sql = getSql();
  const rows = await sql<{ clinic_code: string | null }[]>`select clinic_code from client where id = ${clientId}`;
  const clinic = rows[0]?.clinic_code;
  if (!clinic) return NextResponse.json({ error: '이 클라이언트는 아직 리포트가 연결되지 않았어요' }, { status: 404 });

  const today = kstToday();
  const snaps = await getSnapshots(sql, clinic, unit, buckets[0].start, buckets[buckets.length - 1].end);
  const byStart = new Map(snaps.map((s) => [s.periodStart, s]));

  // 진행 중인 마지막 버킷만 라이브 보충(버킷 시작~오늘) — 저장하지 않는다(부분값이라 닫힌 버킷과 섞이면 안 됨).
  const live = new Map<string, { payload: (typeof snaps)[number]['payload']; fetchedAt: string | null }>();
  const last = buckets[buckets.length - 1];
  if (last.end >= today && last.start <= today) {
    const r = await fetchReportMetrics({ clinic, start: last.start, end: today, dateBasis: 'both', compare: 'none', groupBy: 'branch' });
    if (r.kind === 'ok') live.set(last.start, { payload: r.report.current, fetchedAt: new Date().toISOString() });
  }

  const points = buckets.map((b) => toSeriesPoint(b,
    live.get(b.start) ?? (byStart.has(b.start) ? { payload: byStart.get(b.start)!.payload, fetchedAt: byStart.get(b.start)!.fetchedAt } : null),
    today));
  return NextResponse.json({ unit, points });
}
