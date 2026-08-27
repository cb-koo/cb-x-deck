import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { runCheckPosted } from '@/lib/checkPostedRun';
import { kstToday } from '@/lib/datetime';

// 비용 유발(트윗당 $0.001) — 버튼 opt-in(UX 원칙 6). 사용량은 getxapi 클라이언트가 'getxapi.retweeters'로 기록한다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  try {
    return NextResponse.json(await runCheckPosted(sql, id, { source: makeClient(), today: kstToday() }));
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
