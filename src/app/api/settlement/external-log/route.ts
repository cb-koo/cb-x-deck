import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listExternalLog } from '@/lib/externalApiLog';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json({ rows: await listExternalLog(getSql(), 50) });
}
