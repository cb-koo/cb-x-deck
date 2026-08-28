import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { findTrackedPostById, linkTrackedPost, deleteTrackedPost, setRole } from '@/lib/trackingStore';
import { POST_ROLES, type PostRole } from '@/lib/postRole';

// tracked_post.id는 uuid 컬럼이라 형식이 아닌 값은 "없음"이 아니라 캐스팅 오류(22P02 → 500)가 된다.
// 조회 전에 끊어서 404로 답한다(influencers [id] 관례).
const notFound = () => NextResponse.json({ error: '추적 대상을 찾을 수 없어요' }, { status: 404 });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const body = (await req.json().catch(() => ({}))) as { draftId?: unknown; taskId?: unknown; role?: unknown };

  // 역할 변경 — draftId/taskId 요청과 배타적. 'role' 키가 있으면 이 갈래다(null = 자동으로 되돌리기).
  if ('role' in body) {
    const role = (body as { role?: unknown }).role;
    if (role !== null && !POST_ROLES.includes(role as PostRole)) {
      return NextResponse.json({ error: '잘못된 요청이에요' }, { status: 400 });
    }
    const sql = getSql();
    if (!(await setRole(sql, id, role as PostRole | null))) return notFound();
    return NextResponse.json({ row: await findTrackedPostById(sql, id) });
  }

  // 작업으로 연결(taskId) 또는 원고로 연결(draftId) — 어느 쪽이든 linkTrackedPost가 두 칸을 함께 맞춘다(§2-4).
  const link = 'taskId' in body
    ? { key: 'taskId' as const, v: body.taskId }
    : { key: 'draftId' as const, v: body.draftId };

  // v는 null(연결 해제) 또는 uuid 문자열(연결)만 허용 — 그 외 형태는 손상된 요청이거나
  // uuid 캐스팅 오류(22P02)로 떨어져 catch를 비껴가므로 여기서 형식까지 끊는다.
  if (link.v !== null && (typeof link.v !== 'string' || !isUuidLike(link.v))) {
    return NextResponse.json(
      { error: link.key === 'taskId' ? '연결하려는 작업을 찾을 수 없어요' : '연결하려는 원고를 찾을 수 없어요' },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!(await findTrackedPostById(sql, id))) return notFound();

  try {
    const linked = await sql.begin(async (tx0) => linkTrackedPost(
      tx0 as unknown as postgres.Sql, id,
      link.key === 'taskId' ? { taskId: link.v as string | null } : { draftId: link.v as string | null },
    ));
    if (!linked) return notFound();
  } catch (e) {
    // 존재하지 않는 원고/작업 id를 연결하려 하면 FK 위반(23503, linkTrackedPost는 작업 쪽을 같은 code로 직접 던진다) — 사용자 잘못이니 400으로 알린다.
    if ((e instanceof postgres.PostgresError && e.code === '23503') || (e as { code?: unknown })?.code === '23503') {
      return NextResponse.json({ error: '연결하려는 원고나 작업을 찾을 수 없어요' }, { status: 400 });
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
