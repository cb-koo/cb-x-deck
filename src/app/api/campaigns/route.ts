import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { listCampaigns, createCampaign } from '@/lib/campaignStore';
import { parseCampaignCreate, CLIENT_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { getClientWithProcedures } from '@/lib/clientStore';

// 목록 — 그룹(진행 중/예정/종료)은 클라가 campaignStatus로 나눈다. 서버는 파생 수·통화별 합계만 붙인다(스펙 §6).
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listCampaigns(getSql()));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const parsed = parseCampaignCreate(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  // 클라 이름은 스냅샷(014 관례) — 지금 이름을 서버가 박제한다. 그 사이 지워졌으면 FK 위반을 500으로 흘리지 않고 400.
  const client = await getClientWithProcedures(sql, parsed.value.clientId);
  if (!client) {
    return NextResponse.json({ error: CLIENT_NOT_FOUND_MESSAGE }, { status: 400 });
  }
  const row = await createCampaign(sql, {
    ...parsed.value, clientName: client.client.name,
    createdBy: gate.member.id, // 클라이언트 body 무시 — 위조 차단(drafts POST 관례)
  });
  return NextResponse.json(row);
}
