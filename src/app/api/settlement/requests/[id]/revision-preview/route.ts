import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { previewRevision, type RevisionEdits } from '@/lib/settlementStore';
import { REVISION_FAILURE_MESSAGE } from '@/lib/settlementRevisionCopy';

// 제자리 수정 미리보기(스펙 2026-09-07 §6) — [고친 값으로 다시 반영] 창이 열릴 때와, 창 안에서 분류·마감·링크를 바꿀 때마다 부른다.
// 반영(PATCH action: revise)과 같은 계산(resolveRevision)을 쓰므로 미리보기와 실제 결과가 어긋나지 않는다.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const edits: RevisionEdits | null = q.has('category') || q.has('deadlineOn') || q.has('referenceUrl')
    ? { category: q.get('category') ?? '', deadlineOn: q.get('deadlineOn') ?? '', referenceUrl: q.get('referenceUrl')?.trim() || null }
    : null;
  const p = await previewRevision(getSql(), id, edits);
  if (p.ok) return NextResponse.json({ ok: true, before: p.before, after: p.after });
  const reason = p.reason;
  if (typeof reason === 'string') return NextResponse.json({ ok: false, error: REVISION_FAILURE_MESSAGE[reason], before: p.before }, { status: reason === 'not-found' ? 404 : 200 });
  return NextResponse.json({ ok: false, error: reason.issues.map((i) => i.text).join(' · '), issues: reason.issues, before: p.before });
}
