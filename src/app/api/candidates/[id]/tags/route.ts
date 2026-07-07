import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { addTag } from '@/lib/candidateStore';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name 필수' }, { status: 400 });
  return NextResponse.json(await addTag(getSql(), id, name), { status: 201 });
}
