import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { getTask, cancelTask } from '@/lib/campaignTaskStore';
import { parseCancelBody, TASK_NOT_FOUND_MESSAGE, CANCEL_POSTED_MESSAGE, CANCELLED_TASK_MESSAGE } from '@/lib/campaignTaskInput';

// 작업 취소(캠페인 v2 ADR 0002) — PATCH가 아니라 액션 라우트: for update 재검사 + 원고 떼기·스냅샷·로그를 한 트랜잭션에.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const parsed = parseCancelBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await cancelTask(sql, taskId, { ...parsed.value, actorId: gate.member.id, today: kstToday() });
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'posted') return NextResponse.json({ error: CANCEL_POSTED_MESSAGE }, { status: 409 });
  if (r === 'already') return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 409 });
  return NextResponse.json(await getTask(sql, taskId));
}
