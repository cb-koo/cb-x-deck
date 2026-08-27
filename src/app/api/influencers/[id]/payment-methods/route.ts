import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { findInfluencerById, updatePaymentMethods } from '@/lib/influencerStore';
import { PAYMENT_NOT_FOUND, parsePaymentMethodInput, type PaymentOp } from '@/lib/influencerPayment';

// 정산 결제 수단 — 추가(POST) / 수정·기본 지정(PATCH) / 삭제(DELETE).
// 응답은 언제나 배열 전체 스냅샷 `{ paymentMethods, logs }`(스펙 §2): 연산이 id 단위라 병행 요청은
// 스토어의 행 잠금이 직렬화하고, 마지막 응답이 곧 최신 상태다 — 클라이언트는 부분 병합 없이 교체한다.

// influencer.id는 uuid 컬럼이라 형식이 아닌 값은 "없음"이 아니라 캐스팅 오류(22P02 → 500)가 된다.
const notFound = () => NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });
// 수단 id는 uuid 컬럼이 아니라 jsonb 안의 값이라 형식 검사 대신 "목록에 없다"로 다룬다.
const methodNotFound = () => NextResponse.json({ error: PAYMENT_NOT_FOUND }, { status: 404 });
const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

type Body = { input?: unknown; makeDefault?: unknown; id?: unknown; setDefault?: unknown };
type Ctx = { params: Promise<{ id: string }> };

// 세 메서드의 공통 골격 — 게이트·404·본문 파싱까지는 같고, 다른 것은 "본문 → 연산" 한 조각뿐이다.
async function apply(req: Request, ctx: Ctx, toOp: (body: Body) => PaymentOp | NextResponse) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();

  const body = (await req.json().catch(() => ({}))) as Body;
  const op = toOp(body);
  if (op instanceof NextResponse) return op; // 검증 실패 — 사용자 문구를 그대로 400 body로

  const sql = getSql();
  if (!(await findInfluencerById(sql, id))) return notFound();
  try {
    return NextResponse.json(await updatePaymentMethods(sql, id, op, gate.member.id));
  } catch (e) {
    // 순수 모듈이 모르는 수단 id에 이 문구로 throw한다 — 그것만 404로 옮기고 나머지는 그대로 올려보낸다.
    if (e instanceof Error && e.message === PAYMENT_NOT_FOUND) return methodNotFound();
    throw e;
  }
}

export async function POST(req: Request, ctx: Ctx) {
  return apply(req, ctx, (body) => {
    const input = parsePaymentMethodInput(body.input);
    if (typeof input === 'string') return badRequest(input);
    return { kind: 'add', input, makeDefault: body.makeDefault === true };
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return apply(req, ctx, (body) => {
    const methodId = typeof body.id === 'string' ? body.id : '';
    if (!methodId) return methodNotFound();
    // setDefault는 입력 검증이 필요 없다 — 기존 수단을 가리키기만 한다.
    if (body.setDefault === true) return { kind: 'setDefault', id: methodId };
    const input = parsePaymentMethodInput(body.input);
    if (typeof input === 'string') return badRequest(input);
    return { kind: 'update', id: methodId, input };
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return apply(req, ctx, (body) => {
    const methodId = typeof body.id === 'string' ? body.id : '';
    if (!methodId) return methodNotFound();
    return { kind: 'remove', id: methodId };
  });
}
