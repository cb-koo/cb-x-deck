import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign, getCampaignDetail, updateCampaign, deleteCampaign } from '@/lib/campaignStore';
import { parseCampaignPatch, checkPeriod, CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';

// campaign.id는 uuid — 형식 아닌 값은 "없음"이 아니라 캐스팅 오류(22P02 → 500)라 조회 전에 404로 끊는다(influencers/[id] 관례)
const notFound = () => NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });

// 상세 = 캠페인 + 작업(게시 확인·성과) + 비용 행 + 요약 + 인플 목록 + 유형별 소계 + 삭제 정보 + today(스펙 §6) — 판정 기준 '오늘'을 함께 내려
// 클라가 같은 기준으로 다시 그린다(캠페인 화면의 낙관적 갱신이 서버와 다른 날짜로 밀림을 판정하면 안 된다).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const detail = await getCampaignDetail(getSql(), id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const parsed = parseCampaignPatch(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  const cur = await getCampaign(sql, id);
  if (!cur) return notFound();
  // 한쪽 날짜만 바뀌면 기존 값과 합쳐 순서를 본다 — DB check가 최후 방어지만 사용자에겐 500이 아니라 문구가 가야 한다.
  // 기간을 줄여 예정일이 기간 밖이 되는 원고는 막지 않는다 — 카드·행에 '기간 밖' 경고만(스펙 §3-3).
  const period = checkPeriod(parsed.value.startsOn ?? cur.startsOn, parsed.value.endsOn ?? cur.endsOn);
  if (period) return NextResponse.json({ error: period }, { status: 400 });
  await updateCampaign(sql, id, parsed.value);
  // update 이후 재조회 — 그 사이 지워졌으면(경합) null을 그대로 200에 실어 보내지 않고 GET과 같은 404로.
  const updated = await getCampaign(sql, id);
  if (!updated) return notFound();
  return NextResponse.json(updated);
}

// 작업은 함께 지워지고 원고는 남는다 — 지워질 작업 수·'대상 미정'이 될 참조 수를 응답에 함께 실어 보낸다(스펙 §4-4).
// 확인 다이얼로그는 클라 몫. 이미 없어도 ok:true·deleted:false — 삭제는 멱등(influencers DELETE 관례).
// 정산 보호(정산 스펙 §4-4) — 활성 요청이 붙은 작업이 하나라도 있으면 409로 막는다.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const result = await deleteCampaign(getSql(), id);
  if (!result.deleted && result.activeRequests > 0) {
    return NextResponse.json({ error: `정산 요청된 작업이 ${result.activeRequests}건 있어요 — 먼저 정산에서 취소해 주세요` }, { status: 409 });
  }
  return NextResponse.json({ ok: true, ...result });
}
