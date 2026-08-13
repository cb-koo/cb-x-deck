import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { generateDraft, GenerateInputError, type GenerateRequest } from '@/lib/generate';
import { listDrafts, getDraft, updateDraftsBulk, removeDraftsBulk } from '@/lib/draftStore';
import { LLMRefusalError } from '@/lib/llm';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isDraftStatus, type DraftStatus } from '@/lib/draftStatus';
import { normalizeInfluencerPatch } from '@/lib/influencerPatch';
import { isUuidLike } from '@/lib/uuid';
import { LIST_CAP } from '@/lib/draftPaging';

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
  return NextResponse.json(await listDrafts(getSql(), { clientId, status: status ?? undefined, limit }));
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
  if (body.count !== undefined && (!Number.isInteger(body.count) || body.count < 1 || body.count > 5)) {
    return NextResponse.json({ error: '시안 수는 1~5 사이여야 해요' }, { status: 400 });
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
    });
    return NextResponse.json(await Promise.all(ids.map((id) => getDraft(sql, id))));
  } catch (e) {
    if (e instanceof GenerateInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof LLMRefusalError) {
      return NextResponse.json(
        { error: '안전 분류기가 이번 생성을 거절했어요 — 방향성을 바꿔 다시 시도해주세요' }, { status: 502 });
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
  if (body.status === undefined && inf.value === undefined) {
    return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  }
  await updateDraftsBulk(getSql(), parsed.ids, {
    status: body.status as DraftStatus | undefined,
    ...(inf.value !== undefined ? { influencerHandle: inf.value } : {}),
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
