// 캠페인 판정의 순수 함수 — 단계 승격·밀림·기간 밖·캠페인 상태·준비 중·요약·정렬·인플 목록·이름/코드 제안·주 계산.
// 서버 요약(campaignStore)과 클라 표시(/campaigns·DraftCard)가 같은 함수를 쓴다(influencerJudgment 선례) —
// 드리프트 = 카드마다 다른 숫자. DB 접근 없음. '오늘'은 인자(kstToday())로 받아 테스트가 결정적으로 검증한다.
// 날짜는 전부 'YYYY-MM-DD'(datetime.ts의 date-only 계열) — 시간대 시프트를 하지 않는다.
import { asDateOnly, dateOnlyMonthDay, type DateOnly } from './datetime.ts';
import { STATUS_LABEL, type DraftStatus } from './draftStatus.ts';
import { checkCampaign } from './trackingLink.ts';
import { sumMoney, mergeMoney, type CostType, type DraftCost, type ExtraCost, type MoneyByCurrency, type TaskCost } from './campaignCost.ts';
import { PRICE_TYPES, PRICE_TYPE_LABEL, type PriceType } from './influencerPricing.ts';

const DAY_MS = 86_400_000;

// ─────────────────────────── 날짜 산술(date-only) ───────────────────────────
// 라우트 입력 가드 — date 컬럼엔 달력일만. 시각이 붙은 ISO를 받으면 postgres가 서울 자정 전후로 하루를 민다(DateOnly 관례).
// 형식 + 실제 달력에 있는 날인지(왕복 일치)까지 본다 — '2026-13-40'은 정규식은 통과하지만 Date가 다른 날로 바꿔버린다.
export function isDateOnlyString(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
// 'YYYY-MM-DD'를 UTC 자정으로 읽어 일수만 더한다 — 달력일 문자열의 산술일 뿐, 시간대 변환이 아니다(kstDayRange 관례).
// 반환은 DateOnly — 이후 주 계산이 이 값을 다시 date-only 함수(weekRangeLabel 등)에 넘겨도 타입이 막아준다.
export function addDays(date: string, n: number): DateOnly {
  const t = Date.parse(date + 'T00:00:00Z');
  // 파싱 불가한 입력이면 던지지 않고 빈 문자열로 — datetime.ts 규칙과 동일하게, 표의 셀마다 불리므로
  // 던지면 표 전체 렌더가 죽는다. 셀 하나가 비는 것보다 나쁘다.
  if (Number.isNaN(t)) return '' as DateOnly;
  return asDateOnly(new Date(t + n * DAY_MS).toISOString().slice(0, 10));
}
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);
}
// 월요일 시작(한국 업무 주). getUTCDay는 일=0이라 (dow+6)%7이 월요일까지의 거리다.
export function weekStartOf(date: string): DateOnly {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}
export function weekDays(weekStart: string): DateOnly[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}
// 새 캠페인 기본 기간 = 다음 월~일(스펙 §3-3)
export function nextWeekRange(today: string): { startsOn: DateOnly; endsOn: DateOnly } {
  const startsOn = addDays(weekStartOf(today), 7);
  return { startsOn, endsOn: addDays(startsOn, 6) };
}
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
/** '8/26 수' — 표 예정일 칸·달력 헤더·밀림 문구. M/D는 datetime.ts의 date-only 표기를 그대로 쓴다. */
export function formatDateKo(date: string): string {
  // 단 한 번만 파싱해서 요일까지 뽑는다 — 두 번 파싱하면 하나는 성공하고 하나는 실패하는 경우
  // '8/26 undefined'처럼 절반만 깨진 문구가 나올 수 있다.
  const t = Date.parse(date + 'T00:00:00Z');
  if (Number.isNaN(t)) return '';
  const dow = new Date(t).getUTCDay();
  return `${dateOnlyMonthDay(asDateOnly(date))} ${DOW_KO[dow]}`;
}

// ─────────────────────────── 캠페인 상태·유형 ───────────────────────────
// 기간에서 파생, 수동 상태 없음(라벨-값 일치, 스펙 §10)
export type CampaignStatus = 'upcoming' | 'active' | 'ended';
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { upcoming: '예정', active: '진행 중', ended: '종료' };
export function campaignStatus(startsOn: string, endsOn: string, today: string): CampaignStatus {
  if (today < startsOn) return 'upcoming';
  if (today > endsOn) return 'ended';
  return 'active';
}

// 유형은 표시·필터용 속성 — 로직 분기는 비용 제안의 기본 유형 하나뿐(스펙 §2-1)
export const CAMPAIGN_KINDS = ['content', 'visit', 'seeding'] as const;
export type CampaignKind = typeof CAMPAIGN_KINDS[number];
export const CAMPAIGN_KIND_LABEL: Record<CampaignKind, string> = { content: '콘텐츠 의뢰', visit: '방문 협찬', seeding: '시딩' };
export function isCampaignKind(v: unknown): v is CampaignKind {
  return typeof v === 'string' && (CAMPAIGN_KINDS as readonly string[]).includes(v);
}
// 인플 배정 시 비용을 제안할 때 어느 단가를 볼지 — 방문협찬이면 방문 단가, 나머지는 게시 단가
export function defaultCostType(kind: CampaignKind | null): CostType {
  return kind === 'visit' ? 'visit' : 'post';
}

// ─────────────────────────── 콘텐츠 단계 ───────────────────────────
// draft.status 5종 + 게시됨(tracked_post 존재). 게시됨이면 status와 무관하게 게시됨 — status 값은 바꾸지 않는다(§2-4).
export type ContentStage = DraftStatus | 'published';
export const STAGE_LABEL: Record<ContentStage, string> = { ...STATUS_LABEL, published: '게시됨' };
export interface StageInput { status: DraftStatus; published: boolean; scheduledOn: string | null }
export function contentStage(d: StageInput): ContentStage {
  return d.published ? 'published' : d.status;
}

// 밀림 = 예정일 < 오늘 and 미게시 and 미사용 아님. 미사용은 요약 모집단(N)에서도 빠진다 — 같은 모집단이어야 라벨-값이 맞는다.
export function isOverdue(d: StageInput, today: string): boolean {
  return d.scheduledOn !== null && d.scheduledOn < today && !d.published && d.status !== 'unused';
}
// 기간 밖 — 경고 표시만, 저장 차단 없음(§2-4)
export function isOutOfRange(scheduledOn: string | null, startsOn: string, endsOn: string): boolean {
  return scheduledOn !== null && (scheduledOn < startsOn || scheduledOn > endsOn);
}

// 준비 중 = 초안·검수 대기·사용 확정(미게시). STATUS_LABEL에 없는 합성 라벨이라 정의를 여기 한 곳에 둔다 —
// 칩·카드·필터가 전부 이 함수를 쓴다(§2-4).
export const PREPARING_STATUSES: readonly DraftStatus[] = ['draft', 'review', 'approved'];
export const PREPARING_LABEL = '준비 중';
export function isPreparing(d: StageInput): boolean {
  return !d.published && PREPARING_STATUSES.includes(d.status);
}

export type StageFilter = 'all' | 'preparing' | 'delivered' | 'published';
export const STAGE_FILTERS: readonly StageFilter[] = ['all', 'preparing', 'delivered', 'published'];
export const STAGE_FILTER_LABEL: Record<StageFilter, string> = {
  all: '전체', preparing: PREPARING_LABEL, delivered: STATUS_LABEL.delivered, published: STAGE_LABEL.published,
};
export function matchesStageFilter(d: StageInput, f: StageFilter): boolean {
  if (f === 'all') return true;
  if (f === 'preparing') return isPreparing(d);
  // 미사용도 제외 — summarizeStages()의 published는 미사용을 아예 건너뛰고 센다.
  // 요약 숫자와 필터 행 수가 같아야 한다(라벨-값 일치, §4 원칙).
  if (f === 'published') return d.published && d.status !== 'unused';
  return !d.published && d.status === 'delivered';
}

// ─────────────────────────── 요약 카드 ───────────────────────────
// N = 미사용 제외 원고 수. 게시됨 n / N, 보조 '전달됨 a · 준비 중 b', 밀림 — 전부 같은 모집단(§2-4).
export interface CampaignSummary { total: number; published: number; delivered: number; preparing: number; overdue: number }
export function summarizeStages(items: StageInput[], today: string): CampaignSummary {
  const s: CampaignSummary = { total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0 };
  for (const d of items) {
    if (d.status === 'unused') continue; // 미사용은 표에 흐리게 남고 요약에서만 빠진다
    s.total += 1;
    if (d.published) s.published += 1;
    else if (d.status === 'delivered') s.delivered += 1;
    else if (isPreparing(d)) s.preparing += 1;
    if (isOverdue(d, today)) s.overdue += 1;
  }
  return s;
}

// 성과 합계 — 스냅샷이 하나도 없으면 null(0으로 위장하지 않는다, 스펙 §7 "성과 스냅샷 없음 → —").
// 링크 클릭은 게시 여부와 무관하게 캠페인 원고들의 tracking_link 합(§5).
// status — 미사용은 여기서도 건너뛴다. 카드 ②(summarizeStages)와 같은 모집단이어야 라벨-값이 일치한다
// (요약 카드 옆에 나란히 놓인 두 숫자가 서로 다른 원고 집합을 세면 사용자가 모순으로 읽는다, 최종 리뷰).
export interface PerfInput { status: DraftStatus; published: boolean; perf: { views: number | null; likes: number | null } | null; linkClicks: number | null }
export interface PerfSummary { publishedCount: number; views: number | null; likes: number | null; linkClicks: number | null }
export function summarizePerf(items: PerfInput[]): PerfSummary {
  const out: PerfSummary = { publishedCount: 0, views: null, likes: null, linkClicks: null };
  const add = (k: 'views' | 'likes' | 'linkClicks', v: number | null) => { if (v !== null) out[k] = (out[k] ?? 0) + v; };
  for (const it of items) {
    if (it.status === 'unused') continue; // summarizeStages와 같은 모집단(§2-4)
    if (it.published) out.publishedCount += 1;
    add('views', it.perf?.views ?? null);
    add('likes', it.perf?.likes ?? null);
    add('linkClicks', it.linkClicks);
  }
  return out;
}

// ─────────────────────────── 콘텐츠 표 정렬 ───────────────────────────
export type ContentSortKey = 'default' | 'scheduled' | 'stage' | 'influencer';
export const CONTENT_SORT_LABEL: Record<ContentSortKey, string> = {
  default: '밀린 것 먼저', scheduled: '예정일', stage: '단계', influencer: '인플루언서',
};
export interface SortInput extends StageInput { influencerHandle: string | null; createdAt: string }
const STAGE_ORDER: Record<ContentStage, number> = { draft: 0, review: 1, approved: 2, delivered: 3, published: 4, unused: 5 };
// 기본: 밀린 것 → 예정일 오름차순 → 예정일 없음 → 미사용 맨 아래(§3-2). 어느 키든 미사용은 맨 아래 —
// 흐리게 그리는 행이 중간에 끼면 표가 얼룩진다. 원본은 바꾸지 않는다.
export function sortContent<T extends SortInput>(items: T[], key: ContentSortKey, today: string): T[] {
  const bySchedule = (a: T, b: T): number => {
    if (a.scheduledOn === b.scheduledOn) return a.createdAt.localeCompare(b.createdAt);
    if (a.scheduledOn === null) return 1;
    if (b.scheduledOn === null) return -1;
    return a.scheduledOn.localeCompare(b.scheduledOn);
  };
  return [...items].sort((a, b) => {
    const u = Number(a.status === 'unused') - Number(b.status === 'unused');
    if (u !== 0) return u;
    if (key === 'default') {
      const o = Number(isOverdue(b, today)) - Number(isOverdue(a, today));
      return o !== 0 ? o : bySchedule(a, b);
    }
    if (key === 'scheduled') return bySchedule(a, b);
    if (key === 'stage') return (STAGE_ORDER[contentStage(a)] - STAGE_ORDER[contentStage(b)]) || bySchedule(a, b);
    const ha = (a.influencerHandle ?? '').toLowerCase();
    const hb = (b.influencerHandle ?? '').toLowerCase();
    if (ha === hb) return bySchedule(a, b);
    if (!ha) return 1;
    if (!hb) return -1;
    return ha.localeCompare(hb);
  });
}

// ─────────────────────────── 인플루언서 목록·비용 ───────────────────────────
export interface CostInput { influencerHandle: string | null; status: DraftStatus; cost: DraftCost | null }
export interface CostRowInput { influencerHandle: string; extraCosts: ExtraCost[]; note: string }
export interface InfluencerLine {
  handle: string | null;      // null = 미배정 원고 묶음 — 원고가 있을 때만 한 줄(비용이 합계에서 증발하지 않게)
  contentCount: number;       // 미사용 제외(요약 N과 같은 모집단)
  contentCost: MoneyByCurrency;
  extraCosts: ExtraCost[];
  extraCost: MoneyByCurrency;
  subtotal: MoneyByCurrency;  // 콘텐츠 비용 + 추가 비용, 통화별
  note: string;
  hasCostRow: boolean;        // campaign_influencer_cost 행 존재 — 원고 0이면 "배정 원고 없음" 표시 근거(§2-4)
}
// 인플 목록 = 원고 핸들 집합(소문자 중복 제거) ∪ 비용 행 핸들(§2-4). 표기는 원고에서 먼저 본 것, 없으면 비용 행 표기.
export function deriveInfluencers(drafts: CostInput[], costRows: CostRowInput[]): InfluencerLine[] {
  type Bucket = { handle: string | null; drafts: CostInput[]; row: CostRowInput | null };
  const byKey = new Map<string, Bucket>();
  const keyOf = (h: string | null) => (h ? h.toLowerCase() : '');
  for (const d of drafts) {
    if (d.status === 'unused') continue;
    const k = keyOf(d.influencerHandle);
    const b = byKey.get(k) ?? { handle: d.influencerHandle, drafts: [], row: null };
    b.drafts.push(d);
    byKey.set(k, b);
  }
  for (const r of costRows) {
    const k = keyOf(r.influencerHandle);
    const b = byKey.get(k) ?? { handle: r.influencerHandle, drafts: [], row: null };
    b.row = r;
    byKey.set(k, b);
  }
  // 전제: drafts·costRows는 같은 캠페인 소속(다른 캠페인이 섞이면 소계가 틀린다),
  // 비용 행은 lower(handle)에 DB unique라 같은 핸들이 두 행으로 쪼개져 들어올 일이 없다.
  const lines: InfluencerLine[] = [];
  for (const [k, b] of byKey) {
    if (k === '' && b.drafts.length === 0) continue;
    const contentCost = sumMoney(b.drafts.flatMap((d) => (d.cost ? [d.cost] : [])));
    const extraCosts = b.row?.extraCosts ?? [];
    const extraCost = sumMoney(extraCosts);
    lines.push({
      handle: b.handle, contentCount: b.drafts.length, contentCost, extraCosts, extraCost,
      subtotal: mergeMoney(contentCost, extraCost), note: b.row?.note ?? '', hasCostRow: b.row !== null,
    });
  }
  // 배정 원고 많은 사람 먼저 → 핸들 사전순, 미배정 묶음은 맨 아래
  return lines.sort((a, b) => {
    if (a.handle === null) return 1;
    if (b.handle === null) return -1;
    return (b.contentCount - a.contentCount) || a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());
  });
}
// 캠페인 합계 = 인플 소계의 통화별 합(§2-4) — 미배정 묶음이 줄로 들어 있어 원고 비용 전체와 일치한다
export function campaignTotal(lines: InfluencerLine[]): MoneyByCurrency {
  return mergeMoney(...lines.map((l) => l.subtotal));
}

// ─────────────────────────── 이름·코드 제안(§2-1) ───────────────────────────
// '{클라} {M월 N주}' — 캠페인 첫 주(월~일, startsOn을 포함하는 주)의 목요일로 월/주차를 정한다.
// 시작일(또는 그 주의 월요일) 자체를 기준으로 삼으면, 다음 주 월요일이 그 달 29~31일에
// 떨어지는 달이 잦아 달력일 기준이 실무에서 부르는 주차 표기와 어긋난다 — 그 주의 '무게 중심'인
// 목요일을 쓰면 어느 요일에 시작해도 같은 주는 항상 같은 라벨을 받는다.
export function suggestCampaignName(clientName: string, startsOn: string): string {
  const thursday = addDays(weekStartOf(startsOn), 3);
  const month = Number(thursday.slice(5, 7));
  const week = Math.floor((Number(thursday.slice(8, 10)) - 1) / 7) + 1;
  const base = `${month}월 ${week}주`;
  const name = clientName.trim();
  return name ? `${name} ${base}` : base;
}
// '{클라 영문 소문자}-{YYYYMMDD}', 영문명이 없으면 '{YYYYMMDD}'. checkCampaign 규칙(영어·숫자·._-, 공백→하이픈)으로
// 정리하므로 제안값은 항상 검사를 통과한다 — 통과 못 하는 경우(이론상 없음)엔 날짜만 남긴다.
export function suggestCampaignCode(clientNameEn: string, startsOn: string): string {
  const ymd = startsOn.replace(/-/g, '');
  const en = clientNameEn.trim().toLowerCase().replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const code = en ? `${en}-${ymd}` : ymd;
  const check = checkCampaign(code);
  return check.ok ? check.campaign : ymd;
}

// ─────────────────────────── 작업(campaign_task) 파생 — 스펙 2026-08-28 §2-5 ───────────────────────────
// 작업이 캠페인의 단위다. 아래 함수들은 서버(campaignStore)·클라(TaskTable·달력·요약)가 같이 쓴다.
export type TaskType = PriceType;
export const TASK_TYPES: readonly TaskType[] = PRICE_TYPES;
export const TASK_TYPE_LABEL: Record<TaskType, string> = PRICE_TYPE_LABEL;
export function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v);
}
// 게시물이 생기는 유형만 RT/인용RT의 대상이 될 수 있다. RT는 별도 게시물이 없다.
export const TARGETABLE_TYPES: readonly TaskType[] = ['post', 'quoteRt', 'visit'];
export const TARGETING_TYPES: readonly TaskType[] = ['rt', 'quoteRt'];

export type TaskStage = 'planned' | 'visitPending' | 'visited' | DraftStatus | 'published' | 'removed';
export const TASK_STAGE_LABEL: Record<TaskStage, string> = {
  planned: '예정', visitPending: '방문 전', visited: '방문 완료', ...STATUS_LABEL, published: '게시됨', removed: '내려짐',
};
export interface TaskStageInput {
  type: TaskType; draftStatus: DraftStatus | null;
  postedAt: string | null; removedAt: string | null;
  scheduledOn: string | null; visitOn: string | null;
}
// 우선순위: 내려짐 > 게시됨 > 원고 상태 > 방문(완료/전) > 예정. 게시 확인은 원고 status와 무관하게 이긴다(status 값은 바꾸지 않는다).
export function taskStage(t: TaskStageInput, today: string): TaskStage {
  if (t.postedAt && t.removedAt) return 'removed';
  if (t.postedAt) return 'published';
  if (t.draftStatus) return t.draftStatus;
  if (t.type === 'visit') return t.visitOn !== null && t.visitOn < today ? 'visited' : 'visitPending';
  return 'planned';
}
// 미사용 = 붙은 원고가 미사용이고 아직 게시하지 않은 작업 — 요약 N·합계·인플 건수에서 빠진다(흐린 행의 유일한 조건, §4-1)
export function isTaskUnused(t: TaskStageInput): boolean {
  return t.draftStatus === 'unused' && t.postedAt === null;
}
// 밀림 = 게시 예정일 < 오늘 · 게시 안 됨 · 미사용 아님. 방문일은 쓰지 않는다(방문→게시 사이가 긴 것이 정상).
export function isTaskOverdue(t: TaskStageInput, today: string): boolean {
  return t.scheduledOn !== null && t.scheduledOn < today && t.postedAt === null && !isTaskUnused(t);
}
const PREPARING_STAGES: readonly TaskStage[] = ['draft', 'review', 'approved', 'planned', 'visitPending', 'visited'];
export function isTaskPreparing(t: TaskStageInput, today: string): boolean {
  return PREPARING_STAGES.includes(taskStage(t, today));
}
export function matchesTaskFilter(t: TaskStageInput, f: StageFilter, today: string): boolean {
  if (f === 'all') return true;
  if (f === 'preparing') return isTaskPreparing(t, today);
  if (f === 'published') return t.postedAt !== null && !isTaskUnused(t);   // 내려짐도 게시는 했다 — 게시 n과 같은 모집단
  return taskStage(t, today) === 'delivered';
}

// 대상(RT/인용RT) — 가리킨 작업의 post_url이 있거나 링크가 직접 있으면 확정.
export type TargetStatus = 'none' | 'pending' | 'ready';
export interface TargetInput { targetTaskId: string | null; targetPostUrl: string | null; targetTweetUrl: string | null }
export function targetUrlOf(t: TargetInput): string | null {
  if (t.targetTaskId) return t.targetPostUrl;
  return t.targetTweetUrl;
}
export function targetStatus(t: TargetInput): TargetStatus {
  if (t.targetTaskId) return t.targetPostUrl ? 'ready' : 'pending';
  return t.targetTweetUrl ? 'ready' : 'none';
}

export interface TaskSummary { total: number; published: number; delivered: number; preparing: number; overdue: number; removed: number }
export function summarizeTasks(items: TaskStageInput[], today: string): TaskSummary {
  const s: TaskSummary = { total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0, removed: 0 };
  for (const t of items) {
    if (isTaskUnused(t)) continue;
    s.total += 1;
    const stage = taskStage(t, today);
    if (t.postedAt) s.published += 1;
    if (stage === 'removed') s.removed += 1;
    else if (stage === 'delivered') s.delivered += 1;
    else if (PREPARING_STAGES.includes(stage)) s.preparing += 1;
    if (isTaskOverdue(t, today)) s.overdue += 1;
  }
  return s;
}
export interface TaskPerfInput extends TaskStageInput { perf: { views: number | null; likes: number | null } | null; linkClicks: number | null }
export function summarizeTaskPerf(items: TaskPerfInput[]): PerfSummary {
  const out: PerfSummary = { publishedCount: 0, views: null, likes: null, linkClicks: null };
  const add = (k: 'views' | 'likes' | 'linkClicks', v: number | null) => { if (v !== null) out[k] = (out[k] ?? 0) + v; };
  for (const it of items) {
    if (isTaskUnused(it)) continue;
    if (it.postedAt) out.publishedCount += 1;
    add('views', it.perf?.views ?? null);
    add('likes', it.perf?.likes ?? null);
    add('linkClicks', it.linkClicks);
  }
  return out;
}
// 표 하단 한 줄·정산 검토용 — 있는 유형만, TASK_TYPES 순. 미사용 제외, 내려짐 포함(합계와 같은 모집단).
export interface TypeSubtotal { type: TaskType; count: number; published: number; cost: MoneyByCurrency }
export function subtotalsByType(items: Array<TaskStageInput & { cost: TaskCost | null }>): TypeSubtotal[] {
  const out: TypeSubtotal[] = [];
  for (const type of TASK_TYPES) {
    const mine = items.filter((t) => t.type === type && !isTaskUnused(t));
    if (mine.length === 0) continue;
    out.push({
      type, count: mine.length, published: mine.filter((t) => t.postedAt !== null).length,
      cost: sumMoney(mine.flatMap((t) => (t.cost ? [t.cost] : []))),
    });
  }
  return out;
}

export type TaskSortKey = 'created' | 'scheduled' | 'stage' | 'influencer';
export const TASK_SORT_LABEL: Record<TaskSortKey, string> = { created: '만든 순', scheduled: '예정일', stage: '단계', influencer: '인플루언서' };
export interface TaskSortInput extends TaskStageInput { influencerHandle: string | null; createdAt: string }
const TASK_STAGE_ORDER: Record<TaskStage, number> = {
  planned: 0, visitPending: 0, visited: 1, draft: 0, review: 1, approved: 2, delivered: 3, published: 4, removed: 5, unused: 6,
};
// 기본은 만든 순(koo 08-28) — 밀림도 자리를 바꾸지 않고 표시만 강조한다. 미사용은 어느 키든 맨 아래(흐린 행이 중간에 끼지 않게).
export function sortTasks<T extends TaskSortInput>(items: T[], key: TaskSortKey, today: string): T[] {
  const byCreated = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  const bySchedule = (a: T, b: T): number => {
    if (a.scheduledOn === b.scheduledOn) return byCreated(a, b);
    if (a.scheduledOn === null) return 1;
    if (b.scheduledOn === null) return -1;
    return a.scheduledOn.localeCompare(b.scheduledOn);
  };
  return [...items].sort((a, b) => {
    const u = Number(isTaskUnused(a)) - Number(isTaskUnused(b));
    if (u !== 0) return u;
    if (key === 'created') return byCreated(a, b);
    if (key === 'scheduled') return bySchedule(a, b);
    if (key === 'stage') return (TASK_STAGE_ORDER[taskStage(a, today)] - TASK_STAGE_ORDER[taskStage(b, today)]) || byCreated(a, b);
    const ha = (a.influencerHandle ?? '').toLowerCase();
    const hb = (b.influencerHandle ?? '').toLowerCase();
    if (ha === hb) return byCreated(a, b);
    if (!ha) return 1;
    if (!hb) return -1;
    return ha.localeCompare(hb);
  });
}

export interface TaskCostInput extends TaskStageInput { influencerHandle: string | null; cost: TaskCost | null }
export interface TaskInfluencerLine {
  handle: string | null;                               // null = 미배정 작업 묶음(작업이 있을 때만 한 줄)
  taskCount: number;                                   // 미사용 제외
  countsByType: Partial<Record<TaskType, number>>;    // '투고 1 · RT 3'의 재료
  taskCost: MoneyByCurrency;
  extraCosts: ExtraCost[];
  extraCost: MoneyByCurrency;
  subtotal: MoneyByCurrency;
  note: string;
  hasCostRow: boolean;                                 // 비용 행만 있고 작업 0 → "배정 작업 없음"
}
export function deriveTaskInfluencers(tasks: TaskCostInput[], costRows: CostRowInput[]): TaskInfluencerLine[] {
  type Bucket = { handle: string | null; tasks: TaskCostInput[]; row: CostRowInput | null };
  const byKey = new Map<string, Bucket>();
  const keyOf = (h: string | null) => (h ? h.toLowerCase() : '');
  for (const t of tasks) {
    if (isTaskUnused(t)) continue;
    const k = keyOf(t.influencerHandle);
    const b = byKey.get(k) ?? { handle: t.influencerHandle, tasks: [], row: null };
    b.tasks.push(t);
    byKey.set(k, b);
  }
  for (const r of costRows) {
    const k = keyOf(r.influencerHandle);
    const b = byKey.get(k) ?? { handle: r.influencerHandle, tasks: [], row: null };
    b.row = r;
    byKey.set(k, b);
  }
  const lines: TaskInfluencerLine[] = [];
  for (const [k, b] of byKey) {
    if (k === '' && b.tasks.length === 0) continue;
    const countsByType: Partial<Record<TaskType, number>> = {};
    for (const t of b.tasks) countsByType[t.type] = (countsByType[t.type] ?? 0) + 1;
    const taskCost = sumMoney(b.tasks.flatMap((t) => (t.cost ? [t.cost] : [])));
    const extraCosts = b.row?.extraCosts ?? [];
    const extraCost = sumMoney(extraCosts);
    lines.push({
      handle: b.handle, taskCount: b.tasks.length, countsByType, taskCost, extraCosts, extraCost,
      subtotal: mergeMoney(taskCost, extraCost), note: b.row?.note ?? '', hasCostRow: b.row !== null,
    });
  }
  return lines.sort((a, b) => {
    if (a.handle === null) return 1;
    if (b.handle === null) return -1;
    return (b.taskCount - a.taskCount) || a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());
  });
}
export function taskCampaignTotal(lines: TaskInfluencerLine[]): MoneyByCurrency {
  return mergeMoney(...lines.map((l) => l.subtotal));
}
/** '투고 1 · RT 3' — TASK_TYPES 순, 0은 생략. 전부 0이면 '' */
export function countsByTypeLabel(counts: Partial<Record<TaskType, number>>): string {
  return TASK_TYPES.filter((t) => (counts[t] ?? 0) > 0).map((t) => `${TASK_TYPE_LABEL[t]} ${counts[t]}`).join(' · ');
}
// 정산 후보(§7) — 게시 확인 + 비용 + 인플. 내려짐(removed_at)은 판단 참고 정보라 조건에 넣지 않는다(koo 08-27).
export function isSettlementCandidate(t: { postedAt: string | null; cost: TaskCost | null; influencerHandle: string | null; removedAt: string | null }): boolean {
  return t.postedAt !== null && t.cost !== null && t.influencerHandle !== null;
}
