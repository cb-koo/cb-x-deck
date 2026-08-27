import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getClientWithProcedures, setBudgetOverride } from '@/lib/clientStore';
import { isMonthKey, parseBudgetAmount, MONTH_MESSAGE } from '@/lib/clientBudget';

// 특정 달 예산 설정/되돌리기(스펙 2026-08-27 §5-3). body.amount: 숫자 = 그 달만 이 금액 · null = 예외 삭제(기본값으로).
// 응답은 갱신된 클라이언트(시술 포함) — 화면이 목록 행·패널을 한 번에 갱신한다.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; month: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, month } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  if (!isMonthKey(month)) return NextResponse.json({ error: MONTH_MESSAGE }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { amount?: unknown };
  const parsed = parseBudgetAmount(body.amount);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  await setBudgetOverride(sql, id, month, parsed.value);
  const row = await getClientWithProcedures(sql, id);
  if (!row) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}
