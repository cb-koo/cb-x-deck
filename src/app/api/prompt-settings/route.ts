import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { getPromptOverrides, listPromptVersions, sanitizeOverrides, savePromptOverrides } from '@/lib/promptSettings';
import { PROMPT_DEFAULTS } from '@/lib/generatePrompt';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const [overrides, versions] = await Promise.all([getPromptOverrides(sql), listPromptVersions(sql)]);
  return NextResponse.json({ overrides, defaults: PROMPT_DEFAULTS, versions });
}

export async function PUT(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { overrides?: unknown };
  const clean = sanitizeOverrides(body.overrides);
  if (clean === null) return NextResponse.json({ error: '지시문 형식이 올바르지 않아요' }, { status: 400 });
  // 저장자 = 서버가 해석한 멤버 (클라이언트 body 무시 — 초안 관례)
  await savePromptOverrides(getSql(), clean, gate.member.id);
  return NextResponse.json({ overrides: clean });
}
