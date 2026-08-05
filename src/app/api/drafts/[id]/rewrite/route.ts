import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { rewriteDraft, GenerateInputError } from '@/lib/generate';
import { LLMRefusalError } from '@/lib/llm';
import { requireMember } from '@/lib/authGuard';

const MAX_FEEDBACK = 1000;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { feedback?: unknown };
  if (body.feedback !== undefined && typeof body.feedback !== 'string') {
    return NextResponse.json({ error: '피드백은 텍스트로 보내주세요' }, { status: 400 });
  }
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim().slice(0, MAX_FEEDBACK) : undefined;
  try {
    return NextResponse.json(await rewriteDraft(getSql(), id, feedback || undefined));
  } catch (e) {
    if (e instanceof GenerateInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof LLMRefusalError) {
      return NextResponse.json(
        { error: '안전 분류기가 이번 생성을 거절했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    }
    console.error('[draft] 다시 쓰기 오류', { id, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
