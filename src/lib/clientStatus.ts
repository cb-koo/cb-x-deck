// 클라이언트 현황 — 순수 계산(스펙 2026-10-09-client-status-design.md §3~5). DB는 clientStatusStore가 읽고, 여기서는 숫자만 다룬다.
// '평소'는 차트 키트 규칙 하나(charts/normal.ts), 게시 효과는 게시 묶음(charts/postGroups.ts).
import { normalRange, verdictOf, type Verdict } from '../components/charts/normal.ts';

const DAY = 864e5;
const t = (d: string) => Date.parse(d + 'T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(t(d) + n * DAY);

/** 그 날짜가 속한 주의 월요일(KST 날짜 문자열 기준) */
export function mondayOf(date: string): string {
  const dow = (new Date(t(date)).getUTCDay() + 6) % 7; // 월=0
  return addDays(date, -dow);
}
/** 기준 주 = 지난 완결 주(월~일). 오늘이 속한 주는 진행 중이라 쓰지 않는다. */
export function baseWeekStart(today: string): string { return addDays(mondayOf(today), -7); }
/** 기준 주까지 n주의 월요일(오래된 순) */
export function weekStarts(base: string, n: number): string[] { return Array.from({ length: n }, (_, i) => addDays(base, -7 * (n - 1 - i))); }
export const mdLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

// ── 판정 ──
export type Decision = 'keep' | 'watch' | 'adjust' | 'hold';
export const DECISION_LABEL: Record<Decision, string> = { keep: '유지', watch: '관찰', adjust: '조정 검토', hold: '판단 보류' };
export const DECISION_ORDER: Record<Decision, number> = { adjust: 0, watch: 1, hold: 2, keep: 3 };
export const isDecision = (v: unknown): v is Decision => v === 'keep' || v === 'watch' || v === 'adjust' || v === 'hold';

export interface VerdictInput {
  newInflow: Array<number | null>;   // 주별(오래된 순, 마지막 = 기준 주)
  reservers4: number; reserversPrev4: number;
  posts2w: number;                    // 최근 2주 X 게시 수
}
export interface Suggestion { decision: Decision; reason: string; inflowVerdict: Verdict | null; band: [number, number] | null }

export const RULE_MIN_WEEKS = 4;
export const RULE_RESERVE_MIN_PREV = 4;

/** 판정 규칙 v1 — 위에서부터 처음 맞는 규칙(스펙 §5). 기준값은 몇 주 써 보며 다듬는다. */
export function suggestDecision(i: VerdictInput): Suggestion {
  const known = i.newInflow.filter((v): v is number => v !== null);
  if (known.length < RULE_MIN_WEEKS) return { decision: 'hold', reason: `판단할 데이터가 ${RULE_MIN_WEEKS}주 미만이에요`, inflowVerdict: null, band: null };
  const band = normalRange(i.newInflow.slice(-8));
  const last = i.newInflow[i.newInflow.length - 1], prev = i.newInflow[i.newInflow.length - 2];
  const vLast = last === null ? null : verdictOf(last, band);
  const vPrev = prev === null || prev === undefined ? null : verdictOf(prev, band);
  if (vLast === 'below' && vPrev === 'below') return { decision: 'adjust', reason: '신규 인입이 2주 연속 평소보다 적어요', inflowVerdict: vLast, band };
  if (i.reserversPrev4 >= RULE_RESERVE_MIN_PREV && i.reservers4 * 2 <= i.reserversPrev4)
    return { decision: 'adjust', reason: '최근 4주 예약이 직전 4주의 절반 이하예요', inflowVerdict: vLast, band };
  if (i.posts2w === 0) return { decision: 'watch', reason: 'X 게시가 2주째 없어요', inflowVerdict: vLast, band };
  if (vLast === 'above') return { decision: 'keep', reason: '신규 인입이 평소보다 많아요', inflowVerdict: vLast, band };
  return { decision: 'keep', reason: '평소 범위예요', inflowVerdict: vLast, band };
}

// ── 주별 집계 ──
export interface PostLite { date: string; views: number | null; bookmarks: number | null }
export interface CostLite { date: string; krw: number }
/** 게시물·비용을 주(월요일)별로 묶는다. 범위 밖은 버린다. */
export function weeklyX(weeks: string[], posts: PostLite[], costs: CostLite[]) {
  const idx = new Map(weeks.map((w, i) => [w, i]));
  const n = weeks.length;
  const views = Array<number>(n).fill(0), bookmarks = Array<number>(n).fill(0), postCount = Array<number>(n).fill(0), cost = Array<number>(n).fill(0);
  for (const p of posts) { const i = idx.get(mondayOf(p.date)); if (i === undefined) continue; postCount[i]++; views[i] += p.views ?? 0; bookmarks[i] += p.bookmarks ?? 0; }
  for (const c of costs) { const i = idx.get(mondayOf(c.date)); if (i !== undefined) cost[i] += c.krw; }
  const costPerBookmark = cost.map((c, i) => (bookmarks[i] > 0 && c > 0 ? Math.round(c / bookmarks[i]) : null));
  return { views, bookmarks, postCount, cost, costPerBookmark };
}

/** 최근 4주 합과 그 직전 4주 합(값이 없는 주는 0으로 보지 않고 건너뛴다) */
export function sum4(values: Array<number | null>): { recent: number; prev: number } {
  const s = (a: Array<number | null>) => a.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  return { recent: s(values.slice(-4)), prev: s(values.slice(-8, -4)) };
}
