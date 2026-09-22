import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listBudgetPeriods, createBudgetPeriod } from '@/lib/budgetPeriodStore';
import { spendByPeriods } from '@/lib/campaignStore';
import { periodRow, parseBudgetPeriodInput } from '@/lib/clientBudget';

// 클라이언트 상세 '예산 기간' 패널의 표(스펙 2026-09-22 §5-3). 집행은 저장하지 않고 매번 계산.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const sql = getSql();
  const periods = await listBudgetPeriods(sql, id);
  const spend = await spendByPeriods(sql, id, periods);
  const rows = periods.map((p) => {
    const s = spend.get(p.id) ?? { total: {}, campaignCount: 0, feeKrw: 0, feeUnknown: 0, spanning: [] };
    return periodRow(p, s, s.spanning);
  });
  return NextResponse.json({ rows });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const parsed = parseBudgetPeriodInput(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  try {
    const result = await createBudgetPeriod(sql, id, parsed.value);
    if (!result.ok) {
      return NextResponse.json(
        { error: `이미 있는 기간(${result.conflict.startsOn}~${result.conflict.endsOn})과 겹쳐요` }, { status: 409 });
    }
    return NextResponse.json(result.period, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === '23503') return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
    throw e;
  }
}
