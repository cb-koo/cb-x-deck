import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowCostUsd, formatMoney } from './usagePricing.ts';

test('getxapi: 콜당 $0.001', () => {
  assert.equal(rowCostUsd({ api: 'getxapi', operation: 'getxapi.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 }), 1);
});

test('exa: 검색당 $0.007', () => {
  assert.equal(rowCostUsd({ api: 'exa', operation: 'exa.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 }), 7);
});

test('anthropic haiku: 입력 $1/출력 $5 per 1M', () => {
  const c = rowCostUsd({ api: 'anthropic', operation: 'anthropic.suggest', model: 'claude-haiku-4-5-20251001', calls: 1, inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.equal(c, 6); // 1*1 + 1*5
});

test('anthropic 모델 미상/누락이면 haiku 단가로 폴백', () => {
  const c = rowCostUsd({ api: 'anthropic', operation: 'anthropic.suggest', model: null, calls: 1, inputTokens: 2_000_000, outputTokens: 0 });
  assert.equal(c, 2);
});

test('formatMoney: 1달러 미만은 4자리, 이상은 2자리', () => {
  assert.equal(formatMoney(0.007), '$0.0070');
  assert.equal(formatMoney(12.5), '$12.50');
});
