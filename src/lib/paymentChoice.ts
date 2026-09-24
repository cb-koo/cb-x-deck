// 작업 패널의 결제 수단 고르기(설계 §8-2) — 조회(paymentView)가 싣는 고를 목록과, 화면이 "이 작업의 수단"을 정하는 규칙.
// 규칙은 정산 후보와 같은 taskPaymentMethod 하나다. DB·postgres import 없음 — 화면이 값으로 import한다.
import { describeMethod, feeShortLabel, taskPaymentMethod, type PaymentMethod } from './influencerPayment.ts';

export type FeeChip = { text: string; cb: boolean };
export type PaymentChoice = { id: string; label: string; fee: FeeChip; isDefault: boolean };

export function toPaymentChoices(list: PaymentMethod[]): PaymentChoice[] {
  return list.map((m) => ({ id: m.id, label: describeMethod(m), fee: feeShortLabel(m.fee, m.currency), isDefault: m.isDefault }));
}

// fallback = 작업이 고른 수단이 그 사이 지워져 기본으로 정산된다(패널이 '기본 수단으로 바뀜 ⓘ'로 알린다, §10)
export function resolvePaymentChoice(choices: PaymentChoice[], chosenId: string | null): { choice: PaymentChoice | null; fallback: boolean } {
  return { choice: taskPaymentMethod(choices, chosenId), fallback: !!chosenId && !choices.some((c) => c.id === chosenId) };
}

// 드롭다운에서 고른 값 → 저장할 값. 기본 수단을 고르면 null(= 기본을 따른다)로 저장한다 — null이 "기본"의 유일한 표기라
// 같은 뜻이 두 값(null / 기본 id)으로 갈리지 않는다. 지워진 id를 쥔 작업도 기본을 고르면 깨끗이 null로 돌아간다.
export function choiceToStored(choices: PaymentChoice[], pickedId: string): string | null {
  const c = choices.find((x) => x.id === pickedId);
  return !c || c.isDefault ? null : c.id;
}
