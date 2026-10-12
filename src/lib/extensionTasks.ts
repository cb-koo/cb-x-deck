// 확장 API 작업 요약의 순수 판정 — DB 접근 없음. 목록 items·total·배지 activeCount가 모두 이 한 함수(classifyTask)의
// bucket을 쓴다(계획 §11 '건수' 검증: 같은 조건). 방문 단계·허용 행동은 reservationPolicy, 공통 6단계는 flowStage를 그대로 쓴다.
import { daysBetweenDates, flowStage, TASK_TYPE_LABEL, type FlowSettlementInput, type FlowStage, type TaskType } from './campaignJudgment.ts';
import type { DraftStatus } from './draftStatus.ts';
import type { TaskCost } from './campaignCost.ts';
import {
  allowedVisitActions, ENDED_PHASES, visitPhase,
  type DeadlineMode, type StoredEndKind, type VisitAction, type VisitPhase,
} from './reservationPolicy.ts';

export type TaskBucket = 'active' | 'completed' | 'ended';
export const TASK_BUCKETS: readonly TaskBucket[] = ['active', 'completed', 'ended'];
export const TASK_PAGE_LIMIT = 20;
export const BADGE_BATCH_LIMIT = 50;

// 서버 TaskType('quoteRt')과 wire 표기('quote_rt')의 대응은 여기 한 곳.
export type WireTaskKind = 'visit' | 'post' | 'rt' | 'quote_rt';
const WIRE_KIND: Record<TaskType, WireTaskKind> = { visit: 'visit', post: 'post', rt: 'rt', quoteRt: 'quote_rt' };

export interface TaskFacts {
  id: string; campaignId: string; campaignName: string; type: TaskType;
  influencerHandle: string | null; draftStatus: DraftStatus | null;
  postedAt: string | null; postUrl: string | null; removedAt: string | null; cancelledAt: string | null;
  scheduledOn: string | null; visitOn: string | null;
  cost: TaskCost | null; noCost: boolean; version: number;
  hasConsent: boolean;
  visitCompletedAt: string | null;
  settlement: FlowSettlementInput | null;
  endKind: StoredEndKind | null;
  // visitAt = 시트의 희망 일시(서울 'YYYY-MM-DDTHH:mm', 없으면 '')
  reservation: { confirmed: boolean; visitAt: string; deadlineMode: DeadlineMode } | null;
  requestCount: number;
}

export interface TaskDto {
  id: string; campaignId: string; personId: string; title: string; kind: WireTaskKind;
  flowStage: FlowStage; visitPhase: VisitPhase | null;
  noCost: boolean; amount: number | null; currency: TaskCost['currency'] | null;
  visitAt: string | null; uploadDeadline: string | null; deadlineMode: DeadlineMode;
  hasConsent: boolean;
  version: number; allowedActions: VisitAction[];
  postedAt: string | null; postUrl: string | null;
  dDay: number | null;   // ClassifiedTask.dDay — 배지와 같은 값. 확장이 날짜를 따로 계산하지 않게 서버가 준다
  webUrl: string;
}

export interface ClassifiedTask {
  bucket: TaskBucket;
  visitPhase: VisitPhase | null;
  flowStage: FlowStage;
  dDay: number | null;
  nextDate: string | null;   // 정렬 기준: 다음 미완료 일정
}

// 서울 'YYYY-MM-DDTHH:mm' → offset 있는 ISO(계획 §5: 조회는 offset 포함 ISO).
export function seoulIso(visitAt: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(visitAt) ? `${visitAt}:00+09:00` : null;
}

export function classifyTask(t: TaskFacts, today: string): ClassifiedTask {
  const stage = flowStage(t, t.settlement);
  if (t.type === 'visit') {
    const phase = visitPhase({
      endKind: t.endKind, cancelledAt: t.cancelledAt, postedAt: t.postedAt, noCost: t.noCost,
      settlement: t.settlement, visitCompletedAt: t.visitCompletedAt, visitOn: t.visitOn,
      reservation: t.reservation ? { confirmed: t.reservation.confirmed, visitAt: t.reservation.visitAt } : null,
    }, today);
    const bucket: TaskBucket = phase === 'completed' ? 'completed' : ENDED_PHASES.includes(phase) ? 'ended' : 'active';
    const visitDate = t.reservation?.visitAt ? t.reservation.visitAt.slice(0, 10) : null;
    const nextDate = bucket !== 'active' ? null
      : (phase === 'waiting' || phase === 'confirmed') && visitDate ? visitDate
      : t.scheduledOn;
    return { bucket, visitPhase: phase, flowStage: stage, nextDate, dDay: nextDate ? daysBetweenDates(today, nextDate) : null };
  }
  // 콘텐츠 작업: 취소 = 종료, 지급 완료 또는 비용 없음의 게시 확인 = 완료(계획 §2 완료·정산).
  const bucket: TaskBucket = stage === 'canc' ? 'ended'
    : stage === 'done' || (t.postedAt !== null && t.noCost) ? 'completed'
    : 'active';
  const nextDate = bucket === 'active' && t.postedAt === null ? t.scheduledOn : null;
  return { bucket, visitPhase: null, flowStage: stage, nextDate, dDay: nextDate ? daysBetweenDates(today, nextDate) : null };
}

// 가까운 일정 순, 날짜 없으면 뒤, 같은 날은 task id 순(계획 §10).
export function compareClassified(a: { c: ClassifiedTask; id: string }, b: { c: ClassifiedTask; id: string }): number {
  if (a.c.nextDate !== b.c.nextDate) {
    if (a.c.nextDate === null) return 1;
    if (b.c.nextDate === null) return -1;
    return a.c.nextDate.localeCompare(b.c.nextDate);
  }
  return a.id.localeCompare(b.id);
}

export function toTaskDto(t: TaskFacts, c: ClassifiedTask, personId: string, today: string, origin: string): TaskDto {
  const isVisit = t.type === 'visit';
  const facts = {
    endKind: t.endKind, cancelledAt: t.cancelledAt, postedAt: t.postedAt, noCost: t.noCost,
    settlement: t.settlement, visitCompletedAt: t.visitCompletedAt, visitOn: t.visitOn,
    reservation: t.reservation ? { confirmed: t.reservation.confirmed, visitAt: t.reservation.visitAt } : null,
  };
  return {
    id: t.id,
    campaignId: t.campaignId,
    personId,
    title: `${t.campaignName} · ${TASK_TYPE_LABEL[t.type]}`,
    kind: WIRE_KIND[t.type],
    flowStage: c.flowStage,
    visitPhase: c.visitPhase,
    noCost: t.noCost,
    amount: t.cost?.amount ?? null,
    currency: t.cost?.currency ?? null,
    visitAt: isVisit && t.reservation ? seoulIso(t.reservation.visitAt) : null,
    uploadDeadline: t.scheduledOn,
    deadlineMode: t.reservation?.deadlineMode ?? 'default',
    hasConsent: t.hasConsent,
    postedAt: t.postedAt,
    postUrl: t.postUrl,
    version: t.version,
    allowedActions: isVisit ? allowedVisitActions(facts, t.requestCount, today) : [],
    dDay: c.dDay,
    webUrl: `${origin}/campaigns/flow?id=${encodeURIComponent(t.campaignId)}&task=${encodeURIComponent(t.id)}`,
  };
}

// 불투명 cursor = 다음 offset. 같은 bucket·정렬로만 의미가 있다.
export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}
export function decodeCursor(cursor: string | null): number | null {
  if (cursor === null || cursor === '') return 0;
  const m = /^o:(\d{1,6})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  return m ? Number(m[1]) : null;
}

export function pageOf<T>(items: T[], offset: number, limit: number): { items: T[]; total: number; nextCursor: string | null } {
  const slice = items.slice(offset, offset + limit);
  const next = offset + limit;
  return { items: slice, total: items.length, nextCursor: next < items.length ? encodeCursor(next) : null };
}
