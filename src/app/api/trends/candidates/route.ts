import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listCandidates } from '@/lib/trendDiscover';
import { requireAllowedUser } from '@/lib/authGuard';

// 새로 뜨는 검색 — 아직 고르지 않은 후보(새 시술·다른 표기·새 고민·제외)
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listCandidates(getSql(), new URL(req.url).searchParams.get('market') ?? 'jp'));
}
