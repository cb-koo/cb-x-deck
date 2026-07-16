import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getColumn } from '@/lib/columnStore';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { refreshColumn } from '@/lib/refreshColumn';
import { getColumnQuotedIds } from '@/lib/quotedStore';
import { enrichQuoted } from '@/lib/quotedEnrich';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sql = getSql();

  const existing = await getColumn(sql, id);
  if (!existing) return NextResponse.json({ error: `column not found: ${id}` }, { status: 404 });

  // 과거 백필용: {maxPages} = 깊은 페이지네이션(계정), {sinceDate, untilDate} = 기간 지정 재검색(검색 컬럼)
  const body = (await req.json().catch(() => ({}))) as { maxPages?: unknown; sinceDate?: unknown; untilDate?: unknown };
  const mp = Number(body.maxPages);
  let maxPagesOverride = Number.isFinite(mp) && mp >= 1 ? Math.min(10, Math.floor(mp)) : undefined;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const searchOverride = existing.kind === 'search'
    && typeof body.sinceDate === 'string' && DATE.test(body.sinceDate)
    && typeof body.untilDate === 'string' && DATE.test(body.untilDate)
    ? { sinceDate: body.sinceDate, untilDate: body.untilDate } : undefined;
  if (searchOverride) maxPagesOverride = maxPagesOverride ?? 10; // 기간 백필은 기본으로 깊게

  try {
    const client = makeClient();
    const result = await refreshColumn(sql, client, id, { maxPagesOverride, searchOverride });
    // 인용 트윗 보강(베스트 에포트) — 실패해도 refresh 자체는 성공으로 응답
    try {
      await enrichQuoted(sql, client, await getColumnQuotedIds(sql, id));
    } catch { /* 다음 새로고침에 자연 재시도 */ }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof GetxapiAuthError) {
      return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
