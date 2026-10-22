import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { markReplySeen } from '@/lib/issueReportStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 보낸 사람이 상세를 열었다 — 답을 봤음(사이드바 숫자가 줄어든다). 남의 이슈면 저장소가 아무것도 안 한다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (UUID_RE.test(id)) await markReplySeen(getSql(), id, gate.member.id);
  return NextResponse.json({ ok: true });
}
