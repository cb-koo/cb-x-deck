// 캠페인 현황 슬랙 공유의 본체(스펙 2026-11-13 §6) — 라우트가 실제 의존성(DB·그리기·슬랙)을 넣어 부른다. 테스트는 가짜를 넣는다.
import type { Overview } from './campaignOverview.ts';
import { buildStatusMessage, type SlackBlock } from './campaignStatusSlack.ts';
import { holidayOn } from './koreanHolidays.ts';
import { kstDate } from './datetime.ts';

// 보낼 수 있는 채널 — 운영 채널(#f-x-채널-통합관리)과 테스트 채널(#test-channel). 그 밖은 거부해 잘못 나가는 일을 막는다
export const ALLOWED_CHANNELS = ['C0AD9E5HE1K', 'C0CGWSFBDPV'] as const;
export const STATUS_PAGE_URL = 'https://cb-x-deck.vercel.app/campaigns/overview';

export type SendDeps = {
  now: () => Date;
  loadOverview: () => Promise<Overview>;
  renderPng: (o: Overview, at: Date) => Promise<ArrayBuffer>;
  upload: (png: ArrayBuffer) => Promise<string>;
  post: (channel: string, msg: { text: string; blocks: SlackBlock[] }) => Promise<{ ts: string }>;
  log: (msg: string) => void;
};
export type SendResult =
  | { skipped: 'holiday'; name: string }
  | { sent: true; channel: string; ts: string; withImage: boolean; holidayListMissing?: true };

export async function sendCampaignStatus(channel: string, deps: SendDeps): Promise<SendResult> {
  const at = deps.now();
  const h = holidayOn(kstDate(at.toISOString()));
  if (h && h !== 'unknown-year') return { skipped: 'holiday', name: h.name };
  // 목록에 없는 해는 보낸다 — 못 보내는 것보다 보내는 쪽이 덜 해롭다. 대신 목록을 채우라는 흔적을 남긴다
  if (h === 'unknown-year') deps.log(`campaign-status-slack: ${at.getUTCFullYear()}년 공휴일 목록이 없어요 — src/lib/koreanHolidays.ts에 추가해 주세요`);

  const o = await deps.loadOverview();
  let imageFileId: string | null = null;
  if (o.cards.length > 0) {
    // 이미지가 실패해도 팀이 상황은 알 수 있게 글만이라도 보낸다
    try {
      imageFileId = await deps.upload(await deps.renderPng(o, at));
    } catch (e) {
      deps.log(`campaign-status-slack: 이미지 없이 보냄 — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const msg = buildStatusMessage(o, at, { pageUrl: STATUS_PAGE_URL, imageFileId });
  const { ts } = await deps.post(channel, msg);   // 실패는 그대로 던진다 — 자동 재전송은 중복 발송 위험
  return { sent: true, channel, ts, withImage: imageFileId !== null, ...(h === 'unknown-year' ? { holidayListMissing: true as const } : {}) };
}

// 예약 실행 인증 — 시크릿 미설정이면 전부 거부(fail-closed, settlement auto-send와 같은 계약)
export function authorize(req: Request, secret: string | undefined): Response | null {
  if (!secret) return Response.json({ error: 'MEASURE_CRON_SECRET not configured' }, { status: 401 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return null;
}

export function pickChannel(body: { channel?: unknown }, envChannel: string | undefined): string | Response {
  const ch = typeof body.channel === 'string' && body.channel ? body.channel : envChannel;
  if (!ch || !(ALLOWED_CHANNELS as readonly string[]).includes(ch)) {
    return Response.json({ error: 'channel not allowed' }, { status: 400 });
  }
  return ch;
}
