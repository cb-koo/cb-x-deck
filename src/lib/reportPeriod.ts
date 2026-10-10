// 클라이언트 현황의 보고 기간(스펙 §2 개정 10-10) — 주간 = 캠페인 주차(campaignWeek.ts), 월간 = 달력 월.
// 바이럴 캠페인은 주 단위로 돌리고(세부 방향), 클라이언트 보고·예산은 월 단위(큰 방향)라 두 가지를 오간다.
// 주소에는 'w-2026-10-01'(주차 첫날) / 'm-2026-10'으로 남긴다. 기본값 = 끝난 가장 최근 기간.
import { campaignWeekOf, nextCampaignWeek, prevCampaignWeek, campaignWeekLabel, type CampaignWeek } from './campaignWeek.ts';

export type Period =
  | { kind: 'week'; start: string; end: string; days: number; week: CampaignWeek }
  | { kind: 'month'; start: string; end: string; days: number; year: number; month: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
function monthPeriod(year: number, month: number): Period {
  const start = `${year}-${pad(month)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { kind: 'month', start, end: `${year}-${pad(month)}-${pad(last)}`, days: last, year, month };
}
const weekPeriod = (w: CampaignWeek): Period => ({ kind: 'week', start: w.start, end: w.end, days: w.days, week: w });

/** 끝난 가장 최근 주차 / 달 */
export function defaultPeriod(kind: 'week' | 'month', today: string): Period {
  if (kind === 'week') return weekPeriod(prevCampaignWeek(campaignWeekOf(today)));
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return m === 1 ? monthPeriod(y - 1, 12) : monthPeriod(y, m - 1);
}

/** 주소 값 → 기간. 형식이 틀리거나 아직 시작 안 한 미래면 기본값(주간). */
export function parsePeriod(param: string | null | undefined, today: string): Period {
  const v = param ?? '';
  let p: Period | null = null;
  if (v.startsWith('w-') && DATE.test(v.slice(2))) p = weekPeriod(campaignWeekOf(v.slice(2)));
  const mm = v.match(/^m-(\d{4})-(\d{2})$/);
  if (mm && Number(mm[2]) >= 1 && Number(mm[2]) <= 12) p = monthPeriod(Number(mm[1]), Number(mm[2]));
  return p && p.start <= today ? p : defaultPeriod(v.startsWith('m-') ? 'month' : 'week', today);
}
export const periodParam = (p: Period) => (p.kind === 'week' ? `w-${p.start}` : `m-${p.start.slice(0, 7)}`);
export const periodLabel = (p: Period) => (p.kind === 'week' ? campaignWeekLabel(p.week) : `${p.year}년 ${p.month}월`);
/** 진행 중 = 끝나는 날이 오늘 이후(오늘 포함) — 판정하지 않는다 */
export const isInProgress = (p: Period, today: string) => p.end >= today;
export function stepPeriod(p: Period, dir: -1 | 1): Period {
  if (p.kind === 'week') return weekPeriod(dir < 0 ? prevCampaignWeek(p.week) : nextCampaignWeek(p.week));
  const m = p.month + dir;
  return m < 1 ? monthPeriod(p.year - 1, 12) : m > 12 ? monthPeriod(p.year + 1, 1) : monthPeriod(p.year, m);
}
/** 다음 기간으로 갈 수 있나 — 아직 시작 안 한 기간은 막는다(진행 중인 기간까지는 볼 수 있다) */
export const canStepNext = (p: Period, today: string) => stepPeriod(p, 1).start <= today;
/** 주간 ↔ 월간 전환 — 같은 시점이 보이도록(주 → 그 주의 달, 달 → 그 달 마지막 주차) */
export function switchKind(p: Period, kind: 'week' | 'month', today: string): Period {
  if (p.kind === kind) return p;
  if (kind === 'month') return monthPeriod(Number(p.start.slice(0, 4)), Number(p.start.slice(5, 7)));
  const last = campaignWeekOf(p.end < today ? p.end : today);
  return weekPeriod(last);
}
export { monthPeriod };
