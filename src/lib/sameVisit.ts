// 같은 방문의 게시물(089, ISSUE-016, koo 11-09) — 순수 판정·문구. DB·네트워크 없음.
// 방문협찬은 '방문 한 번 = 묶음 가격'(예: 15,000엔에 게시물 2건)으로 협상한다. 금액은 원래 작업 하나에만 두고,
// 두 번째 게시물부터는 같은 방문의 '연결 작업'(same_visit_of = 원래 작업, 비용 없음 고정)으로 만든다.
// 연결 작업은 예약·방문 수·정산 후보에서 빠지고, 게시물 수·성과에는 들어간다. CPV는 원래 작업 비용을 게시물 수로 나눈다.
import { formatAmount, type TaskCost } from './campaignCost.ts';

export const SAME_VISIT_NO_RESERVATION_MESSAGE = '같은 방문의 게시물 작업이에요. 예약은 원래 작업에 있어요.';
export const SAME_VISIT_COST_MESSAGE = '같은 방문의 게시물이라 비용 없음으로 고정돼 있어요. 금액은 원래 작업에서 바꿔 주세요.';
export const SAME_VISIT_VISIT_ON_MESSAGE = '같은 방문의 게시물이라 방문일은 원래 작업에서 바꿔 주세요.';
export const SAME_VISIT_INFLUENCER_MESSAGE = '같은 방문의 게시물이라 인플루언서를 바꿀 수 없어요.';
export const SAME_VISIT_AGREEMENT_MESSAGE = '협찬 동의서는 같은 방문의 원래 작업에 올려 주세요.';
export const ORIGINAL_INFLUENCER_LOCKED_MESSAGE = '같은 방문의 게시물 작업이 있어 인플루언서를 바꿀 수 없어요. 게시물 작업을 먼저 정리해 주세요.';
export const SAME_VISIT_CREATE_MESSAGE = {
  notVisit: '방문협찬 작업에만 게시물을 더할 수 있어요.',
  cancelled: '취소된 작업엔 게시물을 더할 수 없어요. 먼저 되돌려 주세요.',
  linked: '같은 방문의 게시물 작업이에요. 원래 작업에서 더해 주세요.',
  noInfluencer: '인플루언서를 먼저 배정해 주세요.',
} as const;
export const SAME_VISIT_DELETE_CONFIRM_MESSAGE = '같은 방문의 게시물 작업이 연결된 작업이에요. 함께 지울지 확인해 주세요.';
export const SAME_VISIT_CANCEL_POSTED_MESSAGE = '같은 방문의 게시물이 이미 게시돼 있어 취소할 수 없어요. 금액이 이 작업에 있어서, 취소하면 정산이 나가지 않아요.';

// 연결 작업에 막는 편집 — 판정은 패치 후 상태가 아니라 '보냈는가'로 한다(연결 작업에선 이 칸들이 늘 고정이다).
export function sameVisitPatchError(
  cur: { sameVisitOf?: string | null },
  patch: { noCost?: boolean; cost?: TaskCost | null; visitOn?: string | null; visitTime?: string | null; influencerHandle?: string | null; agreementInput?: unknown },
): string | null {
  if (!cur.sameVisitOf) return null;
  if (patch.noCost !== undefined || (patch.cost !== undefined && patch.cost !== null)) return SAME_VISIT_COST_MESSAGE;
  if (patch.visitOn !== undefined || patch.visitTime !== undefined) return SAME_VISIT_VISIT_ON_MESSAGE;
  if (patch.influencerHandle !== undefined) return SAME_VISIT_INFLUENCER_MESSAGE;
  if (patch.agreementInput !== undefined) return SAME_VISIT_AGREEMENT_MESSAGE;
  return null;
}

// 연결 작업을 만들 수 있는 원래 작업인가 — null = 가능(게시 여부와 상관없이, koo 11-09 결정 3)
export function sameVisitCreateError(o: { type: string; cancelledAt: string | null; sameVisitOf?: string | null; influencerHandle: string | null }): string | null {
  if (o.type !== 'visit') return SAME_VISIT_CREATE_MESSAGE.notVisit;
  if (o.sameVisitOf) return SAME_VISIT_CREATE_MESSAGE.linked;
  if (o.cancelledAt) return SAME_VISIT_CREATE_MESSAGE.cancelled;
  if (!o.influencerHandle) return SAME_VISIT_CREATE_MESSAGE.noInfluencer;
  return null;
}

// ── 묶음 ──
// 한 방문 = 원래 작업 + 연결 작업들(취소 제외). 연결 작업이 하나도 없으면 묶음이 아니다(표시·배분 없음).
export interface SameVisitTask { id: string; sameVisitOf?: string | null; cancelledAt?: string | null; cost: TaskCost | null; createdAt?: string }
export interface SameVisitInfo {
  originalId: string;
  ordinal: number;        // 게시물 번호 — 원래 작업 1, 연결 작업은 만든 순서로 2, 3, …
  total: number;          // 이 방문의 게시물 작업 수 N(취소 제외, 게시 전 포함 — 값이 나중에 튀지 않게)
  share: { cost: TaskCost; n: number } | null;   // 원래 작업 비용을 N으로 나눈 몫의 재료. 비용이 없으면 null
}
export function sameVisitGroups<T extends SameVisitTask>(tasks: readonly T[]): Map<string, SameVisitInfo> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const linkedOf = new Map<string, T[]>();
  for (const t of tasks) {
    if (!t.sameVisitOf || t.cancelledAt) continue;
    const list = linkedOf.get(t.sameVisitOf);
    if (list) list.push(t); else linkedOf.set(t.sameVisitOf, [t]);
  }
  const out = new Map<string, SameVisitInfo>();
  for (const [originalId, linked] of linkedOf) {
    const original = byId.get(originalId);
    if (!original || original.cancelledAt) continue;
    linked.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
    const total = linked.length + 1;
    const share = original.cost ? { cost: original.cost, n: total } : null;
    out.set(originalId, { originalId, ordinal: 1, total, share });
    linked.forEach((t, i) => out.set(t.id, { originalId, ordinal: i + 2, total, share }));
  }
  return out;
}

// CPV 옆 설명(UX 원칙 3) — '방문 비용 15,000엔을 게시물 2건에 나눠 계산했어요'
export function shareNote(share: { cost: TaskCost; n: number }): string {
  return `방문 비용 ${formatAmount(share.cost.amount, share.cost.currency)}을 게시물 ${share.n}건에 나눠 계산했어요`;
}

// [게시물 하나 더] 확인 문구 — 무엇이 생기고 무엇이 그대로인지(UX 원칙 2). 방문일은 원래 작업 값(없으면 말하지 않는다)
export function sameVisitConfirmText(o: { influencerHandle: string | null; visitOn: string | null; visitTime: string | null }, visitText: string | null): string {
  const who = o.influencerHandle ? `@${o.influencerHandle}의 ` : '';
  return [
    `${who}이 방문으로 올린 게시물을 하나 더 기록할까요?`,
    '',
    `같은 인플루언서${visitText ? `, 같은 방문(${visitText})` : ''}`,
    '비용 없음: 정산 요청에 들어가지 않아요',
    '예약 없이 게시 확인만 하면 돼요',
    '',
    '방문 수는 그대로 1건이에요.',
  ].join('\n');
}
