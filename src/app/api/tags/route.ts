import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { listAllTags } from '@/lib/candidateStore';

export async function GET() {
  return NextResponse.json(await listAllTags(getSql()));
}
