import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { saveScout, removeScout, listScouts } from '@/lib/scoutStore';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  const scouts = await listScouts(getSql(), workspaceId);
  return NextResponse.json({ scouts });
}

export async function POST(req: Request) {
  const { workspaceId, handle, name, avatarUrl, bio, followers, verified, sourceTweetId, memberId } =
    await req.json().catch(() => ({}));
  if (!workspaceId || !handle) return NextResponse.json({ error: 'workspaceId·handle 필수' }, { status: 400 });
  await saveScout(getSql(), {
    workspaceId, handle, name, avatarUrl, bio, followers, verified, sourceTweetId, memberId,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId'); const handle = sp.get('handle');
  if (!workspaceId || !handle) return NextResponse.json({ error: 'workspaceId·handle 필수' }, { status: 400 });
  await removeScout(getSql(), { workspaceId, handle });
  return NextResponse.json({ ok: true });
}
