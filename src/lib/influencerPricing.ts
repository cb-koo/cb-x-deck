// 협찬 단가 — 유형·통화 상수와 순수 계산(검증·병합·diff·표시). DB 접근 없음.
// PATCH는 "바뀐 키만" 보내고 서버가 병합한다(스펙 §2 부분 병합 — 전체 교체는 스테일 덮어쓰기 여지).
export type Currency = 'KRW' | 'JPY';
export type PriceType = 'rt' | 'quoteRt' | 'post' | 'visit';

export const PRICE_TYPES: readonly PriceType[] = ['rt', 'quoteRt', 'post', 'visit'];
export const PRICE_TYPE_LABEL: Record<PriceType, string> = {
  rt: 'RT', quoteRt: '인용RT', post: '투고', visit: '방문협찬',
};
export const CURRENCY_LABEL: Record<Currency, string> = { KRW: '원', JPY: '엔' };

export interface Pricing {
  currency?: Currency;
  rt?: number | null; quoteRt?: number | null; post?: number | null; visit?: number | null;
}

// currency 부재 = KRW (UI 기본 선택·diff 계산이 같은 규칙을 쓴다 — 라벨-값 일치)
export function normalizeCurrency(p: Pricing): Currency {
  return p.currency ?? 'KRW';
}

const CURRENCIES: readonly Currency[] = ['KRW', 'JPY'];

// 라우트 입력 검증 — 알려진 키만, 금액은 0 이상 정수 또는 null. 위반은 null(라우트가 400으로).
export function parsePricingPatch(v: unknown): Pricing | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Pricing = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === 'currency') {
      if (!CURRENCIES.includes(val as Currency)) return null;
      out.currency = val as Currency;
    } else if ((PRICE_TYPES as readonly string[]).includes(k)) {
      if (val !== null && (typeof val !== 'number' || !Number.isInteger(val) || val < 0)) return null;
      out[k as PriceType] = val as number | null;
    } else {
      return null;
    }
  }
  return out;
}

export function mergePricing(base: Pricing, patch: Pricing): Pricing {
  return { ...base, ...patch };
}

export interface PricingChange {
  priceType: PriceType | 'currency';
  from: number | string | null;
  to: number | string | null;
  currency: Currency;
}

// patch에 온 키 중 실제 값이 달라진 것만 — 같은 값 재전송은 변경이 아니다(불필요한 로그 방지).
export function diffPricing(base: Pricing, patch: Pricing): PricingChange[] {
  const after = normalizeCurrency(mergePricing(base, patch));
  const changes: PricingChange[] = [];
  if (patch.currency !== undefined && patch.currency !== normalizeCurrency(base)) {
    changes.push({ priceType: 'currency', from: normalizeCurrency(base), to: patch.currency, currency: after });
  }
  for (const t of PRICE_TYPES) {
    if (patch[t] === undefined) continue;
    const from = base[t] ?? null;
    const to = patch[t] ?? null;
    if (from !== to) changes.push({ priceType: t, from, to, currency: after });
  }
  return changes;
}

export function formatMoney(amount: number, currency: Currency): string {
  return `${amount.toLocaleString('ko-KR')}${CURRENCY_LABEL[currency]}`;
}
