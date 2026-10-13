import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { sendTask, holdTask, HOLD_REASON_MAX } from '@/lib/settlementAutoStore';

// 정산 요청 대기 행 버튼(스펙 2026-10-12 §6) — send: [바로 보내기]·[보내기](요청자 = 누른 사람),
// hold: [보류](사유 필수). 판정은 서버가 다시 한다(화면을 우회해도 막힌 건은 못 보낸다).
export async function POST(req: Request, ctx: { params: Promise<{ taskId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { taskId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown };
  const member = { id: gate.member.id, name: gate.member.name };
  if (body.action === 'send') {
    const r = await sendTask(getSql(), taskId, { via: 'manual', member });
    if (r.ok) return NextResponse.json({ ok: true, request: r.request });
    return NextResponse.json({ ok: false, code: r.code, error: r.reason }, { status: r.code === 'not-candidate' ? 404 : 409 });
  }
  if (body.action === 'hold') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return NextResponse.json({ error: '사유를 적어 주세요' }, { status: 400 });
    if (reason.length > HOLD_REASON_MAX) return NextResponse.json({ error: `사유는 ${HOLD_REASON_MAX}자까지예요` }, { status: 400 });
    const ok = await holdTask(getSql(), taskId, member, reason);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: '이미 보냈거나 멈출 수 없는 작업이에요 — 목록을 다시 확인해 주세요' }, { status: 409 });
  }
  return NextResponse.json({ error: '알 수 없는 요청이에요' }, { status: 400 });
}
