import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePricingPatch, mergePricing, diffPricing, normalizeCurrency, formatMoney,
} from './influencerPricing.ts';

test('parsePricingPatch: 유효 입력', () => {
  assert.deepEqual(parsePricingPatch({ rt: 300000, currency: 'JPY' }), { rt: 300000, currency: 'JPY' });
  assert.deepEqual(parsePricingPatch({ post: null }), { post: null });   // 단가 지우기
  assert.deepEqual(parsePricingPatch({}), {});                            // 변경 없음도 유효
});

test('parsePricingPatch: 위반은 null', () => {
  assert.equal(parsePricingPatch({ rt: -1 }), null);          // 음수
  assert.equal(parsePricingPatch({ rt: 1.5 }), null);         // 소수
  assert.equal(parsePricingPatch({ rt: '30만' }), null);      // 문자열
  assert.equal(parsePricingPatch({ unknown: 1 }), null);      // 모르는 키
  assert.equal(parsePricingPatch({ currency: 'USD' }), null); // 지원 외 통화
  assert.equal(parsePricingPatch('x'), null);
  assert.equal(parsePricingPatch(null), null);
});

test('mergePricing: patch에 온 키만 덮는다', () => {
  assert.deepEqual(mergePricing({ rt: 100, post: 200 }, { post: 300 }), { rt: 100, post: 300 });
  assert.deepEqual(mergePricing({ rt: 100 }, { rt: null }), { rt: null }); // null로 지움도 반영
});

test('diffPricing: 실제로 바뀐 것만, 병합 결과 통화 부여', () => {
  const changes = diffPricing({ rt: 100, currency: 'KRW' }, { rt: 100, post: 200 });
  assert.deepEqual(changes, [{ priceType: 'post', from: null, to: 200, currency: 'KRW' }]); // rt는 동일값 → 제외
});

test('diffPricing: 통화 변경은 별도 행 + 이후 금액 변경은 새 통화', () => {
  const changes = diffPricing({ rt: 100 }, { currency: 'JPY', rt: 200 });
  assert.deepEqual(changes, [
    { priceType: 'currency', from: 'KRW', to: 'JPY', currency: 'JPY' }, // base 부재=KRW 간주(스펙 §2)
    { priceType: 'rt', from: 100, to: 200, currency: 'JPY' },
  ]);
});

test('diffPricing: 같은 통화 재전송은 변경 아님', () => {
  assert.deepEqual(diffPricing({ currency: 'KRW', rt: 1 }, { currency: 'KRW' }), []);
});

test('normalizeCurrency: 부재=KRW', () => {
  assert.equal(normalizeCurrency({}), 'KRW');
  assert.equal(normalizeCurrency({ currency: 'JPY' }), 'JPY');
});

test('formatMoney: 천 단위 구분 + 통화 접미', () => {
  assert.equal(formatMoney(300000, 'KRW'), '300,000원');
  assert.equal(formatMoney(30000, 'JPY'), '30,000엔');
});
