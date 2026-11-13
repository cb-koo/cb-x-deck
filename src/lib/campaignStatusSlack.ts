// 캠페인 현황 슬랙 공유의 글(스펙 2026-11-13 §4) — 순수 함수. 숫자는 전부 buildOverview가 만든 Overview에서 온다.
// 화면 수량 칸(OverviewTiles)도 tileDescriptions를 써서, 화면·이미지·메시지가 같은 말을 한다.
import type { Overview, OverviewTiles } from './campaignOverview.ts';
import { weekLabel } from './campaignListView.ts';
import { formatDateKo } from './campaignJudgment.ts';
import { kstDateTime } from './datetime.ts';

export type SlackBlock = Record<string, unknown>;
export const STATUS_SCHEDULE_NOTE = '월 18:00, 수목금 10:30에 보내요.';
const LIST_MAX = 3;   // 늦은 곳·세팅 전 이름은 3곳까지, 나머지는 '외 N곳'

const withMore = (items: string[], more: number) => items.join(', ') + (more > 0 ? `, 외 ${more}곳` : '');

// 수량 칸 보조 글 — 화면(OverviewTiles), 이미지, 메시지가 함께 쓴다
export function tileDescriptions(t: OverviewTiles): { planned: string; overdue: string; remaining: string | null } {
  return {
    planned: `캠페인 ${t.campaignCount}개${t.unsetCount > 0 ? `, ${t.unsetCount}개는 세팅 전` : ''}`,
    overdue: t.overdue > 0 ? withMore(t.overdueBy.map((o) => `${o.title} ${o.count}건`), t.overdueMore) : '없음',
    remaining: t.undated > 0 ? `예정일 미정 ${t.undated}건 포함` : null,
  };
}

// '11/12 (목) 10:30 기준' — 보내는 순간(한국 시각). formatDateKo는 '11/12 목'이라 요일만 괄호로 감싼다
export function sentAtLabel(sentAt: Date): string {
  const kst = kstDateTime(sentAt.toISOString());   // '2026-11-12 10:30'
  const [md, dow] = formatDateKo(kst.slice(0, 10)).split(' ');
  return `${md} (${dow}) ${kst.slice(11, 16)} 기준`;
}

const mrkdwn = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });

export function buildStatusMessage(
  o: Overview, sentAt: Date, opts: { pageUrl: string; imageFileId: string | null },
): { text: string; blocks: SlackBlock[] } {
  const week = weekLabel(o.week.weekStart);
  const t = o.tiles;
  const title = mrkdwn(`📊 *${week} 캠페인 현황*\n${sentAtLabel(sentAt)}`);
  const link = mrkdwn(`👉 <${opts.pageUrl}|캠페인 현황 열기>  캠페인별 게시물과 성과는 여기서 봐요`);
  const overdueText = t.overdue > 0 ? `예정일 지난 미게시 ${t.overdue}건` : '예정일 지난 미게시 없음';
  const text = `📊 ${week} 캠페인 현황: ${t.planned}건 중 ${t.posted}건 게시, ${overdueText}`;

  if (o.cards.length === 0) {
    return { text, blocks: [title, mrkdwn('이번 주에 시작한 주차 캠페인이 아직 없어요.'), link] };
  }

  const d = tileDescriptions(t);
  const pct = t.planned > 0 ? ` (${Math.round((t.posted / t.planned) * 100)}%)` : '';
  const unset = o.cards.filter((c) => c.status === 'unset').map((c) => c.title);
  const lines = [
    `✅ 게시 완료  *${t.posted} / ${t.planned}건*${pct}`,
    t.overdue > 0 ? `⏰ 예정일 지난 미게시  *${t.overdue}건*  ${d.overdue}` : '✅ 예정일 지난 미게시 없음',
    `🗓️ 남은 게시 예정  *${t.remaining}건*${d.remaining ? `  ${d.remaining}` : ''}`,
    ...(unset.length ? [`⚪ 세팅 전  *${unset.length}개*  ${withMore(unset.slice(0, LIST_MAX), unset.length - LIST_MAX)}`] : []),
  ];
  const blocks: SlackBlock[] = [title, mrkdwn(lines.join('\n')), link];
  if (opts.imageFileId) {
    blocks.push({ type: 'image', slack_file: { id: opts.imageFileId }, alt_text: `${week} 캠페인 현황: 계획 ${t.planned}건 중 ${t.posted}건 게시` });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `진행률이 높은 캠페인부터 보여줘요. 방문협찬(장기) 캠페인은 빠져 있어요. ${STATUS_SCHEDULE_NOTE}` }] });
  return { text, blocks };
}
