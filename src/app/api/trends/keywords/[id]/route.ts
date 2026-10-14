import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { setKeywordIntent, rebuildView } from '@/lib/trendStore';
import { INTENT_LABEL, type Intent } from '@/lib/searchIntent';
import { requireMember } from '@/lib/authGuard';

// 검색어 태그 바꾸기 — intent: null이면 규칙대로 되돌림. 바꾸면 화면 완성본을 다시 만든다(약 3초).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { intent?: string | null; market?: string };
  const intent = body.intent ?? null;
  if (intent !== null && !(intent in INTENT_LABEL)) return NextResponse.json({ error: '알 수 없는 태그예요' }, { status: 400 });
  const market = body.market ?? 'jp';
  const sql = getSql();
  if (!(await setKeywordIntent(sql, market, id, intent as Intent | null))) return NextResponse.json({ error: '검색어를 찾지 못했어요' }, { status: 404 });
  await rebuildView(sql, market);
  return NextResponse.json({ ok: true });
}
