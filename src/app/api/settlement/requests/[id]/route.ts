import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { cancelRequest } from '@/lib/settlementStore';

// 라우트 파일은 HTTP 핸들러만 export한다 — 상수는 모듈 내부에 둔다.
const CANCEL_REASON_MESSAGE = '취소 사유를 1~200자로 적어 주세요';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown };
  if (body.action !== 'cancel') return NextResponse.json({ error: '지원하지 않는 동작이에요' }, { status: 400 });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 200) return NextResponse.json({ error: CANCEL_REASON_MESSAGE }, { status: 400 });
  const r = await cancelRequest(getSql(), id, reason, { id: gate.member.id, name: gate.member.name });
  if (r === 'not-found') return NextResponse.json({ error: '요청을 찾을 수 없어요 — 화면을 새로고침해 주세요' }, { status: 404 });
  if (r === 'already-cancelled') return NextResponse.json({ error: '이미 취소된 요청이에요' }, { status: 409 });
  if (r === 'paid-locked') return NextResponse.json({ error: '지급 완료된 요청은 취소할 수 없어요 — 정산 담당자에게 알려 주세요' }, { status: 409 });
  return NextResponse.json(r);
}
