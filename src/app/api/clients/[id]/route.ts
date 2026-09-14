import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getClientWithProcedures, updateClient, deleteClient } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { checkLandingUrl, landingUrlMessage } from '@/lib/trackingLink';
import { parseBudgetAmount } from '@/lib/clientBudget';

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
  const { monthlyBudget: rawBudget, ...rest } = (await req.json().catch(() => ({}))) as {
    name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string; nameEn?: string; monthlyBudget?: unknown; clinicCode?: string | null;
  };
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
  // 예산: undefined = 건드리지 않음 · null/'' = 미설정 · 숫자(콤마 문자열 허용) = 설정. 0 이상 정수만(비용 금액 규칙과 동일)
  let monthlyBudget: number | null | undefined;
  if (rawBudget !== undefined) {
    const parsed = parseBudgetAmount(rawBudget);
    if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
    monthlyBudget = parsed.value;
  }
  try {
    await updateClient(getSql(), id, { ...rest, monthlyBudget });
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      return NextResponse.json({ error: '이 리포트 코드는 이미 다른 클라이언트에 연결돼 있어요' }, { status: 409 });
    throw e;
  }
  return NextResponse.json(await getClientWithProcedures(getSql(), id));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  await deleteClient(getSql(), id);
  return NextResponse.json({ ok: true });
}
