import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { generateDraft, GenerateInputError, type GenerateRequest } from '@/lib/generate';
import { listDrafts, getDraft } from '@/lib/draftStore';
import { LLMRefusalError } from '@/lib/llm';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isDraftStatus } from '@/lib/draftStatus';

export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId') ?? undefined;
  const status = params.get('status');
  if (status !== null && !isDraftStatus(status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  return NextResponse.json(await listDrafts(getSql(), { clientId, status: status ?? undefined }));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as Partial<GenerateRequest>;
  const MODES = ['off', 'form', 'angle', 'both'] as const;
  if (body.mode !== undefined && !MODES.includes(body.mode as typeof MODES[number])) {
    return NextResponse.json({ error: '참고 방식 값이 올바르지 않아요' }, { status: 400 });
  }
  if ((body.refTweetIds !== undefined && !Array.isArray(body.refTweetIds)) ||
      (body.procedureIds !== undefined && !Array.isArray(body.procedureIds))) {
    return NextResponse.json({ error: '요청 형식이 올바르지 않아요' }, { status: 400 });
  }
  try {
    const id = await generateDraft(sql, {
      clientId: body.clientId ?? null,
      procedureIds: body.procedureIds ?? [],
      refTweetIds: body.refTweetIds ?? [],
      mode: body.mode ?? 'off',
      direction: body.direction ?? '',
      format: body.format === 'thread' ? 'thread' : 'single',
      constraintsOn: !!body.constraintsOn,
      memberId: gate.member.id, // 클라이언트 body 무시 — 위조 차단(브리핑 관례)
    });
    return NextResponse.json(await getDraft(sql, id));
  } catch (e) {
    if (e instanceof GenerateInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof LLMRefusalError) {
      return NextResponse.json(
        { error: '안전 분류기가 이번 생성을 거절했어요 — 방향성을 바꿔 다시 시도해주세요' }, { status: 502 });
    }
    // 원인을 삼키지 않는다(브리핑 라우트 관례)
    console.error('[draft] 생성 중 오류', { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
