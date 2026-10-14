import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { updateProcedure, rebuildView, findJpConflict } from '@/lib/trendStore';
import { collectProcedure, kpFromComposio } from '@/lib/trendCollect';
import { CATEGORIES } from '@/lib/procedureTaxonomy';
import { requireMember } from '@/lib/authGuard';

// 시술 고치기(상세 패널 [수정]) — 일본어 검색어가 바뀌면 그 시술만 바로 다시 수집하고(약 5초), 아니면 완성본만 다시 만든다.
export const maxDuration = 60;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { name?: string; kr?: string; jp?: string; en?: string; category?: string; sub?: string; hidden?: boolean; market?: string };
  if (b.name !== undefined && !b.name.trim()) return NextResponse.json({ error: '시술명은 비울 수 없어요' }, { status: 400 });
  if (b.jp !== undefined && !b.jp.trim()) return NextResponse.json({ error: '일본어 검색어는 비울 수 없어요' }, { status: 400 });
  if (b.category !== undefined && !(CATEGORIES as readonly string[]).includes(b.category)) return NextResponse.json({ error: '알 수 없는 분류예요' }, { status: 400 });
  const market = b.market ?? 'jp';
  const sql = getSql();
  if (b.jp !== undefined) {
    const dup = await findJpConflict(sql, market, b.jp, id);
    if (dup) return NextResponse.json({ error: `이미 '${dup.name}'에 있는 일본어 검색어예요` }, { status: 409 });
  }
  const r = await updateProcedure(sql, market, id, { name: b.name, kr: b.kr, jp: b.jp, en: b.en, major: b.category, middle: b.sub, hidden: b.hidden });
  if (!r.found) return NextResponse.json({ error: '시술을 찾지 못했어요' }, { status: 404 });
  if (r.jpChanged) await collectProcedure(sql, kpFromComposio(), market, id);
  else await rebuildView(sql, market);
  return NextResponse.json({ ok: true, recollected: r.jpChanged });
}
