import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listRequests, type RequestStatus } from '@/lib/settlementStore';

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const q = new URL(req.url).searchParams;
  const status = q.get('status');
  const rows = await listRequests(getSql(), {
    clientId: q.get('clientId') ?? undefined, campaignId: q.get('campaignId') ?? undefined, taskId: q.get('taskId') ?? undefined,
    status: status === 'requested' || status === 'cancelled' ? (status as RequestStatus) : undefined,
    from: q.get('from') ?? undefined, to: q.get('to') ?? undefined,
  });
  return NextResponse.json(rows);
}
// 요청 만들기(옛 '검토 대기'의 일괄 생성)는 없앴다 — 이제 정산 요청 대기의 자동 전송·행 버튼(/api/settlement/pending)이 만든다(스펙 2026-10-12)
