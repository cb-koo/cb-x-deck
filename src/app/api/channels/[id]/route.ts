import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { getChannelInput } from '@/lib/ownedChannelStore';
import { buildChannelDetail } from '@/lib/ownedChannels';

// 한 계정 자세히(오른쪽 패널) — 주차별 게시물과 팔로워 추이(스펙 2026-10-20 §2-1)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const now = Date.now();
  const input = await getChannelInput(getSql(), id, now);
  if (!input) return NextResponse.json({ error: '계정을 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(buildChannelDetail(input, now));
}
