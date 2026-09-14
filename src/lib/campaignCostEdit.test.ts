import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertExtraCost, removeExtraCost, extraCostLabel } from './campaignCostEdit.ts';
import type { ExtraCost } from './campaignCost.ts';

const a: ExtraCost = { label: '교통비', amount: 20000, currency: 'KRW' };
const b: ExtraCost = { label: '선물', amount: 5000, currency: 'JPY' };

test('1) upsert — index null이면 뒤에 추가, 범위 안이면 교체, 범위 밖이면 추가(스테일 index 방어). 원본 불변', () => {
  const list = [a];
  assert.deepEqual(upsertExtraCost(list, null, b), [a, b]);
  assert.deepEqual(upsertExtraCost([a, b], 0, { ...a, amount: 30000 }), [{ ...a, amount: 30000 }, b]);
  assert.deepEqual(upsertExtraCost([a], 5, b), [a, b]);
  assert.deepEqual(list, [a]);
});

test('2) remove — index 하나만, 범위 밖은 그대로', () => {
  assert.deepEqual(removeExtraCost([a, b], 0), [b]);
  assert.deepEqual(removeExtraCost([a, b], 9), [a, b]);
});

test('3) 항목 표기 — 이름 + 금액(통화 병기 규칙은 formatAmount)', () => {
  assert.equal(extraCostLabel(a), '교통비 20,000원');
  assert.equal(extraCostLabel(b), '선물 5,000엔');
});
