import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';
import { fetchPost } from '@/lib/postMetrics';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { refreshCampaignPerf } from '@/lib/selfReplyDiscovery';

// 성과 [업데이트](캠페인 v2 §3-3) — 이 캠페인의 게시 확인된 작업에 붙은 게시물을 다시 조회해 스냅샷을 쌓는다.
// 지표는 게시물별 상세 조회로 재고, 작업당 본 게시물 스레드 조회 1회로 새 인플 본인 댓글을 찾아 붙인다(self-replies 스펙 §4 —
// 스레드 실패는 ↻를 막지 않는다, selfReplyDiscovery.refreshCampaignPerf).
// 비용 유발 — 버튼 opt-in(UX 원칙 6). 개별 실패는 건너뛰고 숫자로 돌려준다(틀린 기록보다 빈 기록, 트래킹 스펙).
// 게시물이 많은 캠페인은 순차 조회가 기본 실행 시간 상한을 넘을 수 있다 — reports/sync 크론과 같은 여유(M7).
export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 404 });
  // 클라이언트는 한 번만 만든다 — 키 누락·설정 오류는 게시물 하나하나의 '실패 N건'이 아니라 원인을 말하는 401로 끊는다
  // (check-posted 라우트와 같은 계약). 만들고 나면 개별 조회 실패는 아래에서 숫자로만 센다.
  let client;
  try {
    client = makeClient();
  } catch (e) {
    if (e instanceof GetxapiAuthError) return NextResponse.json({ error: 'GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액을 확인하세요' }, { status: 401 });
    throw e;
  }
  const c = client;
  const r = await refreshCampaignPerf(sql, id, {
    fetchPost: (tweetId) => fetchPost(tweetId, c),
    getTweetThread: (tweetId) => c.getTweetThread(tweetId),
  }, gate.member.id);
  return NextResponse.json(r);
}
