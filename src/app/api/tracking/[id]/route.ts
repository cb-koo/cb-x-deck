import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { findTrackedPostById, setDraftLink, deleteTrackedPost } from '@/lib/trackingStore';

// tracked_post.id는 uuid 컬럼이라 형식이 아닌 값은 "없음"이 아니라 캐스팅 오류(22P02 → 500)가 된다.
// 조회 전에 끊어서 404로 답한다(influencers [id] 관례).
const notFound = () => NextResponse.json({ error: '추적 대상을 찾을 수 없어요' }, { status: 404 });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const body = (await req.json().catch(() => ({}))) as { draftId?: unknown };
  const draftId = body.draftId;

  // draftId는 null(연결 해제) 또는 string(연결)만 허용 — 그 외 형태는 손상된 요청이다.
  if (draftId !== null && typeof draftId !== 'string') {
    return NextResponse.json({ error: '잘못된 요청이에요' }, { status: 400 });
  }

  const sql = getSql();
  if (!(await findTrackedPostById(sql, id))) return notFound();

  try {
    if (!(await setDraftLink(sql, id, draftId))) return notFound();
  } catch (e) {
    // 존재하지 않는 원고 id를 연결하려 하면 FK 위반(23503) — 사용자 잘못이니 400으로 알린다.
    if (e instanceof postgres.PostgresError && e.code === '23503') {
      return NextResponse.json({ error: '연결하려는 원고를 찾을 수 없어요' }, { status: 400 });
    }
    throw e;
  }
  return NextResponse.json({ row: await findTrackedPostById(sql, id) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  if (!(await deleteTrackedPost(getSql(), id))) return notFound();
  return NextResponse.json({ ok: true });
}
