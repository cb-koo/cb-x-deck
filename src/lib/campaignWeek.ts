// 캠페인 주차 — 실제 운영 규칙(koo 10-10, 운영 캠페인 26개 확인): 월~일 주를 달이 바뀌는 날에서 자르고,
// 조각마다 그 날짜의 달에 속해 1일부터 N주차. 예: 9/28~9/30 = 9월5주차(3일), 10/1~10/4 = 10월1주차(4일).
// 월말이 월요일이면 하루짜리 주차도 생긴다(8/31 = 8월6주차) — 실제 캠페인으로 확인된 경우는 아직 없다.
// 한 달 = 그 달 주차들의 합 = 달력 월이라, 클라이언트 월간 보고·예산 기간과 그대로 맞는다.
// (09-28에 기록한 '목요일이 속한 달' 규칙은 실제 운영과 달라 이 규칙으로 바꿨다.)

const DAY = 864e5;
const t = (d: string) => Date.parse(d + 'T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const add = (d: string, n: number) => iso(t(d) + n * DAY);

export interface CampaignWeek { start: string; end: string; year: number; month: number; n: number; days: number }

const monthStart = (d: string) => d.slice(0, 8) + '01';
function monthEnd(d: string): string {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  return iso(Date.UTC(y, m, 0)); // 다음 달 0일 = 이번 달 말일
}
const mondayOf = (d: string) => add(d, -((new Date(t(d)).getUTCDay() + 6) % 7));

/** 그 날짜가 속한 캠페인 주차 */
export function campaignWeekOf(date: string): CampaignWeek {
  const mon = mondayOf(date), first = monthStart(date), last = monthEnd(date);
  const start = mon < first ? first : mon;
  const sun = add(mon, 6);
  const end = sun > last ? last : sun;
  const firstEnd = add(mondayOf(first), 6);              // 1일이 든 주의 일요일 = 1주차 끝
  const n = start === first ? 1 : 2 + Math.floor((t(start) - t(add(firstEnd, 1))) / (7 * DAY));
  return { start, end, year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)), n, days: (t(end) - t(start)) / DAY + 1 };
}
export const nextCampaignWeek = (w: CampaignWeek) => campaignWeekOf(add(w.end, 1));
export const prevCampaignWeek = (w: CampaignWeek) => campaignWeekOf(add(w.start, -1));

/** 한 달(1일~말일)의 캠페인 주차들 */
export function campaignWeeksInMonth(year: number, month: number): CampaignWeek[] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const out: CampaignWeek[] = [];
  for (let w = campaignWeekOf(first); w.month === month && w.year === year; w = nextCampaignWeek(w)) out.push(w);
  return out;
}
/** 그 주차를 끝으로 거꾸로 n개(오래된 순) */
export function campaignWeeksBack(last: CampaignWeek, n: number): CampaignWeek[] {
  const out = [last];
  while (out.length < n) out.unshift(prevCampaignWeek(out[0]));
  return out;
}
export const campaignWeekName = (w: CampaignWeek) => `${w.month}월${w.n}주차`;   // 캠페인 이름에 붙는 모양
export const campaignWeekLabel = (w: CampaignWeek) => `${w.month}월 ${w.n}주차`;  // 화면 표기
