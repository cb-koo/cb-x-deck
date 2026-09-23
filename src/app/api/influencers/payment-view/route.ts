import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { parseXHandle } from '@/lib/xHandle';
import { loadPaymentView } from '@/lib/paymentView';

// 작업 패널 '결제 수단' 한 줄(설계 §8-1). 인플 한 명(또는 작업 한 건의 요청)만 본다 — 목록 응답에 수단을 싣지 않기 위해 따로 둔다.
// 권한은 인플 옵션 목록(/api/drafts/influencers)과 같은 단계.
// `payment-view`는 정적 세그먼트라 형제 동적 세그먼트([id])보다 먼저 매칭된다 — drafts/influencers·drafts/[id]와 같은 관례(기존).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const u = new URL(req.url);
  const parsed = parseXHandle(u.searchParams.get('handle') ?? '');
  if (!parsed.ok) return NextResponse.json({ error: '핸들이 올바르지 않아요' }, { status: 400 });
  return NextResponse.json(await loadPaymentView(getSql(), { handle: parsed.handle, taskId: u.searchParams.get('taskId') }));
}
