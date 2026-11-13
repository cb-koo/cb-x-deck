import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getCampaignOverview } from '@/lib/campaignOverviewStore';
import { sendCampaignStatus, authorize, pickChannel } from '@/lib/campaignStatusSend';
import { renderStatusPng } from '@/lib/statusImage/render';
import { uploadPrivateImage, postBlocks } from '@/lib/slackUpload';

// 캠페인 현황 슬랙 공유(스펙 2026-11-13 §6) — DB 예약 실행(scripts/campaign-status-slack-cron.sql)이 월 18:00, 수목금 10:30에 부른다.
// 로그인 대신 예약 실행 시크릿으로 막는다(settlement auto-send와 같은 MEASURE_CRON_SECRET). 본문 { channel }로 테스트 채널에 보낼 수 있다(허용 목록만).
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = authorize(req, process.env.MEASURE_CRON_SECRET);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { channel?: unknown };
  const channel = pickChannel(body, process.env.SLACK_STATUS_CHANNEL);
  if (typeof channel !== 'string') return channel;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: 'SLACK_BOT_TOKEN not configured' }, { status: 500 });

  const sql = getSql();
  try {
    const r = await sendCampaignStatus(channel, {
      now: () => new Date(),
      loadOverview: () => getCampaignOverview(sql, null),
      renderPng: renderStatusPng,
      upload: (png) => uploadPrivateImage(token, png, 'campaign-status.png', '캠페인 현황'),
      post: (ch, msg) => postBlocks(token, ch, msg),
      log: (m) => console.warn(m),
    });
    return NextResponse.json(r);
  } catch (e) {
    // 토큰은 오류 메시지에 들어가지 않는다(slackUpload가 보장) — 원인만 남긴다
    const message = e instanceof Error ? e.message : String(e);
    console.error(`campaign-status-slack failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
