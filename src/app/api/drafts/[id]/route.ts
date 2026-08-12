import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getDraft, updateDraft, removeDraft } from '@/lib/draftStore';
import type { DraftContent } from '@/lib/draftTypes';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isDraftStatus, type DraftStatus } from '@/lib/draftStatus';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { normalizeDraftMedia } from '@/lib/draftMediaGuard';

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
    { edited?: DraftContent; dismissedFlags?: string[]; status?: string; influencerHandle?: string | null };
  if (body.status !== undefined && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  // undefined = 건드리지 않음(아래로 그대로 통과) · null·공백뿐인 문자열 = 배정 해제 ·
  // 그 외 = parseXHandle로 정규화(빈 값을 파서에 넣지 않는다 — 'empty' 오류가 배정 해제 요청에 잘못 붙는 것을 막는다).
  let influencerHandle: string | null | undefined = body.influencerHandle;
  if (influencerHandle !== undefined) {
    const trimmed = influencerHandle == null ? null : influencerHandle.trim();
    if (!trimmed) {
      influencerHandle = null;
    } else {
      const parsed = parseXHandle(trimmed);
      if (!parsed.ok) {
        return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });
      }
      influencerHandle = parsed.handle;
    }
  }
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
  }
  await updateDraft(getSql(), id, {
    ...(body as { edited?: DraftContent; dismissedFlags?: string[]; status?: DraftStatus }),
    influencerHandle, // 정규화된 값으로 덮어쓴다 — body의 원문 그대로가 아니다(핸들만 저장 원칙)
  });
  return NextResponse.json(await getDraft(getSql(), id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await removeDraft(getSql(), id);
  return NextResponse.json({ ok: true });
}
