import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import {
  cancelRequest, ackDiff, unackDiff, reviseRequest, matchTaskCostToPaid, keepTaskCost, undoKeepTaskCost,
  type RevisionEdits, type ReconcileExpect, type ReconcileFailure, type PaymentRequestRow,
} from '@/lib/settlementStore';
import { REVISION_FAILURE_MESSAGE } from '@/lib/settlementRevisionCopy';
import { parseTaskCost, sameTaskCost, AMOUNT_MESSAGE } from '@/lib/campaignCost';
import { composeKeepReason, RECONCILE_STALE_MESSAGE, RECONCILE_REASON_MAX } from '@/lib/settlementDisplay';
import { PAID_COST_REASON_MESSAGE } from '@/lib/campaignTaskInput';

// 라우트 파일은 HTTP 핸들러만 export한다 — 상수는 모듈 내부에 둔다.
const CANCEL_REASON_MESSAGE = '취소 사유를 1~200자로 적어 주세요';
const NOT_FOUND_MESSAGE = '요청을 찾을 수 없어요 — 화면을 새로고침해 주세요';

// 창을 연 때의 값 — 모양이 어긋나면 화면이 오래된 것이다(경합과 같은 안내)
function parseReconcileExpect(b: Record<string, unknown>): ReconcileExpect | null {
  const c = parseTaskCost(b.expectedTaskCost ?? null);
  if (!c.ok || !c.value) return null;
  const krw = b.expectedPaidKrw;
  const jpy = b.expectedPaidJpy ?? null;
  if (typeof krw !== 'number' || !Number.isSafeInteger(krw)) return null;
  if (jpy !== null && (typeof jpy !== 'number' || !Number.isFinite(jpy))) return null;
  return { taskCost: c.value, paidAmountKrw: krw, paidAmountJpy: jpy as number | null };
}
function reconcileResponse(r: PaymentRequestRow | ReconcileFailure) {
  if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'stale') return NextResponse.json({ error: RECONCILE_STALE_MESSAGE }, { status: 409 });
  return NextResponse.json(r);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown };

  if (body.action === 'ack-diff' || body.action === 'unack-diff') {
    const r = body.action === 'ack-diff'
      ? await ackDiff(getSql(), id, { name: gate.member.name })
      : await unackDiff(getSql(), id);
    if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    if (r === 'no-diff') return NextResponse.json({ error: '확인할 차액이 없어요 — 화면을 새로고침해 주세요' }, { status: 409 });
    return NextResponse.json(r);
  }

  // 정산팀 지급 금액 ≠ 작업 금액 처리(스펙 2026-10-07 §5) — 판정·경합은 스토어(lockForReconcile), 여기는 입력 모양·HTTP 매핑만
  if (body.action === 'match-task-cost' || body.action === 'keep-task-cost') {
    const b = body as Record<string, unknown>;
    const expect = parseReconcileExpect(b);
    if (!expect) return NextResponse.json({ error: RECONCILE_STALE_MESSAGE }, { status: 409 });
    if (body.action === 'match-task-cost') {
      const nc = parseTaskCost(b.newCost ?? null);
      if (!nc.ok) return NextResponse.json({ error: nc.message }, { status: 400 });
      if (!nc.value) return NextResponse.json({ error: AMOUNT_MESSAGE }, { status: 400 });
      if (sameTaskCost(nc.value, expect.taskCost)) return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
      const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (!reason || reason.length > RECONCILE_REASON_MAX) return NextResponse.json({ error: PAID_COST_REASON_MESSAGE }, { status: 400 });
      return reconcileResponse(await matchTaskCostToPaid(getSql(), id, { expect, newCost: nc.value, reason }, { id: gate.member.id, name: gate.member.name }));
    }
    const reason = composeKeepReason(b.reasonKind, b.memo);
    if (!reason) return NextResponse.json({ error: PAID_COST_REASON_MESSAGE }, { status: 400 });
    return reconcileResponse(await keepTaskCost(getSql(), id, { expect, reason }, { name: gate.member.name }));
  }
  if (body.action === 'undo-keep-task-cost') {
    const r = await undoKeepTaskCost(getSql(), id);
    if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    if (r === 'not-kept') return NextResponse.json({ error: RECONCILE_STALE_MESSAGE }, { status: 409 });
    return NextResponse.json(r);
  }

  // 제자리 수정(스펙 2026-09-07 §4·§6) — 판정은 스토어(reviseRequest), 여기는 입력 모양·HTTP 매핑만
  if (body.action === 'revise') {
    const b = body as { expectedRevision?: unknown; reason?: unknown; edits?: unknown; partnerConfirmed?: unknown };
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason || reason.length > 200) return NextResponse.json({ error: '수정 사유를 1~200자로 적어 주세요' }, { status: 400 });
    if (typeof b.expectedRevision !== 'number' || !Number.isInteger(b.expectedRevision)) return NextResponse.json({ error: '화면이 오래됐어요 — 새로고침해 주세요' }, { status: 400 });
    const e = (b.edits ?? {}) as Record<string, unknown>;
    const edits: RevisionEdits = {
      category: typeof e.category === 'string' ? e.category : '',
      deadlineOn: typeof e.deadlineOn === 'string' ? e.deadlineOn : '',
      referenceUrl: typeof e.referenceUrl === 'string' && e.referenceUrl.trim() ? e.referenceUrl.trim() : null,
    };
    const r = await reviseRequest(getSql(), id, { expectedRevision: b.expectedRevision, reason, edits, partnerConfirmed: b.partnerConfirmed === true }, { id: gate.member.id, name: gate.member.name });
    if (typeof r === 'string') return NextResponse.json({ error: REVISION_FAILURE_MESSAGE[r] }, { status: r === 'not-found' ? 404 : 409 });
    if ('kind' in r && r.kind === 'blocked') return NextResponse.json({ error: r.issues.map((i) => i.text).join(' · ') }, { status: 409 });
    return NextResponse.json(r);
  }

  if (body.action !== 'cancel') return NextResponse.json({ error: '지원하지 않는 동작이에요' }, { status: 400 });
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 200) return NextResponse.json({ error: CANCEL_REASON_MESSAGE }, { status: 400 });
  const r = await cancelRequest(getSql(), id, reason, { id: gate.member.id, name: gate.member.name });
  if (r === 'not-found') return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  if (r === 'already-cancelled') return NextResponse.json({ error: '이미 취소된 요청이에요' }, { status: 409 });
  if (r === 'paid-locked') return NextResponse.json({ error: '지급 완료된 요청은 취소할 수 없어요 — 정산팀에 알려 주세요' }, { status: 409 });
  return NextResponse.json(r);
}
