// 업데이트 소식 순수 로직 — 데이터(src/content/updates.ts)를 화면이 그릴 모양으로.
// 전부 순수 함수, 시계를 읽지 않는다(페이지가 정적 렌더라 '지금'은 빌드 시각이 되므로 — 스펙 §2).
import type { UpdateEntry } from '@/content/updates';

export type MonthGroup = { ym: string; label: string; entries: UpdateEntry[] };

/** 펼친 채로 보여줄 월 수 — "항목이 있는 최신 N개 월". 달력 기준(최근 90일)이 아니다. */
export const OPEN_MONTHS = 3;

/** href 안에서 마지막 방문 워크스페이스 id로 치환되는 토큰 */
export const WS_TOKEN = '{ws}';

/** date 내림차순. Array.prototype.sort는 안정 정렬이라 같은 날은 입력(파일) 순서가 유지된다. */
export function sortUpdates(entries: readonly UpdateEntry[]): UpdateEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date));
}

export function monthLabel(ym: string): string {
  return `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
}

/** 'YYYY-MM-DD' → '8월 5일'. 문자열이 이미 KST 달력일이라 시간대 변환이 없다(datetime.ts의 kstMonthDayKo는 인스턴트용). */
export function formatDay(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}

export function groupByMonth(entries: readonly UpdateEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of sortUpdates(entries)) {
    const ym = entry.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.ym === ym) last.entries.push(entry);
    else groups.push({ ym, label: monthLabel(ym), entries: [entry] });
  }
  return groups;
}

export function isMonthOpen(index: number): boolean {
  return index < OPEN_MONTHS;
}

/** 형식(YYYY-MM-DD)과 실제 달력 날짜를 모두 본다 — 2026-02-30 같은 오타를 테스트에서 잡기 위함. */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 토큰이 없으면 그대로, 있으면 wsId로 치환. wsId가 없으면 null — 갈 곳 없는 링크를 그리지 않기 위해
 * (거짓 어포던스 방지, 스펙 §3).
 */
export function resolveHref(href: string, wsId: string | null): string | null {
  if (!href.includes(WS_TOKEN)) return href;
  if (!wsId) return null;
  return href.split(WS_TOKEN).join(wsId);
}
