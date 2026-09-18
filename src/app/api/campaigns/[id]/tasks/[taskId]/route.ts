import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getTask, updateTask, deleteTask, hasActiveRequest, clearOldInfluencerTraces } from '@/lib/campaignTaskStore';
import type { TaskPatch } from '@/lib/campaignTaskStore';
import { TARGETABLE_TYPES } from '@/lib/campaignJudgment';
import { parseTaskPatch, proofGateError, influencerChangeGuard, TASK_NOT_FOUND_MESSAGE, TARGET_TYPE_MESSAGE, TARGET_SELF_MESSAGE, VISIT_ON_MESSAGE, REMOVED_WITHOUT_POSTED_MESSAGE, CANCELLED_TASK_MESSAGE, POST_CANCELLED_MESSAGE } from '@/lib/campaignTaskInput';
import { getDraft, updateDraft } from '@/lib/draftStore';
import { syncInfluencerOnDraftUpdate } from '@/lib/influencerSync';
import { kstToday } from '@/lib/datetime';

const notFound = () => NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 404 });

// updateTask가 false를 돌려줄 때(읽기~쓰기 사이 취소됨, R17) sql.begin의 트랜잭션을 통째로 끊는 신호.
// 문자열 return이 아니라 throw인 이유 — postgres.js는 콜백이 정상 return하면 커밋한다.
class TaskUpdateRaceError extends Error {}

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
  // 취소 중 허용되는 편집은 메모만(ADR 0002 "취소 중 허용되는 것"). 게시 확인은 전용 문구(상호 배제, ADR 0002),
  // 나머지는 되돌린 뒤 고치라는 문구.
  if (cur.cancelledAt) {
    if (patch.postedAt !== undefined) return NextResponse.json({ error: POST_CANCELLED_MESSAGE }, { status: 400 });
    if (Object.keys(patch).some((k) => k !== 'note')) return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 400 });
  }
  // 인플루언서 칸 변경 — 배정·해제·같은 인플만. 다른 인플로는 교체 라우트(ADR 0005). 상태 제한은 셋에 같다.
  if (patch.influencerHandle !== undefined) {
    const g = influencerChangeGuard(cur, patch.influencerHandle, kstToday());
    if (g) return NextResponse.json({ error: g }, { status: 400 });
  }
  if (patch.visitOn && cur.type !== 'visit') return NextResponse.json({ error: VISIT_ON_MESSAGE }, { status: 400 });
  // ── RT 증빙 3규칙 (스펙 §5) — 판정은 순수 함수 campaignTaskInput.proofGateError로 뺐다(리뷰 Critical:
  //    패치 전 증빙만 보면 한 요청에 postedAt+proof:null을 합쳐 보내는 우회가 뚫린다. 반드시 패치 후 상태로 본다.
  const gateError = proofGateError(cur, patch);
  if (gateError) return NextResponse.json({ error: gateError }, { status: 400 });
  const { proofUrl, ...rest } = patch;
  const taskPatch: TaskPatch = { ...rest };
  if (proofUrl !== undefined) {
    // 경로 검증(모양·이 작업 것인지)은 proofGateError가 이미 했다 — 여기는 서버만 아는 값을 채우는 자리다
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
  try {
    await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;
      // updateTask의 where절이 R17 가드를 건다(게시 확인만) — 읽기~쓰기 사이 취소가 끼어들면 false가
      // 온다. 트랜잭션을 throw로 끊어 흔적 정리·원고 동기화까지 반쪽으로 남지 않게 한다(라우트가 409로).
      const ok = await updateTask(tx, taskId, taskPatch);
      // false의 다른 원인은 "행이 없음"(동시 삭제) — 그건 아래 getTask → 404 문구가 맞다. 게시 확인 패치일 때만 취소 경합.
      if (!ok && taskPatch.postedAt !== undefined) throw new TaskUpdateRaceError();
      // 해제(인플 → 없음)도 옛 사람 흔적을 정리한다 — "해제 → 재배정"으로 교체 규칙을 우회할 수 없게(ADR 0005 표)
      if (patch.influencerHandle === null && cur.influencerHandle) {
        const traces = await clearOldInfluencerTraces(tx, taskId);
        if (traces.draftId && traces.draftWasDelivered) await updateDraft(tx, traces.draftId, { status: 'approved' });
      }
      if (patch.influencerHandle !== undefined && cur.draftId) {
        const before = await getDraft(tx, cur.draftId);
        if (before && (before.influencerHandle ?? '').toLowerCase() !== (patch.influencerHandle ?? '').toLowerCase()) {
          await updateDraft(tx, cur.draftId, { influencerHandle: patch.influencerHandle });
          await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle: patch.influencerHandle, status: undefined, actorId: gate.member.id });
        }
      }
    });
  } catch (e) {
    if (e instanceof TaskUpdateRaceError) return NextResponse.json({ error: POST_CANCELLED_MESSAGE }, { status: 409 });
    // 최후 방어 — DB check(경합의 다른 경로)를 밟아도 500 대신 문구로.
    if (e instanceof postgres.PostgresError && e.code === '23514') {
      return NextResponse.json({ error: POST_CANCELLED_MESSAGE }, { status: 409 });
    }
    throw e;
  }
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
