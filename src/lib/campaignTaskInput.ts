// 작업 API 입력 검증 — 순수(DB 없음). 라우트 4곳(작업 생성·패치, 원고 PATCH·POST의 taskId)이 같은 규칙을 쓴다.
import type { Parsed, TaskCost } from './campaignCost.ts';
import { parseTaskCost } from './campaignCost.ts';
import { isTaskType, isDateOnlyString, type TaskType } from './campaignJudgment.ts';
import type { TaskPatch } from './campaignTaskStore.ts';
import { parseTweetLink, tweetPermalink } from './tweetLink.ts';
import { parseXHandle, handleParseMessage } from './xHandle.ts';
import { isUuidLike } from './uuid.ts';
import { isTaskProofPath, isTaskProofPathFor, PROOF_VALUE_MESSAGE, PROOF_ONLY_RT_MESSAGE, PROOF_KEEP_MESSAGE, PROOF_REQUIRED_MESSAGE, type TaskProof } from './taskProofGuard.ts';

export const TASK_ID_MESSAGE = '작업 값이 올바르지 않아요';
export const TASK_NOT_FOUND_MESSAGE = '작업을 찾을 수 없어요 — 삭제됐을 수 있어요. 화면을 새로고침해 주세요';
export const DRAFT_ATTACHED_MESSAGE = '이 원고는 이미 다른 작업에 붙어 있어요 — 먼저 그 작업에서 떼어 주세요';
export const TASK_HAS_DRAFT_MESSAGE = '이 작업엔 이미 원고가 있어요 — 작업 하나에 원고는 하나만 붙어요';

// undefined = 키 없음(건드리지 않음) · null = 떼기 · uuid = 붙이기
export function parseTaskIdPatch(v: unknown): Parsed<string | null | undefined> {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (typeof v === 'string' && isUuidLike(v)) return { ok: true, value: v };
  return { ok: false, message: TASK_ID_MESSAGE };
}

export const TASK_TYPE_MESSAGE = '작업 유형 값이 올바르지 않아요';
export const TARGET_MESSAGE = 'RT 대상 링크가 X 게시물 주소가 아니에요';
// 같은 파서를 쓰지만 사용자가 채운 칸이 다르다 — 게시물 링크 오류에 'RT 대상'이라고 말하면 어느 칸을 고칠지 알 수 없다
export const POST_URL_MESSAGE = '게시물 링크가 X 게시물 주소가 아니에요';
export const TARGET_TYPE_MESSAGE = 'RT 작업은 대상이 될 수 없어요 — 투고·인용RT·방문협찬 작업을 골라 주세요';
export const TARGET_SELF_MESSAGE = '작업이 자기 자신을 대상으로 가질 수 없어요';
export const VISIT_ON_MESSAGE = '방문일은 방문협찬 작업에만 있어요';
export const DRAFT_MULTI_MESSAGE = '원고는 한 사람에게만 붙일 수 있어요 — 인플루언서를 한 명만 고르거나 원고를 빼 주세요';
export const POSTED_AT_NULL_MESSAGE = '게시 확인은 지울 수 없어요 — 잘못 찍었으면 작업을 삭제하고 다시 만들어 주세요';
export const REMOVED_WITHOUT_POSTED_MESSAGE = '게시 확인이 없는 작업이에요 — 게시 내림은 게시된 작업에만 표시할 수 있어요';
export const DATE_MESSAGE = '날짜는 YYYY-MM-DD 형식이어야 해요';
function fail<T>(message: string): Parsed<T> { return { ok: false, message }; }

export const CANCELLED_TASK_MESSAGE = '취소된 작업이에요 — 되돌린 뒤 고쳐 주세요';
export const CANCEL_POSTED_MESSAGE = '이미 게시된 작업은 취소할 수 없어요 — 내림으로 처리해 주세요';
export const POST_CANCELLED_MESSAGE = '취소된 작업이에요 — 되돌린 뒤 게시 확인해 주세요';
export const REPLACE_REQUIRED_MESSAGE = '다른 인플루언서로 바꾸려면 교체를 써 주세요';
export const REPLACE_AFTER_VISIT_MESSAGE = '방문한 인플루언서가 게시해야 해요 — 진행이 안 되면 취소해 주세요';
export const CANCEL_REASON_MESSAGE = '취소 사유 값이 올바르지 않아요';
export const RESTORE_NOT_CANCELLED_MESSAGE = '취소된 작업이 아니에요';
export const POSTED_TASK_MESSAGE = '이미 게시된 작업이에요 — 인플루언서를 바꿀 수 없어요';

// 인플루언서 칸을 바꾸는 모든 요청(배정·해제·교체)에 같은 상태 제한(ADR 0005). PATCH는 "다른 인플로"를 막고 교체 라우트로 보낸다.
export function influencerChangeGuard(
  cur: { postedAt: string | null; cancelledAt: string | null; type: TaskType; visitOn: string | null; influencerHandle: string | null },
  next: string | null, today: string, opts: { allowReplace?: boolean } = {},
): string | null {
  if (cur.cancelledAt) return CANCELLED_TASK_MESSAGE;
  if (cur.postedAt) return POSTED_TASK_MESSAGE;
  const same = (cur.influencerHandle ?? '').toLowerCase() === (next ?? '').toLowerCase();
  if (same) return null;
  if (cur.type === 'visit' && cur.visitOn !== null && cur.visitOn < today) return REPLACE_AFTER_VISIT_MESSAGE;   // 방문 완료 판정과 같은 기준(< 오늘)
  if (cur.influencerHandle && next && !opts.allowReplace) return REPLACE_REQUIRED_MESSAGE;
  return null;
}

export function parseReplaceBody(body: unknown): Parsed<{ handle: string; cost: TaskCost | null | undefined; reason: CancelReason | null; note: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const h = parseXHandle(String(b.handle ?? ''));
  if (!h.ok) return fail(handleParseMessage(h.reason));
  let cost: TaskCost | null | undefined = undefined;
  if ('cost' in b) { const c = parseTaskCost(b.cost); if (!c.ok) return c; cost = c.value; }
  const r = parseCancelBody(b);
  if (!r.ok) return r;
  return { ok: true, value: { handle: h.handle, cost, reason: r.value.reason, note: r.value.note } };
}

export const CANCEL_REASONS = ['declined', 'no_response', 'other'] as const;
export type CancelReason = typeof CANCEL_REASONS[number];
export const isCancelReason = (v: unknown): v is CancelReason => typeof v === 'string' && (CANCEL_REASONS as readonly string[]).includes(v);

// 취소 요청 본문 — reason은 없어도(단순 취소) 되고, 셋 중 하나여야 한다.
export function parseCancelBody(body: unknown): Parsed<{ reason: CancelReason | null; note: string }> {
  const b = (body ?? {}) as Record<string, unknown>;
  let reason: CancelReason | null = null;
  if (b.reason != null && b.reason !== '') {
    if (!isCancelReason(b.reason)) return fail(CANCEL_REASON_MESSAGE);
    reason = b.reason;
  }
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  return { ok: true, value: { reason, note } };
}

// 사용자가 붙인 X 링크 → 정규형 permalink(x.com/twitter.com·꼬리 무관). 핸들이 있으면 보존, 없으면 /i/status/.
export function normalizeTargetTweetUrl(v: string): string | null {
  const p = parseTweetLink(v);
  if (!p.ok) return null;
  const m = /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\//i.exec(v);
  const handle = m && m[1].toLowerCase() !== 'i' ? m[1] : null;
  return tweetPermalink(handle, p.tweetId);
}
const dateOrNull = (v: unknown): Parsed<string | null> => {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  return isDateOnlyString(v) ? { ok: true, value: v } : fail(DATE_MESSAGE);
};
const uuidOrNull = (v: unknown, message: string): Parsed<string | null> => {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  return typeof v === 'string' && isUuidLike(v) ? { ok: true, value: v } : fail(message);
};

// 날짜는 사람마다 다르다(같은 캠페인이어도 인플마다 올리는 날이 다르다) — influencers[]의 날짜가 먼저고,
// 최상위 scheduledOn/visitOn은 그 줄에 날짜가 없을 때의 기본값(미배정 1행도 이걸 쓴다).
export const COUNT_MESSAGE = '만들 개수는 1~20 사이여야 해요';
export const COUNT_WITH_ITEMS_MESSAGE = '개수로 만들 때는 인플루언서·원고 없이 빈 작업만 만들어요';

export interface TaskCreateBody {
  type: TaskType; targetTaskId: string | null; targetTweetUrl: string | null; draftId: string | null;
  scheduledOn: string | null; visitOn: string | null; note: string; cost: TaskCost | null;
  influencers: Array<{ handle: string; cost: TaskCost | null; scheduledOn: string | null; visitOn: string | null }>;
  count: number | null;   // 뼈대 N개 한 번에 만들기(§4-1) — influencers 비고 draftId 없을 때만
}
export function parseTaskCreate(body: unknown): Parsed<TaskCreateBody> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isTaskType(b.type)) return fail(TASK_TYPE_MESSAGE);
  const targetTaskId = uuidOrNull(b.targetTaskId, TASK_ID_MESSAGE); if (!targetTaskId.ok) return targetTaskId;
  let targetTweetUrl: string | null = null;
  if (typeof b.targetTweetUrl === 'string' && b.targetTweetUrl.trim()) {
    targetTweetUrl = normalizeTargetTweetUrl(b.targetTweetUrl);
    if (!targetTweetUrl) return fail(TARGET_MESSAGE);
  }
  const draftId = uuidOrNull(b.draftId, TASK_ID_MESSAGE); if (!draftId.ok) return draftId;
  const scheduledOn = dateOrNull(b.scheduledOn); if (!scheduledOn.ok) return scheduledOn;
  const visitOn = dateOrNull(b.visitOn); if (!visitOn.ok) return visitOn;
  if (visitOn.value && b.type !== 'visit') return fail(VISIT_ON_MESSAGE);
  const cost = b.cost === undefined ? { ok: true as const, value: null } : parseTaskCost(b.cost); if (!cost.ok) return cost;
  const raw = Array.isArray(b.influencers) ? b.influencers : [];
  const influencers: TaskCreateBody['influencers'] = [];
  for (const it of raw) {
    const o = (it ?? {}) as { handle?: unknown; cost?: unknown; scheduledOn?: unknown; visitOn?: unknown };
    const h = parseXHandle(String(o.handle ?? ''));
    if (!h.ok) return fail(handleParseMessage(h.reason));
    const c = o.cost === undefined ? { ok: true as const, value: null } : parseTaskCost(o.cost); if (!c.ok) return c;
    const s = dateOrNull(o.scheduledOn); if (!s.ok) return s;
    const v = dateOrNull(o.visitOn); if (!v.ok) return v;
    if (v.value && b.type !== 'visit') return fail(VISIT_ON_MESSAGE);
    influencers.push({ handle: h.handle, cost: c.value, scheduledOn: s.value, visitOn: v.value });
  }
  if (draftId.value && influencers.length > 1) return fail(DRAFT_MULTI_MESSAGE);
  let count: number | null = null;
  if (b.count !== undefined) {
    if (typeof b.count !== 'number' || !Number.isInteger(b.count) || b.count < 1 || b.count > 20) return fail(COUNT_MESSAGE);
    if (influencers.length > 0 || draftId.value) return fail(COUNT_WITH_ITEMS_MESSAGE);
    count = b.count;
  }
  return { ok: true, value: {
    type: b.type, targetTaskId: targetTaskId.value, targetTweetUrl, draftId: draftId.value,
    scheduledOn: scheduledOn.value, visitOn: visitOn.value, note: typeof b.note === 'string' ? b.note.trim() : '', cost: cost.value, influencers, count,
  } };
}

// 파서는 멤버를 모르므로 증빙은 경로만 넘긴다 — 라우트가 by/byName/at을 붙여 TaskPatch.proof를 만든다(§5-1).
export type TaskPatchParsed = Omit<TaskPatch, 'proof'> & { proofUrl?: string | null };

// 온 키만 결과에 실린다(undefined=건드리지 않음) — 스토어 updateTask의 3값 규칙과 맞물린다
export function parseTaskPatch(body: unknown): Parsed<TaskPatchParsed> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: TaskPatchParsed = {};
  if ('influencerHandle' in b) {
    if (b.influencerHandle === null) out.influencerHandle = null;
    else { const h = parseXHandle(String(b.influencerHandle ?? '')); if (!h.ok) return fail(handleParseMessage(h.reason)); out.influencerHandle = h.handle; }
  }
  if ('targetTaskId' in b) { const r = uuidOrNull(b.targetTaskId, TASK_ID_MESSAGE); if (!r.ok) return r; out.targetTaskId = r.value; }
  if ('targetTweetUrl' in b) {
    if (b.targetTweetUrl === null || b.targetTweetUrl === '') out.targetTweetUrl = null;
    else { const u = normalizeTargetTweetUrl(String(b.targetTweetUrl)); if (!u) return fail(TARGET_MESSAGE); out.targetTweetUrl = u; }
  }
  if ('postUrl' in b) {
    if (b.postUrl === null || b.postUrl === '') out.postUrl = null;
    else { const u = normalizeTargetTweetUrl(String(b.postUrl)); if (!u) return fail(POST_URL_MESSAGE); out.postUrl = u; }
  }
  if ('postedAt' in b) {
    if (b.postedAt === null) return fail(POSTED_AT_NULL_MESSAGE);
    if (!isDateOnlyString(b.postedAt)) return fail(DATE_MESSAGE);
    out.postedAt = b.postedAt; out.postedSource = 'manual';   // 사람이 찍는 경로는 항상 manual — 클라가 source를 정하지 못한다
  }
  if ('removedAt' in b) { const r = dateOrNull(b.removedAt); if (!r.ok) return r; out.removedAt = r.value; }
  if ('removedReason' in b) out.removedReason = typeof b.removedReason === 'string' ? b.removedReason.trim() : '';
  if ('scheduledOn' in b) { const r = dateOrNull(b.scheduledOn); if (!r.ok) return r; out.scheduledOn = r.value; }
  if ('visitOn' in b) { const r = dateOrNull(b.visitOn); if (!r.ok) return r; out.visitOn = r.value; }
  if ('cost' in b) { const c = parseTaskCost(b.cost); if (!c.ok) return c; out.cost = c.value; }
  if ('note' in b) out.note = typeof b.note === 'string' ? b.note.trim() : '';
  if ('proof' in b) {
    if (b.proof === null) out.proofUrl = null;
    else if (isTaskProofPath(b.proof)) out.proofUrl = b.proof;
    else return fail(PROOF_VALUE_MESSAGE);
  }
  return { ok: true, value: out };
}

// RT 증빙 3규칙의 판정 — 라우트에 테스트 하네스가 없어 순수 함수로 뺀다(리뷰에서 우회 구멍이 잡힌 자리).
// 핵심: "패치 후 상태"로 판단해야 한다. 패치 전 증빙(cur.proof)만 보면 한 요청에 postedAt과
// proof:null을 합쳐 보내는 것을 통과시켜, 되돌릴 수 없는 '증빙 없는 게시됨 RT'가 남는다.
export function proofGateError(
  cur: { id: string; type: TaskType; postedAt: string | null; proof: TaskProof | null },
  patch: { postedAt?: string; proofUrl?: string | null },
): string | null {
  // ① 범위 — RT 작업에만 붙는다
  if (patch.proofUrl !== undefined && cur.type !== 'rt') return PROOF_ONLY_RT_MESSAGE;
  // ② 이 작업의 증빙인가 — 모양만 맞는 남의 경로를 막는다(판정을 라우트에 두지 않는다, 리뷰 Important)
  if (patch.proofUrl != null && !isTaskProofPathFor(cur.id, patch.proofUrl)) return PROOF_VALUE_MESSAGE;
  // 패치 후 증빙 — 이번 요청이 증빙 키를 안 보냈으면 원래 값이 남는다
  const proofAfter = patch.proofUrl !== undefined ? patch.proofUrl : (cur.proof?.url ?? null);
  // ③ 떼기 금지 — 이미 게시됨인 RT에서 비우는 것만 막는다. 아직 게시 전이면 자유롭게 뗄 수 있고,
  //    이번 요청이 게시까지 함께 하는 경우는 ④가 '증빙이 필요하다'는 정확한 문구로 잡는다(문구-값 일치).
  if (patch.proofUrl === null && cur.postedAt) return PROOF_KEEP_MESSAGE;
  // ④ 필수 — 새로 게시됨이 되는 RT는 패치 후 증빙이 있어야 한다
  if (patch.postedAt && !cur.postedAt && cur.type === 'rt' && !proofAfter) return PROOF_REQUIRED_MESSAGE;
  return null;
}
