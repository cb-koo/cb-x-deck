import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listMembers, createMember } from '@/lib/workspaceStore';

import { requireAllowedUser } from '@/lib/authGuard';
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listMembers(getSql()));
}

export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { name, color } = await req.json().catch(() => ({}));
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: '이름 필수' }, { status: 400 });
  try {
    return NextResponse.json(await createMember(getSql(), name, typeof color === 'string' && color ? color : '#1d9bf0'), { status: 201 });
  } catch {
    return NextResponse.json({ error: '이미 있는 이름입니다' }, { status: 409 });
  }
}
