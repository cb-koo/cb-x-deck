import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { listRequests, createRequests, SettlementCreateError, type CreateItemInput, type RequestStatus } from '@/lib/settlementStore';

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

// 일괄 생성(§5-2) — 하나라도 실패면 0건 저장 + 409 건별 이유. body의 사람 정보는 무시(요청자 = 서버가 해석한 멤버).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { items?: unknown };
  const items = parseItems(body.items);
  if (typeof items === 'string') return NextResponse.json({ error: items }, { status: 400 });
  try {
    const created = await createRequests(getSql(), items, { id: gate.member.id, name: gate.member.name });
    return NextResponse.json({ created });
  } catch (e) {
    if (e instanceof SettlementCreateError) {
      return NextResponse.json({ error: '만들지 못했어요 — 아래 건을 확인해 주세요', failures: e.failures }, { status: 409 });
    }
    throw e;
  }
}

function parseItems(v: unknown): CreateItemInput[] | string {
  if (!Array.isArray(v) || v.length === 0) return '요청할 작업을 골라 주세요';
  if (v.length > 200) return '한 번에 200건까지 만들 수 있어요';
  const out: CreateItemInput[] = [];
  for (const raw of v as unknown[]) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const ex = (o.expected ?? {}) as Record<string, unknown>;
    if (typeof o.taskId !== 'string' || typeof o.category !== 'string' || typeof o.deadlineOn !== 'string') return '요청 형식이 올바르지 않아요';
    if (typeof ex.amountGross !== 'number' || (ex.payoutCurrency !== 'KRW' && ex.payoutCurrency !== 'JPY') || typeof ex.paymentMethodId !== 'string') return '요청 형식이 올바르지 않아요';
    out.push({
      taskId: o.taskId, category: o.category.trim(), deadlineOn: o.deadlineOn,
      referenceUrl: typeof o.referenceUrl === 'string' && o.referenceUrl.trim() ? o.referenceUrl.trim() : null,
      expected: { amountGross: ex.amountGross, payoutCurrency: ex.payoutCurrency, paymentMethodId: ex.paymentMethodId },
    });
  }
  return out;
}
