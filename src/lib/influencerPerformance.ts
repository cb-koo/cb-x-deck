// 인플루언서 성과 비교 — 순수 계산(DB·네트워크 없음). 스펙 docs/superpowers/specs/2026-09-30-influencer-performance-design.md
// 저장소가 넘긴 "작업 + 작업별 최신 스냅샷 합"을 인플 1행으로 요약하고, 정렬·주소 쿼리를 맡는다. 화면이 전환·정렬 때 바로 부른다.
import { median } from './analysisStats.ts';
import { toKrw } from './clientBudget.ts';
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from './campaignJudgment.ts';
import type { TaskCost } from './campaignCost.ts';

export interface PerfTaskMetrics { postCount: number; views: number | null; likes: number | null; replies: number | null; bookmarks: number | null; retweets: number | null; quotes: number | null }
export interface PerfTask {
  id: string; campaignId: string; campaignName: string; type: TaskType; postedAt: string | null; postUrl: string | null;
  removedAt: string | null; removedReason: string;   // 게시 내림일·사유 — 있으면 성과 표본에서 뺀다(스펙 §12-4)
  clientId: string | null; clientName: string | null; // 캠페인의 클라이언트 스냅샷 — 클라이언트 필터용(스펙 §15-3)
  cost: TaskCost | null; metrics: PerfTaskMetrics | null;
}
export interface PerfInfluencerInput { handle: string; influencerId: string | null; displayName: string | null; avatarUrl: string | null; isBlueVerified: boolean | null; tasks: PerfTask[] }
export type MetricKey = 'views' | 'cpv' | 'engagement' | 'likes' | 'replies' | 'bookmarks' | 'retweets' | 'quotes';
export interface MetricStat { median: number | null; mean: number | null; n: number }
export interface PerfRow extends Omit<PerfInfluencerInput, 'tasks'> {
  campaignCount: number; lastPostedAt: string | null;
  typeCounts: Record<TaskType, number>;   // 게시된 작업만(스펙 §12-3) — 예정 작업은 안 센다
  stats: Record<MetricKey, MetricStat>; tasks: PerfTask[];
}
export type Agg = 'median' | 'mean';
export type SortKey = MetricKey | 'campaigns' | 'lastPosted' | 'n_post' | 'n_quoteRt' | 'n_rt' | 'n_visit';
export type SortDir = 'asc' | 'desc';

export const METRIC_KEYS: readonly MetricKey[] = ['views', 'cpv', 'engagement', 'likes', 'replies', 'bookmarks', 'retweets', 'quotes'];
// 자기 게시물이 있는 유형 — RT는 조회가 원글에 쌓여 인플 몫이 없다(스펙 §4-1)
export const CONTENT_TYPES: readonly TaskType[] = ['post', 'quoteRt', 'visit'];
const isContent = (t: PerfTask) => CONTENT_TYPES.includes(t.type);
// 게시됨 = 게시 확인일이나 게시물 링크가 있음(RT 포함 전 유형 같은 규칙, 스펙 §12-3)
export const isPosted = (t: PerfTask) => t.postedAt !== null || t.postUrl !== null;

// 참여율 — 공개 반응 5종 ÷ 조회. 하나라도 없으면 null(0으로 채우면 낮게 왜곡), 조회 0도 null.
export function taskEngagement(m: PerfTaskMetrics | null): number | null {
  if (!m || !m.views) return null;
  const parts = [m.likes, m.replies, m.bookmarks, m.retweets, m.quotes];
  if (parts.some((v) => v === null)) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0) / m.views;
}

// 조회당 비용(원) — 게시물 작업의 비용만. 엔화는 1엔=10원.
export function taskCpv(t: PerfTask): number | null {
  if (!isContent(t) || !t.cost || !t.metrics?.views) return null;
  return toKrw({ [t.cost.currency]: t.cost.amount }).krw / t.metrics.views;
}

function stat(values: Array<number | null>): MetricStat {
  const xs = values.filter((v): v is number => v !== null);
  return { median: median(xs), mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
}

export function summarizeInfluencer(inf: PerfInfluencerInput): PerfRow {
  const { tasks, ...who } = inf;
  const typeCounts: Record<TaskType, number> = { post: 0, quoteRt: 0, rt: 0, visit: 0 };
  const done = tasks.filter(isPosted);
  for (const t of done) typeCounts[t.type] += 1;
  const posted = tasks.map((t) => t.postedAt).filter((d): d is string => d !== null).sort();
  // 성과 표본 = 게시물 작업 중 조회가 수집됐고 내려가지 않은 것(스펙 §4-1·§12-4)
  const sample = tasks.filter((t) => isContent(t) && t.removedAt === null && t.metrics?.views != null);
  const pick = (k: 'likes' | 'replies' | 'bookmarks' | 'retweets' | 'quotes') => sample.map((t) => t.metrics![k]);
  const stats: Record<MetricKey, MetricStat> = {
    views: stat(sample.map((t) => t.metrics!.views)),
    cpv: stat(sample.map(taskCpv)),
    engagement: stat(sample.map((t) => taskEngagement(t.metrics))),
    likes: stat(pick('likes')), replies: stat(pick('replies')), bookmarks: stat(pick('bookmarks')),
    retweets: stat(pick('retweets')), quotes: stat(pick('quotes')),
  };
  const ordered = [...tasks].sort((a, b) =>
    a.postedAt === b.postedAt ? 0 : a.postedAt === null ? 1 : b.postedAt === null ? -1 : b.postedAt.localeCompare(a.postedAt));
  return {
    ...who,
    campaignCount: new Set(done.map((t) => t.campaignId)).size,
    lastPostedAt: posted.at(-1) ?? null,
    typeCounts,
    stats,
    tasks: ordered,
  };
}

// API 응답 = 게시된 작업이 1건 이상인 인플만(스펙 §12-3 대상 행) — 예정만 있는 인플은 비교할 게 없다
export function buildPerfRows(inputs: PerfInfluencerInput[]): PerfRow[] {
  return inputs.filter((inf) => inf.tasks.some(isPosted)).map(summarizeInfluencer);
}

// 펼친 작업 목록의 성과 자리에 무엇을 보일지(스펙 §5·§12-4) — 삭제됨이 가장 앞(수집 전보다 우선)
export type TaskPerfState = 'removed' | 'rt' | 'unposted' | 'uncollected' | 'ok';
export function taskPerfState(t: PerfTask): TaskPerfState {
  if (t.removedAt !== null) return 'removed';
  if (t.type === 'rt') return 'rt';
  if (!isPosted(t)) return 'unposted';
  if (t.metrics?.views == null) return 'uncollected';
  return 'ok';
}

// 부모 행 성과 칸이 전부 '—'일 때 그 이유 한 줄(스펙 §18-4) — 성과가 하나라도 있으면 null.
// 우선: 게시한 게시물 작업이 없음(RT만) > 삭제된 게시물 있음 > 수집 전. 조회 표본이 비면 성과 8칸이 모두 비므로 views.n으로 판정한다.
export function perfEmptyReason(r: PerfRow): string | null {
  if (r.stats.views.n > 0) return null;
  const content = r.tasks.filter((t) => isContent(t) && isPosted(t));
  if (content.length === 0) return 'RT만 진행해 성과가 없어요 — 조회는 원글에 쌓여요';
  if (content.some((t) => t.removedAt !== null)) return '게시물이 삭제됐어요';
  return '성과 수집 전이에요';
}

// 첫 클릭은 "좋은 쪽부터" — 조회당 비용만 싼 쪽이 좋다(스펙 §4)
export const firstDir = (key: SortKey): SortDir => (key === 'cpv' ? 'asc' : 'desc');

function sortValue(r: PerfRow, key: SortKey, agg: Agg): number | string | null {
  switch (key) {
    case 'campaigns': return r.campaignCount;
    case 'lastPosted': return r.lastPostedAt;
    case 'n_post': return r.typeCounts.post;
    case 'n_quoteRt': return r.typeCounts.quoteRt;
    case 'n_rt': return r.typeCounts.rt;
    case 'n_visit': return r.typeCounts.visit;
    default: return r.stats[key][agg];
  }
}

// 값 없음은 방향과 무관하게 맨 아래, 동점은 핸들 순(안정적인 순서)
export function sortPerfRows(rows: PerfRow[], key: SortKey, dir: SortDir, agg: Agg): PerfRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key, agg); const vb = sortValue(b, key, agg);
    if (va === null && vb === null) return a.handle.localeCompare(b.handle);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
    return c !== 0 ? sign * c : a.handle.localeCompare(b.handle);
  });
}

// ── 필터·검색(스펙 §15·§16·§17) ──
// ② 성과 범위 바꾸기(클라이언트·유형) = 작업을 먼저 거른 뒤 다시 집계 / ① 사람 좁히기(검색·최소 게시 수) = 행만 거른다
// 기간 필터는 뺐다(스펙 §17) — 작업 데이터가 9월 한 달뿐이라 30/60/90일이 전체와 같고 비교 기준이 안 된다.
// clientIds·types는 비면 전체, 선택 안 OR·필터 사이 AND. minPosted는 정규화된 정수 ≥1(1 = 필터 없음)
export interface PerfFilter { q: string; clientIds: string[]; types: TaskType[]; minPosted: number }
export const EMPTY_FILTER: PerfFilter = { q: '', clientIds: [], types: [], minPosted: 1 };
// 유형은 늘 표시 순서로 들고 다닌다 — 주소·요약 문구가 누른 순서에 따라 흔들리지 않게
const TYPE_ORDER: readonly TaskType[] = ['post', 'quoteRt', 'rt', 'visit'];

// 복수 선택 버튼·요약 문구 — 없음 '전체', maxListed개까지 나열, 넘으면 '첫 이름 외 N'(클라이언트 1·유형 2, 스펙 §16)
export function selectionLabel(names: string[], maxListed: number): string {
  if (names.length === 0) return '전체';
  if (names.length <= maxListed) return names.join(', ');
  return `${names[0]} 외 ${names.length - 1}`;
}
export const typeNames = (types: TaskType[]) => types.map((t) => TASK_TYPE_LABEL[t]);

export function toggleType(types: TaskType[], t: TaskType): TaskType[] {
  const next = types.includes(t) ? types.filter((x) => x !== t) : [...types, t];
  return TYPE_ORDER.filter((x) => next.includes(x));
}

// 최소 게시 수 — 비움·0·음수·소수·숫자 아님은 1(= 필터 없음). 입력칸은 친 그대로 두고 적용값만 이걸로
export function normalizeMinPosted(raw: string | number | null): number {
  const n = typeof raw === 'number' ? raw : raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

const clientOk = (t: PerfTask, f: PerfFilter) => f.clientIds.length === 0 || (t.clientId !== null && f.clientIds.includes(t.clientId));
const typeOk = (t: PerfTask, f: PerfFilter) => f.types.length === 0 || f.types.includes(t.type);

// ② — 클라이언트·유형으로 작업을 거른다
export function filterTasks(tasks: PerfTask[], f: PerfFilter): PerfTask[] {
  return tasks.filter((t) => clientOk(t, f) && typeOk(t, f));
}

const normQ = (q: string) => q.trim().replace(/^@/, '').toLowerCase();
const matchesQ = (who: { handle: string; displayName: string | null }, q: string) =>
  q === '' || who.handle.toLowerCase().includes(q) || (who.displayName ?? '').toLowerCase().includes(q);
const postedTotal = (r: PerfRow) => Object.values(r.typeCounts).reduce((a, b) => a + b, 0);

// ① — 숫자는 그대로, 행만 거른다. 최소 게시 수는 ②를 거친 뒤의 게시한 작업 수 기준
export function filterRows(rows: PerfRow[], f: PerfFilter): PerfRow[] {
  const q = normQ(f.q);
  return rows.filter((r) => matchesQ(r, q) && postedTotal(r) >= f.minPosted);
}

const isScopeOn = (f: PerfFilter) => f.clientIds.length > 0 || f.types.length > 0;

// 화면이 부르는 한 번 — ② 작업 필터 → 집계(게시 0건이 된 인플은 buildPerfRows가 뺀다) → ① 행 필터
export function buildFilteredRows(inputs: PerfInfluencerInput[], f: PerfFilter): PerfRow[] {
  const scoped = isScopeOn(f) ? inputs.map((inf) => ({ ...inf, tasks: filterTasks(inf.tasks, f) })) : inputs;
  return filterRows(buildPerfRows(scoped), f);
}

// 팝오버 항목 오른쪽 숫자(스펙 §16) — 그 항목을 골랐을 때 들어오는 게시된 작업 수.
// 다른 필터(반대편 선택·검색)는 반영하고 자기 쪽 선택은 무시한다. 최소 게시 수는 사람 단위라 작업 수에 안 섞는다.
export function optionCounts(inputs: PerfInfluencerInput[], f: PerfFilter): { client: Record<string, number>; type: Record<TaskType, number> } {
  const client: Record<string, number> = {};
  const type: Record<TaskType, number> = { post: 0, quoteRt: 0, rt: 0, visit: 0 };
  const q = normQ(f.q);
  for (const inf of inputs) {
    if (!matchesQ(inf, q)) continue;
    for (const t of inf.tasks) {
      if (!isPosted(t)) continue;
      if (t.clientId !== null && typeOk(t, f)) client[t.clientId] = (client[t.clientId] ?? 0) + 1;
      if (clientOk(t, f)) type[t.type] += 1;
    }
  }
  return { client, type };
}

export const isFilterOn = (f: PerfFilter) => isScopeOn(f) || normQ(f.q) !== '' || f.minPosted !== 1;

// 표 위 요약 한 줄(스펙 §15-2·§16·§17) — 무엇으로 계산했는지 + 누구를 좁혔는지 + 몇 명.
// clientNames = 고른 클라이언트 이름(목록 순서). 버튼과 같은 규칙으로 줄인다.
export function filterSummary(f: PerfFilter, clientNames: string[], n: number): string {
  const parts: string[] = [];
  const scope = [
    f.clientIds.length > 0 ? selectionLabel(clientNames, 1) : '',
    f.types.length > 0 ? selectionLabel(typeNames(f.types), 2) : '',
  ].filter(Boolean).join(' · ');
  if (scope !== '') parts.push(`${scope} 게시물만으로 계산했어요`);
  if (f.q.trim() !== '') parts.push(`'${f.q.trim()}' 검색`);
  if (f.minPosted !== 1) parts.push(`게시 ${f.minPosted}건 이상`);
  parts.push(`${n}명`);
  return parts.join(' · ');
}

export interface PerfQuery extends PerfFilter { sort: SortKey; dir: SortDir; agg: Agg }
export const DEFAULT_QUERY: PerfQuery = { sort: 'views', dir: 'desc', agg: 'median', ...EMPTY_FILTER };
const SORT_KEYS: readonly SortKey[] = [...METRIC_KEYS, 'campaigns', 'lastPosted', 'n_post', 'n_quoteRt', 'n_rt', 'n_visit'];

const csv = (s: string | null) => [...new Set((s ?? '').split(',').map((x) => x.trim()).filter(Boolean))];

// 옛 주소의 period·from·to는 조용히 무시한다(스펙 §17) — 여기서 읽지 않으니 자동으로 무시된다
export function parsePerfQuery(get: (k: string) => string | null): PerfQuery {
  const s = get('sort');
  const sort = SORT_KEYS.includes(s as SortKey) ? (s as SortKey) : DEFAULT_QUERY.sort;
  const d = get('dir');
  const dir: SortDir = d === 'asc' || d === 'desc' ? d : firstDir(sort);
  const agg: Agg = get('agg') === 'mean' ? 'mean' : 'median';
  const tset = csv(get('type'));
  const types = TYPE_ORDER.filter((t) => tset.includes(t) && TASK_TYPES.includes(t));
  // client는 여기서 검증할 수 없다(목록이 데이터에 있음) — 모르는 id는 화면이 목록과 맞춰 버린다
  const clientIds = csv(get('client'));
  return { sort, dir, agg, q: get('q') ?? '', clientIds, types, minPosted: normalizeMinPosted(get('min')) };
}

// 기본값인 키는 주소에서 뺀다 — 처음 들어온 주소가 깨끗하게. 복수 값은 쉼표로(client=a,b)
export function perfQueryString(q: PerfQuery): string {
  const p = new URLSearchParams();
  if (q.q.trim() !== '') p.set('q', q.q.trim());
  if (q.clientIds.length > 0) p.set('client', q.clientIds.join(','));
  if (q.types.length > 0) p.set('type', q.types.join(','));
  if (q.minPosted !== 1) p.set('min', String(q.minPosted));
  if (q.sort !== DEFAULT_QUERY.sort) p.set('sort', q.sort);
  if (q.dir !== firstDir(q.sort)) p.set('dir', q.dir);
  if (q.agg !== DEFAULT_QUERY.agg) p.set('agg', q.agg);
  return p.toString().replace(/%2C/g, ',');
}

export function formatMetric(key: MetricKey, v: number | null): string {
  if (v === null) return '—';
  // 0.1% 미만(0 제외)은 둘째 자리까지 — '0.0%'로 뭉개져 반응이 없던 것처럼 읽히지 않게(스펙 §18-2, 조회당 비용과 같은 태도)
  if (key === 'engagement') return `${(v * 100).toFixed(v > 0 && v < 0.001 ? 2 : 1)}%`;
  // 1원 미만은 둘째 자리까지 — 100만 조회 게시물이 '0.0원'으로 보여 공짜처럼 읽히던 것(koo QA 09-30)
  if (key === 'cpv') return `${v.toFixed(v < 1 ? 2 : 1)}원`;
  // 건수 지표는 축약 없이 쉼표 전체 숫자 — '1.2만'보다 비교가 정확하다(스펙 §13.3)
  return Math.round(v).toLocaleString('ko-KR');
}
