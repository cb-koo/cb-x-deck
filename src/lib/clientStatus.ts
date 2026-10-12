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
  weekDays?: number[];               // 주차마다 일수(캠페인 주차는 달 경계에서 잘려 3~7일) — 없으면 모두 7일
  days4?: number; daysPrev4?: number; // 최근 4주차·직전 4주차의 일수 — 길이가 다르면 하루 평균으로 비교
  reservers4: number; reserversPrev4: number;
  posts2w: number;                    // 최근 2주 X 게시 수
  // 결과 구간(v2) — 없으면 그 점검은 건너뛴다
  revenue4?: number; revenuePrev4?: number;   // 예약 매출(접수일 기준) 최근 4주·직전 4주
  roas4?: number | null;                      // 작업 비용 대비 매출(4주) — 비용 0이면 null
  lostRate?: number | null;                   // 불발률 — 불발이 정리된 주(2주 이상 지난 4주)만
}
// 판정은 '캠페인을 어떻게 할지'. 퍼널의 다른 구간 신호는 점검(check)으로 따로 붙여 '어디를 볼지'를 알려 준다.
export type Stage = 'campaign' | 'conversion' | 'result';
export const STAGE_LABEL: Record<Stage, string> = { campaign: '캠페인', conversion: '전환', result: '결과' };
export interface Check { stage: Stage; text: string }
export interface Suggestion { decision: Decision; reason: string; inflowVerdict: Verdict | null; band: [number, number] | null; checks: Check[] }

export const RULE_MIN_WEEKS = 4;
export const RULE_RESERVE_MIN_PREV = 4;
export const RULE_LOST_RATE = 0.4;        // 불발률이 이 이상이면 전환 점검(v2 출발값 — 몇 주 써 보며 다듬는다)
export const RULE_LOST_MIN = 5;           // 불발률은 예약이 이만큼은 있어야 본다
export const RULE_REVENUE_MIN_PREV = 1_000_000;

/** 판정 규칙 v2 — 위에서부터 처음 맞는 규칙이 판정, 점검은 해당하는 것 전부(스펙 §5). */
export function suggestDecision(i: VerdictInput): Suggestion {
  const checks = stageChecks(i);
  const known = i.newInflow.filter((v): v is number => v !== null);
  if (known.length < RULE_MIN_WEEKS) return { decision: 'hold', reason: `판단할 데이터가 ${RULE_MIN_WEEKS}주 미만이에요`, inflowVerdict: null, band: null, checks };
  // 짧은 주차(3~4일)가 늘 '평소보다 적음'이 되지 않게 7일 환산(값 × 7 ÷ 일수)으로 본다. 꽉 찬 주는 그대로라 band도 주 단위.
  const rates = per7(i.newInflow, i.weekDays);
  const band = normalRange(rates.slice(-8));
  const last = rates[rates.length - 1], prev = rates[rates.length - 2];
  const vLast = last === null ? null : verdictOf(last, band);
  const vPrev = prev === null || prev === undefined ? null : verdictOf(prev, band);
  const out = (decision: Decision, reason: string, extra: Check[] = []): Suggestion => ({ decision, reason, inflowVerdict: vLast, band, checks: [...extra, ...checks] });
  if (vLast === 'below' && vPrev === 'below') return out('adjust', '신규 인입이 2주 연속 평소보다 적어요', [{ stage: 'campaign', text: '인입 감소' }]);
  const d4 = i.days4 ?? 28, dPrev = i.daysPrev4 ?? 28;
  if (i.reserversPrev4 >= RULE_RESERVE_MIN_PREV && (i.reservers4 / d4) * 2 <= i.reserversPrev4 / dPrev) {
    // 사람은 오는데 예약만 줄었다면 캠페인 문제가 아니다 — 캠페인은 유지하고 상담→예약을 점검
    if (vLast === 'above' || vLast === 'normal') return out('keep', '지난주 인입은 평소 이상인데, 최근 4주 예약이 직전 4주의 절반 이하예요', [{ stage: 'conversion', text: '예약 전환 점검' }]);
    return out('adjust', '신규 인입과 예약이 함께 줄었어요', [{ stage: 'campaign', text: '인입·예약 감소' }]);
  }
  if (i.posts2w === 0) return out('watch', 'X 게시가 2주째 없어요', [{ stage: 'campaign', text: '게시 없음' }]);
  if (vLast === 'above') return out('keep', '신규 인입이 평소보다 많아요');
  return out('keep', '평소 범위예요');
}

/** 판정과 별개인 구간 점검 — 전환(불발)·결과(매출·비용) */
/** 주차별 값 → 7일 환산(값 × 7 ÷ 그 주차 일수). 일수가 없거나 7이면 그대로. */
export function per7(values: Array<number | null>, days?: number[]): Array<number | null> {
  return values.map((v, k) => { const d = days?.[k] ?? 7; return v === null ? null : d === 7 ? v : Math.round(((v * 7) / d) * 10) / 10; });
}

function stageChecks(i: VerdictInput): Check[] {
  const c: Check[] = [];
  const d4 = i.days4 ?? 28, dPrev = i.daysPrev4 ?? 28;
  if (i.lostRate !== undefined && i.lostRate !== null && i.lostRate >= RULE_LOST_RATE) c.push({ stage: 'conversion', text: `불발 ${Math.round(i.lostRate * 100)}%` });
  if (i.revenue4 !== undefined && i.revenuePrev4 !== undefined && i.revenuePrev4 >= RULE_REVENUE_MIN_PREV && (i.revenue4 / d4) * 2 <= i.revenuePrev4 / dPrev) c.push({ stage: 'result', text: '매출 절반 이하' });
  if (i.roas4 !== undefined && i.roas4 !== null && i.roas4 < 1) c.push({ stage: 'result', text: '비용보다 매출 적음' });
  return c;
}

// ── 주별 집계 ──
export interface PostLite { date: string; views: number | null; bookmarks: number | null }
export interface CostLite { date: string; krw: number }
/** 게시물·비용을 주차(시작~끝 날짜)별로 묶는다. 범위 밖은 버린다. 주차는 오래된 순. */
export function weeklyX(weeks: Array<{ start: string; end: string }>, posts: PostLite[], costs: CostLite[]) {
  const at = (d: string) => weeks.findIndex((w) => d >= w.start && d <= w.end);
  const n = weeks.length;
  const views = Array<number>(n).fill(0), bookmarks = Array<number>(n).fill(0), postCount = Array<number>(n).fill(0), cost = Array<number>(n).fill(0);
  for (const p of posts) { const i = at(p.date); if (i < 0) continue; postCount[i]++; views[i] += p.views ?? 0; bookmarks[i] += p.bookmarks ?? 0; }
  for (const c of costs) { const i = at(c.date); if (i >= 0) cost[i] += c.krw; }
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

// ── 예약 상태(접수일 기준) ──
export interface StatusCounts { visited: number; confirmed: number; reviewing: number; lost: number; cancelled: number; noshow: number }
export const countTotal = (c: StatusCounts) => c.visited + c.confirmed + c.reviewing + c.lost + c.cancelled + c.noshow;

// ── 판정 확정 때 본 숫자(스냅샷, koo 10-10) — 예약 데이터는 나중에 바뀌므로(불발 표시·취소) 그때 숫자를 남겨 '당시 vs 지금'으로 돌아본다 ──
export interface ReviewSnapshot {
  newInflow: number | null; days: number;          // 그 주차 신규 인입·일수
  reservers4: number; revenue4: number;            // 최근 4주차
  roas4: number | null; lostRate: number | null;
  checks: Check[]; reason: string;
}

// ── 월 방향(큰 방향, 클라이언트 월간 보고에 맞춤 — koo 10-10) ──
export type Direction = 'expand' | 'keep' | 'shrink' | 'pivot';
export const DIRECTIONS: Direction[] = ['expand', 'keep', 'shrink', 'pivot'];
export const DIRECTION_LABEL: Record<Direction, string> = { expand: '확대', keep: '유지', shrink: '축소', pivot: '전환' };
export const DIRECTION_HELP: Record<Direction, string> = {
  expand: '예산·물량을 늘림', keep: '지금 규모 그대로', shrink: '예산·물량을 줄임', pivot: '방식 자체를 바꿈(콘텐츠 방향·채널 등)',
};
export const isDirection = (v: unknown): v is Direction => v === 'expand' || v === 'keep' || v === 'shrink' || v === 'pivot';
export interface MonthSnapshot { newInflow: number | null; revenue: number | null; roas: number | null; budgetUsed: number | null; weekVerdicts: Partial<Record<Decision, number>> }
