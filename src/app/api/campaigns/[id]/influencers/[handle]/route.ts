import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { parseExtraCosts, type ExtraCost } from '@/lib/campaignCost';
import { getCampaign, upsertInfluencerCost } from '@/lib/campaignStore';

const notFound = () => NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });

// 캠페인×핸들의 추가 비용·메모 upsert(스펙 §2-2 — 행은 처음 적을 때 생긴다). 인플 목록 자체는 원고에서 파생되므로
// 이 라우트는 '명단에 추가'가 아니다 — 원고 0인 핸들에 비용을 적으면 표에 "배정 원고 없음"으로 드러난다(§2-4).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; handle: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, handle } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  // 핸들은 서버 정규화(parseXHandle)를 한 번 더 — 원고 배정과 같은 표기 규칙이어야 lower 조인이 맞아떨어진다
  const parsedHandle = parseXHandle(handle);
  if (!parsedHandle.ok) return NextResponse.json({ error: handleParseMessage(parsedHandle.reason) }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { extraCosts?: unknown; note?: unknown };
  const patch: { extraCosts?: ExtraCost[]; note?: string } = {};
  if (body.extraCosts !== undefined) {
    const p = parseExtraCosts(body.extraCosts);
    if (!p.ok) return NextResponse.json({ error: p.message }, { status: 400 });
    patch.extraCosts = p.value;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== 'string') return NextResponse.json({ error: '메모 형식이 올바르지 않아요' }, { status: 400 });
    patch.note = body.note.trim();
  }
  if (patch.extraCosts === undefined && patch.note === undefined) {
    return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  }
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return notFound();
  return NextResponse.json(await upsertInfluencerCost(sql, id, parsedHandle.handle, patch));
}
