// 결제 수단 폼의 입력 상태·변환 — 인플 프로필(PaymentSection)과 작업 패널의 등록 창(PaymentMethodDialog)이 같이 쓴다(설계 §8-3).
// DB·postgres import 없음 — 화면이 값으로 import한다. 검증은 서버와 같은 parsePaymentMethodInput 한 벌.
import type { Currency } from './influencerPricing.ts';
import { PAYMENT_TYPES, parsePaymentMethodInput, type PaymentMethod, type PaymentMethodInput, type PaymentMethodType } from './influencerPayment.ts';

// 수취인 칸의 이름은 유형에 따라 바뀐다 — 계좌이체에서 '수취인명'은 정산 담당이 쓰는 말이 아니다.
export const holderLabel = (t: PaymentMethodType) => (t === 'bank' ? '예금주' : '수취인명');

export type FeeMode = 'none' | 'grossUp' | 'fixed';
export const FEE_MODE_LABEL: Record<FeeMode, string> = {
  none: '인플 부담',
  grossUp: 'CB 부담 (비율)',
  fixed: 'CB 부담 (고정액)',
};

export interface MethodDraft {
  type: PaymentMethodType; holder: string; currency: Currency;
  email: string; paypalId: string; identifier: string; qr: string;
  bank: string; branch: string; account: string;
  feeMode: FeeMode; feePercent: string; feeAmount: string;
  memo: string; makeDefault: boolean;
}

export function methodDraftOf(m: PaymentMethod | null): MethodDraft {
  return {
    // 새 수단의 기본값: 유형은 목록 첫 번째, 통화는 ¥ — 이 통화는 '인플이 받는 돈의 통화(지급 통화)'라
    // 단가(₩ 기본, 캠페인 관리 기준)와 다른 질문이다. 실데이터 91건 중 84건이 엔화(koo 결정 08-27).
    type: m?.type ?? PAYMENT_TYPES[0],
    holder: m?.holder ?? '',
    currency: m?.currency ?? 'JPY',
    email: m?.email ?? '',
    paypalId: m?.paypalId ?? '',
    identifier: m?.identifier ?? '',
    qr: m?.qr ?? '',
    bank: m?.bank ?? '',
    branch: m?.branch ?? '',
    account: m?.account ?? '',
    feeMode: m?.fee?.mode ?? 'none',
    feePercent: m?.fee?.mode === 'grossUp' ? String(m.fee.percent) : '5',
    feeAmount: m?.fee?.mode === 'fixed' ? String(m.fee.amount) : '',
    memo: m?.memo ?? '',
    makeDefault: false,
  };
}

// 빈 칸은 0이 아니라 "안 적음" — Number('')=0이면 수수료 금액을 비워도 0원으로 통과해 버린다.
function numOf(s: string): number {
  const t = s.replace(/[,\s]/g, '');
  return t === '' ? NaN : Number(t);
}

// 폼 값 → 라우트에 보낼 입력. 유형에 맞지 않는 칸도 그대로 실어 보내고, 버리는 일은 parsePaymentMethodInput이 한다 —
// 클라이언트와 서버가 같은 한 벌 규칙을 쓴다(문구도 같아진다).
export function methodInputOf(d: MethodDraft): unknown {
  const fee = d.feeMode === 'grossUp' ? { mode: 'grossUp', percent: numOf(d.feePercent) }
    : d.feeMode === 'fixed' ? { mode: 'fixed', amount: numOf(d.feeAmount) }
      : undefined;
  return {
    type: d.type, holder: d.holder, currency: d.currency,
    email: d.email, paypalId: d.paypalId, identifier: d.identifier, qr: d.qr,
    bank: d.bank, branch: d.branch, account: d.account,
    fee, memo: d.memo,
  };
}

export const parseMethodDraft = (d: MethodDraft): PaymentMethodInput | string => parsePaymentMethodInput(methodInputOf(d));

// 등록 응답(배열 전체 스냅샷)에서 방금 생긴 수단 id — 등록 전 id 목록에 없던 것(설계 §8-3). 없으면 null.
export function newMethodIdOf(beforeIds: readonly string[], after: readonly { id: string }[]): string | null {
  const before = new Set(beforeIds);
  return after.find((m) => !before.has(m.id))?.id ?? null;
}
