import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { decideCandidate, candidateProcedure } from '@/lib/trendDiscover';
import { createProcedure, findJpConflict } from '@/lib/trendStore';
import { collectProcedure, kpFromComposio } from '@/lib/trendCollect';
import { requireMember } from '@/lib/authGuard';

// 후보 처리 — action: 'ignore'(다시 안 보임) · 'adopt'(다른 표기는 그 시술 묶음에, 고민은 '피부 고민'에 넣고 바로 수집) · 'added'(새 시술을 양식으로 추가한 뒤 표시만)
export const maxDuration = 300;  // 새 달이 나와 있으면 전체 갱신을 먼저 한다(collectProcedure)

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { action?: string; market?: string };
  const market = b.market ?? 'jp';
  const sql = getSql();
  const by = gate.member.name ?? gate.user.email ?? '';
  if (b.action === 'ignore' || b.action === 'added') {
    if (!(await decideCandidate(sql, market, id, b.action === 'ignore' ? 'ignored' : 'added', by))) return NextResponse.json({ error: '이미 처리된 후보예요' }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (b.action !== 'adopt') return NextResponse.json({ error: '알 수 없는 처리예요' }, { status: 400 });
  const p = await candidateProcedure(sql, market, id);
  if (!p) return NextResponse.json({ error: '이 후보는 바로 넣을 수 없어요 — [시술로 추가]로 이름·분류를 정해 주세요' }, { status: 400 });
  const dup = await findJpConflict(sql, market, p.jp);
  if (dup) { await decideCandidate(sql, market, id, 'added', by); return NextResponse.json({ error: `이미 '${dup.name}'에 있는 검색어예요` }, { status: 409 }); }
  const pid = await createProcedure(sql, market, p);
  await sql`update trend_procedure set note = '새로 뜨는 검색 후보에서 추가' where id = ${pid}`;
  await decideCandidate(sql, market, id, 'added', by);
  const r = await collectProcedure(sql, kpFromComposio(), market, pid);
  return NextResponse.json({ id: pid, keywords: r.keywords });
}
