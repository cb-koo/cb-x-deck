import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { countUnseenReplies } from '@/lib/issueReportStore';

// 사이드바 '이슈' 옆 숫자 — 답이 달렸는데 아직 안 본 내 이슈 수
export async function GET() {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  return NextResponse.json({ unseen: await countUnseenReplies(getSql(), gate.member.id) });
}
