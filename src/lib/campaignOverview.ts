// 캠페인 현황(전체 캠페인 모니터링) 화면의 순수 계산 — DB·화면 없이 테스트한다.
import { weekStartOf, addDays, isDateOnlyString, isTaskExcluded, isTaskOverdue, daysBetweenDates, TASK_TYPE_LABEL } from './campaignJudgment.ts';
import type { CampaignTaskItem, CampaignRow } from './campaignStore.ts';
import { isLongCampaign, staysInLongSection, weekKey, weekName } from './campaignListView.ts';
import type { VisitPhase } from './reservationPolicy.ts';
import { flowStats } from './campaignFlowView.ts';
import { toKrw } from './clientBudget.ts';

export interface OverviewWeek { weekStart: string; weekEnd: string; isCurrent: boolean }

// 주소의 주 값을 월~일 주로 바꾼다. 틀린 값·미래 주는 이번 주로 — 아직 오지 않은 주는 볼 게 없다.
// isDateOnlyString이 형식과 실제 달력 날짜(02-30 등)를 함께 거른다.
export function resolveWeek(param: string | null, today: string): OverviewWeek {
  const current = weekStartOf(today);
  let weekStart: string = current;
  if (param !== null && isDateOnlyString(param)) {
    const ws = weekStartOf(param);
    if (ws <= current) weekStart = ws;
  }
  return { weekStart, weekEnd: addDays(weekStart, 6), isCurrent: weekStart === current };
}

// 계획 수량 — 나중에 최소 작업량이 생기면 여기만 바꾼다(스펙 §6)
export function plannedCount(tasks: CampaignTaskItem[]): number {
  return tasks.filter((t) => !isTaskExcluded(t)).length;
}

export interface Quantity { planned: number; posted: number; overdue: number; open: number; undated: number; cancelled: number }

// open = planned − posted(게시 전 전부, overdue 포함). undated = 게시 전이고 예정일 없음.
export function quantityOf(tasks: CampaignTaskItem[], today: string): Quantity {
  const live = tasks.filter((t) => !isTaskExcluded(t));
  const planned = plannedCount(tasks);
  const posted = live.filter((t) => t.postedAt !== null).length;
  // 밀림 판정은 기존 규칙 하나만 쓴다 — 다른 화면과 숫자가 어긋나지 않게
  const overdue = live.filter((t) => isTaskOverdue(t, today)).length;
  const undated = live.filter((t) => t.postedAt === null && t.scheduledOn === null).length;
  return { planned, posted, overdue, open: planned - posted, undated, cancelled: tasks.length - live.length };
}

export type CardStatus = 'unset' | 'done' | 'late' | 'onTrack';

// 판정 순서: 계획 없음 → 다 게시 → 밀림 있음 → 예정대로
export function cardStatus(q: Quantity): CardStatus {
  if (q.planned === 0) return 'unset';
  if (q.open === 0) return 'done';
  if (q.overdue > 0) return 'late';
  return 'onTrack';
}

export const CARD_STATUS_LABEL = (s: CardStatus, overdue: number): string => {
  switch (s) {
    case 'unset': return '세팅 전';
    case 'done': return '✓ 계획 완료';
    case 'late': return `예정일 지난 ${overdue}건`;
    case 'onTrack': return '예정대로';
  }
};

// 나중에 판정을 얹을 자리(스펙 §6) — 지금은 항상 null
export interface Metric { value: number | null; judgment: null }
export type CpvView = { kind: 'value'; krw: number } | { kind: 'free' } | { kind: 'none' };
export interface Perf { views: Metric; bookmarks: Metric; cpv: CpvView; spentKrw: number }

const isLivePosted = (t: CampaignTaskItem) => !isTaskExcluded(t) && t.postedAt !== null;

// 숫자는 flowStats 그대로 — 캠페인 상세와 같은 숫자가 나와야 한다
export function perfOf(tasks: CampaignTaskItem[]): Perf {
  const s = flowStats(tasks);
  const spentKrw = toKrw(s.spent).krw;
  const views = s.perf.views;
  let cpv: CpvView = { kind: 'none' };
  if (spentKrw > 0) {
    // CPV 공식은 flowStats 하나만 — 조회가 있을 때만 값이 있다
    if (views && s.cpvKrw !== null) cpv = { kind: 'value', krw: s.cpvKrw };
  } else {
    // flowStats는 비용 0원에도 cpvKrw 0을 준다 — 비용 미입력과 무상을 가르려면 작업을 직접 본다
    const posted = tasks.filter(isLivePosted);
    if (posted.length > 0 && posted.every((t) => t.noCost || t.cost?.amount === 0)) cpv = { kind: 'free' };
  }
  return { views: { value: views, judgment: null }, bookmarks: { value: s.perf.bookmarks, judgment: null }, cpv, spentKrw };
}

// 소수 한 자리는 캠페인 상세(FlowCards·FlowTable)의 CPV 표기와 맞춘다
export function formatCpv(c: CpvView): string {
  if (c.kind === 'value') return `${c.krw.toFixed(1)}원`;
  return c.kind === 'free' ? '무상' : '-';
}

// 스토어가 주는 재료: 본 게시물의 한국 날짜별 마지막 실측값
export interface DayPoint { taskId: string; day: string; views: number | null; bookmarks: number | null }
export interface FlowChart {
  days: string[];              // 'YYYY-MM-DD' 가로 칸 전부
  todayIndex: number;          // 선이 끝나는 칸(이번 주 = 오늘, 지난 주 = 마지막 칸)
  views: Array<number | null>; // todayIndex 뒤는 null
  bookmarks: Array<number | null>;
  postedPerDay: number[];      // 그날 게시된 작업 수(postedAt 기준)
}

// 이번 주는 7칸을 다 그리고 오늘에서 선을 멈춘다. 지난 주는 게시 뒤 2주까지 조회가 붙으니 일요일+14일(또는 오늘)까지.
export function chartDays(weekStart: string, today: string): { days: string[]; todayIndex: number } {
  const weekEnd = addDays(weekStart, 6);
  if (weekStart <= today && today <= weekEnd) {
    const days: string[] = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    return { days, todayIndex: days.indexOf(today) };
  }
  const last = addDays(weekEnd, 14) < today ? addDays(weekEnd, 14) : today;
  const days: string[] = [];
  for (let d = weekStart; d <= last; d = addDays(d, 1)) days.push(d);
  return { days, todayIndex: days.length - 1 };
}

type Key = 'views' | 'bookmarks';

// 날짜별 누적 = 게시물마다 그날까지의 마지막 실측값(null은 건너뜀, 측정 전은 0)의 합.
// 오늘 칸은 카드와 같은 규칙(flowStats — 최신값이 null인 게시물은 뺀다)으로 덮어 카드 숫자와 선 끝이 같게 한다.
export function flowChart(tasks: CampaignTaskItem[], points: DayPoint[], weekStart: string, today: string): FlowChart | null {
  const posted = tasks.filter(isLivePosted);
  const ids = new Set(posted.map((t) => t.id));
  const pts = points.filter((p) => ids.has(p.taskId)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  // 카드에 숫자가 하나도 없으면(조회·저장 모두 '-') 차트도 그리지 않는다 — 선만 있고 끝이 0으로 꺾이는 모순을 막는다
  const hasLatest = posted.some((t) => t.perf?.views != null || t.perf?.bookmarks != null);
  if (!hasLatest) return null;

  const { days, todayIndex } = chartDays(weekStart, today);
  // 게시물별로 그날까지 이어온 값
  const carry = (key: Key, day: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const p of pts) {
      if (p.day > day) break;
      const v = p[key];
      if (v !== null) m.set(p.taskId, v);
    }
    return m;
  };
  const series = (key: Key): Array<number | null> => days.map((day, i) => {
    if (i > todayIndex) return null;
    if (i === todayIndex) return posted.reduce((sum, t) => sum + (t.perf?.[key] ?? 0), 0);
    const m = carry(key, day);
    let sum = 0;
    for (const v of m.values()) sum += v;
    return sum;
  });

  // postedAt이 시각까지 오더라도 날짜 부분만 비교한다
  const postedPerDay = days.map((day) => posted.filter((t) => t.postedAt!.slice(0, 10) === day).length);
  return { days, todayIndex, views: series('views'), bookmarks: series('bookmarks'), postedPerDay };
}

export interface OverviewInput {
  campaign: CampaignRow; tasks: CampaignTaskItem[]; points: DayPoint[];
  visitPhases: Record<string, VisitPhase>;   // 장기 캠페인의 방문 작업만. 없는 작업 id는 'unregistered'로 본다
  perfUpdatedAt: string | null;
}
export interface OverviewTiles {
  campaignCount: number; unsetCount: number;
  planned: number; posted: number; overdue: number; remaining: number; undated: number;
  overdueBy: Array<{ title: string; count: number }>;   // 많은 순 최대 3개
  overdueMore: number;                                  // 그 밖의 캠페인 수
}
export interface PostedRow { taskId: string; handle: string | null; typeLabel: string; postedOn: string; url: string | null;
  views: number | null; bookmarks: number | null; likes: number | null; cpvKrw: number | null }
export interface OpenRow { taskId: string; handle: string | null; typeLabel: string; scheduledOn: string | null; overdueDays: number | null }
export interface OverviewCard {
  campaignId: string; title: string; status: CardStatus; statusLabel: string;
  quantity: Quantity; perf: Perf; chart: FlowChart | null;
  posted: PostedRow[];   // 조회수 많은 순, 측정값 없는 줄은 뒤
  open: OpenRow[];       // 예정일 지난 것 먼저(오래된 순), 그다음 예정일 순, 미정은 맨 뒤
}
export interface LongRow { campaignId: string; title: string; stages: Array<{ label: string; count: number }>; postedThisWeek: number; perf: Perf }
export interface Overview {
  week: OverviewWeek; weekName: string; today: string; perfUpdatedAt: string | null;
  tiles: OverviewTiles; cards: OverviewCard[]; long: LongRow[];
}

export function pickWeekly(campaigns: CampaignRow[], weekStart: string): CampaignRow[] {
  return campaigns.filter((c) => !isLongCampaign(c) && weekKey(c.startsOn) === weekStart);
}
export function pickLong(campaigns: CampaignRow[], today: string): CampaignRow[] {
  return campaigns.filter((c) => staysInLongSection(c, today));
}

const typeLabelOf = (t: CampaignTaskItem): string =>
  (t.type === 'other' && t.otherKind.trim()) || TASK_TYPE_LABEL[t.type];
// 동점은 만든 순 → id로 고정 — 새로 고칠 때마다 줄이 섞이지 않게
const byCreated = (a: CampaignTaskItem, b: CampaignTaskItem): number =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

function postedRows(tasks: CampaignTaskItem[]): PostedRow[] {
  const rows = tasks.filter(isLivePosted).sort((a, b) => {
    const va = a.perf?.views ?? null, vb = b.perf?.views ?? null;
    if (va !== vb) {
      if (va === null) return 1;
      if (vb === null) return -1;
      return vb - va;
    }
    return byCreated(a, b);
  });
  return rows.map((t) => {
    const views = t.perf?.views ?? null;
    // 작업 하나의 CPV — 비용·조회가 다 있을 때만(0원·미입력은 값 없음)
    const krw = t.cost && t.cost.amount > 0 ? toKrw({ [t.cost.currency]: t.cost.amount }).krw : 0;
    return {
      taskId: t.id, handle: t.influencerHandle, typeLabel: typeLabelOf(t), postedOn: t.postedAt!, url: t.postUrl,
      views, bookmarks: t.perf?.bookmarks ?? null, likes: t.perf?.likes ?? null,
      cpvKrw: krw > 0 && views ? krw / views : null,
    };
  });
}

// 예정일 오름차순이면 지난 것(오늘 전)이 자연히 먼저 온다. 미정은 맨 뒤.
function openRows(tasks: CampaignTaskItem[], today: string): OpenRow[] {
  const rows = tasks.filter((t) => !isTaskExcluded(t) && t.postedAt === null).sort((a, b) => {
    if (a.scheduledOn !== b.scheduledOn) {
      if (a.scheduledOn === null) return 1;
      if (b.scheduledOn === null) return -1;
      return a.scheduledOn.localeCompare(b.scheduledOn);
    }
    return byCreated(a, b);
  });
  return rows.map((t) => ({
    taskId: t.id, handle: t.influencerHandle, typeLabel: typeLabelOf(t), scheduledOn: t.scheduledOn,
    overdueDays: isTaskOverdue(t, today) && t.scheduledOn !== null ? daysBetweenDates(t.scheduledOn, today) : null,
  }));
}

const STAGES = ['예약 대기', '예약 확정', '방문 완료', '게시', '준비'] as const;
type Stage = typeof STAGES[number];
// 방문 단계 → 장기 줄 단계. null = 세지 않음(취소·노쇼)
const VISIT_STAGE: Record<VisitPhase, Stage | null> = {
  unregistered: '예약 대기', waiting: '예약 대기', confirmed: '예약 확정', visited: '방문 완료',
  uploaded: '게시', settling: '게시', completed: '게시',
  cancelled: null, visit_no_show: null, upload_no_show: null,
};

function longRow(inp: OverviewInput, week: OverviewWeek): LongRow {
  const live = inp.tasks.filter((t) => !isTaskExcluded(t));
  const counts = new Map<Stage, number>();
  for (const t of live) {
    // 게시 확인이 어느 단계보다 이긴다(taskStage와 같은 우선순위)
    const stage: Stage | null = t.postedAt !== null ? '게시'
      : t.type === 'visit' ? VISIT_STAGE[inp.visitPhases[t.id] ?? 'unregistered'] : '준비';
    if (stage) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  const c = inp.campaign;
  return {
    campaignId: c.id, title: c.clientName ?? c.name,
    stages: STAGES.filter((s) => counts.has(s)).map((label) => ({ label, count: counts.get(label)! })),
    postedThisWeek: live.filter((t) => {
      const d = t.postedAt?.slice(0, 10);
      return d !== undefined && week.weekStart <= d && d <= week.weekEnd;
    }).length,
    perf: perfOf(inp.tasks),
  };
}

export function buildOverview(weekly: OverviewInput[], long: OverviewInput[], week: OverviewWeek, today: string): Overview {
  // 같은 주에 한 클라이언트 캠페인이 둘 이상이면 클라이언트 이름만으로는 구분이 안 된다
  const perClient = new Map<string, number>();
  for (const w of weekly) if (w.campaign.clientId) perClient.set(w.campaign.clientId, (perClient.get(w.campaign.clientId) ?? 0) + 1);

  const cards: OverviewCard[] = weekly.map((inp) => {
    const c = inp.campaign;
    const dup = c.clientId !== null && (perClient.get(c.clientId) ?? 0) > 1;
    const quantity = quantityOf(inp.tasks, today);
    const status = cardStatus(quantity);
    return {
      campaignId: c.id, title: dup ? c.name : (c.clientName ?? c.name), status, statusLabel: CARD_STATUS_LABEL(status, quantity.overdue),
      quantity, perf: perfOf(inp.tasks), chart: flowChart(inp.tasks, inp.points, week.weekStart, today),
      posted: postedRows(inp.tasks), open: openRows(inp.tasks, today),
    };
  });
  // 세팅 전은 맨 뒤 → 밀린 건 많은 순 → 이름순
  cards.sort((a, b) =>
    Number(a.status === 'unset') - Number(b.status === 'unset')
    || b.quantity.overdue - a.quantity.overdue
    || a.title.localeCompare(b.title, 'ko')
    || a.campaignId.localeCompare(b.campaignId));

  const sum = (k: keyof Quantity) => cards.reduce((s, c) => s + c.quantity[k], 0);
  const planned = sum('planned'), posted = sum('posted'), overdue = sum('overdue');
  // 카드가 이미 밀린 순 → 이름순이라 그대로 앞에서 자른다
  const late = cards.filter((c) => c.quantity.overdue > 0);
  const tiles: OverviewTiles = {
    campaignCount: cards.length, unsetCount: cards.filter((c) => c.status === 'unset').length,
    planned, posted, overdue, remaining: planned - posted - overdue, undated: sum('undated'),
    overdueBy: late.slice(0, 3).map((c) => ({ title: c.title, count: c.quantity.overdue })),
    overdueMore: Math.max(0, late.length - 3),
  };

  // ISO 문자열이라 문자열 비교가 곧 시간 비교
  const perfUpdatedAt = weekly.reduce<string | null>((m, w) => (w.perfUpdatedAt !== null && (m === null || w.perfUpdatedAt > m) ? w.perfUpdatedAt : m), null);
  return {
    week, weekName: weekName(week.weekStart), today, perfUpdatedAt,
    tiles, cards, long: long.map((inp) => longRow(inp, week)),
  };
}
