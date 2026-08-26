// 추가 비용 배열 편집의 순수 연산 — 다이얼로그는 '항목 하나'를 다루고 저장은 배열 전체를 PUT한다
// (campaign_influencer_cost.extra_costs는 jsonb 한 덩이 — 항목 단위 API가 없다, 스펙 §2-2).
import { formatAmount, type ExtraCost } from './campaignCost.ts';

export function upsertExtraCost(list: ExtraCost[], index: number | null, item: ExtraCost): ExtraCost[] {
  // 범위 밖 index는 '추가'로 — 다이얼로그가 열린 사이 다른 사람이 항목을 지워 index가 낡았을 때 엉뚱한 항목을 덮지 않는다
  if (index === null || index < 0 || index >= list.length) return [...list, item];
  return list.map((x, i) => (i === index ? item : x));
}

export function removeExtraCost(list: ExtraCost[], index: number): ExtraCost[] {
  return list.filter((_, i) => i !== index);
}

/** '교통비 20,000원' — 표의 항목 알약·다이얼로그 제목 */
export function extraCostLabel(e: ExtraCost): string {
  return `${e.label} ${formatAmount(e.amount, e.currency)}`;
}
