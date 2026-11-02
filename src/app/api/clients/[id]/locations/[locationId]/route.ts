import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { deleteLocation, listLocationsForManage, updateLocation } from '@/lib/clinicStore';
import { productWebBoundary } from '@/lib/productWebBoundary';
import { productMissing } from '@/lib/productCommand';

type Ctx = { params: Promise<{ id: string; locationId: string }> };
// 다른 클라이언트의 지점 id로 접근하는 걸 막는다 — 소속이 다르면 없는 것으로 본다(404)
async function owned(clientId: string, locationId: string) {
  const own = (await listLocationsForManage(getSql(), clientId)).some((l) => l.id === locationId);
  if (!own) throw productMissing();
}

async function PATCHInternal(req: Request, ctx: Ctx) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, locationId } = await ctx.params;
  await owned(id, locationId);
  const b = (await req.json().catch(() => ({}))) as { name?: unknown; position?: unknown; active?: unknown };
  const patch: { name?: string; position?: number; active?: boolean } = {};
  if (b.name !== undefined) patch.name = b.name as string;
  if (b.position !== undefined) patch.position = b.position as number;
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') return NextResponse.json({ error: '사용 여부 값을 확인해 주세요.' }, { status: 400 });
    patch.active = b.active;
  }
  return NextResponse.json(await updateLocation(getSql(), locationId, patch));
}

async function DELETEInternal(_req: Request, ctx: Ctx) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, locationId } = await ctx.params;
  await owned(id, locationId);
  await deleteLocation(getSql(), locationId);
  return NextResponse.json({ ok: true });
}

export const PATCH = productWebBoundary(PATCHInternal);
export const DELETE = productWebBoundary(DELETEInternal);
