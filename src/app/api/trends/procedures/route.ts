import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { createProcedure, findJpConflict } from '@/lib/trendStore';
import { collectProcedure, kpFromComposio } from '@/lib/trendCollect';
import { CATEGORIES } from '@/lib/procedureTaxonomy';
import { requireMember } from '@/lib/authGuard';

// 시술 추가 — 저장하고 그 시술만 바로 수집한다(4년치 검색량·연관 검색어·수식어·한국 조합, 약 5초).
export const maxDuration = 300;  // 새 달이 나와 있으면 전체 갱신을 먼저 한다(1~2분, 한 달에 한 번)

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const b = (await req.json().catch(() => ({}))) as { name?: string; kr?: string; jp?: string; en?: string; category?: string; sub?: string; market?: string };
  const name = b.name?.trim(), jp = b.jp?.trim();
  if (!name || !jp) return NextResponse.json({ error: '시술명과 일본어 검색어가 필요해요' }, { status: 400 });
  if (!b.category || !(CATEGORIES as readonly string[]).includes(b.category)) return NextResponse.json({ error: '분류를 골라 주세요' }, { status: 400 });
  const market = b.market ?? 'jp';
  const sql = getSql();
  const dup = await findJpConflict(sql, market, jp);
  if (dup) return NextResponse.json({ error: `이미 '${dup.name}'에 있는 일본어 검색어예요` }, { status: 409 });
  const id = await createProcedure(sql, market, { name, kr: b.kr?.trim() || name, jp, en: b.en?.trim() ?? '', major: b.category, middle: b.sub?.trim() ?? '' });
  const r = await collectProcedure(sql, kpFromComposio(), market, id);
  return NextResponse.json({ id, keywords: r.keywords });
}
