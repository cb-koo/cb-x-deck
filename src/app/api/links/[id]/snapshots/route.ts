import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listClickSnapshots } from '@/lib/linkStore';

// 행을 펼칠 때만 부른다(목록 응답에 이력 전량을 싣지 않는다 — tracking snapshots 관례)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(await listClickSnapshots(getSql(), id));
}
