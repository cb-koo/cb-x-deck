import type { TaskCost } from './campaignCost';

// 게시 확인 때 비용 받기(koo 11-23 결정) — 비용이 빈 채 게시 확인되면 정산 '보완 필요'에서야 드러나 입금이 밀렸다
// (게시 확인 뒤에야 비용을 채우는 일이 매주 반복됐다).
// 게시 확인하려면 금액을 넣거나 '비용 없음'을 골라야 한다 — 화면(CostAtPostBox)과 서버(작업 PATCH)가 이 파일의 같은 판정을 쓴다.
// '금액은 나중에'는 두지 않는다(koo 결정) — 다시 새는 길이 된다.
export const COST_AT_POST_MESSAGE = "작업 비용을 넣거나 '비용 없음'을 골라야 게시 확인할 수 있어요";
// 0엔은 금액으로 저장돼 0엔 정산 요청이 만들어진다 — 막지 않고 '비용 없음'을 권한다(koo 결정)
export const ZERO_COST_HINT = "0이면 '비용 없음'이 맞아요. 0으로 두면 0원 정산 요청이 만들어져요.";

type CostState = { cost: TaskCost | null; noCost?: boolean };

/** 게시 확인 때 비용을 받아야 하는 작업인가 — 금액도 '비용 없음' 표시도 없는 작업. 같은 방문의 연결 작업은 '비용 없음' 고정이라 해당 없다. */
export function needsCostAtPost(t: CostState): boolean {
  return t.cost === null && !t.noCost;
}

/** 서버 판정 — 이 요청이 첫 게시 확인이고, 패치 뒤에도 금액·'비용 없음'이 둘 다 없으면 거절 문구.
 *  반드시 패치 후 상태로 본다(같은 요청에 비용을 함께 보내는 것이 주 경로다). 이미 게시된 작업의 다른 편집은 막지 않는다. */
export function costAtPostGateError(
  cur: CostState & { postedAt: string | null },
  patch: { postedAt?: string; cost?: TaskCost | null; noCost?: boolean },
): string | null {
  if (!patch.postedAt || cur.postedAt !== null) return null;
  const noCost = patch.noCost !== undefined ? patch.noCost : !!cur.noCost;
  if (noCost) return null;
  const cost = patch.cost !== undefined ? patch.cost : cur.cost;
  return cost === null ? COST_AT_POST_MESSAGE : null;
}

// 지급이 끝난 작업은 '비용 없음'으로 바꾸지 못한다 — 금액이 사유도 이력도 없이 지워진다(065의 '지급 완료 작업은 사유 필수'를 돌아가는 길).
// '비용 없음'을 전 유형에 열면서 막는다(리뷰 11-23). 풀기(false)는 금액을 건드리지 않아 막지 않는다.
export const NO_COST_PAID_MESSAGE = "지급이 끝난 작업은 '비용 없음'으로 바꿀 수 없어요. 금액을 고치려면 비용 칸에서 이유를 적어 주세요.";
export function noCostPaidGateError(patch: { noCost?: boolean }, hasPaidRequest: boolean): string | null {
  return patch.noCost === true && hasPaidRequest ? NO_COST_PAID_MESSAGE : null;
}

// 화면의 선택 — 금액(amount 글자·통화) 또는 '비용 없음'
export type CostAtPostChoice = { noCost: boolean; cost: TaskCost | null };
// 게시 확인 요청에 함께 싣는 비용 — 금액 또는 '비용 없음'(둘 다 없으면 비용이 이미 있는 작업)
export type CostAtPostExtra = { cost?: TaskCost; noCost?: true };
/** 게시 확인 요청에 함께 실을 값 — 받을 필요가 없으면 빈 객체, 아직 못 정했으면 null(버튼을 막는다). */
export function costAtPostExtra(needed: boolean, choice: CostAtPostChoice): CostAtPostExtra | null {
  if (!needed) return {};
  if (choice.noCost) return { noCost: true };
  return choice.cost ? { cost: choice.cost } : null;
}
