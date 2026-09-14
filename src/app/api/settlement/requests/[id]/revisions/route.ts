import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listRevisions } from '@/lib/settlementStore';

// 개정 이력(스펙 2026-09-07 §6) — 요청 펼침의 "개정 이력" 블록. 고치기 전 판들을 오래된 순으로.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  return NextResponse.json({ revisions: await listRevisions(getSql(), id) });
}
