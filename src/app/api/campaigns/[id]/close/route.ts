import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign, setCampaignClosed } from '@/lib/campaignStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { productWebBoundary } from '@/lib/productWebBoundary';

// 캠페인 마감 / 다시 열기(085, koo 11-02) — 누구나. body { closed: boolean }. 응답은 갱신된 CampaignRow(PATCH와 같은 모양).
const notFound = () => NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });

async function POSTInternal(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const body = await req.json().catch(() => null) as { closed?: unknown } | null;
  if (typeof body?.closed !== 'boolean') return NextResponse.json({ error: '마감 여부(closed)가 필요해요' }, { status: 400 });
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return notFound();
  await setCampaignClosed(sql, id, body.closed, gate.member.name);
  const updated = await getCampaign(sql, id);
  if (!updated) return notFound();
  return NextResponse.json(updated);
}

// 칸이 아직 없을 때(42703) 500 대신 '설정 적용 전' 문구 — productWebBoundary
export const POST = productWebBoundary(POSTInternal);
