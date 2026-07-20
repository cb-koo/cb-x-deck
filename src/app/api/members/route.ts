import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listMembers } from '@/lib/workspaceStore';

import { requireAllowedUser } from '@/lib/authGuard';
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listMembers(getSql()));
}
