import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { dismiss, undismiss } from '@/lib/dismissStore';

export async function POST(req: Request) {
  const { workspaceId, tweetId, memberId } = await req.json().catch(() => ({}));
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await dismiss(getSql(), { workspaceId, tweetId, memberId });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId'); const tweetId = sp.get('tweetId');
  if (!workspaceId || !tweetId) return NextResponse.json({ error: 'workspaceId·tweetId 필수' }, { status: 400 });
  await undismiss(getSql(), { workspaceId, tweetId });
  return NextResponse.json({ ok: true });
}
