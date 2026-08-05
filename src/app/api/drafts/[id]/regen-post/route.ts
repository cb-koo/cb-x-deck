import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { regeneratePost, GenerateInputError } from '@/lib/generate';
import { LLMRefusalError } from '@/lib/llm';
import { requireMember } from '@/lib/authGuard';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { index?: number };
  if (typeof body.index !== 'number') {
    return NextResponse.json({ error: '다시 만들 트윗 번호(index)가 필요해요' }, { status: 400 });
  }
  try {
    return NextResponse.json(await regeneratePost(getSql(), id, body.index));
  } catch (e) {
    if (e instanceof GenerateInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof LLMRefusalError) {
      return NextResponse.json(
        { error: '안전 분류기가 이번 생성을 거절했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    }
    console.error('[draft] 부분 재생성 오류', { id, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
