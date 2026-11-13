import { type NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { getCampaignOverview } from '@/lib/campaignOverviewStore';
import { renderStatusResponse } from '@/lib/statusImage/render';

// 캠페인 현황 슬랙 이미지 미리보기(스펙 2026-11-13 §6) — 로그인한 사람만. 보내지 않고 같은 PNG를 그려 보여준다(스테이징 QA·디자인 확인용).
// ?week=YYYY-MM-DD(그 주 아무 날), 없으면 이번 주. 기준 시각은 지금.
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const o = await getCampaignOverview(getSql(), request.nextUrl.searchParams.get('week'));
  return renderStatusResponse(o, new Date());
}
