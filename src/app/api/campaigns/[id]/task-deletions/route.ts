import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listTaskDeletions } from '@/lib/taskDeletionStore';

// 이 캠페인에서 지운 작업 기록(073) — 읽기만. 지우거나 고치는 API는 없다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json({ items: await listTaskDeletions(getSql(), id) });
}
