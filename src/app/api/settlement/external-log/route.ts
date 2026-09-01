import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listExternalLog } from '@/lib/externalApiLog';

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const q = new URL(req.url).searchParams;
  const method = q.get('method');
  return NextResponse.json({ rows: await listExternalLog(getSql(), {
    limit: 50,
    method: method === 'GET' || method === 'POST' ? method : undefined,
    rejectedOnly: q.get('rejectedOnly') === '1',
    requestId: q.get('request'),
  }) });
}
