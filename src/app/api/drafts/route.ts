import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { generateDraft, GenerateInputError, type GenerateRequest } from '@/lib/generate';
import { listDrafts, getDraft, getDraftsByIdsForUpdate, updateDraftsBulk, removeDraftsBulk } from '@/lib/draftStore';
import { syncInfluencerOnDraftUpdate } from '@/lib/influencerSync';
import { LLMRefusalError } from '@/lib/llm';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isDraftStatus, type DraftStatus } from '@/lib/draftStatus';
import { normalizeInfluencerPatch } from '@/lib/influencerPatch';
import { isUuidLike } from '@/lib/uuid';
import { LIST_CAP } from '@/lib/draftPaging';
import { parseTaskIdPatch, TASK_NOT_FOUND_MESSAGE, TASK_HAS_DRAFT_MESSAGE, DRAFT_ATTACHED_MESSAGE, CANCELLED_TASK_MESSAGE } from '@/lib/campaignTaskInput';
import { getTask, TaskAttachError } from '@/lib/campaignTaskStore';

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId') ?? undefined;
  const status = params.get('status');
  if (status !== null && !isDraftStatus(status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  // 폴링은 방금 만들어진 것만 찾으므로 작은 값으로 부른다(설계 §I) — 취소 한 번에
  // 5초 간격 24회가 나가는데 그때마다 전량을 받으면 수 MB가 오간다.
  // 숫자가 아니거나 범위를 벗어난 값은 오류로 세우지 않고 상한으로 클램프한다 — 목록 조회는
  // 읽기 전용이고, 여기서 400을 주면 낡은 클라이언트가 목록을 통째로 못 보는 쪽이 더 나쁘다.
  const rawLimit = Number(params.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), LIST_CAP) : LIST_CAP;
  // unattached=1 — 작업에 안 붙은 원고만('있는 원고 고르기' 후보, 스펙 2026-08-28 §4-2)
  const unattached = params.get('unattached') === '1';
  return NextResponse.json(await listDrafts(getSql(), { clientId, status: status ?? undefined, limit, unattached }));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as Partial<GenerateRequest>;
  const MODES = ['off', 'form', 'angle', 'both'] as const;
  if (body.mode !== undefined && !MODES.includes(body.mode as typeof MODES[number])) {
    return NextResponse.json({ error: '참고 방식 값이 올바르지 않아요' }, { status: 400 });
  }
  if ((body.refTweetIds !== undefined && !Array.isArray(body.refTweetIds)) ||
      (body.procedureIds !== undefined && !Array.isArray(body.procedureIds))) {
    return NextResponse.json({ error: '요청 형식이 올바르지 않아요' }, { status: 400 });
  }
  if (body.quoteTargetTaskId !== undefined && body.quoteTargetTaskId !== null && (typeof body.quoteTargetTaskId !== 'string' || !isUuidLike(body.quoteTargetTaskId))) {
    return NextResponse.json({ error: '인용RT 작업 정보가 올바르지 않아요' }, { status: 400 });
  }
  if (body.count !== undefined && (!Number.isInteger(body.count) || body.count < 1 || body.count > 5)) {
    return NextResponse.json({ error: '시안 수는 1~5 사이여야 해요' }, { status: 400 });
  }
  // 작업에 붙여 만들기(스펙 2026-08-28 §5 /generate?task=) — 형식·존재·미부착을 여기서 확정하고
  // generateDraft엔 검증된 값만 넘긴다. 시안을 N개 만들면 첫 시안만 붙는다(원고 1개 = 작업 1개).
  const taskId = parseTaskIdPatch((body as { taskId?: unknown }).taskId);
  if (!taskId.ok) return NextResponse.json({ error: taskId.message }, { status: 400 });
  if (typeof taskId.value === 'string') {
    const task = await getTask(sql, taskId.value);
    if (!task) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 400 });
    if (task.cancelledAt) return NextResponse.json({ error: CANCELLED_TASK_MESSAGE }, { status: 409 });   // R18 — attachDraft도 막지만 여기서 먼저(생성 비용 전)
    if (task.draftId) return NextResponse.json({ error: TASK_HAS_DRAFT_MESSAGE }, { status: 409 });
  }
  try {
    const ids = await generateDraft(sql, {
      clientId: body.clientId ?? null,
      procedureIds: body.procedureIds ?? [],
      refTweetIds: body.refTweetIds ?? [],
      mode: body.mode ?? 'off',
      direction: body.direction ?? '',
      format: body.format === 'thread' ? 'thread' : 'single',
      constraintsOn: !!body.constraintsOn,
      count: body.count,
      memberId: gate.member.id, // 클라이언트 body 무시 — 위조 차단(브리핑 관례)
      taskId: taskId.value ?? null, // 위에서 존재·미부착까지 확인한 값
      quoteTargetTaskId: body.quoteTargetTaskId ?? null,
      quoteTargetInput: body.quoteTargetInput ?? null,
    });
    return NextResponse.json(await Promise.all(ids.map((id) => getDraft(sql, id))));
  } catch (e) {
    if (e instanceof GenerateInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof LLMRefusalError) {
      return NextResponse.json(
        { error: '안전 분류기가 이번 생성을 거절했어요 — 방향성을 바꿔 다시 시도해주세요' }, { status: 502 });
    }
    // 생성 자체는 끝났는데 붙이기(insertDraft→attachDraft)가 경합으로 실패한 경우 — manual 라우트와 같은 매핑.
    if (e instanceof TaskAttachError) {
      const message = e.code === 'draft-attached' ? DRAFT_ATTACHED_MESSAGE
        : e.code === 'task-has-draft' ? TASK_HAS_DRAFT_MESSAGE
        : e.code === 'task-cancelled' ? CANCELLED_TASK_MESSAGE : TASK_NOT_FOUND_MESSAGE;
      return NextResponse.json({ error: message }, { status: e.code === 'no-task' ? 400 : 409 });
    }
    // 원인을 삼키지 않는다(브리핑 라우트 관례)
    console.error('[draft] 생성 중 오류', { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}

// 일괄 처리 상한. UI는 최근 50건까지만 보여줘 넘길 수 없지만, 라우트는 UI를 믿지 않는다.
const BULK_MAX = 100;

// 두 벌크 라우트가 공유하는 ids 검증. 형식이 틀린 요청은 UI가 보낼 수 없는 값이다(손상된 요청).
function parseIds(v: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(v) || v.length === 0) return { ok: false, error: '대상을 하나 이상 골라주세요' };
  if (v.length > BULK_MAX) return { ok: false, error: `한 번에 ${BULK_MAX}개까지 처리할 수 있어요` };
  if (v.some((x) => typeof x !== 'string' || !isUuidLike(x))) {
    return { ok: false, error: '요청 형식이 올바르지 않아요' };
  }
  return { ok: true, ids: v as string[] };
}

export async function PATCH(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as
    { ids?: unknown; status?: unknown; influencerHandle?: string | null };
  const parsed = parseIds(body.ids);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (body.status !== undefined && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  const inf = normalizeInfluencerPatch(body.influencerHandle);
  if (!inf.ok) return NextResponse.json({ error: inf.message }, { status: 400 });
  // 일괄은 상태·배정만 받는다 — 캠페인 소속은 작업의 것이라 여기로 오지 않는다(스펙 2026-08-28 §5).
  if (body.status === undefined && inf.value === undefined) {
    return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  }
  const sql = getSql();
  // 갱신과 자동 로그(influencerSync)를 같은 트랜잭션에 — 단건 PATCH와 같은 원칙(스펙 §5).
  // UPDATE는 여전히 한 문장이고, 로그 insert N개는 같은 커넥션 위의 짧은 문장들이라
  // updateDraftsBulk가 피하려던 "커넥션 N개 동시 점유"와는 다르다.
  await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql; // 저장소 선례: generate.ts:127
    const befores = await getDraftsByIdsForUpdate(tx, parsed.ids);
    await updateDraftsBulk(tx, parsed.ids, {
      status: body.status as DraftStatus | undefined,
      ...(inf.value !== undefined ? { influencerHandle: inf.value } : {}),
    });
    for (const before of befores) {
      await syncInfluencerOnDraftUpdate(tx, {
        before, influencerHandle: inf.value,
        status: body.status as string | undefined, actorId: gate.member.id,
      });
    }
  });
  return NextResponse.json({ ok: true, updated: parsed.ids.length });
}

export async function DELETE(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const parsed = parseIds(body.ids);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await removeDraftsBulk(getSql(), parsed.ids);
  return NextResponse.json({ ok: true, removed: parsed.ids.length });
}
