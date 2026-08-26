import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { listUnassignedDrafts } from '@/lib/draftStore';

// '기존 원고 고르기' 후보(스펙 §4-1) — 그 캠페인 클라이언트의 캠페인 미소속 원고만. 다른 캠페인 소속은 나오지 않는다(§7).
// 추가 자체는 PATCH /api/drafts {ids, campaignId}(Task 5) — 여기서 쓰기 경로를 하나 더 만들지 않는다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });
  const sql = getSql();
  const campaign = await getCampaign(sql, id);
  if (!campaign) return NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(await listUnassignedDrafts(sql, campaign.clientId));
}
