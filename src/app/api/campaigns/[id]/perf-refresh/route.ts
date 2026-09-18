import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { fetchPost } from '@/lib/postMetrics';
import { listTrackedPostIdsForCampaign, appendSnapshot, markUnavailable } from '@/lib/trackingStore';

// 성과 [업데이트](캠페인 v2 §3-3) — 이 캠페인의 게시 확인된 작업에 붙은 게시물을 다시 조회해 스냅샷을 쌓는다.
// 비용 유발(게시물당 API 1회) — 버튼 opt-in(UX 원칙 6). 개별 실패는 건너뛰고 숫자로 돌려준다(틀린 기록보다 빈 기록, 트래킹 스펙).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const posts = await listTrackedPostIdsForCampaign(sql, id);
  let refreshed = 0, unavailable = 0, failed = 0;
  for (const p of posts) {
    const r = await fetchPost(p.tweetId);
    if (r.kind === 'error') { failed += 1; continue; }
    if (r.kind === 'unavailable') { await markUnavailable(sql, p.id); unavailable += 1; continue; }
    await appendSnapshot(sql, p.id, r.post.metrics, r.post.raw);
    refreshed += 1;
  }
  return NextResponse.json({ total: posts.length, refreshed, unavailable, failed });
}
