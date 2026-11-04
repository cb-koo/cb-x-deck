import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { createCampaignsBulk, BulkCampaignError } from '@/lib/campaignStore';
import { parseBulkCreate } from '@/lib/campaignBulk';

// 여러 클라이언트 캠페인 한 번에 만들기(ISSUE-006) — 전부 만들거나 하나도 안 만든다. 만든 사람은 서버가 정한다(위조 차단, POST /api/campaigns 관례).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const parsed = parseBulkCreate(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  try {
    const rows = await createCampaignsBulk(getSql(), { ...parsed.value, createdBy: gate.member.id });
    return NextResponse.json(rows);
  } catch (e) {
    if (e instanceof BulkCampaignError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
