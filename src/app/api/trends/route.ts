import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { readView } from '@/lib/trendStore';
import { requireAllowedUser } from '@/lib/authGuard';

// 검색 트렌드 화면 데이터 — 수집·수정 때 미리 만들어 둔 완성본(trend_view)을 그대로 준다(스펙 2026-10-13 §7).
// 약 260묶음 × 48개월이라 0.5MB 남짓(압축하면 훨씬 작다) — 계산은 하지 않는다.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const market = new URL(req.url).searchParams.get('market') ?? 'jp';
  const view = await readView(getSql(), market);
  if (!view) return NextResponse.json({ error: '아직 수집된 데이터가 없어요' }, { status: 404 });
  return NextResponse.json({ builtAt: view.builtAt, ...view.doc });
}
