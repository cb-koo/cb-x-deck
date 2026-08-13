import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { deleteManualLog } from '@/lib/influencerStore';

// 지울 수 있는 건 사람이 쓴 기록뿐 — 자동 이벤트는 스토어의 kind 조건이 막고, 여기선 그 결과를 404로 옮긴다.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; logId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, logId } = await ctx.params;
  // uuid 형식이 아니면 조회 전에 끊는다(22P02 → 500 방지).
  if (!isUuidLike(id) || !isUuidLike(logId)) {
    return NextResponse.json({ error: '수동 기록만 지울 수 있어요' }, { status: 404 });
  }
  const ok = await deleteManualLog(getSql(), id, logId);
  if (!ok) return NextResponse.json({ error: '수동 기록만 지울 수 있어요' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
