import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listTargetCandidates } from '@/lib/campaignTaskStore';

// 대상 고르기 목록(스펙 §4-2) — ?clientId= 기본 필터, ?all=1이면 전체, ?q= 검색. 최근 만든 순 50건.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const clientId = p.get('clientId');
  if (clientId && !isUuidLike(clientId)) return NextResponse.json({ error: '클라이언트 값이 올바르지 않아요' }, { status: 400 });
  const all = p.get('all') === '1';
  return NextResponse.json(await listTargetCandidates(getSql(), { clientId: all ? null : clientId, q: p.get('q') ?? '' }));
}
