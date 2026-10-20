// X 업로드 현황 — 판정과 화면 문구(순수 함수). 스펙 docs/superpowers/specs/2026-10-20-owned-channels-x-uploads-design.md
// 화면·API가 여기서 만든 값을 그대로 보여 준다 — 라벨과 값을 한 곳에서 정해 어긋나지 않게(UX 원칙 4).
//
// 판정 기준은 "그 주(월~일, 한국)에 새 글이나 인용을 약속한 횟수만큼 올렸는가"다(koo 10-20).
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

/** 약속 횟수에 드는 글 — 새 글과 인용. RT·답글은 목록에만 보인다. */
export const countsTowardPromise = (k: PostKind): boolean => k === 'original' || k === 'quote';

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
  situation: string;                   // 상태 칩 — 짧은 명사형(koo 10-13·10-20): '3주 연속 미달' · '지난주 미달' · '1회 남음' · '달성' · '계정 확인 필요'
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
    headline: string;                  // 판단 한 줄(UX 원칙 3) — '4곳이 아직이에요. 그중 2곳은 지난주에도 미달이에요.'
    total: number; doneCount: number;
    pending: ThisWeekRow[]; done: ThisWeekRow[];
  };
  history: { weeks: string[]; rows: HistoryRow[] };
}

function situationFor(c: ChannelInput, cur: WeekCell, streak: number): { tone: Tone; text: string } {
  if (c.lastError === 'notFound' || c.lastError === 'accountChanged') return { tone: 'warn', text: '계정 확인 필요' };
  if (cur.state === 'beforeStart' && c.promiseStartedOn) return { tone: 'plain', text: `${md(c.promiseStartedOn)} 시작` };
  if (cur.met) return { tone: 'ok', text: '달성' };
  if (streak >= 2) return { tone: 'warn', text: `${streak}주 연속 미달` };
  if (streak === 1) return { tone: 'warn', text: '지난주 미달' };
  return { tone: 'plain', text: `${c.currentTarget - (cur.count ?? 0)}회 남음` };
}

function lastPostLabel(c: ChannelInput, now: number): string {
  let latest: string | null = null;
  for (const p of c.posts) if (countsTowardPromise(p.kind) && (!latest || p.postedAt > latest)) latest = p.postedAt;
  return latest ? relativeDay(latest, now) : '기록 없음';
}

function historySummary(cells: WeekCell[], streak: number): { summary: string; bad: boolean } {
  if (streak >= 2) return { summary: `${streak}주 연속 미달`, bad: true };
  const recorded = cells.filter((x) => x.met !== null);
  const n = recorded.length;
  const m = recorded.filter((x) => x.met).length;
  if (n === 0) return { summary: '기록 없음', bad: false };
  if (m === n) return { summary: n === cells.length ? `${n}주 모두 달성` : `시작 후 ${n}주 모두 달성`, bad: false };
  return { summary: `${m}/${n}주 달성`, bad: false };
}

/** 이번 주 판단 한 줄 — 판단 먼저, 근거는 짧게(koo 10-14 요약 서술 규칙) */
export function headlineFor(pending: ThisWeekRow[], doneCount: number): string {
  if (pending.length === 0) return doneCount > 0 ? '모든 곳이 이번 주 약속을 달성했어요.' : '';
  const warn = pending.filter((r) => r.tone === 'warn').length;
  const first = `${pending.length}곳이 아직이에요.`;
  return warn > 0 ? `${first} 그중 ${warn}곳은 지난주에도 미달이거나 계정 확인이 필요해요.` : first;
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
  const rows: Array<{ row: HistoryRow; streak: number }> = [];

  for (const c of inputs) {
    const cells = weeks.map((w) => weekCell(c, w, false));
    const streak = missedStreak(cells);
    const curCell = weekCell(c, cur, true);
    const accountBad = c.lastError === 'notFound' || c.lastError === 'accountChanged';
    const s = situationFor(c, curCell, streak);
    const staleNote = c.lastCollectedAt && kstYmd(c.lastCollectedAt) < today ? `${md(kstYmd(c.lastCollectedAt))} 기준` : null;
    const row: ThisWeekRow = {
      channelId: c.channelId, clientId: c.clientId, clientName: c.clientName, handle: c.handle,
      count: accountBad ? null : curCell.count, target: c.currentTarget,
      done: !accountBad && curCell.met === true, tone: s.tone, situation: s.text,
      lastPost: lastPostLabel(c, now), staleNote,
    };
    if (row.done) done.push(row);
    else {
      const latest = c.posts.filter((p) => countsTowardPromise(p.kind)).reduce((a, p) => (p.postedAt > a ? p.postedAt : a), '');
      pending.push({ row, streak: accountBad ? 1e9 : streak, lastAt: latest });
    }
    rows.push({ row: { channelId: c.channelId, clientId: c.clientId, clientName: c.clientName, handle: c.handle,
      target: c.currentTarget, cells, ...historySummary(cells, streak) }, streak });
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
      headline: headlineFor(pending.map((p) => p.row), done.length),
      total: inputs.length, doneCount: done.length,
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
}
export interface DetailWeek {
  weekStart: string; title: string; isCurrent: boolean; state: CellState;
  count: number | null; target: number | null; met: boolean | null;
  verdict: string;                     // 주 머리 오른쪽 한 줄 — '2 / 1회 달성' · '0 / 1회 미달' · '1 / 2회 진행' · '약속 전(글 2개)' 등
  posts: DetailPost[];
}
export interface ChannelDetail {
  channelId: string; clientId: string; clientName: string; handle: string; target: number;
  followers: { weeks: string[]; values: Array<number | null>; summary: string };
  weeks: DetailWeek[];                 // 이번 주부터 최근 순
  posts: DetailPost[];                 // 같은 기간 글 전부, 최근 순 — 표는 주차로 묶지 않고 주차를 열로 보인다(koo 10-20)
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** '10/18(토) 14:05' — 표의 게시 칸 */
function dayTime(instant: string): string {
  const k = new Date(new Date(instant).getTime() + KST_MS).toISOString();
  return `${mdDow(k.slice(0, 10))} ${k.slice(11, 16)}`;
}

export function weekVerdict(cell: WeekCell, isCurrent: boolean): string {
  if (cell.state === 'beforeRecord') return '기록 시작 전';
  if (cell.state === 'beforeStart') return `약속 전(글 ${cell.count}개)`;
  if (cell.state === 'noPromise') return `약속 없음(글 ${cell.count}개)`;
  const base = `${cell.count} / ${cell.target}회`;
  if (isCurrent) return cell.met ? `${base} 달성` : `${base} 진행`;
  return cell.met ? `${base} 달성` : `${base} 미달`;
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
  const weeks: DetailWeek[] = starts.map((w) => {
    const cell = weekCell(c, w, w === cur);
    const end = addWeeks(w, 1);
    const posts = c.posts
      .filter((p) => { const s = weekStartOf(p.postedAt); return s >= w && s < end; })
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
      .map((p) => ({ postId: p.postId, kind: p.kind, text: p.text, postedAt: p.postedAt, day: dayTime(p.postedAt),
        deletedNote: p.deletedAt ? `${md(kstYmd(p.deletedAt))}에 지워진 것을 확인했어요` : null,
        counted: countsTowardPromise(p.kind), weekLabel: campaignWeekLabel(kstYmd(p.postedAt)) }));
    const isCurrent = w === cur;
    return { weekStart: w, title: weekTitle(w), isCurrent, state: cell.state, count: cell.count, target: cell.target,
      met: isCurrent ? null : cell.met, verdict: weekVerdict(cell, isCurrent), posts };
  });

  // 팔로워 — 지난 8주 + 이번 주, 주마다 그 주 마지막 기록값
  const fw = [...starts].reverse();
  const values = fw.map((w) => {
    const end = addWeeks(w, 1);
    let best: ChannelSnapshot | null = null;
    for (const s of c.snapshots) if (s.capturedOn >= w && s.capturedOn < end && (!best || s.capturedOn > best.capturedOn)) best = s;
    return best?.followers ?? null;
  });
  return { channelId: c.channelId, clientId: c.clientId, clientName: c.clientName, handle: c.handle, target: c.currentTarget,
    followers: { weeks: fw, values, summary: followerSummary(values) }, weeks, posts: weeks.flatMap((w) => w.posts) };
}
