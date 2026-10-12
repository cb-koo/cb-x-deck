// 캠페인 목록(v2 왼쪽) 순수 규칙 — 스펙 2026-10-08-campaign-list-redesign §3. 화면·서버 공용(의존 없음).
import { addDays, daysBetweenDates, suggestCampaignName, weekStartOf } from './campaignJudgment.ts';
import type { CampaignProgress } from './campaignStore.ts';

export type CampaignDot = 'grey' | 'green' | 'yellow' | 'red';

const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

// 색 점(자동) + 툴팁 문장. 위에서부터 먼저 맞는 것(§3-3). 종료일 당일은 아직 끝난 게 아니다(campaignStatus와 같은 기준).
export function campaignDot(
  c: { startsOn: string; endsOn: string; progress: CampaignProgress }, today: string,
): { dot: CampaignDot; reason: string } {
  const { planned, posted, assigned, unassigned } = c.progress;
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

export interface WeekGroup<T> { key: string; label: string; tone: 'current' | 'upcoming' | 'past'; rows: T[] }
export interface CampaignSections<T> { long: T[]; upcoming: WeekGroup<T>[]; past: WeekGroup<T>[] }

const ko = (a: string | null, b: string | null) => (a ?? '').localeCompare(b ?? '', 'ko');

export function campaignSections<T extends { name: string; clientName: string | null; startsOn: string; endsOn: string }>(
  rows: T[], today: string,
): CampaignSections<T> {
  const thisWeek = weekKey(today);
  const nextWeek = addDays(thisWeek, 7) as string;
  const lastWeek = addDays(thisWeek, -7) as string;

  const long = rows.filter((r) => isLongCampaign(r) && r.endsOn >= today)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || ko(a.name, b.name));

  const byWeek = new Map<string, T[]>();
  for (const r of rows) {
    const isLiveLong = isLongCampaign(r) && r.endsOn >= today;
    if (isLiveLong) continue;
    const key = weekKey(isLongCampaign(r) ? r.endsOn : r.startsOn); // 끝난 장기는 끝난 날의 주
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
export function campaignsByClient<T extends { clientId: string | null; clientName: string | null; name: string; startsOn: string; endsOn: string }>(
  rows: T[], today: string,
): ClientGroup<T>[] {
  const map = new Map<string, ClientGroup<T>>();
  for (const r of rows) {
    const key = r.clientId ?? '__none__';
    const g = map.get(key) ?? { key, label: r.clientName ?? '클라이언트 없음', open: false, rows: [] };
    g.rows.push(r);
    if (r.endsOn >= today) g.open = true;
    map.set(key, g);
  }
  const latest = (g: ClientGroup<T>) => g.rows.reduce((m, r) => (r.startsOn > m ? r.startsOn : m), '');
  const groups = [...map.values()];
  for (const g of groups) g.rows.sort((a, b) => b.startsOn.localeCompare(a.startsOn) || ko(a.name, b.name));
  return groups.sort((a, b) => latest(b).localeCompare(latest(a)) || ko(a.label, b.label));
}

// 클라이언트 묶음 안 나누기(시안 ClientMode): 진행 중·예정(종료일 ≥ 오늘)이 먼저, 그 안에서 장기가 맨 위(나머지는 받은 순서 유지).
// 지난(종료일 < 오늘)은 받은 순서 그대로 — `지난` 라벨 아래 흐리게 그린다.
export function splitClientRows<T extends { startsOn: string; endsOn: string }>(
  rows: T[], today: string,
): { current: T[]; past: T[] } {
  const live = rows.filter((r) => r.endsOn >= today);
  return {
    current: [...live.filter(isLongCampaign), ...live.filter((r) => !isLongCampaign(r))],
    past: rows.filter((r) => r.endsOn < today),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
export function matchesCampaignQuery(c: { name: string; clientName: string | null }, q: string): boolean {
  const n = norm(q);
  if (!n) return true;
  return norm(c.name).includes(n) || norm(c.clientName ?? '').includes(n);
}
