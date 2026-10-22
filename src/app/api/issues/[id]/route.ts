import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { getIssue, updateIssue } from '@/lib/issueReportStore';
import { MAX_ISSUE_REPLY, isIssueHandler, isIssueStatus } from '@/lib/issueReport';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const issue = UUID_RE.test(id) ? await getIssue(getSql(), id) : null;
  if (!issue) return NextResponse.json({ error: '이슈를 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(issue);
}

// 상태·해결 답 바꾸기 — 처리 담당자(koo·태정님)만(스펙 §5). 화면에서 숨기는 것만으로 막지 않는다.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  if (!isIssueHandler(gate.user.email)) return NextResponse.json({ error: '상태는 담당자만 바꿀 수 있어요' }, { status: 403 });
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '이슈를 찾을 수 없어요' }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { status?: unknown; reply?: unknown } | null;
  if (b?.status !== undefined && !isIssueStatus(b.status)) return NextResponse.json({ error: '알 수 없는 상태예요' }, { status: 400 });
  if (b?.reply !== undefined && b.reply !== null && typeof b.reply !== 'string') return NextResponse.json({ error: '답은 글자로 적어 주세요' }, { status: 400 });
  const reply = typeof b?.reply === 'string' ? b.reply.replace(/\s+/g, ' ').trim() : b?.reply === null ? null : undefined;
  if (reply && reply.length > MAX_ISSUE_REPLY) return NextResponse.json({ error: `답은 ${MAX_ISSUE_REPLY}자까지예요` }, { status: 400 });
  const issue = await updateIssue(getSql(), id, {
    status: isIssueStatus(b?.status) ? b.status : undefined, reply, byName: gate.member.name,
  });
  if (!issue) return NextResponse.json({ error: '이슈를 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(issue);
}
