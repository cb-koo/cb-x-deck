import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listPending } from '@/lib/settlementAutoStore';

// 정산 요청 대기(스펙 2026-10-12 §6) — 정산 화면 묶음과 캠페인 필터 줄이 같은 판정을 본다. campaignId로 좁히면 그 캠페인만.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const campaignId = new URL(req.url).searchParams.get('campaignId') ?? undefined;
  return NextResponse.json(await listPending(getSql(), new Date(), campaignId));
}
