import { productWebBoundary } from '@/lib/productWebBoundary';
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { createSameVisitTask } from '@/lib/campaignTaskStore';
import { TASK_NOT_FOUND_MESSAGE } from '@/lib/campaignTaskInput';

// 같은 방문의 게시물 하나 더(089, ISSUE-016) — 방문협찬 원래 작업에 연결 작업(비용 없음 고정)을 만든다.
// 판정(방문협찬·취소 아님·스스로 연결 작업 아님·인플 있음)은 저장소가 원래 작업을 잠그고 다시 한다 — 거절은 ProductError → 409 문구.
async function POSTInternal(_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const created = await createSameVisitTask(getSql(), id, taskId, gate.member.id);
  return NextResponse.json(created, { status: 201 });
}

export const POST = productWebBoundary(POSTInternal);
