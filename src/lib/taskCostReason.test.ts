// 지급이 끝난 작업의 금액 수정은 사유 필수(스펙 2026-10-07 §6) — 라우트 하네스가 없어 판정을 순수 함수로 뺐다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costReasonGateError, parseTaskPatch, PAID_COST_REASON_MESSAGE, COST_REASON_MAX } from './campaignTaskInput.ts';

const c = (amount: number) => ({ amount, currency: 'JPY' as const });

test('costReasonGateError — 지급 완료 작업의 금액을 실제로 바꿀 때만 사유가 필요하다', () => {
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: '' }), PAID_COST_REASON_MESSAGE);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: '   ' }), PAID_COST_REASON_MESSAGE);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: undefined }), PAID_COST_REASON_MESSAGE);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: true, reason: '인용 6000엔' }), null);
  assert.equal(costReasonGateError({ before: c(4000), next: c(6000), hasPaidRequest: false, reason: '' }), null);   // 지급 전 — 사유 없어도 된다
  assert.equal(costReasonGateError({ before: c(4000), next: c(4000), hasPaidRequest: true, reason: '' }), null);    // 같은 값 재전송
  assert.equal(costReasonGateError({ before: c(4000), next: undefined, hasPaidRequest: true, reason: '' }), null);   // 금액을 안 바꾸는 PATCH
  assert.equal(costReasonGateError({ before: c(4000), next: null, hasPaidRequest: true, reason: '' }), PAID_COST_REASON_MESSAGE);   // 지우기도 바꾸기
});

test('parseTaskPatch — costReason은 다듬고 200자로 자른다', () => {
  const p = parseTaskPatch({ cost: { amount: 6000, currency: 'JPY' }, costReason: '  인용 6000엔  ' });
  assert.ok(p.ok); assert.equal(p.value.costReason, '인용 6000엔');
  const long = parseTaskPatch({ cost: { amount: 6000, currency: 'JPY' }, costReason: 'x'.repeat(300) });
  assert.ok(long.ok); assert.equal(long.value.costReason?.length, COST_REASON_MAX);
  const none = parseTaskPatch({ cost: { amount: 6000, currency: 'JPY' } });
  assert.ok(none.ok); assert.equal(none.value.costReason, undefined);
});
