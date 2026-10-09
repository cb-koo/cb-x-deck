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

// ── 게시물 기준 시점 값(스펙 §10 비교 규칙, 10-09 데이터 확인) ──
// 북마크는 게시 3일이면 96%가 쌓이고 조회는 7일 내내 는다 → 북마크는 3일, 조회는 7일 값으로 비교한다.
// 아직 그 시점이 안 된 글은 '누적 비율'로 나눈 예상값(est). 마지막 측정이 게시 24시간 전이면 판정하지 않는다(measuring).
export const H_BOOKMARKS = 72;
export const H_VIEWS = 168;
export const MIN_MEASURE_H = 24;
export type Accrual = Array<{ h: number; views: number; bookmarks: number }>; // h 오름차순, 값 = 최종 대비 비율
/** 운영 측정 기록 중앙값(10-09, 33개 글) — 표본이 모자라는 구간은 이 값을 쓴다 */
export const ACCRUAL_DEFAULT: Accrual = [
  { h: 12, views: 0.51, bookmarks: 0.5 }, { h: 24, views: 0.61, bookmarks: 0.7 }, { h: 48, views: 0.78, bookmarks: 0.89 },
  { h: 72, views: 0.87, bookmarks: 0.96 }, { h: 120, views: 0.92, bookmarks: 1 },
];
/** h시간 시점의 누적 비율 — 표 사이는 직선 보간, 표 끝 뒤는 기준 시점에서 1이 되게 */
export function shareAt(acc: Accrual, h: number, key: 'views' | 'bookmarks'): number {
  const end = key === 'views' ? H_VIEWS : H_BOOKMARKS;
  const pts: Array<[number, number]> = [[0, 0], ...acc.map((a): [number, number] => [a.h, Math.min(1, a[key])]), [Math.max(end, acc[acc.length - 1]?.h ?? 0) + 1e-9, 1]];
  if (h >= pts[pts.length - 1][0]) return 1;
  for (let i = 1; i < pts.length; i++) {
    const [h0, s0] = pts[i - 1], [h1, s1] = pts[i];
    if (h <= h1) return s0 + ((s1 - s0) * (h - h0)) / (h1 - h0 || 1);
  }
  return 1;
}
/** 기준 시점 H의 값 — 앞뒤 측정이 있으면 보간, 뒤만 있으면 그 값, 앞만 있으면 누적 비율로 나눈 예상값 */
export function valueAtHorizon(points: Array<[number, number]>, H: number, key: 'views' | 'bookmarks', acc: Accrual): { value: number; est: boolean } | null {
  const pts = points.filter(([h, v]) => h >= 0 && v !== null && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  if (!pts.length) return null;
  const after = pts.find(([h]) => h >= H);
  const before = [...pts].reverse().find(([h]) => h < H);
  if (after && before) {
    const [h0, v0] = before, [h1, v1] = after;
    return { value: Math.round(v0 + ((v1 - v0) * (H - h0)) / (h1 - h0 || 1)), est: false };
  }
  if (after) return { value: after[1], est: false };
  const [h, v] = pts[pts.length - 1];
  return { value: Math.round(v / Math.max(0.05, shareAt(acc, h, key))), est: true };
}
