import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getTask, updateTask, deleteTask, hasActiveRequest } from '@/lib/campaignTaskStore';
import type { TaskPatch } from '@/lib/campaignTaskStore';
import { TARGETABLE_TYPES } from '@/lib/campaignJudgment';
import { parseTaskPatch, proofGateError, TASK_NOT_FOUND_MESSAGE, TARGET_TYPE_MESSAGE, TARGET_SELF_MESSAGE, VISIT_ON_MESSAGE, REMOVED_WITHOUT_POSTED_MESSAGE } from '@/lib/campaignTaskInput';
import { getDraft, updateDraft } from '@/lib/draftStore';
import { syncInfluencerOnDraftUpdate } from '@/lib/influencerSync';
import { PROOF_VALUE_MESSAGE } from '@/lib/taskProofGuard';

const notFound = () => NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });

// 작업 패치(스펙 §6) — 3값 규칙. 인플 변경은 붙은 원고에도 전파(값은 하나) + 배정 자동 로그.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return notFound();
  const parsed = parseTaskPatch(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const patch = parsed.value;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (!cur || cur.campaignId !== id) return notFound();
  if (patch.visitOn && cur.type !== 'visit') return NextResponse.json({ error: VISIT_ON_MESSAGE }, { status: 400 });
  // ── RT 증빙 3규칙 (스펙 §5) — 판정은 순수 함수 campaignTaskInput.proofGateError로 뺐다(리뷰 Critical:
  //    패치 전 증빙만 보면 한 요청에 postedAt+proof:null을 합쳐 보내는 우회가 뚫린다. 반드시 패치 후 상태로 본다.
  const gateError = proofGateError(cur, patch);
  if (gateError) return NextResponse.json({ error: gateError }, { status: 400 });
  const { proofUrl, ...rest } = patch;
  const taskPatch: TaskPatch = { ...rest };
  if (proofUrl !== undefined) {
    // 경로가 이 작업 것인지 좁힌다 — 모양만 맞으면 남의 작업(혹은 없는 객체)을 가리키는 값도 통과해 버린다(리뷰 Minor)
    if (proofUrl !== null && !proofUrl.startsWith(`task/${taskId}/`)) {
      return NextResponse.json({ error: PROOF_VALUE_MESSAGE }, { status: 400 });
    }
    taskPatch.proof = proofUrl === null
      ? null
      : { url: proofUrl, by: gate.member.id, byName: gate.member.name, at: new Date().toISOString() };
  }
  if (patch.removedAt && !cur.postedAt && !patch.postedAt) return NextResponse.json({ error: REMOVED_WITHOUT_POSTED_MESSAGE }, { status: 400 });
  if (patch.targetTaskId) {
    if (patch.targetTaskId === taskId) return NextResponse.json({ error: TARGET_SELF_MESSAGE }, { status: 400 });
    const target = await getTask(sql, patch.targetTaskId);
    if (!target) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 400 });
    if (!TARGETABLE_TYPES.includes(target.type)) return NextResponse.json({ error: TARGET_TYPE_MESSAGE }, { status: 400 });
    taskPatch.targetTweetUrl = null;   // 작업 참조와 링크는 둘 중 하나
  } else if (patch.targetTweetUrl) {
    taskPatch.targetTaskId = null;
  }
  await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    await updateTask(tx, taskId, taskPatch);
    if (patch.influencerHandle !== undefined && cur.draftId) {
      const before = await getDraft(tx, cur.draftId);
      if (before && (before.influencerHandle ?? '').toLowerCase() !== (patch.influencerHandle ?? '').toLowerCase()) {
        await updateDraft(tx, cur.draftId, { influencerHandle: patch.influencerHandle });
        await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle: patch.influencerHandle, status: undefined, actorId: gate.member.id });
      }
    }
  });
  const updated = await getTask(sql, taskId);
  if (!updated) return notFound();
  return NextResponse.json(updated);
}

// 삭제 — 원고 set null·참조 set null·tracked_post.task_id set null은 FK. 멱등(이미 없으면 deleted:false).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, taskId } = await ctx.params;
  if (!isUuidLike(id) || !isUuidLike(taskId)) return notFound();
  const sql = getSql();
  const cur = await getTask(sql, taskId);
  if (cur && cur.campaignId !== id) return notFound();
  // 정산 보호(정산 스펙 §4-4) — 활성 요청이 붙은 작업은 지우지 않는다
  if (await hasActiveRequest(sql, taskId)) {
    return NextResponse.json({ error: '정산 요청된 작업이에요 — 먼저 정산에서 요청을 취소해 주세요' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, deleted: await deleteTask(sql, taskId) });
}
