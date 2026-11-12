import { NextResponse, type NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { getCampaignOverview } from '@/lib/campaignOverviewStore';

// 캠페인 현황 — 워크스페이스 무관, 읽기 전용. ?week=YYYY-MM-DD(그 주 아무 날). 없거나 틀리면 이번 주(resolveWeek).
export async function GET(request: NextRequest) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await getCampaignOverview(getSql(), request.nextUrl.searchParams.get('week')));
}
