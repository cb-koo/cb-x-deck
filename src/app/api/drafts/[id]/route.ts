import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getDraft, updateDraft, removeDraft } from '@/lib/draftStore';
import type { DraftContent } from '@/lib/draftTypes';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isDraftStatus, type DraftStatus } from '@/lib/draftStatus';

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
    { edited?: DraftContent; dismissedFlags?: string[]; status?: string };
  if (body.status !== undefined && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  if (body.edited !== undefined) {
    const posts = (body.edited as { posts?: unknown })?.posts;
    if (!Array.isArray(posts) || posts.length === 0 ||
        posts.some((p) => typeof (p as { text?: unknown })?.text !== 'string')) {
      return NextResponse.json({ error: '편집 내용 형식이 올바르지 않아요' }, { status: 400 });
    }
    body.edited = {
      posts: (posts as Array<{ text: string; media?: unknown }>).map((p) => ({
        text: p.text, media: Array.isArray(p.media) ? p.media : [],
      })),
    } as DraftContent;
  }
  await updateDraft(getSql(), id,
    body as { edited?: DraftContent; dismissedFlags?: string[]; status?: DraftStatus });
  return NextResponse.json(await getDraft(getSql(), id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await removeDraft(getSql(), id);
  return NextResponse.json({ ok: true });
}
