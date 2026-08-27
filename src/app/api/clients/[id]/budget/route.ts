import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getClientBudget } from '@/lib/clientStore';
import { spendByMonth } from '@/lib/campaignStore';
import { budgetRows } from '@/lib/clientBudget';
import { kstToday } from '@/lib/datetime';

// 클라이언트 상세 '월 마케팅 예산' 패널의 표(스펙 2026-08-27 §5-3). 클라이언트 로드와 분리 — 상세 첫 화면을 느리게 하지
// 않고 패널이 자기 데이터를 따로 부른다. 집행은 저장하지 않고 매번 계산(캠페인 합계와 같은 totalsFor).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const sql = getSql();
  const client = await getClientBudget(sql, id);
  if (!client) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  const spend = await spendByMonth(sql, id);
  return NextResponse.json({ rows: budgetRows(client, spend, kstToday()) });
}
