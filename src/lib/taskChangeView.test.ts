import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_CHANGE_SOURCE_TEXT, costText } from './taskChangeView.ts';

test('이력 출처 문장 — 스펙 §9 그대로', () => {
  assert.deepEqual(TASK_CHANGE_SOURCE_TEXT, {
    settlement: '정산 화면에서 정산팀 지급 금액에 맞췄어요',
    campaign: '캠페인 화면에서 고쳤어요',
    replace: '인플루언서를 바꾸면서 고쳤어요',
  });
});
test('costText — 금액 없으면 —', () => {
  assert.equal(costText({ amount: 6000, currency: 'JPY' }), '6,000엔');
  assert.equal(costText(null), '—');
});
