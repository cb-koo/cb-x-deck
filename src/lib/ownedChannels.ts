// X 업로드 현황 — 판정과 화면 문구(순수 함수). 스펙 docs/superpowers/specs/2026-10-20-owned-channels-x-uploads-design.md
// 화면·API가 여기서 만든 값을 그대로 보여 준다 — 라벨과 값을 한 곳에서 정해 어긋나지 않게(UX 원칙 4).
//
// 판정 기준은 "그 주(월~일, 한국)에 새 글을 약속한 횟수만큼 올렸는가"다(koo 10-20 — 인용·RT·답글은 세지 않는다).
// - 지운 글도 그 주에 올린 글로 센다 — 올린 시점에 약속은 지켜졌다. 지워짐은 표시만 한다.
// - 지난 주는 그 주의 약속(owned_channel_week)으로 판정한다 — 나중에 약속을 바꿔도 지난 판정이 흔들리지 않게.
import { str, toIso } from './mappers.ts';

export type PostKind = 'original' | 'quote' | 'retweet' | 'reply';

export const HISTORY_WEEKS = 8;
const KST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

// ─────────────────────────── 글 종류 ───────────────────────────

/** getxapi 글 하나 → 종류. RT를 먼저 본다(RT 원문이 인용·답글이어도 우리 쪽 행동은 RT). 스레드 이어 쓰기도 답글이다 — 스레드 하나 = 1회. */
export function classifyPost(raw: Record<string, unknown>): PostKind {
  if (raw.retweeted_tweet) return 'retweet';
  if (str(raw.inReplyToId) || raw.isReply === true) return 'reply';
  if (raw.quoted_tweet) return 'quote';
  return 'original';
}

/** 약속 횟수에 드는 글 — 새 글만(koo 10-20). 인용·RT·답글은 패널의 '다른 유형도'에서만 보인다. */
export const countsTowardPromise = (k: PostKind): boolean => k === 'original';

export interface ParsedPost { postId: string; kind: PostKind; text: string; postedAt: string; pinned: boolean }

// X 응답 본문은 &amp; 같은 HTML 표기로 온다(실호출 확인 10-20) — 패널에 그대로 보이지 않게 흔한 다섯 개만 푼다
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export const decodeEntities = (t: string) => t.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);

export function parsePost(raw: Record<string, unknown>): ParsedPost | null {
  const postId = str(raw.id);
  const postedAt = toIso(raw.createdAt);
  if (!postId || !postedAt) return null;
  return { postId, kind: classifyPost(raw), text: decodeEntities(str(raw.text) ?? '').replace(/\u0000/g, ''), postedAt, pinned: raw.isPinned === true };
}

// ─────────────────────────── 주와 날짜(한국) ───────────────────────────

/** 순간 → 한국 날짜 'YYYY-MM-DD'. */
export function kstYmd(instant: string | number | Date): string {
  return new Date(new Date(instant).getTime() + KST_MS).toISOString().slice(0, 10);
}

/** 순간 → 그 순간이 속한 주의 월요일(한국 달력) 'YYYY-MM-DD'. */
export function weekStartOf(instant: string | number | Date): string {
  const d = new Date(new Date(instant).getTime() + KST_MS);
  const dow = (d.getUTCDay() + 6) % 7;            // 월=0 … 일=6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}

export function addWeeks(weekStart: string, n: number): string {
  return new Date(Date.parse(weekStart + 'T00:00:00Z') + n * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** 한국 날짜 00:00이 가리키는 순간. 수집 범위(지난주 월요일부터)를 정할 때 쓴다. */
export function kstMidnight(ymd: string): Date {
  return new Date(Date.parse(ymd + 'T00:00:00Z') - KST_MS);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const mdDow = (ymd: string) => `${md(ymd)}(${DOW[new Date(ymd + 'T00:00:00Z').getUTCDay()]})`;

/** '9/26(25일 전)' · '10/20(어제)' · '10/21(오늘)' — 화면에 `·`로 잇지 않는다(koo 10-20). */
export function relativeDay(instant: string, now: number): string {
  const day = kstYmd(instant);
  const n = daysBetween(day, kstYmd(now));
  const rel = n <= 0 ? '오늘' : n === 1 ? '어제' : `${n}일 전`;
  return `${md(day)}(${rel})`;
}

/** 주 머리 '10/20(월) ~ 26(일)' — 달이 바뀌면 '9/29(월) ~ 10/5(일)'. */
export function weekTitle(weekStart: string): string {
  const end = addWeeks(weekStart, 1);
  const sun = new Date(Date.parse(end + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
  const endLabel = sun.slice(5, 7) === weekStart.slice(5, 7) ? `${Number(sun.slice(8, 10))}(일)` : `${md(sun)}(일)`;
  return `${mdDow(weekStart)} ~ ${endLabel}`;
}

/**
 * 캠페인 주차 'N월 N주차' — 캠페인 운영 규칙(koo 10-10): 월~일 주를 달이 바뀌는 날에서 잘라, 그 날짜의 달에서 1일이 든 주부터 1주차.
 * 예: 9/28~30 = 9월 5주차, 10/1~4 = 10월 1주차, 10/5~11 = 10월 2주차.
 */
export function campaignWeekLabel(ymd: string): string {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10));
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;   // 1일의 요일(월=0)
  return `${m}월 ${Math.floor((d - 1 + firstDow) / 7) + 1}주차`;
}

/** 주 칸 머리 '9/15~21' · 달이 바뀌면 '9/28~10/4' — 칸이 무슨 기간인지 바로 읽히게(시작일만 쓰면 '9/15'가 하루로 읽힌다) */
export function weekRangeShort(weekStart: string): string {
  const sun = new Date(Date.parse(addWeeks(weekStart, 1) + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
  return `${md(weekStart)}~${sun.slice(5, 7) === weekStart.slice(5, 7) ? Number(sun.slice(8, 10)) : md(sun)}`;
}

/** 주 칸 머리 '9/15'. */
export const weekShort = (weekStart: string) => md(weekStart);

// ─────────────────────────── 입력 ───────────────────────────

export interface ChannelPost {
  postId: string; kind: PostKind; text: string; postedAt: string; deletedAt: string | null;
}
export interface ChannelSnapshot { capturedOn: string; followers: number }

/** 수집 실패 종류 — 'notFound'(계정 없음)·'accountChanged'(핸들 주인이 바뀜)는 0으로 세지 않고 경고한다. 'fetchFailed'는 일시 오류. */
export type CollectError = 'notFound' | 'accountChanged' | 'fetchFailed';

export interface ChannelInput {
  channelId: string;
  clientId: string;
  clientName: string;
  handle: string;
  currentTarget: number;               // 지금 약속(점검 대상만 들어온다)
  registeredAt: string;                // 채널 등록 시각 — 기록은 그 8주 전 월요일부터
  promiseStartedOn?: string | null;    // 약속 시작일(YYYY-MM-DD, 한국) — 그 날이 든 주부터 판정, 그 전 주는 글 수만 보인다
  accountCreatedAt: string | null;
  weekTargets: Array<{ weekStart: string; target: number | null }>;   // null = 그 주는 약속 없음(점검을 쉬었다)
  posts: ChannelPost[];
  snapshots: ChannelSnapshot[];
  lastCollectedAt: string | null;
  lastError: CollectError | null;
}

// ─────────────────────────── 주별 판정 ───────────────────────────

/** 칸 상태 — judged: 판정함 / beforeRecord: 기록 시작 전(글 수도 모름) / beforeStart: 약속 시작 전 / noPromise: 그 주 약속 없음 */
export type CellState = 'judged' | 'beforeRecord' | 'beforeStart' | 'noPromise';

export interface WeekCell {
  weekStart: string;
  state: CellState;
  count: number | null;                // null = 기록 시작 전('—')
  target: number | null;               // null = 그 주는 약속 없음 — 판정하지 않는다('—')
  met: boolean | null;
  deleted: number;                     // 센 글 중 지금 X에서 지워진 수
}

/** 기록이 있는 첫 주 — 등록 8주 전 월요일과 계정 개설 주 중 늦은 쪽. */
export function firstRecordedWeek(c: Pick<ChannelInput, 'registeredAt' | 'accountCreatedAt'>): string {
  const backfill = addWeeks(weekStartOf(c.registeredAt), -HISTORY_WEEKS);
  if (!c.accountCreatedAt) return backfill;
  const opened = weekStartOf(c.accountCreatedAt);
  return opened > backfill ? opened : backfill;
}

/**
 * 그 주의 약속 — 저장된 줄, 없으면 가장 가까운 앞 주(약속은 바꿀 때까지 이어진다), 앞 주가 없으면 가까운 뒤 주(등록 전 8주),
 * 그것도 없으면 지금 약속. 앞 주가 '약속 없음'(null)이면 그 뒤 빈 주도 약속 없음이다 — 쉬는 동안을 못 채움으로 보지 않게.
 */
export function targetForWeek(c: Pick<ChannelInput, 'weekTargets' | 'currentTarget'>, weekStart: string): number | null {
  let before: { weekStart: string; target: number | null } | null = null;
  let after: { weekStart: string; target: number | null } | null = null;
  for (const w of c.weekTargets) {
    if (w.weekStart === weekStart) return w.target;
    if (w.weekStart < weekStart && (!before || w.weekStart > before.weekStart)) before = w;
    if (w.weekStart > weekStart && (!after || w.weekStart < after.weekStart)) after = w;
  }
  if (before) return before.target;
  return after ? after.target : c.currentTarget;
}

/** 약속 시작일이 든 주의 월요일. 없으면 null(등록 8주 전부터 판정). */
export function promiseStartWeek(c: Pick<ChannelInput, 'promiseStartedOn'>): string | null {
  return c.promiseStartedOn ? weekStartOf(kstMidnight(c.promiseStartedOn)) : null;
}

export function weekCell(c: ChannelInput, weekStart: string, isCurrent: boolean): WeekCell {
  const startWeek = promiseStartWeek(c);
  const beforeStart = startWeek !== null && weekStart < startWeek;
  const target = beforeStart ? null : isCurrent ? c.currentTarget : targetForWeek(c, weekStart);
  if (weekStart < firstRecordedWeek(c)) return { weekStart, state: 'beforeRecord', count: null, target, met: null, deleted: 0 };
  const end = addWeeks(weekStart, 1);
  let count = 0, deleted = 0;
  for (const p of c.posts) {
    if (!countsTowardPromise(p.kind)) continue;
    const w = weekStartOf(p.postedAt);
    if (w < weekStart || w >= end) continue;
    count++;
    if (p.deletedAt) deleted++;
  }
  const state: CellState = beforeStart ? 'beforeStart' : target === null ? 'noPromise' : 'judged';
  return { weekStart, state, count, target, met: target === null ? null : count >= target, deleted };
}

/** 지난주까지 연속으로 못 채운 주 수. 기록 시작 전·약속 없는 주에서 멈춘다. */
export function missedStreak(cells: WeekCell[]): number {
  let k = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].met === false) k++;
    else break;
  }
  return k;
}

// ─────────────────────────── 화면 ───────────────────────────

export type Tone = 'warn' | 'plain' | 'ok';

export interface ThisWeekRow {
  channelId: string; clientId: string; clientName: string; handle: string;
  count: number | null;                // null = 계정 확인 실패('?')
  target: number;
  done: boolean;
  tone: Tone;
  flag: 'account' | 'missed' | 'deadline' | null;   // 주황인 이유 — 판단 한 줄이 이유별로 센다
  situation: string;                   // 상태 칩 — 짧은 명사형(koo 10-13·10-20): '3주 연속 미달' · '지난주 미달' · '1회 남음' · '완료' · '계정 확인 필요'
  lastPost: string;                    // '9/26(25일 전)' · '기록 없음'
  staleNote: string | null;            // 오늘 수집이 실패했을 때 '10/20 기준'
}

export interface HistoryRow {
  channelId: string; clientId: string; clientName: string; handle: string;
  target: number;                      // 지금 약속
  cells: WeekCell[];                   // 오래된 주 → 지난주
  summary: string;                     // '3주 연속 미달' · '8주 모두 달성' · '6/8주 달성'
  bad: boolean;
}

export interface ChannelsView {
  thisWeek: {
    weekStart: string; title: string; daysLeftLabel: string;
    checkedLabel: string | null;       // '오늘 07:00 기준' — 점검 대상이 없으면 null
    headline: string;                  // 판단 한 줄(UX 원칙 3) — '4곳이 아직이에요. 그중 2곳은 지난주에도 미달이에요. 1곳은 계정 확인이 필요해요.'
    total: number; doneCount: number;
    pending: ThisWeekRow[]; done: ThisWeekRow[];
    upcoming: ThisWeekRow[];           // 약속 시작일이 이번 주보다 뒤 — 판정 대상이 아니라 total·판단 한 줄에서 뺀다(리뷰 10-20)
  };
  history: { weeks: string[]; rows: HistoryRow[] };
}

/** 마감 임박 — 남은 날(오늘 포함)이 이만큼 이하인데 아직 남았으면 주황으로 올린다(토·일, koo 10-21) */
export const DEADLINE_DAYS = 2;

type Situation = { tone: Tone; text: string; flag: ThisWeekRow['flag'] };
function situationFor(c: ChannelInput, cur: WeekCell, streak: number, daysLeft: number): Situation {
  if (c.lastError === 'notFound' || c.lastError === 'accountChanged') return { tone: 'warn', text: '계정 확인 필요', flag: 'account' };
  if (cur.state === 'beforeStart' && c.promiseStartedOn) return { tone: 'plain', text: `${md(c.promiseStartedOn)} 시작`, flag: null };
  // 이번 주는 '완료'(진행 중인 주라 해낸 일로), 지난 주 기록은 '달성/미달'(koo 10-21)
  if (cur.met) return { tone: 'ok', text: '완료', flag: null };
  // 연속 미달이 마감 임박보다 무겁다 — 둘 다면 연속 미달을 보인다
  if (streak >= 2) return { tone: 'warn', text: `${streak}주 연속 미달`, flag: 'missed' };
  if (streak === 1) return { tone: 'warn', text: '지난주 미달', flag: 'missed' };
  const left = c.currentTarget - (cur.count ?? 0);
  // 지난주를 잘 지켰어도 주말까지 남았으면 놓치기 직전이다 — 회색 'N회 남음'으로 두면 눈에 안 띈다
  if (daysLeft <= DEADLINE_DAYS) return { tone: 'warn', text: `마감 임박(${left}회 남음)`, flag: 'deadline' };
  return { tone: 'plain', text: `${left}회 남음`, flag: null };
}

function lastPostLabel(c: ChannelInput, now: number): string {
  let latest: string | null = null;
  for (const p of c.posts) if (countsTowardPromise(p.kind) && (!latest || p.postedAt > latest)) latest = p.postedAt;
  return latest ? relativeDay(latest, now) : '기록 없음';
}

function historySummary(c: ChannelInput, cells: WeekCell[], streak: number): { summary: string; bad: boolean } {
  if (streak >= 2) return { summary: `${streak}주 연속 미달`, bad: true };
  const recorded = cells.filter((x) => x.met !== null);
  const n = recorded.length;
  const m = recorded.filter((x) => x.met).length;
  // 판정한 주가 없을 때 — 칸에는 글 수가 보이는데 '기록 없음'이라 하면 라벨과 값이 어긋난다(UX 원칙 4, 리뷰 10-20)
  if (n === 0) {
    if (cells.some((x) => x.state === 'beforeStart') && c.promiseStartedOn) return { summary: `${md(c.promiseStartedOn)}부터 판정`, bad: false };
    if (cells.some((x) => x.state === 'noPromise')) return { summary: '약속 없음', bad: false };
    return { summary: '기록 없음', bad: false };
  }
  if (m === n) {
    if (n === cells.length) return { summary: `${n}주 모두 달성`, bad: false };
    // 판정 안 한 주가 쉰 주(약속 없음)면 '시작 후'가 틀린 말이다
    return { summary: cells.some((x) => x.state === 'noPromise') ? `판정한 ${n}주 모두 달성` : `시작 후 ${n}주 모두 달성`, bad: false };
  }
  return { summary: `${m}/${n}주 달성`, bad: false };
}

/** 이번 주 판단 한 줄 — 판단 먼저, 근거는 짧게(koo 10-14 요약 서술 규칙) */
export function headlineFor(pending: ThisWeekRow[], doneCount: number, daysLeft = 7): string {
  if (pending.length === 0) return doneCount > 0 ? '모든 곳이 이번 주 업로드를 완료했어요.' : '';
  const account = pending.filter((r) => r.flag === 'account').length;
  const missed = pending.filter((r) => r.flag === 'missed').length;
  // 마감이 가까우면 그 사실을 먼저 — '아직'보다 '오늘이 마감'이 할 일을 바로 말한다
  const when = daysLeft <= 1 ? '오늘이 마감인데 ' : daysLeft <= DEADLINE_DAYS ? '마감까지 이틀, ' : '';
  const parts = [`${when}${pending.length}곳이 아직이에요.`];
  if (missed > 0) parts.push(`그중 ${missed}곳은 지난주에도 미달이에요.`);
  if (account > 0) parts.push(`${account}곳은 계정 확인이 필요해요.`);
  return parts.join(' ');
}

const byName = (a: { clientName: string }, b: { clientName: string }) => a.clientName.localeCompare(b.clientName, 'ko');

function checkedLabel(inputs: ChannelInput[], now: number): string | null {
  if (inputs.length === 0) return null;
  const times = inputs.map((c) => c.lastCollectedAt);
  if (times.some((t) => !t)) return '확인 전';
  const oldest = times.reduce((a, b) => (a! < b! ? a : b))!;
  const day = kstYmd(oldest);
  const hm = new Date(new Date(oldest).getTime() + KST_MS).toISOString().slice(11, 16);
  const today = kstYmd(now);
  const when = day === today ? '오늘' : daysBetween(day, today) === 1 ? '어제' : md(day);
  return `${when} ${hm} 기준`;
}

export function buildChannelsView(inputs: ChannelInput[], now: number): ChannelsView {
  const cur = weekStartOf(now);
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, i) => addWeeks(cur, i - HISTORY_WEEKS));
  const today = kstYmd(now);
  const daysLeft = 7 - daysBetween(cur, today);    // 오늘 포함

  const pending: Array<{ row: ThisWeekRow; streak: number; lastAt: string }> = [];
  const done: ThisWeekRow[] = [];
  const upcoming: ThisWeekRow[] = [];
  const rows: Array<{ row: HistoryRow; streak: number }> = [];

  for (const c of inputs) {
    const cells = weeks.map((w) => weekCell(c, w, false));
    const streak = missedStreak(cells);
    const curCell = weekCell(c, cur, true);
    const accountBad = c.lastError === 'notFound' || c.lastError === 'accountChanged';
    const s = situationFor(c, curCell, streak, daysLeft);
    const staleNote = c.lastCollectedAt && kstYmd(c.lastCollectedAt) < today ? `${md(kstYmd(c.lastCollectedAt))} 기준` : null;
    const row: ThisWeekRow = {
      channelId: c.channelId, clientId: c.clientId, clientName: c.clientName, handle: c.handle,
      count: accountBad ? null : curCell.count, target: c.currentTarget,
      done: !accountBad && curCell.met === true, tone: s.tone, flag: s.flag, situation: s.text,
      lastPost: lastPostLabel(c, now), staleNote,
    };
    if (curCell.state === 'beforeStart' && !accountBad) upcoming.push(row);
    else if (row.done) done.push(row);
    else {
      const latest = c.posts.filter((p) => countsTowardPromise(p.kind)).reduce((a, p) => (p.postedAt > a ? p.postedAt : a), '');
      pending.push({ row, streak: accountBad ? 1e9 : streak, lastAt: latest });
    }
    rows.push({ row: { channelId: c.channelId, clientId: c.clientId, clientName: c.clientName, handle: c.handle,
      target: c.currentTarget, cells, ...historySummary(c, cells, streak) }, streak });
  }

  // 이번 주: 계정 확인 실패 → 연속 미달 주 많은 순 → 남은 횟수 많은 순 → 마지막 글 오래된 순 → 이름
  const left = (r: ThisWeekRow) => r.target - (r.count ?? 0);
  pending.sort((a, b) => b.streak - a.streak || left(b.row) - left(a.row)
    || a.lastAt.localeCompare(b.lastAt) || byName(a.row, b.row));
  done.sort(byName);
  // 흐름: 지난주 미달 → 연속 미달 주 많은 순 → 이름
  const lastMissed = (r: HistoryRow) => (r.cells[r.cells.length - 1]?.met === false ? 1 : 0);
  rows.sort((a, b) => lastMissed(b.row) - lastMissed(a.row) || b.streak - a.streak || byName(a.row, b.row));

  return {
    thisWeek: {
      weekStart: cur, title: weekTitle(cur),
      daysLeftLabel: daysLeft <= 1 ? '오늘 마감' : `${daysLeft}일 남음`,
      checkedLabel: checkedLabel(inputs, now),
      headline: headlineFor(pending.map((p) => p.row), done.length, daysLeft),
      total: inputs.length - upcoming.length, doneCount: done.length, upcoming: upcoming.sort(byName),
      pending: pending.map((p) => p.row), done,
    },
    history: { weeks, rows: rows.map((r) => r.row) },
  };
}

// ─────────────────────────── 한 계정 자세히(오른쪽 패널) ───────────────────────────

export interface DetailPost {
  postId: string; kind: PostKind; text: string; postedAt: string;
  day: string;                         // '10/18(토) 14:05'
  deletedNote: string | null; counted: boolean;
  weekLabel: string;                   // 캠페인 주차 '10월 3주차' — 표의 주차 열
  isCurrentWeek: boolean;              // 이번 판정 주(월~일)의 글 — 표에서 배경색으로 구분(koo 10-20)
}
export interface ChannelDetail {
  channelId: string; clientId: string; clientName: string; handle: string; target: number;
  followers: { weeks: string[]; values: Array<number | null>; summary: string };
  posts: DetailPost[];                 // 이번 주 + 지난 8주 글 전부, 최근 순 — 표는 주차로 묶지 않고 주차를 열로 보인다(koo 10-20)
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** '10/18(토) 14:05' — 표의 게시 칸 */
function dayTime(instant: string): string {
  const k = new Date(new Date(instant).getTime() + KST_MS).toISOString();
  return `${mdDow(k.slice(0, 10))} ${k.slice(11, 16)}`;
}

export function followerSummary(values: Array<number | null>): string {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return '팔로워 추이는 2주 뒤부터 보여요';
  const first = pts[0], last = pts[pts.length - 1];
  const diff = last.v - first.v;
  const span = last.i - first.i;
  const weeksLabel = `${span}주 동안`;
  if (diff === 0) return `${weeksLabel} 변화가 없어요(${fmt(last.v)}명)`;
  const sign = diff > 0 ? '+' : '−';
  const avg = Math.round(Math.abs(diff) / span);
  return `${weeksLabel} ${sign}${fmt(Math.abs(diff))}명(${fmt(first.v)} → ${fmt(last.v)}), 주 평균 ${sign}${fmt(avg)}명${diff > 0 ? '이에요' : '으로 줄고 있어요'}`;
}

export function buildChannelDetail(c: ChannelInput, now: number): ChannelDetail {
  const cur = weekStartOf(now);
  const starts = Array.from({ length: HISTORY_WEEKS + 1 }, (_, i) => addWeeks(cur, -i));   // 이번 주 → 8주 전
  const from = starts[starts.length - 1];
  const posts: DetailPost[] = c.posts
    .filter((p) => weekStartOf(p.postedAt) >= from)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .map((p) => ({ postId: p.postId, kind: p.kind, text: p.text, postedAt: p.postedAt, day: dayTime(p.postedAt),
      deletedNote: p.deletedAt ? `${md(kstYmd(p.deletedAt))}에 지워진 것을 확인했어요` : null,
      counted: countsTowardPromise(p.kind), weekLabel: campaignWeekLabel(kstYmd(p.postedAt)),
      isCurrentWeek: weekStartOf(p.postedAt) === cur }));

  // 팔로워 — 지난 8주 + 이번 주, 주마다 그 주 마지막 기록값
  const fw = [...starts].reverse();
  const values = fw.map((w) => {
    const end = addWeeks(w, 1);
    let best: ChannelSnapshot | null = null;
    for (const s of c.snapshots) if (s.capturedOn >= w && s.capturedOn < end && (!best || s.capturedOn > best.capturedOn)) best = s;
    return best?.followers ?? null;
  });
  return { channelId: c.channelId, clientId: c.clientId, clientName: c.clientName, handle: c.handle, target: c.currentTarget,
    followers: { weeks: fw, values, summary: followerSummary(values) }, posts };
}
