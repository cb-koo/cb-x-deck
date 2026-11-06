import { productWebBoundary } from '@/lib/productWebBoundary';
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getClientWithProcedures, updateClient, deleteClient, setClientActive } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { checkLandingUrl, landingUrlMessage } from '@/lib/trackingLink';
import { isUuidLike } from '@/lib/uuid';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const row = await getClientWithProcedures(getSql(), id);
  if (!row) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; clinicCode?: string | null; sponsorMemo?: string;
    active?: unknown;
  };
  // 비활성화·다시 활성화(087, ISSUE-013) — 다른 칸과 섞지 않고 단독으로 처리한다(누가·언제는 서버가 정한다)
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: '활성 여부를 다시 골라 주세요' }, { status: 400 });
    if (!isUuidLike(id)) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });   // 형식이 틀린 id는 DB까지 가지 않는다(22P02 → 500 방지)
    const row = await setClientActive(getSql(), id, body.active, { id: gate.member.id, name: gate.member.name });
    if (!row) return NextResponse.json({ error: `client not found: ${id}` }, { status: 404 });
    return NextResponse.json(await getClientWithProcedures(getSql(), id));
  }
  const { active: _active, ...rest } = body;
  void _active;
  if (rest.name !== undefined) {
    rest.name = rest.name?.trim();
    if (!rest.name) return NextResponse.json({ error: '클라이언트 이름은 비울 수 없어요' }, { status: 400 });
  }
  if (rest.landingUrl !== undefined) {
    rest.landingUrl = rest.landingUrl?.trim();
    // 빈 값은 '기본 랜딩 없음'으로 허용 — 값이 있을 때만 형식을 지킨다(잘못된 기본값이 생성 폼에 흘러들지 않게)
    if (rest.landingUrl !== '') {
      const check = checkLandingUrl(rest.landingUrl);
      if (!check.ok) return NextResponse.json({ error: landingUrlMessage(check.reason) }, { status: 400 });
      rest.landingUrl = check.url;
    }
  }
  if (rest.nameEn !== undefined) {
    rest.nameEn = rest.nameEn?.trim();
    // 빈 값 허용(영문 이름 없음) — 값이 있으면 캠페인 규칙과 같은 영문 문자만(공백은 저장 시 유지, 제안이 하이픈화)
    if (rest.nameEn !== '' && !/^[A-Za-z0-9 ._-]+$/.test(rest.nameEn ?? '')) {
      return NextResponse.json({ error: '영문 이름은 영어·숫자로 입력해 주세요 (예: yonsei-clinic)' }, { status: 400 });
    }
  }
  if (rest.sponsorMemo !== undefined) {
    if (typeof rest.sponsorMemo !== 'string') return NextResponse.json({ error: '협찬 항목은 글로 입력해 주세요' }, { status: 400 });
    // 줄바꿈·공백은 trim하지 않고 그대로 저장(익스텐션에 적은 모양 그대로 보인다) — 길이만 막는다
    if (rest.sponsorMemo.length > 4000)
      return NextResponse.json({ error: `협찬 항목은 4000자까지 적을 수 있어요 (현재 ${rest.sponsorMemo.length}자)` }, { status: 400 });
  }
  try {
    await updateClient(getSql(), id, rest);
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      return NextResponse.json({ error: '이 리포트 코드는 이미 다른 클라이언트에 연결돼 있어요' }, { status: 409 });
    throw e;
  }
  return NextResponse.json(await getClientWithProcedures(getSql(), id));
}

async function DELETEInternal(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await deleteClient(getSql(), id);
  return NextResponse.json({ ok: true });
}

export const DELETE = productWebBoundary(DELETEInternal);
