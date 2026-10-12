import { productWebBoundary } from '@/lib/productWebBoundary';
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { getTask, cancelTask } from '@/lib/campaignTaskStore';
import { parseCancelBody, TASK_NOT_FOUND_MESSAGE, CANCEL_POSTED_MESSAGE, CANCELLED_TASK_MESSAGE } from '@/lib/campaignTaskInput';
import { endReservedTaskByCancel } from '@/lib/reservationCommands';

// 작업 취소(캠페인 v2 ADR 0002) — PATCH가 아니라 액션 라우트: for update 재검사 + 원고 떼기·스냅샷·로그를 한 트랜잭션에.
async function POSTInternal(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const parsed = parseCancelBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (cur.cancelledAt) return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 409 });
  if (cur.postedAt) return NextResponse.json({ error: CANCEL_POSTED_MESSAGE }, { status: 409 });
  // 예약이 연결된 방문 작업은 예약 종료로 기록한다(같은 창·같은 입력) — 일반 취소는 예약 가드가 거절한다. 아니면 예전 취소 그대로.
  if (await endReservedTaskByCancel(sql, req, gate.member, taskId, parsed.value)) return NextResponse.json(await getTask(sql, taskId));
  const r = await cancelTask(sql, taskId, { ...parsed.value, actorId: gate.member.id, today: kstToday() });
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'posted') return NextResponse.json({ error: CANCEL_POSTED_MESSAGE }, { status: 409 });
  if (r === 'already') return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 409 });
  return NextResponse.json(await getTask(sql, taskId));
}

export const POST = productWebBoundary(POSTInternal);
