import { productWebBoundary } from '@/lib/productWebBoundary';
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getTask, restoreTask } from '@/lib/campaignTaskStore';
import { TASK_NOT_FOUND_MESSAGE, RESTORE_NOT_CANCELLED_MESSAGE } from '@/lib/campaignTaskInput';

// 되돌리기(ADR 0002) — 복원 UPDATE → 세이브포인트 재부착 → 단일 커밋. draft: reattached | taken | gone | none 을 화면이 문구로 옮긴다.
async function POSTInternal(_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  const r = await restoreTask(sql, taskId);
  if (r.result === 'not-found') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });
  if (r.result === 'not-cancelled') return NextResponse.json({ error: RESTORE_NOT_CANCELLED_MESSAGE }, { status: 409 });
  // linked — 함께 되돌린 같은 방문 게시물 수(090). 원래 작업이 취소된 연결 작업은 저장소가 SAME_VISIT_ORIGINAL_CANCELLED(409)로 막는다
  return NextResponse.json({ task: await getTask(sql, taskId), draft: r.draft, linked: r.linked });
}

export const POST = productWebBoundary(POSTInternal);
