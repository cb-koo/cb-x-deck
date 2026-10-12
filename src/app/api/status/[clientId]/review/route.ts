import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { kstToday } from '@/lib/datetime';
import { isDecision, isDirection } from '@/lib/clientStatus';
import { loadClientMonth, saveMonthReview, monthSnapshot } from '@/lib/clientMonthStore';
import { loadClientStatus, saveReview, reviewSnapshot } from '@/lib/clientStatusStore';
import { parsePeriod } from '@/lib/reportPeriod';

const MEMO_MAX = 1000;

// 이번 주 판정 확정(스펙 2026-10-09 §6) — 기준 주와 규칙 제안값은 서버가 다시 계산해 저장한다(화면 값을 믿지 않는다).
export async function PUT(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { clientId } = await ctx.params;
  if (!isUuidLike(clientId)) return NextResponse.json({ error: '클라이언트를 찾을 수 없어요' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { verdict?: unknown; direction?: unknown; memo?: unknown; period?: unknown };
  const memo = typeof body.memo === 'string' ? body.memo.trim() : '';
  if (memo.length > MEMO_MAX) return NextResponse.json({ error: `메모는 ${MEMO_MAX}자까지예요` }, { status: 400 });
  const sql = getSql();
  const today = kstToday();
  // 어느 기간의 기록인지는 화면이 보낸 기간 — 서버가 다시 해석하고, 진행 중인 기간은 받지 않는다
  const period = parsePeriod(typeof body.period === 'string' ? body.period : null, today);
  const by = gate.member ? { id: gate.member.id, name: gate.member.name } : null;
  if (period.kind === 'month') {
    if (!isDirection(body.direction)) return NextResponse.json({ error: '방향을 골라 주세요' }, { status: 400 });
    const m = await loadClientMonth(sql, clientId, today, period);
    if (!m) return NextResponse.json({ error: '리포트가 연결된 클라이언트가 아니에요' }, { status: 404 });
    if (m.period.inProgress) return NextResponse.json({ error: '진행 중인 달은 끝난 뒤에 기록할 수 있어요' }, { status: 400 });
    return NextResponse.json(await saveMonthReview(sql, { clientId, monthStart: period.start, direction: body.direction, memo, by, snapshot: monthSnapshot(m) }));
  }
  if (!isDecision(body.verdict)) return NextResponse.json({ error: '판정을 골라 주세요' }, { status: 400 });
  const s = await loadClientStatus(sql, clientId, today, period);
  if (!s) return NextResponse.json({ error: '리포트가 연결된 클라이언트가 아니에요' }, { status: 404 });
  if (s.period.inProgress) return NextResponse.json({ error: '진행 중인 주차는 끝난 뒤에 확정할 수 있어요' }, { status: 400 });
  // 확정 순간의 숫자를 함께 남긴다 — 예약 데이터는 나중에 바뀌어(미예약 표시·취소) 그때 판단 근거를 다시 볼 수 있게(koo 10-10)
  const review = await saveReview(sql, { clientId, weekStart: s.baseWeek.start, weekEnd: s.baseWeek.end, verdict: body.verdict, suggested: s.suggestion.decision, memo,
    by, snapshot: reviewSnapshot(s) });
  return NextResponse.json(review);
}
