import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { updateBudgetPeriod, deleteBudgetPeriod } from '@/lib/budgetPeriodStore';
import { parseBudgetPeriodInput } from '@/lib/clientBudget';

const NOT_FOUND = () => NextResponse.json({ error: '기간을 찾을 수 없어요 — 새로고침해 주세요' }, { status: 404 });

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; periodId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, periodId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(periodId)) return NOT_FOUND();
  const parsed = parseBudgetPeriodInput(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const result = await updateBudgetPeriod(getSql(), periodId, id, parsed.value);
  if (result === null) return NOT_FOUND();
  if (!result.ok) {
    return NextResponse.json(
      { error: `이미 있는 기간(${result.conflict.startsOn}~${result.conflict.endsOn})과 겹쳐요` }, { status: 409 });
  }
  return NextResponse.json(result.period);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; periodId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, periodId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(periodId)) return NOT_FOUND();
  await deleteBudgetPeriod(getSql(), periodId, id);
  return NextResponse.json({ ok: true });
}
