import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { createLocation, listLocationsForManage } from '@/lib/clinicStore';
import { productWebBoundary } from '@/lib/productWebBoundary';

// 지점 관리 탭 목록 — 사용 중지 지점 포함, 순서대로, 예약 수 포함
async function GETInternal(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  return NextResponse.json({ items: await listLocationsForManage(getSql(), id) });
}

async function POSTInternal(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const created = await createLocation(getSql(), id, { name: typeof body.name === 'string' ? body.name : '' });
  return NextResponse.json(created, { status: 201 });
}

export const GET = productWebBoundary(GETInternal);
export const POST = productWebBoundary(POSTInternal);
