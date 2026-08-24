import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { deleteLink } from '@/lib/linkStore';

// DB만 지운다 — short.io 링크는 살려둔다: 인플루언서가 이미 게시한 링크가 죽으면 사고다(스펙 §API, koo 확정).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });
  await deleteLink(getSql(), id);
  return NextResponse.json({ ok: true });
}
