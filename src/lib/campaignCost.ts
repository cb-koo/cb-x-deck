// 캠페인 비용의 순수 로직 — 입력 검증, 통화별 합계, 표기, 단가 제안.
// 통화 리터럴과 단일 금액 표기는 influencerPricing.ts(032 협찬 단가)의 것을 그대로 쓴다 — 같은 문자열을
// 두 벌 두면 한쪽만 고쳐지는 드리프트가 나고, 인플 프로필의 단가 칸과 캠페인 비용 칸이 다른 말을 하게 된다(스펙 §2-3).
// 서버(라우트 검증)와 브라우저(팝오버·표)가 같은 함수를 쓴다.
import { normalizeCurrency, formatMoney, type Currency, type PriceType, type Pricing } from './influencerPricing.ts';

export {
  CURRENCY_LABEL, normalizeCurrency,
  formatMoney as formatAmount,   // 단일 금액 '360,000원' — 이름을 바꿔 내보내는 이유: 아래 formatMoneyBy(통화별 병기)와 헷갈리지 않게
  type Currency, type PriceType, type Pricing,
} from './influencerPricing.ts';
// 유형 리터럴은 재수출하지 않는다 — 캠페인의 단위는 작업이고, 유형 이름/라벨은 campaignJudgment의 TASK_TYPES·TASK_TYPE_LABEL 하나뿐이다.

// influencerPricing은 통화 목록을 내보내지 않는다(내부 상수) — 표·카드가 그리는 고정 순서(원 → 엔)로 여기서 든다.
export const CURRENCIES: readonly Currency[] = ['KRW', 'JPY'];

export interface ExtraCost { label: string; amount: number; currency: Currency }
// 통화별 합계 — 키가 없는 통화는 0이 아니라 '해당 없음'. 통화 간 합산은 어디서도 하지 않는다(스펙 §2-4).
export type MoneyByCurrency = Partial<Record<Currency, number>>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
export const AMOUNT_MESSAGE = '금액은 0 이상의 정수로 입력해 주세요';
export const CURRENCY_MESSAGE = '통화는 원(KRW) 또는 엔(JPY)만 고를 수 있어요';
export const EXTRA_LABEL_MESSAGE = '추가 비용 항목 이름을 입력해 주세요';

export function isCurrency(v: unknown): v is Currency {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);
}

// 0 이상 정수만(단가 검증 parsePricingPatch 규칙과 동일, 스펙 §7). 문자열('30,000')도 받는다 — 입력칸 값은 문자열이다.
// isSafeInteger(정수이면서 2^53 미만)를 쓴다 — isInteger만으로는 1e300처럼 '정수처럼 보이는' 거대한 값이
// 통과해 campaignStore.totalsFor의 SQL ::bigint 캐스팅에서 터진다(/campaigns가 500이 됨, 최종 리뷰 Critical).
export function parseAmount(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

export function parseExtraCosts(v: unknown): Parsed<ExtraCost[]> {
  if (!Array.isArray(v)) return { ok: false, message: '추가 비용 형식이 올바르지 않아요' };
  const out: ExtraCost[] = [];
  for (const item of v) {
    const o = (item ?? {}) as { label?: unknown; amount?: unknown; currency?: unknown };
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!label) return { ok: false, message: EXTRA_LABEL_MESSAGE };
    const amount = parseAmount(o.amount);
    if (amount === null) return { ok: false, message: AMOUNT_MESSAGE };
    if (!isCurrency(o.currency)) return { ok: false, message: CURRENCY_MESSAGE };
    out.push({ label, amount, currency: o.currency });
  }
  return { ok: true, value: out };
}

export function sumMoney(items: ReadonlyArray<{ amount: number; currency: Currency }>): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const it of items) out[it.currency] = (out[it.currency] ?? 0) + it.amount;
  return out;
}

export function mergeMoney(...parts: MoneyByCurrency[]): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const p of parts) {
    for (const c of CURRENCIES) {
      const v = p[c];
      if (v !== undefined) out[c] = (out[c] ?? 0) + v;
    }
  }
  return out;
}

// 통화 고정 순서(원 → 엔)로 존재하는 것만 — 표·카드가 같은 순서로 그린다
export function moneyParts(m: MoneyByCurrency): Array<{ currency: Currency; amount: number }> {
  return CURRENCIES.filter((c) => m[c] !== undefined).map((c) => ({ currency: c, amount: m[c] as number }));
}

// '360,000원 · 95,000엔' — 통화 병기, 합치지 않는다. 비어 있으면 '—'(값 없음 관례). 단일 금액은 formatAmount(재수출).
export function formatMoneyBy(m: MoneyByCurrency): string {
  const parts = moneyParts(m);
  return parts.length ? parts.map((p) => formatMoney(p.amount, p.currency)).join(' · ') : '—';
}

// 작업 비용(스펙 §2-1) — 유형은 작업 컬럼에 있으므로 금액·통화만. 옛 draft.cost 모양({type,...})이 와도 type은 무시한다(이관 SQL이 잘라낸다).
export interface TaskCost { amount: number; currency: Currency }
export function parseTaskCost(v: unknown): Parsed<TaskCost | null> {
  if (v === null) return { ok: true, value: null };
  if (!v || typeof v !== 'object') return { ok: false, message: '비용 형식이 올바르지 않아요' };
  const o = v as { amount?: unknown; currency?: unknown };
  const amount = parseAmount(o.amount);
  if (amount === null) return { ok: false, message: AMOUNT_MESSAGE };
  if (!isCurrency(o.currency)) return { ok: false, message: CURRENCY_MESSAGE };
  return { ok: true, value: { amount, currency: o.currency } };
}
// 작업 추가·인플 변경 시 제안 — 금액 = pricing[type], 통화 = pricing 레벨(normalizeCurrency). 없으면 null(빈 칸, §4-2).
export function suggestTaskCost(pricing: Pricing | null | undefined, type: PriceType): TaskCost | null {
  if (!pricing) return null;
  const amount = parseAmount(pricing[type]);
  if (amount === null) return null;
  return { amount, currency: normalizeCurrency(pricing) };
}
