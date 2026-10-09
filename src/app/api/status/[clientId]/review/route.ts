import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { isDecision } from '@/lib/clientStatus';
import { loadClientStatus, saveReview } from '@/lib/clientStatusStore';

const MEMO_MAX = 1000;

// 이번 주 판정 확정(스펙 2026-10-09 §6) — 기준 주와 규칙 제안값은 서버가 다시 계산해 저장한다(화면 값을 믿지 않는다).
export async function PUT(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { clientId } = await ctx.params;
  if (!isUuidLike(clientId)) return NextResponse.json({ error: '클라이언트를 찾을 수 없어요' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { verdict?: unknown; memo?: unknown };
  if (!isDecision(body.verdict)) return NextResponse.json({ error: '판정을 골라 주세요' }, { status: 400 });
  const memo = typeof body.memo === 'string' ? body.memo.trim() : '';
  if (memo.length > MEMO_MAX) return NextResponse.json({ error: `메모는 ${MEMO_MAX}자까지예요` }, { status: 400 });
  const sql = getSql();
  const s = await loadClientStatus(sql, clientId, kstToday());
  if (!s) return NextResponse.json({ error: '리포트가 연결된 클라이언트가 아니에요' }, { status: 404 });
  const review = await saveReview(sql, { clientId, weekStart: s.baseWeek.start, verdict: body.verdict, suggested: s.suggestion.decision, memo, by: gate.member ? { id: gate.member.id, name: gate.member.name } : null });
  return NextResponse.json(review);
}
