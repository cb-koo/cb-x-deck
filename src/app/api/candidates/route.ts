import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { saveCandidate, removeCandidate, listCandidates, ensureLibraryItem } from '@/lib/candidateStore';

import { requireMember } from '@/lib/authGuard';
export async function GET(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const workspaceId = sp.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listCandidates(getSql(), workspaceId, {
    tag: sp.get('tag') ?? undefined,
    // "내 것"만 볼 때도 클라이언트 memberId 대신 서버 해석 멤버로(위조 차단) — memberId 미지정 시(팀 전체 보기)엔 그대로 무필터
    memberId: sp.get('memberId') ? gate.member.id : undefined,
  }));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { tweetId, workspaceId, sourceColumnId } = await req.json().catch(() => ({}));
  const memberId = gate.member.id; // 클라이언트 body.memberId 무시(위조 차단)
  if (!tweetId || !workspaceId) return NextResponse.json({ error: 'tweetId·workspaceId 필수' }, { status: 400 });
  await ensureLibraryItem(getSql(), { workspaceId, tweetId, addedBy: memberId });
  return NextResponse.json(await saveCandidate(getSql(), { tweetId, workspaceId, memberId, sourceColumnId }), { status: 201 });
}

export async function DELETE(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sp = new URL(req.url).searchParams;
  const tweetId = sp.get('tweetId'), workspaceId = sp.get('workspaceId');
  const memberId = gate.member.id; // 클라이언트 쿼리 memberId 무시(위조 차단)
  if (!tweetId || !workspaceId) return NextResponse.json({ error: 'tweetId·workspaceId 필수' }, { status: 400 });
  await removeCandidate(getSql(), { tweetId, workspaceId, memberId });
  return NextResponse.json({ ok: true });
}
