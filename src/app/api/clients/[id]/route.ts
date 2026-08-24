import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getClientWithProcedures, updateClient, deleteClient } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { checkLandingUrl, landingUrlMessage } from '@/lib/trackingLink';

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
  const body = (await req.json().catch(() => ({}))) as { name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string };
  if (body.name !== undefined) {
    body.name = body.name?.trim();
    if (!body.name) return NextResponse.json({ error: '클라이언트 이름은 비울 수 없어요' }, { status: 400 });
  }
  if (body.landingUrl !== undefined) {
    body.landingUrl = body.landingUrl?.trim();
    // 빈 값은 '기본 랜딩 없음'으로 허용 — 값이 있을 때만 형식을 지킨다(잘못된 기본값이 생성 폼에 흘러들지 않게)
    if (body.landingUrl !== '') {
      const check = checkLandingUrl(body.landingUrl);
      if (!check.ok) return NextResponse.json({ error: landingUrlMessage(check.reason) }, { status: 400 });
      body.landingUrl = check.url;
    }
  }
  if (body.nameEn !== undefined) {
    body.nameEn = body.nameEn?.trim();
    // 빈 값 허용(영문 이름 없음) — 값이 있으면 캠페인 규칙과 같은 영문 문자만(공백은 저장 시 유지, 제안이 하이픈화)
    if (body.nameEn !== '' && !/^[A-Za-z0-9 ._-]+$/.test(body.nameEn ?? '')) {
      return NextResponse.json({ error: '영문 이름은 영어·숫자로 입력해 주세요 (예: yonsei-clinic)' }, { status: 400 });
    }
  }
  await updateClient(getSql(), id, body);
  return NextResponse.json(await getClientWithProcedures(getSql(), id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await deleteClient(getSql(), id);
  return NextResponse.json({ ok: true });
}
