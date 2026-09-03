import type { DraftStatus } from './draftStatus.ts';
import type { TaskCost } from './campaignCost.ts';
import { TARGETING_TYPES, TASK_TYPES, TASK_TYPE_LABEL, isTaskUnused, type TaskType } from './campaignJudgment.ts';
import type { ExternalStatus, SettlementBadgeStatus } from './campaignTaskStore.ts';

// 업무 흐름대로 본 작업 판정 — 스펙 2026-09-03 §2·3·5.
// campaignJudgment의 taskStage는 '원고가 어디까지 갔나'를 말한다. 이쪽은 '지금 누구 차례인가'를 말한다.
// 둘은 다른 질문이라 따로 둔다. 여기도 순수 함수다 — DB 접근 없음, '오늘'은 인자.

export const WORKFLOW_STAGES = [
  'cancelled', 'done', 'payPending', 'settlePending', 'postPending', 'deliverPending', 'preparing',
] as const;
export type WorkflowStage = typeof WORKFLOW_STAGES[number];

export const WORKFLOW_STAGE_LABEL: Record<WorkflowStage, string> = {
  cancelled: '취소', done: '완료', payPending: '지급 대기', settlePending: '정산 대기',
  postPending: '게시 대기', deliverPending: '전달 대기', preparing: '준비',
};

// 누구 차례인가 — 막힌 것(§5) 계산과 화면 배치의 근거다.
export type StageOwner = 'us' | 'influencer' | 'settlement' | 'closed';
export const WORKFLOW_STAGE_OWNER: Record<WorkflowStage, StageOwner> = {
  cancelled: 'closed', done: 'closed', payPending: 'settlement', settlePending: 'us',
  postPending: 'influencer', deliverPending: 'us', preparing: 'us',
};
export const STAGE_OWNER_LABEL: Record<StageOwner, string> = {
  us: '우리 차례', influencer: '인플루언서 차례', settlement: '정산 프로덕트', closed: '종결',
};

// 업무 순서대로 — 우리가 손댈 것이 위에 온다. 묶기 '진행'의 묶음 순서이기도 하다.
export const WORKFLOW_STAGE_ORDER: readonly WorkflowStage[] = [
  'preparing', 'deliverPending', 'postPending', 'settlePending', 'payPending', 'done', 'cancelled',
];
// 주 단위라 완료가 쌓이면 화면이 길어진다 — 종결된 것은 기본으로 접는다(§6-2).
export const COLLAPSED_STAGES: readonly WorkflowStage[] = ['done', 'cancelled'];

export interface WorkflowInput {
  type: TaskType;
  influencerHandle: string | null;
  draftId: string | null;
  draftStatus: DraftStatus | null;
  draftBy: 'us' | 'influencer' | null;   // 마이그레이션 047. 그 전에는 늘 null = '아직 안 정함'
  targetTweetUrl: string | null;
  target: { postUrl: string | null } | null;
  cost: TaskCost | null;
  scheduledOn: string | null;
  deliveredOn: string | null;            // 047. 그 전에는 null → isDelivered가 원고 상태로 대신 읽는다
  postedAt: string | null;
  cancelledOn: string | null;            // 047. 그 전에는 늘 null → 취소 단계가 비어 보인다
  settlement: { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null } | null;
}

// 준비가 끝나는 조건(§3). 무엇이 비었는지까지 돌려준다 — 「진행」 칸이 "다음에 무엇을"을 말해야 하기 때문.
export type ReadyGap = 'influencer' | 'draft' | 'target' | 'cost';
export const READY_GAP_LABEL: Record<ReadyGap, string> = {
  influencer: '인플루언서', draft: '원고', target: '대상 링크', cost: '비용',
};

// RT는 원고 개념이 없어 원고·draft_by를 보지 않는다(§3-1).
export function needsDraft(type: TaskType): boolean {
  return type !== 'rt';
}
export function needsTarget(type: TaskType): boolean {
  return TARGETING_TYPES.includes(type);
}

export function readyGaps(t: WorkflowInput): ReadyGap[] {
  const gaps: ReadyGap[] = [];
  if (!t.influencerHandle) gaps.push('influencer');
  // "원고가 있거나, 인플이 쓴다고 표시"(§3). draftBy가 null이면 아직 안 정한 것이라 막힌다 — 047 전에는 여기서 다 걸린다.
  if (needsDraft(t.type) && !t.draftId && t.draftBy !== 'influencer') gaps.push('draft');
  // 가리킨 작업이 아직 게시 안 됐으면(target.postUrl 없음) 전달할 링크가 없다 — 준비 안 끝난 것으로 본다.
  if (needsTarget(t.type) && !(t.target ? t.target.postUrl : t.targetTweetUrl)) gaps.push('target');
  if (!t.cost) gaps.push('cost');
  // 예정일은 준비 조건이 아니다(§3) — 전달할 때 "언제까지"와 함께 채워지는 값에 가깝다.
  return gaps;
}
export function isReadyToDeliver(t: WorkflowInput): boolean {
  return readyGaps(t).length === 0;
}

// 047 전에는 delivered_on이 없다. 원고 상태 '전달됨'을 대신 읽는다 —
// 실제로 전달한 사실이 기록된 유일한 자리다. RT는 원고가 없어 이 신호가 없다(그래서 047이 필요하다).
export function isDelivered(t: WorkflowInput): boolean {
  return t.deliveredOn !== null || t.draftStatus === 'delivered';
}

// 위에서 먼저 걸리는 것이 그 작업의 단계다(§2).
export function workflowStage(t: WorkflowInput, today: string): WorkflowStage {
  if (t.cancelledOn) return 'cancelled';
  if (t.settlement?.externalStatus === 'paid') return 'done';
  // 우리가 취소한 요청(status 'cancelled')은 지급 대기가 아니다 — 다시 요청해야 하니 정산 대기로 내려간다.
  if (t.settlement?.status === 'requested') return 'payPending';
  if (t.postedAt) return 'settlePending';
  if (isDelivered(t)) return 'postPending';
  if (isReadyToDeliver(t)) return 'deliverPending';
  void today;   // 지금 판정에 '오늘'은 쓰이지 않는다. 인자로 받아두는 건 밀림(§5)과 같은 서명을 유지하려는 것.
  return 'preparing';
}

// 밀림 — 게시 대기 중 예정일이 지난 것. 예정일이 없으면 밀렸는지 알 수 없다(§5).
export function isPostOverdue(t: WorkflowInput, today: string): boolean {
  return t.scheduledOn !== null && t.scheduledOn < today && !t.postedAt;
}

// 막힌 것(§5) — 우리가 손대야 하는 것만 센다. 이 구분이 없으면 숫자가 항상 크게 뜨고 의미가 없어진다.
export function isBlocked(t: WorkflowInput, today: string): boolean {
  // 미사용 원고가 붙은 작업은 세워둔 것이다 — 요약 N·합계에서 빠지는 관례를 따라 여기서도 뺀다.
  if (isTaskUnused({ type: t.type, draftStatus: t.draftStatus, postedAt: t.postedAt, removedAt: null, scheduledOn: t.scheduledOn, visitOn: null })) return false;
  const stage = workflowStage(t, today);
  if (WORKFLOW_STAGE_OWNER[stage] === 'us') return true;
  if (stage === 'postPending') return isPostOverdue(t, today);
  return false;
}
export function blockedCount(items: readonly WorkflowInput[], today: string): number {
  return items.reduce((n, t) => n + (isBlocked(t, today) ? 1 : 0), 0);
}

// 단계별 건수 — 묶음 제목이 개수를 말하므로 진행 막대는 두지 않는다(§6-2).
export function countByStage(items: readonly WorkflowInput[], today: string): Record<WorkflowStage, number> {
  const out = Object.fromEntries(WORKFLOW_STAGES.map((s) => [s, 0])) as Record<WorkflowStage, number>;
  for (const t of items) out[workflowStage(t, today)] += 1;
  return out;
}

// 묶기는 표의 기능이다(§6-1). 머리글에 얹지 않는다 — 머리글은 정렬을 기대하는 자리다.
export const GROUP_BYS = ['stage', 'influencer', 'type', 'none'] as const;
export type GroupBy = typeof GROUP_BYS[number];
export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  stage: '진행', influencer: '인플루언서', type: '유형', none: '없음',
};
export function isGroupBy(v: unknown): v is GroupBy {
  return typeof v === 'string' && (GROUP_BYS as readonly string[]).includes(v);
}

// 묶은 기준은 열에서 빠지고 안 묶은 것이 열로 들어온다 — 어느 쪽으로 묶어도 열 수가 늘지 않는다(§6-1).
export function hidesColumn(by: GroupBy, column: 'type' | 'influencer' | 'stage'): boolean {
  return by === column;
}

export interface TaskGroup<T> {
  key: string;
  label: string;
  items: T[];
  collapsedByDefault: boolean;
}

const UNASSIGNED = '미배정';

// 빈 묶음은 숨긴다(§6-2) — 돌려주는 배열에 애초에 넣지 않는다.
export function groupTasks<T extends WorkflowInput>(items: readonly T[], by: GroupBy, today: string): Array<TaskGroup<T>> {
  if (by === 'none') return items.length ? [{ key: 'all', label: '', items: [...items], collapsedByDefault: false }] : [];

  if (by === 'stage') {
    return WORKFLOW_STAGE_ORDER
      .map((s) => ({
        key: s,
        label: WORKFLOW_STAGE_LABEL[s],
        items: items.filter((t) => workflowStage(t, today) === s),
        collapsedByDefault: COLLAPSED_STAGES.includes(s),
      }))
      .filter((g) => g.items.length > 0);
  }

  if (by === 'type') {
    return TASK_TYPES
      .map((ty) => ({
        key: ty,
        label: TASK_TYPE_LABEL[ty],
        items: items.filter((t) => t.type === ty),
        collapsedByDefault: false,
      }))
      .filter((g) => g.items.length > 0);
  }

  // 인플루언서 — 표기는 보존하고 정렬·묶음 키는 lower()(핸들 관례). 미배정은 맨 아래로.
  const buckets = new Map<string, { label: string; items: T[] }>();
  for (const t of items) {
    const key = t.influencerHandle ? t.influencerHandle.toLowerCase() : '';
    const b = buckets.get(key) ?? { label: t.influencerHandle ?? UNASSIGNED, items: [] };
    b.items.push(t);
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
    .map(([key, b]) => ({ key: key || UNASSIGNED, label: b.label, items: b.items, collapsedByDefault: false }));
}

// 「진행」 칸의 다음 행동 — 지금 어디에 있고 다음에 무엇을 하면 되는지 한 줄로.
// 2단계에서 이 문구가 버튼이 된다. 지금은 문구만이라 거짓 손잡이를 만들지 않는다.
export function nextActionText(t: WorkflowInput, today: string): string {
  const stage = workflowStage(t, today);
  if (stage === 'preparing') {
    const gaps = readyGaps(t).map((g) => READY_GAP_LABEL[g]);
    return `${gaps.join(' · ')} 채우기`;
  }
  if (stage === 'deliverPending') return '인플루언서에게 전달하고 전달함 표시';
  if (stage === 'postPending') return isPostOverdue(t, today) ? '예정일이 지났어요 — 게시됐는지 확인' : '인플루언서가 올릴 차례';
  if (stage === 'settlePending') return '정산 요청 올리기';
  if (stage === 'payPending') return '정산 프로덕트가 지급할 차례';
  return '';
}
