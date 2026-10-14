import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listFamilyKeywords } from '@/lib/trendStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 검색어 점검 — 상세 패널이 연 묶음(시술 id 여러 개)의 검색어 전부와 지금 적용된 태그
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const u = new URL(req.url);
  const ids = (u.searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return NextResponse.json(await listFamilyKeywords(getSql(), u.searchParams.get('market') ?? 'jp', ids));
}
