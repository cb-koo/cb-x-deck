import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { decideCandidate, candidateProcedure, isBroadTerm } from '@/lib/trendDiscover';
import { createProcedure, findJpConflict, updateProcedure } from '@/lib/trendStore';
import { collectProcedure, kpFromComposio } from '@/lib/trendCollect';
import { requireMember } from '@/lib/authGuard';

// 후보 처리 — action: 'ignore'(다시 안 보임) · 'adopt'(다른 표기는 그 시술 묶음에, 고민은 '피부 고민'에 넣고 바로 수집) · 'replace'(우리 표기를 이 표기로 바꾸고 다시 수집) · 'added'(새 시술을 양식으로 추가한 뒤 표시만)
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
  if (b.action === 'replace') {
    // 표기 바꾸기 — 우리 표기보다 훨씬 많이 찾는 표기로 그 시술의 일본어를 고친다(시트 원래 값은 sheet에 남는다)
    const [c] = await sql<Array<{ term: string; of_procedure_id: string | null }>>`select term, of_procedure_id from trend_candidate where market = ${market} and id = ${id} and status = 'open'`;
    if (!c?.of_procedure_id) return NextResponse.json({ error: '바꿀 시술을 찾지 못했어요' }, { status: 400 });
    // 넓은 말로는 바꾸지 않는다(화면이 막지만 서버도 한 번 더) — RF·毛穴 같은 말로 시술 대표 검색어가 바뀌면 그 시술 숫자가 엉뚱해진다
    const jps = (await sql<Array<{ jp: string }>>`select jp from trend_procedure where market = ${market} and not hidden`).map((r) => r.jp);
    if (isBroadTerm(c.term, jps)) return NextResponse.json({ error: '너무 넓은 말이라 표기를 바꿀 수 없어요 — 필요하면 [더하기]로 넣어 주세요' }, { status: 400 });
    const dup = await findJpConflict(sql, market, c.term, c.of_procedure_id);
    if (dup) return NextResponse.json({ error: `이미 '${dup.name}'에 있는 검색어예요` }, { status: 409 });
    await updateProcedure(sql, market, c.of_procedure_id, { jp: c.term });
    await decideCandidate(sql, market, id, 'added', by);
    const r = await collectProcedure(sql, kpFromComposio(), market, c.of_procedure_id);
    return NextResponse.json({ id: c.of_procedure_id, keywords: r.keywords });
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
