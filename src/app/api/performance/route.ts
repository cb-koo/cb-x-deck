import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { loadPerformance } from '@/lib/performanceStore';
import type { Range } from '@/lib/landingEventStore';

const RANGES: readonly Range[] = ['all', '7d', '30d', 'custom'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// 읽기 전용 — 외부 호출 없이 DB만 읽는다. 게이트는 목록 GET 관례(requireAllowedUser).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const q = new URL(req.url).searchParams;
  const campaign = q.get('campaign');
  const rangeParam = q.get('range');
  const range: Range = RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : 'all';
  // 직접 지정 기간 — 형식이 아니면 버린다(스토어가 all로 되돌리고 응답의 range로 알려준다)
  const ymd = (k: string) => { const v = q.get(k); return v && YMD.test(v) ? v : null; };
  return NextResponse.json(await loadPerformance(getSql(), campaign, range, ymd('from'), ymd('to')));
}
