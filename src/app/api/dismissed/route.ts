import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { dismiss, undismiss } from '@/lib/dismissStore';

import { requireAllowedUser, requireMember } from '@/lib/authGuard';
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { workspaceId, tweetId } = await req.json().catch(() => ({}));
  const memberId = gate.member.id; // 클라이언트 body.memberId 무시(위조 차단)
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await dismiss(getSql(), { workspaceId, tweetId, memberId });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId'); const tweetId = sp.get('tweetId');
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await undismiss(getSql(), { workspaceId, tweetId });
  return NextResponse.json({ ok: true });
}
