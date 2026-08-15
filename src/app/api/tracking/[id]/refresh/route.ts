import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { fetchPost } from '@/lib/postMetrics';
import { findTrackedPostById, markUnavailable, appendSnapshot } from '@/lib/trackingStore';

const FETCH_FAILED = '지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

// ok → 스냅샷 추가(+복귀 수용은 appendSnapshot이 처리) / unavailable → 시각 기록 /
// error → 아무것도 저장하지 않는다. 틀린 기록보다 빈 기록(스펙 §수집 레이어).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '추적 대상을 찾을 수 없어요' }, { status: 404 });
  const sql = getSql();
  const row = await findTrackedPostById(sql, id);
  if (!row) return NextResponse.json({ error: '추적 대상을 찾을 수 없어요' }, { status: 404 });

  const result = await fetchPost(row.tweetId);
  if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });
  if (result.kind === 'unavailable') await markUnavailable(sql, id);
  else await appendSnapshot(sql, id, result.post.metrics, result.post.raw);
  return NextResponse.json({ row: await findTrackedPostById(sql, id) });
}
