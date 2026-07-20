import { NextResponse } from 'next/server';
import { requireMember } from '@/lib/authGuard';

export async function GET() {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  return NextResponse.json(gate.member);
}
