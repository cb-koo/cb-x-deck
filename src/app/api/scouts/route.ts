import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { saveScout, removeScout, listScouts } from '@/lib/scoutStore';

import { requireAllowedUser, requireMember } from '@/lib/authGuard';
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  const scouts = await listScouts(getSql(), workspaceId);
  return NextResponse.json({ scouts });
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { workspaceId, handle, name, avatarUrl, bio, followers, verified, sourceTweetId } =
    await req.json().catch(() => ({}));
  const memberId = gate.member.id; // 클라이언트 body.memberId 무시(위조 차단)
  if (!workspaceId || !handle) return NextResponse.json({ error: 'workspaceId·handle 필수' }, { status: 400 });
  await saveScout(getSql(), {
    workspaceId, handle, name, avatarUrl, bio, followers, verified, sourceTweetId, memberId,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId'); const handle = sp.get('handle');
  if (!workspaceId || !handle) return NextResponse.json({ error: 'workspaceId·handle 필수' }, { status: 400 });
  await removeScout(getSql(), { workspaceId, handle });
  return NextResponse.json({ ok: true });
}
