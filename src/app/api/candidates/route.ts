import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { saveCandidate, removeCandidate, listCandidates } from '@/lib/candidateStore';

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listCandidates(getSql(), workspaceId, {
    tag: sp.get('tag') ?? undefined,
    memberId: sp.get('memberId') ?? undefined,
  }));
}

export async function POST(req: Request) {
  const { tweetId, workspaceId, memberId, sourceColumnId } = await req.json().catch(() => ({}));
  if (!tweetId || !workspaceId || !memberId) return NextResponse.json({ error: 'tweetId·workspaceId·memberId 필수' }, { status: 400 });
  return NextResponse.json(await saveCandidate(getSql(), { tweetId, workspaceId, memberId, sourceColumnId }), { status: 201 });
}

export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams;
  const tweetId = sp.get('tweetId'), workspaceId = sp.get('workspaceId'), memberId = sp.get('memberId');
  if (!tweetId || !workspaceId || !memberId) return NextResponse.json({ error: 'tweetId·workspaceId·memberId 필수' }, { status: 400 });
  await removeCandidate(getSql(), { tweetId, workspaceId, memberId });
  return NextResponse.json({ ok: true });
}
