import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { collectAll } from '@/lib/ownedChannelCollect';
import { listChannelInputs, countUncheckedChannels } from '@/lib/ownedChannelStore';
import { buildChannelsView } from '@/lib/ownedChannels';

// 화면의 ↻ — 점검 대상 전부를 지금 다시 받는다(스펙 2026-10-20 §4-1). 비용이 드는 동작이라 누를 때만.
// 1분 안에 받은 계정은 건너뛴다(연타·동시 클릭으로 같은 호출이 겹치지 않게).
export const maxDuration = 60;

const DEADLINE_MS = 45_000;
const SKIP_RECENT_MS = 60_000;

export async function POST() {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  try {
    await collectAll(sql, makeClient({ maxRetries: 1, usagePrefix: 'channels' }), { deadlineAt: Date.now() + DEADLINE_MS, skipRecentMs: SKIP_RECENT_MS });
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'X 데이터를 받지 못했어요 — 관리자에게 알려 주세요(API 잔액 확인)' }, { status: 502 });
    throw e;
  }
  const now = Date.now();
  const [inputs, unchecked] = await Promise.all([listChannelInputs(sql, now), countUncheckedChannels(sql)]);
  return NextResponse.json({ view: buildChannelsView(inputs, now), unchecked });
}
