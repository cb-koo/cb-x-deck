import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { listInfluencers } from '@/lib/influencerStore';
import { registerInfluencer } from '@/lib/influencerRegistration';
import { productWebBoundary } from '@/lib/productWebBoundary';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listInfluencers(getSql()));
}

async function register(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = await req.json().catch(() => ({})) as { handle?: unknown };
  const result = await getSql().begin((tx) => registerInfluencer(tx as unknown as postgres.Sql, body.handle, gate.member.id));
  return NextResponse.json(result);
}
export const POST = productWebBoundary(register);
