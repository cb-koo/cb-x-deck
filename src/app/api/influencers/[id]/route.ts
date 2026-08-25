import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getInfluencerDetail, findInfluencerById, updateInfluencer, updatePricing, deleteInfluencer } from '@/lib/influencerStore';
import { parsePricingPatch } from '@/lib/influencerPricing';

// influencer.id는 uuid 컬럼이라 형식이 아닌 값은 "없음"이 아니라 캐스팅 오류(22P02 → 500)가 된다.
// 조회 전에 끊어서 404로 답한다.
const notFound = () => NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const detail = await getInfluencerDetail(getSql(), id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const body = (await req.json().catch(() => ({}))) as { note?: unknown; tags?: unknown; pricing?: unknown };

  // undefined = 건드리지 않음. 값이 왔다면 형식을 여기서 확정한다(스토어는 검증하지 않는다).
  if (body.note !== undefined && typeof body.note !== 'string') {
    return NextResponse.json({ error: '메모 형식이 올바르지 않아요' }, { status: 400 });
  }
  if (body.tags !== undefined &&
      (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string'))) {
    return NextResponse.json({ error: '태그 형식이 올바르지 않아요' }, { status: 400 });
  }
  // pricing: 바뀐 키만 온다 — 서버가 병합(스펙 §2 부분 병합). 검증 실패는 400.
  let pricingPatch = null;
  if (body.pricing !== undefined) {
    pricingPatch = parsePricingPatch(body.pricing);
    if (pricingPatch === null) {
      return NextResponse.json({ error: '단가 형식이 올바르지 않아요' }, { status: 400 });
    }
  }

  const sql = getSql();
  if (!(await findInfluencerById(sql, id))) return notFound();
  await updateInfluencer(sql, id, {
    note: body.note as string | undefined,
    tags: body.tags as string[] | undefined,
  });
  let pricingResult: Awaited<ReturnType<typeof updatePricing>> | null = null;
  if (pricingPatch !== null) {
    pricingResult = await updatePricing(sql, id, pricingPatch, gate.member.id);
  }
  const row = await findInfluencerById(sql, id);
  return NextResponse.json(pricingResult
    ? { ...row, pricing: pricingResult.pricing, pricingLogs: pricingResult.logs }
    : row);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  await deleteInfluencer(getSql(), id); // 없는 행을 지워도 성공 — 삭제는 멱등
  return NextResponse.json({ ok: true });
}
