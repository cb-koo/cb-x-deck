// 캠페인 목록(v2 왼쪽) 순수 규칙 — 스펙 2026-10-08-campaign-list-redesign §3. 화면·서버 공용(의존 없음).
import { addDays, daysBetweenDates, monthWeekOf, suggestCampaignName, weekStartOf } from './campaignJudgment.ts';
import type { CampaignProgress } from './campaignStore.ts';

export type CampaignDot = 'grey' | 'green' | 'yellow' | 'red';

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// 마감(085) — 사람이 정리 끝으로 표시한 캠페인. 작업과 무관하게 지난 캠페인으로 가고 점은 회색이다(koo 11-02).
type Closable = { closedAt?: string | null };
export const isClosed = (c: Closable): boolean => c.closedAt != null;
// 마감한 날(서울) 'YYYY-MM-DD'
const kstDateOf = (iso: string): string => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);

// 색 점(자동) + 툴팁 문장. 위에서부터 먼저 맞는 것(§3-3). 종료일 당일은 아직 끝난 게 아니다(campaignStatus와 같은 기준).
export function campaignDot(
  c: { startsOn: string; endsOn: string; progress: CampaignProgress } & Closable, today: string,
): { dot: CampaignDot; reason: string } {
  const { planned, posted, assigned, unassigned } = c.progress;
  if (isClosed(c)) {
    const open = assigned + unassigned;
    return { dot: 'grey', reason: open > 0 ? `마감했어요. 게시 안 된 작업 ${open}건` : '마감했어요' };
  }
  if (today < c.startsOn) return { dot: 'grey', reason: `${md(c.startsOn)}에 시작해요` };
  if (planned >= 1 && posted === planned) return { dot: 'green', reason: '모두 게시됐어요' };
  const open = assigned + unassigned;
  if (today > c.endsOn && open >= 1) return { dot: 'red', reason: `기간이 끝났는데 게시 안 된 작업 ${open}건` };
  if (open >= 1) {
    return { dot: 'yellow', reason: unassigned > 0 ? `미배정 ${unassigned}건 · 게시 대기 ${assigned}건` : `게시 대기 ${assigned}건` };
  }
  return { dot: 'grey', reason: '작업이 없어요' };
}

// 기간(끝−시작+1일)이 7일 초과면 장기
export function isLongCampaign(c: { startsOn: string; endsOn: string }): boolean {
  return daysBetweenDates(c.startsOn, c.endsOn) + 1 > 7;
}

// 기간이 끝났는데 게시 안 된 작업(배정+미배정, 취소 제외)이 남은 장기 캠페인 — 처리할 때까지 장기 섹션에 남는다(ISSUE-004, koo 11-02).
// 남은 작업을 게시 확인하거나 [✕ 진행 안 됨]으로 빼면 지난 캠페인으로 내려간다. 기간으로 자동 내려보내지 않는다(처리할 일 알림 역할).
export function isEndedLongPending(
  c: { startsOn: string; endsOn: string; progress: CampaignProgress } & Closable, today: string,
): boolean {
  return !isClosed(c) && isLongCampaign(c) && c.endsOn < today && c.progress.assigned + c.progress.unassigned > 0;
}

// 장기 섹션(주차 모드)·클라이언트 묶음의 진행 중 칸에 머무는가: 진행 중·예정인 장기 + 끝났지만 남은 작업이 있는 장기.
// 마감한 캠페인은 머물지 않는다.
export function staysInLongSection(
  c: { startsOn: string; endsOn: string; progress: CampaignProgress } & Closable, today: string,
): boolean {
  return !isClosed(c) && isLongCampaign(c) && (c.endsOn >= today || isEndedLongPending(c, today));
}

// 클라이언트 묶음에서 '진행 중·예정' 쪽인가 — 마감 안 했고, 종료 전이거나 끝났지만 남은 작업이 있는 장기
function isCurrentRow(c: { startsOn: string; endsOn: string; progress: CampaignProgress } & Closable, today: string): boolean {
  return !isClosed(c) && (c.endsOn >= today || isEndedLongPending(c, today));
}

const WEEKLY_SUFFIX = /^\d+월\d+주차$/;
// '{클라}_{M월N주차}'면 클라 이름만, 아니면 클라 이름 + 꼬리말('{클라}_'을 뗀 나머지). 클라이언트가 없으면 이름 전체.
// groupedByClient(클라이언트 묶음 안의 행): 묶음 제목이 클라이언트를 이미 말하므로 '{클라}_' 뒤 부분만 제목으로 쓴다.
// 접두어가 없거나 뗀 나머지가 비면 이름 전체.
export function campaignRowLabel(
  c: { name: string; clientName: string | null }, opts?: { groupedByClient?: boolean },
): { title: string; suffix: string | null } {
  const client = c.clientName?.trim();
  if (!client) return { title: c.name, suffix: null };
  const prefix = `${client}_`;
  if (opts?.groupedByClient) {
    const after = c.name.startsWith(prefix) ? c.name.slice(prefix.length).trim() : '';
    return { title: after || c.name, suffix: null };
  }
  // {클라}_ 규칙을 안 따르는 이름은 캠페인 이름만 — 클라이언트 이름을 앞에 또 붙이면 '미모드림 · 미모드림의원 …'처럼 겹친다(koo 10-08)
  if (!c.name.startsWith(prefix)) return { title: c.name.trim() || client, suffix: null };
  const rest = c.name.slice(prefix.length).trim();
  if (!rest || rest === client || WEEKLY_SUFFIX.test(rest)) return { title: client, suffix: null };
  return { title: client, suffix: rest };
}

export const weekKey = (date: string): string => weekStartOf(date);
// 캠페인 이름 규칙과 같은 목요일 판정(suggestCampaignName) — 클라이언트 없이 호출하면 'M월N주차'만 나온다.
export const weekName = (date: string): string => suggestCampaignName('', date);
// 화면 머리글용 띄어 쓴 표기 '11월 2주차' — 판정은 weekName과 같고 띄어쓰기만 다르다(캠페인 이름은 붙여 쓴다)
export function weekLabel(date: string): string {
  const { month, week } = monthWeekOf(date);
  return `${month}월 ${week}주차`;
}

export interface WeekGroup<T> { key: string; label: string; tone: 'current' | 'upcoming' | 'past'; rows: T[] }
export interface CampaignSections<T> { long: T[]; upcoming: WeekGroup<T>[]; past: WeekGroup<T>[] }

const ko = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '', 'ko');

export function campaignSections<T extends { name: string; clientName: string | null; startsOn: string; endsOn: string; progress: CampaignProgress } & Closable>(
  rows: T[], today: string,
): CampaignSections<T> {
  const thisWeek = weekKey(today);
  const nextWeek = addDays(thisWeek, 7) as string;
  const lastWeek = addDays(thisWeek, -7) as string;

  // 진행 중·예정 장기가 위(시작일순), 끝났는데 남은 작업이 있는 장기가 아래(먼저 끝난 순)
  const long = rows.filter((r) => staysInLongSection(r, today))
    .sort((a, b) => Number(a.endsOn < today) - Number(b.endsOn < today)
      || (a.endsOn < today ? a.endsOn.localeCompare(b.endsOn) : 0)
      || a.startsOn.localeCompare(b.startsOn) || ko(a.name, b.name));

  const byWeek = new Map<string, T[]>();
  for (const r of rows) {
    if (staysInLongSection(r, today)) continue;
    // 장기는 끝난 날의 주(기간 중에 마감했으면 마감한 날의 주), 주차 캠페인은 시작한 주
    let longKeyDate = r.endsOn;
    if (r.closedAt) { const d = kstDateOf(r.closedAt); if (d < longKeyDate) longKeyDate = d; }
    const key = weekKey(isLongCampaign(r) ? longKeyDate : r.startsOn);
    const list = byWeek.get(key) ?? [];
    list.push(r);
    byWeek.set(key, list);
  }
  const sortRows = (list: T[]) => [...list].sort((a, b) => ko(a.clientName ?? a.name, b.clientName ?? b.name) || a.startsOn.localeCompare(b.startsOn));
  const group = (key: string, label: string, tone: WeekGroup<T>['tone']): WeekGroup<T> =>
    ({ key, label, tone, rows: sortRows(byWeek.get(key) ?? []) });

  const upcoming = [
    group(thisWeek, `이번 주 · ${weekName(thisWeek)}`, 'current'),
    group(nextWeek, `다음 주 · ${weekName(nextWeek)}`, 'upcoming'),
    ...[...byWeek.keys()].filter((k) => k > nextWeek).sort().map((k) => group(k, weekName(k), 'upcoming')),
  ];
  const past = [...byWeek.keys()].filter((k) => k < thisWeek).sort().reverse()
    .map((k) => group(k, k === lastWeek ? `지난 주 · ${weekName(k)}` : weekName(k), 'past'));
  return { long, upcoming, past };
}

export interface ClientGroup<T> { key: string; label: string; open: boolean; rows: T[] }

// 클라이언트 묶기: 최근에 시작한 캠페인이 있는 클라이언트가 위, 묶음 안 최근 시작순, 진행 중·예정(종료 전)이 있으면 펼침.
export function campaignsByClient<T extends { clientId: string | null; clientName: string | null; name: string; startsOn: string; endsOn: string; progress: CampaignProgress } & Closable>(
  rows: T[], today: string,
): ClientGroup<T>[] {
  const map = new Map<string, ClientGroup<T>>();
  for (const r of rows) {
    const key = r.clientId ?? '__none__';
    const g = map.get(key) ?? { key, label: r.clientName ?? '클라이언트 없음', open: false, rows: [] };
    g.rows.push(r);
    if (isCurrentRow(r, today)) g.open = true;
    map.set(key, g);
  }
  const latest = (g: ClientGroup<T>) => g.rows.reduce((m, r) => (r.startsOn > m ? r.startsOn : m), '');
  const groups = [...map.values()];
  for (const g of groups) g.rows.sort((a, b) => b.startsOn.localeCompare(a.startsOn) || ko(a.name, b.name));
  return groups.sort((a, b) => latest(b).localeCompare(latest(a)) || ko(a.label, b.label));
}

// 클라이언트 묶음 안 나누기(시안 ClientMode): 마감한 캠페인은 항상 지난 쪽. 진행 중·예정(종료일 ≥ 오늘)이 먼저, 그 안에서 장기가 맨 위(나머지는 받은 순서 유지).
// 끝났지만 남은 작업이 있는 장기도 맨 위 장기 칸에 남는다(isEndedLongPending).
// 지난(종료일 < 오늘)은 받은 순서 그대로 — `지난` 라벨 아래 흐리게 그린다.
export function splitClientRows<T extends { startsOn: string; endsOn: string; progress: CampaignProgress } & Closable>(
  rows: T[], today: string,
): { current: T[]; past: T[] } {
  const isCurrent = (r: T) => isCurrentRow(r, today);
  const live = rows.filter(isCurrent);
  return {
    current: [...live.filter(isLongCampaign), ...live.filter((r) => !isLongCampaign(r))],
    past: rows.filter((r) => !isCurrent(r)),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
// 인플 핸들로도 찾는다(ISSUE-008, koo 11-03) — '@mina'·'mina' 둘 다. 핸들은 그 캠페인의 취소 안 된 작업에 배정된 인플.
export function matchesCampaignQuery(c: { name: string; clientName: string | null; influencerHandles?: string[] }, q: string): boolean {
  const n = norm(q);
  if (!n) return true;
  if (norm(c.name).includes(n) || norm(c.clientName ?? '').includes(n)) return true;
  const h = n.replace(/^@/, '');
  return !!h && (c.influencerHandles ?? []).some((x) => norm(x).includes(h));
}
/** 검색어가 이 캠페인의 인플 핸들에 걸렸으면 그 핸들(목록 줄에 '@핸들'로 보여 줘 왜 나왔는지 알게) — 이름·클라이언트로 걸렸으면 null. */
export function matchedHandle(c: { name: string; clientName: string | null; influencerHandles?: string[] }, q: string): string | null {
  const n = norm(q);
  if (!n || norm(c.name).includes(n) || norm(c.clientName ?? '').includes(n)) return null;
  const h = n.replace(/^@/, '');
  return (h && (c.influencerHandles ?? []).find((x) => norm(x).includes(h))) || null;
}
