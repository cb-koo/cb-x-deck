import { formatMoney } from '@/lib/influencerPricing';
import type { MoneyCalc } from '@/lib/settlementCalc';
// '₩30,000 → ¥3,000' + 수수료 조각 '+ 158'. 원가와 지급액을 항상 둘 다, 수수료는 분리(스펙 §4-1 "이름만 바꿔 붙이지 않는다").
// 같은 통화면 화살표 없이 지급액만.
export function formatKrwToPayout(m: MoneyCalc): { base: string; fee: string | null } {
  const cost = formatMoney(m.costAmount, m.costCurrency);
  const net = formatMoney(m.amountNet, m.payoutCurrency);
  const base = m.costCurrency === m.payoutCurrency ? net : `${cost} → ${net}`;
  return { base, fee: m.feeAmount > 0 ? `+ ${m.feeAmount.toLocaleString('ko-KR')}` : null };
}
