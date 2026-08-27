import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { listUnattachedDrafts } from '@/lib/draftStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';

// '있는 원고 고르기' 후보(스펙 2026-08-28 §4-2) — 그 캠페인 클라이언트의, 작업에 안 붙은 원고만.
// 붙이는 건 작업 쪽 경로(PATCH /api/drafts/[id] {taskId} · 작업 생성 시 draftId) — 여기서 쓰기 경로를 하나 더 만들지 않는다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  const campaign = await getCampaign(sql, id);
  if (!campaign) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  return NextResponse.json(await listUnattachedDrafts(sql, campaign.clientId));
}
