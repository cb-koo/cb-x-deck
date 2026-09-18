import type { CampaignTaskItem } from './campaignStore.ts';
import {
  flowStage, FLOW_STAGES, FLOW_STAGE_LABEL, isTaskExcluded, isSettlementCandidate, isTaskOverdue,
  TASK_TYPES, TASK_TYPE_LABEL, formatDateKo, daysBetweenDates, type FlowStage, type TaskType,
} from './campaignJudgment.ts';
import { formatAmount, formatMoneyBy, sumMoney, type MoneyByCurrency, type TaskCost } from './campaignCost.ts';
import type { CancelReason } from './campaignTaskInput.ts';

// 캠페인 v2 화면(결정 문서 §3·§4)의 판정·문구 — 컴포넌트는 그리기만 한다. 단계는 flowStage 하나(R21), 모집단은 취소 제외(R17).
export type FlowRow = CampaignTaskItem;
const stageOf = (t: FlowRow): FlowStage => flowStage(t, t.settlement);

// ── 필터(R26): 드롭다운 하나, 세 묶음 — 묶음 안 OR, 묶음 사이 AND ──
export type ExtraFilter = 'late' | 'today' | 'none';
export const EXTRA_FILTERS: readonly ExtraFilter[] = ['late', 'today', 'none'];
export const EXTRA_FILTER_LABEL: Record<ExtraFilter, string> = { late: '지연', today: '오늘 게시 예정', none: '예정일 미정' };
export interface FlowFilter { stages: Set<FlowStage>; types: Set<TaskType>; extras: Set<ExtraFilter>; q: string }
export const EMPTY_FLOW_FILTER = (): FlowFilter => ({ stages: new Set(), types: new Set(), extras: new Set(), q: '' });
export const filterCount = (f: FlowFilter) => f.stages.size + f.types.size + f.extras.size;
export const isFilterActive = (f: FlowFilter) => filterCount(f) > 0 || f.q.trim() !== '';

// '지금 볼 것'은 진행 중(게시 전·취소 아님) 작업만 센다 — 게시된 건은 이미 할 일이 아니다.
export function matchesExtra(t: FlowRow, key: ExtraFilter, today: string): boolean {
  if (isTaskExcluded(t) || t.postedAt) return false;
  if (key === 'late') return isTaskOverdue(t, today);
  if (key === 'today') return t.scheduledOn === today;
  return t.scheduledOn === null;
}
export function matchesSearch(t: FlowRow, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^@/, '');
  if (!s) return true;
  const hay = [t.influencerHandle, t.draftLabel, t.draftFirstLine, t.cancelledDraftTitle].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  return hay.some((h) => h.includes(s));
}
export function matchesFlowFilter(t: FlowRow, f: FlowFilter, today: string): boolean {
  if (!matchesSearch(t, f.q)) return false;
  if (f.stages.size && !f.stages.has(stageOf(t))) return false;
  if (f.types.size && !f.types.has(t.type)) return false;
  if (f.extras.size && ![...f.extras].some((k) => matchesExtra(t, k, today))) return false;
  return true;
}
export function filterSummary(f: FlowFilter, shown: number, total: number): string {
  if (!isFilterActive(f)) return `전체 ${total}건`;
  const labels = [...f.stages].map((k) => FLOW_STAGE_LABEL[k])
    .concat([...f.types].map((k) => TASK_TYPE_LABEL[k]), [...f.extras].map((k) => EXTRA_FILTER_LABEL[k]));
  if (f.q.trim()) labels.push(`"${f.q.trim()}"`);
  return `${labels.join(' · ')} ${shown}건`;
}

// ── 정렬(R26): 기본 만든 순, 헤더 클릭 오름 → 내림 → 기본. 미정은 오름차순에서 맨 뒤. 취소는 단계 순에서 맨 뒤 ──
export type FlowSortKey = 'stage' | 'type' | 'influencer' | 'draft' | 'date' | 'cost';
export interface FlowSort { key: FlowSortKey | null; dir: 1 | -1 }
export const FLOW_SORT_LABEL: Record<FlowSortKey, string> = { stage: '단계', type: '유형', influencer: '인플루언서', draft: '원고', date: '게시 예정일', cost: '작업 비용' };
export function nextSort(cur: FlowSort, key: FlowSortKey): FlowSort {
  if (cur.key !== key) return { key, dir: 1 };
  if (cur.dir === 1) return { key, dir: -1 };
  return { key: null, dir: 1 };
}
const LAST = '￿';
const sortValue = (t: FlowRow, key: FlowSortKey): string | number => {
  switch (key) {
    case 'stage': return FLOW_STAGES.indexOf(stageOf(t));
    case 'type': return TASK_TYPES.indexOf(t.type);
    case 'influencer': return t.influencerHandle ? t.influencerHandle.toLowerCase() : LAST;
    case 'draft': { const d = draftCell(t).text; return d === '미정' || d === '—' ? LAST : d.toLowerCase(); }
    // dateCell이 보여주는 날짜와 같은 우선순위(취소일 > 게시일 > 예정일) — 표시된 날짜와 정렬 순서가 어긋나면 안 된다
    case 'date': return t.cancelledAt ?? t.postedAt ?? t.scheduledOn ?? LAST;
    case 'cost': return t.cost ? t.cost.amount : LAST;   // 미정은 0원이 아니라 '값 없음' — 다른 키와 같이 맨 뒤로
  }
};
export function sortFlowRows<T extends FlowRow>(rows: T[], sort: FlowSort): T[] {
  const byCreated = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  if (!sort.key) return [...rows].sort(byCreated);
  const key = sort.key;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, key), y = sortValue(b, key);
    // 미정(LAST)은 방향과 무관하게 맨 뒤 — 내림차순에서 미정이 맨 위로 올라오면 "가장 큰 값"처럼 읽힌다
    const ax = x === LAST, bx = y === LAST;
    if (ax !== bx) return ax ? 1 : -1;
    const c = x < y ? -1 : x > y ? 1 : 0;
    return c * sort.dir || byCreated(a, b);
  });
}

// ── 칸 문구(R26·R27) ──
export function dateCell(t: FlowRow, today: string): { text: string; tone: 'late' | 'posted' | 'plain' | 'muted' } {
  if (t.cancelledAt) return { text: `${formatDateKo(t.cancelledAt)} 취소`, tone: 'muted' };
  if (t.postedAt) return { text: formatDateKo(t.postedAt), tone: 'posted' };
  if (!t.scheduledOn) return { text: '미정', tone: 'muted' };
  if (t.scheduledOn < today) return { text: `${formatDateKo(t.scheduledOn)} · D+${daysBetweenDates(t.scheduledOn, today)}`, tone: 'late' };
  return { text: formatDateKo(t.scheduledOn), tone: 'plain' };
}
export const CANCEL_REASON_CHIPS: ReadonlyArray<{ value: CancelReason; label: string }> = [
  { value: 'declined', label: '🙅 거절' }, { value: 'no_response', label: '🔇 무응답' }, { value: 'other', label: '📝 기타' },
];   // 가안(§8) — 이모지는 koo 확정 뒤 여기 한 곳만 바꾼다
export const cancelReasonLabel = (r: CancelReason | null) => CANCEL_REASON_CHIPS.find((c) => c.value === r)?.label ?? null;
export function draftCell(t: FlowRow): { text: string; muted: boolean; title: string } {
  if (t.cancelledAt) {
    const parts = [cancelReasonLabel(t.cancelReason), t.cancelNote.trim() || null, t.cancelledDraftTitle ? `원고 있었음: ${t.cancelledDraftTitle}` : null].filter((x): x is string => !!x);
    const text = parts.length ? parts.join(' · ') : '취소';
    return { text, muted: true, title: text };
  }
  if (t.type === 'rt') return { text: '—', muted: true, title: '' };
  if (t.draftId) { const text = t.draftFirstLine ?? t.draftLabel ?? '(내용 없음)'; return { text, muted: false, title: text }; }
  return { text: '미정', muted: true, title: '' };
}
export function costCell(t: FlowRow, suggestion: TaskCost | null): { text: string; tone: 'plain' | 'muted' | 'struck' | 'suggested'; title?: string } {
  if (t.cost) return { text: formatAmount(t.cost.amount, t.cost.currency), tone: t.cancelledAt ? 'struck' : 'plain' };
  if (!t.cancelledAt && suggestion) return { text: formatAmount(suggestion.amount, suggestion.currency), tone: 'suggested', title: '아직 확인 전 — 프로필 단가로 채운 값이에요' };
  return { text: '미정', tone: 'muted' };
}

// ── 하단 줄·카드(§3-2 하단 한 줄, §3-3) — 모집단은 취소 제외(R17) ──
// 화면에 유형을 나열하는 순서 — 주력인 발행 유형(투고·인용RT)이 먼저, 부수적인 RT·방문협찬이 뒤.
// TASK_TYPES(rt·quoteRt·post·visit)는 도메인 순서(단가 키 등)라 그대로 두고, 보이는 순서만 여기서 한 번 정한다:
// 하단 한 줄과 필터 드롭다운이 같은 순서를 써야 화면 안에서 유형 나열이 두 가지로 갈리지 않는다(시안 F도 이 순서).
export const DISPLAY_TYPE_ORDER: readonly TaskType[] = ['post', 'quoteRt', 'rt', 'visit'];
export function flowFooter(rows: FlowRow[], today: string): string {
  const live = rows.filter((t) => !isTaskExcluded(t));
  const types = DISPLAY_TYPE_ORDER.filter((k) => live.some((t) => t.type === k)).map((k) => `${TASK_TYPE_LABEL[k]} ${live.filter((t) => t.type === k).length}`);
  const cost = sumMoney(live.flatMap((t) => (t.cost ? [t.cost] : [])));
  const posted = live.filter((t) => t.postedAt).length;
  const late = live.filter((t) => isTaskOverdue(t, today)).length;
  return [...types, `비용 ${formatMoneyBy(cost)}`, `게시 ${posted} / ${live.length}`, ...(late ? [`밀림 ${late}`] : [])].join(' · ');
}
export interface FlowStats {
  planned: number; posted: number;
  perf: { views: number; likes: number; bookmarks: number; withPerf: number; noLink: number };
  spent: MoneyByCurrency; plannedCost: MoneyByCurrency;
}
export function flowStats(rows: FlowRow[]): FlowStats {
  const live = rows.filter((t) => !isTaskExcluded(t));
  const posted = live.filter((t) => t.postedAt);
  const withPerf = posted.filter((t) => t.perf);
  const perf = withPerf.reduce((a, t) => ({
    views: a.views + (t.perf?.views ?? 0), likes: a.likes + (t.perf?.likes ?? 0), bookmarks: a.bookmarks + (t.perf?.bookmarks ?? 0),
  }), { views: 0, likes: 0, bookmarks: 0 });
  return {
    planned: live.length, posted: posted.length,
    perf: { ...perf, withPerf: withPerf.length, noLink: posted.length - withPerf.length },
    spent: sumMoney(posted.flatMap((t) => (t.cost ? [t.cost] : []))),
    plannedCost: sumMoney(live.flatMap((t) => (t.cost ? [t.cost] : []))),
  };
}
// 정산 대기 = 정산 후보인데 활성 요청이 없는 것. 우리가 취소했거나 그쪽이 취소한 요청은 후보로 돌아온다(§3-1 정산 정의).
export const settleWaitCount = (rows: FlowRow[]) => rows.filter((t) =>
  isSettlementCandidate(t) && (!t.settlement || t.settlement.status === 'cancelled' || t.settlement.externalStatus === 'cancelled')).length;

export function restoreMessage(r: 'reattached' | 'taken' | 'gone' | 'none'): string {
  return r === 'reattached' ? '되돌렸어요 — 원고도 다시 붙었어요'
    : r === 'taken' ? '되돌렸어요 — 원고는 그 사이 다른 작업에 붙어 있어요'
    : r === 'gone' ? '되돌렸어요 — 원고는 삭제돼 붙이지 못했어요'
    : '되돌렸어요';
}

// 패널 칸 순서(§4-2, koo 09-18)
export type PanelField = 'influencer' | 'cost' | 'draft' | 'target' | 'scheduled' | 'dates' | 'note';
export const PANEL_FIELD_ORDER: Record<TaskType, PanelField[]> = {
  post: ['influencer', 'cost', 'draft', 'scheduled', 'note'],
  quoteRt: ['influencer', 'cost', 'draft', 'target', 'scheduled', 'note'],
  rt: ['influencer', 'cost', 'target', 'scheduled', 'note'],
  visit: ['influencer', 'dates', 'cost', 'draft', 'note'],
};
