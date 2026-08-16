import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listSnapshots } from '@/lib/trackingStore';

// 한 게시물의 측정 이력 — 표에서 행을 펼칠 때만 부른다(목록 응답에 전부 실어 보내면
// 12행 x 수십 건이 매번 따라온다). 읽기 전용이므로 게이트는 requireAllowedUser(목록 GET과 동일).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  // uuid 형식이 아닌 값은 uuid 칸에서 캐스팅 오류(22P02 → 500)가 되므로 먼저 막는다([id] 라우트 관례)
  if (!isUuidLike(id)) return NextResponse.json({ error: '추적 대상을 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(await listSnapshots(getSql(), id));
}
