import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { getDraft, updateDraft, removeDraft } from '@/lib/draftStore';
import type { DraftContent, DraftFormat } from '@/lib/draftTypes';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isDraftStatus, type DraftStatus } from '@/lib/draftStatus';
import { normalizeInfluencerPatch } from '@/lib/influencerPatch';
import { formatForPosts } from '@/lib/draftFormat';
import { normalizeDraftMedia } from '@/lib/draftMediaGuard';
import { syncInfluencerOnDraftUpdate } from '@/lib/influencerSync';
import { parseTaskIdPatch, TASK_NOT_FOUND_MESSAGE, DRAFT_ATTACHED_MESSAGE, TASK_HAS_DRAFT_MESSAGE } from '@/lib/campaignTaskInput';
import { attachDraft, detachDraft, TaskAttachError } from '@/lib/campaignTaskStore';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const row = await getDraft(getSql(), id);
  if (!row) return NextResponse.json({ error: `draft not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as
    { edited?: DraftContent; dismissedFlags?: string[]; status?: string;
      influencerHandle?: string | null; title?: string | null;
      taskId?: unknown }; // 작업 붙이기/떼기(스펙 2026-08-28 §5) — 검증은 parseTaskIdPatch
  if (body.status !== undefined && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== 'string') {
      return NextResponse.json({ error: '제목 형식이 올바르지 않아요' }, { status: 400 });
    }
    if (body.title.trim().length > 80) {
      return NextResponse.json({ error: '제목은 80자까지 쓸 수 있어요' }, { status: 400 });
    }
  }
  const inf = normalizeInfluencerPatch(body.influencerHandle);
  if (!inf.ok) return NextResponse.json({ error: inf.message }, { status: 400 });
  const influencerHandle = inf.value;
  // 작업 — undefined=건드리지 않음 · null=떼기 · uuid=붙이기(스펙 2026-08-28 §5)
  const taskId = parseTaskIdPatch(body.taskId);
  if (!taskId.ok) return NextResponse.json({ error: taskId.message }, { status: 400 });
  let derivedFormat: DraftFormat | undefined;
  if (body.edited !== undefined) {
    const posts = (body.edited as { posts?: unknown })?.posts;
    if (!Array.isArray(posts) || posts.length === 0 ||
        posts.some((p) => typeof (p as { text?: unknown })?.text !== 'string')) {
      return NextResponse.json({ error: '편집 내용 형식이 올바르지 않아요' }, { status: 400 });
    }
    // 항목 형태가 틀린 media는 UI가 보낼 수 없는 값이다(정상 흐름이 아니라 손상된 요청) —
    // 텍스트 형식 오류와 같은 방식으로 전체 요청을 400으로 거절한다. 반면 4장 초과는
    // 정상적인 사용 흐름(§C)이라 오류가 아니라 조용히 4장으로 잘라 저장한다.
    const normalizedMedia = (posts as Array<{ media?: unknown }>).map((p) => normalizeDraftMedia(p.media));
    if (normalizedMedia.some((m) => m === null)) {
      return NextResponse.json({ error: '첨부 이미지 형식이 올바르지 않아요' }, { status: 400 });
    }
    body.edited = {
      posts: (posts as Array<{ text: string; media?: unknown }>).map((p, i) => ({
        text: p.text, media: normalizedMedia[i]!,
      })),
    } as DraftContent;
    // 칸 수가 바뀌었으면 format도 맞춘다 — 클라이언트가 보낸 값을 믿지 않고 본문에서 파생한다.
    // 어긋난 채 저장되면 다시쓰기가 손으로 늘린 칸을 잘라낸다(설계 §E).
    derivedFormat = formatForPosts((body.edited as DraftContent).posts.length);
  }
  const sql = getSql();
  const result = await sql.begin(async (tx0): Promise<'ok' | 'no-draft' | 'no-task' | 'draft-attached' | 'task-has-draft'> => {
    const tx = tx0 as unknown as postgres.Sql; // 저장소 선례: generate.ts:127
    // 동시 PATCH가 스테일 스냅샷으로 로그를 쓰지 않도록 행을 잠그고 읽는다 (리뷰 반영)
    await tx`select id from draft where id = ${id} for update`;
    const before = await getDraft(tx, id);
    if (!before) return 'no-draft';
    // 붙이기/떼기를 updateDraft보다 먼저 — 실패 시 문자열 return이라 트랜잭션은 커밋된다(postgres.js).
    // 뒤에 두면 이 커밋이 updateDraft만 남긴 반쪽 변경이 된다.
    if (taskId.value === null) await detachDraft(tx, id);
    else if (taskId.value !== undefined) {
      try { await attachDraft(tx, taskId.value, id); }
      catch (e) { if (e instanceof TaskAttachError) return e.code; throw e; }
    }
    // body를 통째로 펼치지 않는다. 그렇게 하면 요청 본문의 아무 키나 updateDraft의 patch로 흘러가
    // 클라이언트가 history·translation·koTitle 같은 서버 소관 필드를 직접 세팅할 수 있다. format이
    // 특히 위험하다 — 본문과 어긋난 값이 저장되면 다시쓰기가 손으로 늘린 칸을 잘라낸다(설계 §E).
    // 받을 필드를 여기서 하나씩 명시한다.
    await updateDraft(tx, id, {
      ...(body.edited !== undefined ? { edited: body.edited } : {}),
      ...(body.dismissedFlags !== undefined ? { dismissedFlags: body.dismissedFlags } : {}),
      ...(body.status !== undefined ? { status: body.status as DraftStatus } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      influencerHandle, // 정규화된 값으로 덮어쓴다 — body의 원문 그대로가 아니다(핸들만 저장 원칙)
      ...(derivedFormat ? { format: derivedFormat } : {}),
    });
    await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle, status: body.status as string | undefined, actorId: gate.member.id });
    return 'ok';
  });
  if (result === 'no-task') return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 400 });
  if (result === 'draft-attached') return NextResponse.json({ error: DRAFT_ATTACHED_MESSAGE }, { status: 409 });
  if (result === 'task-has-draft') return NextResponse.json({ error: TASK_HAS_DRAFT_MESSAGE }, { status: 409 });
  if (result === 'no-draft') {
    return NextResponse.json({ error: '원고를 찾을 수 없어요 — 다른 사람이 삭제했을 수 있어요' }, { status: 404 });
  }
  return NextResponse.json(await getDraft(sql, id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await removeDraft(getSql(), id);
  return NextResponse.json({ ok: true });
}
