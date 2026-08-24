import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { makeClient } from '@/lib/getxapi';
import { findInfluencerById, applyProfileSnapshot } from '@/lib/influencerStore';
import { resolveAccount, type AccountResolution } from '@/lib/influencerAccount';

// 갱신 3분기 (스펙 §5) + 중복 경고 (스펙 §7).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  // uuid 형식이 아니면 조회 전에 끊는다(22P02 → 500 방지).
  if (!isUuidLike(id)) return NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });

  const sql = getSql();
  const inf = await findInfluencerById(sql, id);
  if (!inf) return NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });

  // 판정은 analyze와 같은 규칙을 쓴다(influencerAccount.resolveAccount).
  // resolveAccount는 중복 조회(DB)까지 포함 — 그 실패도 여기서 502로 수렴한다(기존엔 500, 의도된 개선).
  let resolution: AccountResolution;
  try {
    resolution = await resolveAccount(sql, inf, makeClient());
  } catch (e) {
    console.error('[influencer] 프로필 갱신 실패', {
      handle: inf.handle, err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
  }
  if (resolution.status !== 'ok') return NextResponse.json({ status: resolution.status });

  await applyProfileSnapshot(sql, inf.id, resolution.info);
  return NextResponse.json({
    status: 'ok', duplicateOf: resolution.duplicateOf, influencer: await findInfluencerById(sql, id),
  });
}
