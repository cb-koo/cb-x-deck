import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listCandidates, removeCandidateByTweetId, saveCandidate } from '@/lib/candidateStore';

export async function GET(req: Request) {
  const tag = new URL(req.url).searchParams.get('tag') ?? undefined;
  return NextResponse.json(await listCandidates(getSql(), { tag }));
}

export async function POST(req: Request) {
  const { tweetId, sourceColumnId } = await req.json();
  if (!tweetId) return NextResponse.json({ error: 'tweetId 필수' }, { status: 400 });
  return NextResponse.json(await saveCandidate(getSql(), tweetId, sourceColumnId ?? null), { status: 201 });
}

export async function DELETE(req: Request) {
  const tweetId = new URL(req.url).searchParams.get('tweetId');
  if (!tweetId) return NextResponse.json({ error: 'tweetId 필수' }, { status: 400 });
  await removeCandidateByTweetId(getSql(), tweetId);
  return NextResponse.json({ ok: true });
}
