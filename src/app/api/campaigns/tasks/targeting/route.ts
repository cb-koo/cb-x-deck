import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listTargetingHandles } from '@/lib/campaignTaskStore';
import { normalizeTargetTweetUrl } from '@/lib/campaignTaskInput';

// "이 게시물을 이미 RT하기로 한 사람"(스펙 §4-2) — ?taskId= 또는 ?url=
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const p = new URL(req.url).searchParams;
  const taskId = p.get('taskId');
  const url = p.get('url');
  if (taskId && isUuidLike(taskId)) return NextResponse.json({ handles: await listTargetingHandles(getSql(), { taskId }) });
  const norm = url ? normalizeTargetTweetUrl(url) : null;
  if (norm) return NextResponse.json({ handles: await listTargetingHandles(getSql(), { tweetUrl: norm }) });
  return NextResponse.json({ handles: [] });
}
