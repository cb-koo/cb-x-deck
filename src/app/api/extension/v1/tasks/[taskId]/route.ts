import { getSql } from '@/lib/db';
import { extError, extHandle, extOk, extPreflight } from '@/lib/extensionApi';
import { requireExtensionMember } from '@/lib/extensionAuth';
import { findTaskHandle, loadTaskFacts } from '@/lib/extensionReadStore';
import { classifyTask, toTaskDto } from '@/lib/extensionTasks';
import { kstToday } from '@/lib/datetime';
import { isUuidLike } from '@/lib/uuid';
import { extensionProductDispatch } from '@/lib/extensionProductApi';

export const OPTIONS = extPreflight;

export async function GET(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    const { taskId } = await ctx.params;
    const notFound = () => extError(req, requestId, 'RESOURCE_NOT_FOUND', '작업을 찾을 수 없어요.');
    if (!isUuidLike(taskId)) return notFound();
    const sql = getSql();
    // 확장은 상대 기준으로 작업에 들어온다 — 담당 인플루언서가 등록되지 않은 작업은 조회 대상이 아니다.
    const owner = await findTaskHandle(sql, taskId);
    if (!owner?.handle || !owner.personId) return notFound();
    const fact = (await loadTaskFacts(sql, [owner.handle])).find((t) => t.id === taskId);
    if (!fact) return notFound();
    const today = kstToday();
    const [reservation] = await sql<Array<{ id: string }>>`select id from visit_reservation where task_id = ${taskId}`;
    const response = extOk(req, requestId, { ...toTaskDto(fact, classifyTask(fact, today), owner.personId, today, new URL(req.url).origin), reservationId: reservation?.id ?? null });
    response.headers.set('ETag', `"${fact.version}"`);
    return response;
  });
}

// 이 경로가 [...path]보다 먼저 잡히므로 삭제는 여기서 공통 처리로 넘긴다.
export async function DELETE(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    const result = await extensionProductDispatch(req, ['tasks', (await ctx.params).taskId], gate.member);
    return extOk(req, requestId, result.data, result.status);
  });
}
