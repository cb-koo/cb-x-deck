import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getClientWithProcedures, updateClient, deleteClient } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';

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
  const body = (await req.json().catch(() => ({}))) as { name?: string; info?: string; bannedPhrases?: string[] };
  if (body.name !== undefined) {
    body.name = body.name?.trim();
    if (!body.name) return NextResponse.json({ error: '클라이언트 이름은 비울 수 없어요' }, { status: 400 });
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
