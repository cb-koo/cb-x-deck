import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getTask, listTaskChanges } from '@/lib/campaignTaskStore';
import { TASK_NOT_FOUND_MESSAGE } from '@/lib/campaignTaskInput';

// 작업 금액 변경 이력(스펙 2026-10-07 §6) — 읽기만. 지우거나 고치는 API는 없다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  return NextResponse.json({ changes: await listTaskChanges(sql, taskId) });
}
