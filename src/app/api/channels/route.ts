import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listChannelInputs, countUncheckedChannels } from '@/lib/ownedChannelStore';
import { buildChannelsView } from '@/lib/ownedChannels';

// X 업로드 현황 화면 데이터 — 이번 주·지난 8주 판정과 문구를 서버에서 만들어 보낸다(스펙 2026-10-20 §2-1)
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const now = Date.now();
  const [inputs, unchecked] = await Promise.all([listChannelInputs(sql, now), countUncheckedChannels(sql)]);
  return NextResponse.json({ view: buildChannelsView(inputs, now), unchecked });
}
