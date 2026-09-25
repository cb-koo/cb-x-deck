import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { getTask, replaceInfluencer } from '@/lib/campaignTaskStore';
import { parseReplaceBody, TASK_NOT_FOUND_MESSAGE } from '@/lib/campaignTaskInput';
import { rosterHandleOf, ROSTER_REQUIRED_MESSAGE } from '@/lib/taskAssignGate';

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
  // 명부 게이팅(설계 §9 ③) — 다른 사람으로 바꿀 때만 판정(같은 사람 재선택은 저장소가 no-op으로 끝낸다). 저장 표기는 명부 표기로.
  // 결제 수단은 저장소(replaceInfluencer)가 비운다 — 앞사람의 수단 id가 남으면 안 된다(§8-2).
  const canon = await rosterHandleOf(sql, parsed.value.handle);
  if (!canon && parsed.value.handle.toLowerCase() !== (cur.influencerHandle ?? '').toLowerCase()) {
    return NextResponse.json({ error: ROSTER_REQUIRED_MESSAGE }, { status: 400 });
  }
  const r = await replaceInfluencer(sql, taskId, { ...parsed.value, handle: canon ?? parsed.value.handle, actorId: gate.member.id, today: kstToday() });
  if (r === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r !== 'ok') return NextResponse.json({ error: r }, { status: 400 });
  return NextResponse.json(await getTask(sql, taskId));
}
