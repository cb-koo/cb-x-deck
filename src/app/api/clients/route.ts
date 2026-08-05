import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listClients, createClient, getClientWithProcedures } from '@/lib/clientStore';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const clients = await listClients(sql);
  // 시술 포함 목록 — 클라이언트 수는 소수라 N+1 허용
  const withProcs = await Promise.all(clients.map((c) => getClientWithProcedures(sql, c.id)));
  return NextResponse.json(withProcs.filter(Boolean));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: '클라이언트 이름이 필요해요' }, { status: 400 });
  return NextResponse.json(await createClient(getSql(), body.name.trim()));
}
