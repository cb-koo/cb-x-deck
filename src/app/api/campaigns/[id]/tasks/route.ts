import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { createTasks, getTask, findTaskByDraft, TaskAttachError } from '@/lib/campaignTaskStore';
import { TARGETABLE_TYPES } from '@/lib/campaignJudgment';
import { parseTaskCreate, TASK_NOT_FOUND_MESSAGE, TARGET_TYPE_MESSAGE, DRAFT_ATTACHED_MESSAGE, TASK_HAS_DRAFT_MESSAGE, CANCELLED_TASK_MESSAGE } from '@/lib/campaignTaskInput';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { getDraft } from '@/lib/draftStore';
import { syncInfluencerOnDraftUpdate } from '@/lib/influencerSync';
import { rosterHandleOf, checkTaskPaymentMethod, ROSTER_REQUIRED_MESSAGE } from '@/lib/taskAssignGate';

const notFound = () => NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });

// 작업 생성(스펙 §6) — 인플 N명이면 N행을 한 트랜잭션에. 대상 작업은 존재·유형(post/quoteRt/visit)까지 확인한다(DB check로는 표현 불가).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const parsed = parseTaskCreate(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const v = parsed.value;
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return notFound();
  // 명부 게이팅(설계 §9 ①·⑤-a) — 사람을 넣는 줄은 명부에 있어야 한다. 저장 표기는 명부 표기로.
  // 고른 결제 수단(§8-2)은 그 사람의 지금 목록에 있어야 한다.
  for (const it of v.influencers) {
    const canon = await rosterHandleOf(sql, it.handle);
    if (!canon) return NextResponse.json({ error: ROSTER_REQUIRED_MESSAGE }, { status: 400 });
    it.handle = canon;
    if (it.paymentMethodId) {
      const err = await checkTaskPaymentMethod(sql, canon, it.paymentMethodId);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
  }
  if (v.targetTaskId) {
    const target = await getTask(sql, v.targetTaskId);
    if (!target) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 400 });
    if (!TARGETABLE_TYPES.includes(target.type)) return NextResponse.json({ error: TARGET_TYPE_MESSAGE }, { status: 400 });
    v.targetTweetUrl = null;   // 작업 참조와 링크는 둘 중 하나 — PATCH와 같은 규칙(둘 다 오면 작업 참조가 이긴다)
  }
  let before = null as Awaited<ReturnType<typeof getDraft>>;
  if (v.draftId) {
    before = await getDraft(sql, v.draftId);
    if (!before) return NextResponse.json({ error: '원고를 찾을 수 없어요 — 다른 사람이 삭제했을 수 있어요' }, { status: 400 });
    if (await findTaskByDraft(sql, v.draftId)) return NextResponse.json({ error: DRAFT_ATTACHED_MESSAGE }, { status: 409 });
  }
  try {
    const tasks = await createTasks(sql, id, {
      type: v.type, targetTaskId: v.targetTaskId, targetTweetUrl: v.targetTweetUrl, draftId: v.draftId,
      scheduledOn: v.scheduledOn, visitOn: v.visitOn, note: v.note, createdBy: gate.member.id,
      items: v.count ? Array.from({ length: v.count }, () => ({ handle: null, cost: v.cost }))
           : v.influencers.length ? v.influencers : (v.cost ? [{ handle: null, cost: v.cost }] : []),
    });
    // 원고를 붙이며 인플이 바뀌었으면(작업 인플 → 원고) 배정 자동 로그도 남긴다(§5 syncInfluencerOnDraftUpdate)
    if (before && tasks[0].influencerHandle && (before.influencerHandle ?? '').toLowerCase() !== tasks[0].influencerHandle.toLowerCase()) {
      await sql.begin(async (tx0) => syncInfluencerOnDraftUpdate(tx0 as unknown as postgres.Sql, { before: before!, influencerHandle: tasks[0].influencerHandle, status: undefined, actorId: gate.member.id }));
    }
    return NextResponse.json({ tasks });
  } catch (e) {
    if (e instanceof TaskAttachError) {
      const msg = e.code === 'draft-attached' ? DRAFT_ATTACHED_MESSAGE
        : e.code === 'task-has-draft' ? TASK_HAS_DRAFT_MESSAGE
        : e.code === 'task-cancelled' ? CANCELLED_TASK_MESSAGE : TASK_NOT_FOUND_MESSAGE;
      return NextResponse.json({ error: msg }, { status: e.code === 'no-task' ? 400 : 409 });
    }
    throw e;
  }
}
