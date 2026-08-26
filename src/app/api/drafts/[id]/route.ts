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
import { parseDraftFieldPatch, CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/draftFieldPatch';
import { getCampaign } from '@/lib/campaignStore';

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
      campaignId?: unknown; scheduledOn?: unknown; cost?: unknown }; // 캠페인 3필드(스펙 §2-3) — 검증은 parseDraftFieldPatch
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
  // 캠페인 3필드 — undefined=건드리지 않음 · null=지움 · 값=설정. 네 라우트가 공유하는 한 함수로 형식을 확정한다.
  const fields = parseDraftFieldPatch(body);
  if (!fields.ok) return NextResponse.json({ error: fields.message }, { status: 400 });
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
  const result = await sql.begin(async (tx0): Promise<'ok' | 'no-draft' | 'no-campaign'> => {
    const tx = tx0 as unknown as postgres.Sql; // 저장소 선례: generate.ts:127
    // 동시 PATCH가 스테일 스냅샷으로 로그를 쓰지 않도록 행을 잠그고 읽는다 (리뷰 반영)
    await tx`select id from draft where id = ${id} for update`;
    const before = await getDraft(tx, id);
    if (!before) return 'no-draft';
    // 소속시킬 캠페인이 살아 있는지 — 그 사이 다른 사람이 지웠을 수 있다. FK 위반(23503)을 500으로 흘리지 않고 400 문구로 말한다.
    if (fields.value.campaignId && !(await getCampaign(tx, fields.value.campaignId))) return 'no-campaign';
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
      ...fields.value, // campaignId·scheduledOn·cost — 검증을 통과한, 실제로 온 키만 들어 있다
    });
    await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle, status: body.status as string | undefined, actorId: gate.member.id });
    return 'ok';
  });
  if (result === 'no-campaign') return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 400 });
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
