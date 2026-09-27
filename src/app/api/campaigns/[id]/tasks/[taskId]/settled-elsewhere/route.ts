import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { getTask, markSettledElsewhere, clearSettledElsewhere } from '@/lib/campaignTaskStore';
import {
  parseSettleElsewhereBody, TASK_NOT_FOUND_MESSAGE, CANCELLED_TASK_MESSAGE, SETTLE_ELSEWHERE_NOT_POSTED_MESSAGE,
  SETTLE_ELSEWHERE_HAS_REQUEST_MESSAGE, SETTLE_ELSEWHERE_ALREADY_MESSAGE, SETTLE_ELSEWHERE_NOT_SET_MESSAGE,
} from '@/lib/campaignTaskInput';

// 다른 곳에서 정산함(061) — 앱 밖(구글폼 등)에서 이미 지급한 작업 표시(POST)·되돌리기(DELETE).
// PATCH가 아니라 액션 라우트: for update 재검사(게시·취소·살아있는 요청)가 필요하다(cancel 라우트와 같은 태도).
type Ctx = { params: Promise<{ id: string; taskId: string }> };

async function load(ctx: Ctx) {
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return null;
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  return cur && cur.campaignId === id ? { sql, taskId } : null;
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const parsed = parseSettleElsewhereBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const t = await load(ctx);
  if (!t) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await markSettledElsewhere(t.sql, t.taskId, { note: parsed.value.note, by: { id: gate.member.id, name: gate.member.name }, today: kstToday() });
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'cancelled') return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 409 });
  if (r === 'not-posted') return NextResponse.json({ error: SETTLE_ELSEWHERE_NOT_POSTED_MESSAGE }, { status: 409 });
  if (r === 'has-request') return NextResponse.json({ error: SETTLE_ELSEWHERE_HAS_REQUEST_MESSAGE }, { status: 409 });
  if (r === 'already') return NextResponse.json({ error: SETTLE_ELSEWHERE_ALREADY_MESSAGE }, { status: 409 });
  return NextResponse.json(await getTask(t.sql, t.taskId));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const t = await load(ctx);
  if (!t) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await clearSettledElsewhere(t.sql, t.taskId);
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'not-settled') return NextResponse.json({ error: SETTLE_ELSEWHERE_NOT_SET_MESSAGE }, { status: 409 });
  return NextResponse.json(await getTask(t.sql, t.taskId));
}
