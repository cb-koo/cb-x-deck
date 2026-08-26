import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCIES, COST_TYPES, COST_TYPE_LABEL, AMOUNT_MESSAGE,
  parseAmount, parseDraftCost, parseExtraCosts,
  sumMoney, mergeMoney, moneyParts, formatAmount, formatMoneyBy, suggestDraftCost,
} from './campaignCost.ts';
import { PRICE_TYPES, PRICE_TYPE_LABEL } from './influencerPricing.ts';

test('1) 리터럴은 influencerPricing과 한 벌 — 재수출이 같은 객체를 가리킨다(문자열 두 벌 금지)', () => {
  assert.equal(COST_TYPES, PRICE_TYPES);
  assert.equal(COST_TYPE_LABEL, PRICE_TYPE_LABEL);
  assert.deepEqual([...CURRENCIES], ['KRW', 'JPY']);
  assert.deepEqual([...COST_TYPES], ['rt', 'quoteRt', 'post', 'visit']);
});

test('2) parseAmount — 0 이상 정수만, 콤마 문자열은 받고 소수·음수·빈 값은 거절', () => {
  assert.equal(parseAmount(0), 0);
  assert.equal(parseAmount(30000), 30000);
  assert.equal(parseAmount('30,000'), 30000);   // 입력칸 값은 문자열이다
  assert.equal(parseAmount(' 12 '), 12);
  assert.equal(parseAmount(-1), null);
  assert.equal(parseAmount(1.5), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
});

test('3) parseDraftCost — null은 지움, 세 필드 검증, 오류 문구가 비어 있지 않다', () => {
  assert.deepEqual(parseDraftCost(null), { ok: true, value: null });
  assert.deepEqual(parseDraftCost({ type: 'post', amount: '50000', currency: 'JPY' }),
    { ok: true, value: { type: 'post', amount: 50000, currency: 'JPY' } });
  const badType = parseDraftCost({ type: 'gift', amount: 1, currency: 'KRW' });
  assert.equal(badType.ok, false);
  const badAmount = parseDraftCost({ type: 'rt', amount: -5, currency: 'KRW' });
  assert.equal(badAmount.ok, false);
  if (!badAmount.ok) assert.equal(badAmount.message, AMOUNT_MESSAGE);
  assert.equal(parseDraftCost({ type: 'rt', amount: 1, currency: 'USD' }).ok, false);
  assert.equal(parseDraftCost('x').ok, false);
});

test('4) parseExtraCosts — 항목명 공백 트림·필수, 배열 아니면 거절', () => {
  const ok = parseExtraCosts([{ label: ' 교통비 ', amount: 20000, currency: 'KRW' }]);
  assert.deepEqual(ok, { ok: true, value: [{ label: '교통비', amount: 20000, currency: 'KRW' }] });
  assert.deepEqual(parseExtraCosts([]), { ok: true, value: [] });
  assert.equal(parseExtraCosts([{ label: '  ', amount: 1, currency: 'KRW' }]).ok, false);
  assert.equal(parseExtraCosts({ label: 'x' }).ok, false);
});

test('5) 통화별 합계 — 통화 간 합산 금지, 원→엔 고정 순서, 비면 —', () => {
  const m = sumMoney([
    { amount: 300000, currency: 'KRW' }, { amount: 60000, currency: 'KRW' }, { amount: 95000, currency: 'JPY' },
  ]);
  assert.deepEqual(m, { KRW: 360000, JPY: 95000 });
  assert.deepEqual(mergeMoney({ KRW: 1 }, { JPY: 2 }, { KRW: 3 }), { KRW: 4, JPY: 2 });
  assert.deepEqual(moneyParts({ JPY: 5, KRW: 1 }), [{ currency: 'KRW', amount: 1 }, { currency: 'JPY', amount: 5 }]);
  assert.equal(formatAmount(360000, 'KRW'), '360,000원');           // = influencerPricing.formatMoney
  assert.equal(formatMoneyBy({ KRW: 360000, JPY: 95000 }), '360,000원 · 95,000엔');
  assert.equal(formatMoneyBy({}), '—');
  assert.equal(formatMoneyBy({ KRW: 0 }), '0원'); // 0은 값이다 — '없음'과 다르다
});

test('6) suggestDraftCost — pricing[type]이 있을 때만, 통화는 pricing 레벨 하나(normalizeCurrency, 기본 KRW)', () => {
  assert.deepEqual(suggestDraftCost({ post: 50000, currency: 'JPY' }, 'post'), { type: 'post', amount: 50000, currency: 'JPY' });
  assert.deepEqual(suggestDraftCost({ rt: 100000 }, 'rt'), { type: 'rt', amount: 100000, currency: 'KRW' });
  assert.equal(suggestDraftCost({ rt: 100000 }, 'visit'), null);   // 그 유형 금액이 없으면 제안 없음
  assert.equal(suggestDraftCost({ rt: null }, 'rt'), null);        // 단가 지움(null)도 제안 없음
  assert.equal(suggestDraftCost({}, 'post'), null);
  assert.equal(suggestDraftCost(null, 'post'), null);
  assert.equal(suggestDraftCost(undefined, 'post'), null);         // 명부에 없는 핸들(InfluencerOption 없음)
  assert.equal(suggestDraftCost({ post: 1.5 }, 'post'), null);     // jsonb는 모양을 보증하지 않는다 — 정수 아니면 제안 없음
});
