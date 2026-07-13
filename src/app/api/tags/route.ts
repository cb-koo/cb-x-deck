import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listAllTags } from '@/lib/candidateStore';

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId 필수' }, { status: 400 });
  return NextResponse.json(await listAllTags(getSql(), workspaceId));
}
