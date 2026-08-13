import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { makeClient, type UserInfo } from '@/lib/getxapi';
import { findInfluencerById, findDuplicateByXUserId, applyProfileSnapshot } from '@/lib/influencerStore';

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

  let info: UserInfo;
  try {
    info = await makeClient().getUserInfo(inf.handle);
  } catch (e) {
    console.error('[influencer] 프로필 갱신 실패', {
      handle: inf.handle, err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
  }

  // v1은 x_user_id로 새 핸들을 되찾지 않는다(스펙 §5-3 후자). 등록 화면에서 새 핸들을 추가하면
  // 개명 플로우가 같은 x_user_id를 보고 알아서 잡는다.
  if (!info.id) return NextResponse.json({ status: 'not_found' });
  // 핸들은 그대로인데 계정이 바뀌었다 = 남이 그 핸들을 가져간 것. 스냅샷으로 덮어쓰지 않는다.
  if (inf.xUserId && info.id !== inf.xUserId) return NextResponse.json({ status: 'handle_taken' });

  // §7: 같은 사람이 두 행으로 들어와 있으면 경고만 띄운다(자동 병합하지 않는다).
  const duplicateOf = await findDuplicateByXUserId(sql, info.id, inf.id);
  await applyProfileSnapshot(sql, inf.id, info);
  return NextResponse.json({
    status: 'ok', duplicateOf, influencer: await findInfluencerById(sql, id),
  });
}
