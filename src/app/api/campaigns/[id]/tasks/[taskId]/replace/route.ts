import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { getTask, replaceInfluencer } from '@/lib/campaignTaskStore';
import { parseReplaceBody, TASK_NOT_FOUND_MESSAGE } from '@/lib/campaignTaskInput';

// 인플루언서 교체(ADR 0005) — 같은 작업 ID. 상태 제한·흔적 정리·사유 로그를 서버가 한 트랜잭션으로 보장한다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const parsed = parseReplaceBody(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await replaceInfluencer(sql, taskId, { ...parsed.value, actorId: gate.member.id, today: kstToday() });
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r !== 'ok') return NextResponse.json({ error: r }, { status: 400 });
  return NextResponse.json(await getTask(sql, taskId));
}
