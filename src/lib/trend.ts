import type { PillarTopic } from './pillarTypes.ts';

export interface TrendTweet { tweetId: string; likes: number | null; createdAt: string | null; topicId: string | null }
export interface WeekBucket { weekStart: string; count: number; medianLikes: number }
export type Direction = 'up' | 'flat' | 'down';
export type Sufficiency = 'ok' | 'sparse' | 'insufficient';
export interface TopicTrendRow {
  topicId: string; label: string;
  recent: { count: number; medianLikes: number };
  previous: { count: number; medianLikes: number };
  direction: Direction;
  judgment: string;
}
export interface TrendPayload {
  weekly: WeekBucket[];            // 완성 주 8슬롯(달력 고정, 0건 주 포함), 오래된→최신
  partialWeek: WeekBucket | null;  // 현재(집계 중) 주 — 판정·비교 제외
  judgment: string | null;         // sufficiency='ok'이고 기준 주 2개 이상일 때만
  sufficiency: Sufficiency;
  dataWeeks: number;               // weekly 중 트윗이 있는 주 수
  topicTrends: TopicTrendRow[] | null; // 계정 컬럼 + 주제 분석 존재 시(라우트가 채움)
  capped?: boolean; // 조회 상한(2000건) 도달 — 오래된 주가 실제보다 적게 보일 수 있음(라우트가 채움)
}

const JST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
export const TREND_WINDOW_WEEKS = 8;

// ISO 시각 → 그 시각이 속한 주의 월요일(JST 달력) 'YYYY-MM-DD'. 파싱 불가 문자열은 ''(호출부가 제외).
export function weekStartJst(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return ''; // 비정상 문자열 — RangeError 크래시 대신 조용히 제외
  const d = new Date(ms + JST_MS); // UTC 게터가 JST 벽시계가 되도록 시프트
  const dow = (d.getUTCDay() + 6) % 7;          // 월=0 … 일=6
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}

export function addWeeks(weekStart: string, n: number): string {
  return new Date(Date.parse(weekStart + 'T00:00:00Z') + n * 7 * DAY_MS).toISOString().slice(0, 10);
}

export function median(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function bucket(tweets: TrendTweet[], weekStart: string): WeekBucket {
  return { weekStart, count: tweets.length, medianLikes: median(tweets.map((t) => t.likes ?? 0)) };
}

function groupByWeek(tweets: TrendTweet[]): Map<string, TrendTweet[]> {
  const m = new Map<string, TrendTweet[]>();
  for (const t of tweets) {
    if (!t.createdAt) continue;
    const w = weekStartJst(t.createdAt);
    if (!w) continue;
    if (!m.has(w)) m.set(w, []);
    m.get(w)!.push(t);
  }
  return m;
}

function direction(recent: number, base: number): Direction {
  if (base === 0) return recent > 0 ? 'up' : 'flat';
  const r = recent / base;
  if (r >= 1.5) return 'up';
  if (r <= 0.67) return 'down';
  return 'flat';
}

const POST_LABEL: Record<Direction, string> = { up: '늘어나는 중', flat: '유지', down: '줄어드는 중' };
const LIKE_LABEL: Record<Direction, string> = { up: '뜨거워지는 중이에요', flat: '비슷해요', down: '줄어드는 중이에요' };
const TOPIC_LABEL: Record<Direction, string> = { up: '뜨는 중', flat: '유지', down: '식는 중' };

export function computeWeeklyTrend(tweets: TrendTweet[], nowIso: string): Omit<TrendPayload, 'topicTrends'> {
  const currentWeek = weekStartJst(nowIso);
  const byWeek = groupByWeek(tweets);

  const weekly: WeekBucket[] = [];
  for (let i = TREND_WINDOW_WEEKS; i >= 1; i--) {
    const w = addWeeks(currentWeek, -i);
    weekly.push(bucket(byWeek.get(w) ?? [], w));
  }
  const partial = byWeek.get(currentWeek);
  const partialWeek = partial ? bucket(partial, currentWeek) : null;

  const withData = weekly.filter((b) => b.count > 0);
  const dataWeeks = withData.length;
  const sufficiency: Sufficiency =
    dataWeeks < 3 ? 'insufficient' : median(withData.map((b) => b.count)) < 5 ? 'sparse' : 'ok';

  const judgment = sufficiency === 'ok' ? weeklyJudgment(weekly) : null;
  return { weekly, partialWeek, judgment, sufficiency, dataWeeks };
}

// 완성 주 배열(오래된→최신)에서 판정 한 줄 — 최근 1주 vs 직전 최대 3주(트윗 있는 주만, 최소 2개) 평균.
// 파생값(원칙 4) — 추이 패널과 브리핑 수치 블록이 같은 규칙을 공유한다.
export function weeklyJudgment(weekly: WeekBucket[]): string | null {
  if (weekly.length < 2) return null;
  const recent = weekly[weekly.length - 1];
  const baseWeeks = weekly.slice(-4, -1).filter((b) => b.count > 0);
  if (baseWeeks.length < 2) return null;
  const avg = (f: (b: WeekBucket) => number) => baseWeeks.reduce((s, b) => s + f(b), 0) / baseWeeks.length;
  const postDir = direction(recent.count, avg((b) => b.count));
  const likeDir = direction(recent.medianLikes, avg((b) => b.medianLikes));
  return `게시량은 ${POST_LABEL[postDir]} · 반응은 ${LIKE_LABEL[likeDir]}`;
}

// 주제별 격주 비교: 최근 격주(현재 주 -2 ~ -1) vs 직전 격주(-4 ~ -3). 집계 중 주 제외, 남는 주 버림.
export function computeTopicTrend(tweets: TrendTweet[], topics: PillarTopic[], nowIso: string): TopicTrendRow[] {
  const currentWeek = weekStartJst(nowIso);
  const recentFrom = addWeeks(currentWeek, -2);
  const prevFrom = addWeeks(currentWeek, -4);
  const weekOf = (t: TrendTweet) => (t.createdAt ? weekStartJst(t.createdAt) : null);

  const rows: TopicTrendRow[] = [];
  for (const topic of topics) {
    const mine = tweets.filter((t) => t.topicId === topic.id);
    const recent = mine.filter((t) => { const w = weekOf(t); return w !== null && w >= recentFrom && w < currentWeek; });
    const previous = mine.filter((t) => { const w = weekOf(t); return w !== null && w >= prevFrom && w < recentFrom; });
    if (recent.length + previous.length === 0) continue;
    const r = { count: recent.length, medianLikes: median(recent.map((t) => t.likes ?? 0)) };
    const p = { count: previous.length, medianLikes: median(previous.map((t) => t.likes ?? 0)) };
    const dir = direction(r.medianLikes, p.medianLikes);
    rows.push({ topicId: topic.id, label: topic.label, recent: r, previous: p, direction: dir, judgment: TOPIC_LABEL[dir] });
  }
  rows.sort((a, b) => b.recent.medianLikes - a.recent.medianLikes);
  return rows;
}
