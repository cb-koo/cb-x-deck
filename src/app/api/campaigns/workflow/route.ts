import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { listCampaigns } from '@/lib/campaignStore';
import { listTasksByCampaigns, settlementByTaskIds } from '@/lib/campaignTaskStore';
import { blockedCount, type WorkflowInput } from '@/lib/campaignWorkflow';
import { kstToday } from '@/lib/datetime';

// 캠페인 목록 + 캠페인마다 '막힌 것 N건'(워크플로 스펙 §6-3). 읽기 전용 — 쓰기는 2단계.
// 캠페인마다 상세를 부르지 않기 위해 한 번에 모아 읽는다(작업 1회 + 정산 배지 1회).
// 마이그레이션 047 전이라 delivered_on·cancelled_on·draft_by가 없다 — null로 넣으면
// campaignWorkflow가 원고 상태를 대신 읽는다(§3-1·§4의 한계가 화면에 그대로 드러나야 한다).
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const sql = getSql();
  const today = kstToday();
  const campaigns = await listCampaigns(sql);
  const tasks = await listTasksByCampaigns(sql, campaigns.map((c) => c.id));
  const badges = await settlementByTaskIds(sql, tasks.map((t) => t.id));

  const byCampaign = new Map<string, WorkflowInput[]>();
  for (const t of tasks) {
    const badge = badges.get(t.id) ?? null;
    const input: WorkflowInput = {
      type: t.type, influencerHandle: t.influencerHandle,
      draftId: t.draftId, draftStatus: t.draftStatus, draftBy: null,
      targetTweetUrl: t.targetTweetUrl, target: t.target ? { postUrl: t.target.postUrl } : null,
      cost: t.cost, scheduledOn: t.scheduledOn,
      deliveredOn: null, postedAt: t.postedAt, cancelledOn: null,
      settlement: badge ? { status: badge.status, externalStatus: badge.externalStatus } : null,
    };
    const list = byCampaign.get(t.campaignId) ?? [];
    list.push(input);
    byCampaign.set(t.campaignId, list);
  }

  return NextResponse.json({
    today,
    campaigns: campaigns.map((c) => ({ ...c, blocked: blockedCount(byCampaign.get(c.id) ?? [], today) })),
  });
}
